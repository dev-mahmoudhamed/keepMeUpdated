import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContentState, Db, Post, Settings, Source, SourceStatus } from '../../shared/models';
import { normalizeUrl } from '../gather/dedupe';
import { parseSourcesMd } from '../../shared/sources-md';

export const POSTS_FILE = 'content/posts.json';
export const STATE_FILE = 'content/state.json';
export const SOURCES_FILE = 'sources.md';
const RUNS_KEPT = 50;
const DAY_MS = 86_400_000;

export const DEFAULT_SETTINGS: Settings = {
  relevanceThreshold: 6,
  maxItemAgeHours: 48,
  maxAiCallsPerRun: 15,
  retentionDays: 30,
};

/** Stable id for a source, so its fetch history survives edits to sources.md. */
export function sourceIdFor(feedUrl: string): string {
  return createHash('sha1').update(normalizeUrl(feedUrl)).digest('hex').slice(0, 12);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

function parseJson<T>(text: string, file: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${file} is not valid JSON — fix or restore it from git history`);
  }
}

/** Assemble the working data from content/posts.json, content/state.json and sources.md. */
export async function loadContent(root: string): Promise<Db> {
  const postsText = await readOptional(join(root, POSTS_FILE));
  const stateText = await readOptional(join(root, STATE_FILE));
  const sourcesText = await readOptional(join(root, SOURCES_FILE));

  const posts = postsText ? parseJson<Post[]>(postsText, POSTS_FILE) : [];
  const state = stateText ? parseJson<Partial<ContentState>>(stateText, STATE_FILE) : {};
  const status = state.sourceStatus ?? {};

  const sources: Source[] = (sourcesText ? parseSourcesMd(sourcesText).sources : []).map((def) => {
    const id = sourceIdFor(def.feedUrl);
    return { ...def, id, ...(status[id] ?? {}) };
  });

  return {
    version: 1,
    posts,
    sources,
    runs: state.runs ?? [],
    seen: state.seen ?? {},
    settings: { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) },
  };
}

const postTime = (p: Post) => p.publishedAt ?? p.createdAt;

function stateOf(db: Db): ContentState {
  const sourceStatus: Record<string, SourceStatus> = {};
  for (const s of db.sources) {
    const st: SourceStatus = {
      ...(s.lastFetchedAt ? { lastFetchedAt: s.lastFetchedAt } : {}),
      ...(s.lastError ? { lastError: s.lastError } : {}),
      ...(s.lastItemCount !== undefined ? { lastItemCount: s.lastItemCount } : {}),
    };
    if (Object.keys(st).length) sourceStatus[s.id] = st;
  }
  return { version: 1, settings: db.settings, seen: db.seen, runs: db.runs, sourceStatus };
}

async function writeIfChanged(root: string, file: string, text: string): Promise<boolean> {
  const path = join(root, file);
  if ((await readOptional(path)) === text) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, text, 'utf8');
  await rename(`${path}.tmp`, path);
  return true;
}

/** Write posts and state (never sources.md — the gather doesn't change sources). */
export async function saveContent(root: string, db: Db): Promise<{ changed: string[] }> {
  const posts = [...db.posts].sort((a, b) => postTime(b).localeCompare(postTime(a)));
  const changed: string[] = [];
  if (await writeIfChanged(root, POSTS_FILE, `${JSON.stringify(posts, null, 2)}\n`)) changed.push(POSTS_FILE);
  if (await writeIfChanged(root, STATE_FILE, `${JSON.stringify(stateOf(db), null, 2)}\n`)) changed.push(STATE_FILE);
  return { changed };
}

/** Delete posts and seen links older than settings.retentionDays; cap the run log. */
export function applyRetention(db: Db, now: Date): { removedPosts: number; removedSeen: number } {
  const cutoff = now.getTime() - db.settings.retentionDays * DAY_MS;
  const before = db.posts.length;
  db.posts = db.posts.filter((p) => Date.parse(postTime(p)) >= cutoff);
  let removedSeen = 0;
  for (const [url, at] of Object.entries(db.seen)) {
    if (Date.parse(at) < cutoff) {
      delete db.seen[url];
      removedSeen++;
    }
  }
  db.runs.splice(RUNS_KEPT);
  return { removedPosts: before - db.posts.length, removedSeen };
}
