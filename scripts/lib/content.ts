// The data files (content/posts.json, content/state.json, sources.md), the site's static data, and HTML helpers.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sanitize from 'sanitize-html';
import { normalizeUrl, slugify, toSummary } from '../../shared/feed';
import type { ContentState, Db, FeedIndex, Post, Settings, SiteConfig, Source, SourceStatus } from '../../shared/models';
import { parseSourcesMd } from '../../shared/sources-md';
import type { RawItem } from './ai';

export const POSTS_FILE = 'content/posts.json';
export const STATE_FILE = 'content/state.json';
export const SOURCES_FILE = 'sources.md';
export const RUNS_KEPT = 50;
export const DAY_MS = 86_400_000;

export const DEFAULT_SETTINGS: Settings = {
  maxAiCallsPerRun: 15,
  retentionDays: 30,
};

export const newId = (): string => randomUUID();

export function uniqueSlug(text: string, taken: Set<string>): string {
  const base = slugify(text) || `post-${randomBytes(4).toString('hex').slice(0, 6)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

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
    return { ...def, id: sourceIdFor(def.feedUrl), ...(status[normalizeUrl(def.feedUrl)] ?? {}) };
  });

  return {
    version: 1,
    posts,
    sources,
    runs: state.runs ?? [],
    seen: state.seen ?? {},
    settings: {
      maxAiCallsPerRun: state.settings?.maxAiCallsPerRun ?? DEFAULT_SETTINGS.maxAiCallsPerRun,
      retentionDays: state.settings?.retentionDays ?? DEFAULT_SETTINGS.retentionDays,
    },
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
    if (Object.keys(st).length) sourceStatus[normalizeUrl(s.feedUrl)] = st;
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

/** owner/name from an https or ssh GitHub remote url. */
export function repoFromRemote(remote: string): string | undefined {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** content/posts.json → the static files the site reads (published posts only, HTML sanitized). */
export async function buildPublic(opts: { root: string; outDir: string; repo: string; branch: string }): Promise<{ posts: number }> {
  const db = await loadContent(opts.root);
  const published = db.posts
    .filter((p) => p.status === 'published' && p.publishedAt)
    .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!));

  await rm(opts.outDir, { recursive: true, force: true });
  await mkdir(join(opts.outDir, 'p'), { recursive: true });

  const index: FeedIndex = { generatedAt: new Date().toISOString(), posts: published.map(toSummary) };
  await writeFile(join(opts.outDir, 'posts.json'), JSON.stringify(index));
  for (const post of published) {
    await writeFile(join(opts.outDir, 'p', `${post.slug}.json`), JSON.stringify({ ...post, bodyHtml: sanitizeHtml(post.bodyHtml) }));
  }
  const site: SiteConfig = { repo: opts.repo, branch: opts.branch, gatherWorkflow: 'gather.yml', schedule: '0 3 * * *' };
  await writeFile(join(opts.outDir, 'site.json'), JSON.stringify(site, null, 2));
  return { posts: published.length };
}

const SANITIZE_OPTIONS: sanitize.IOptions = {
  allowedTags: ['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'strong', 'em', 'img', 'hr', 'br', 's'],
  allowedAttributes: { a: ['href', 'rel', 'target'], img: ['src', 'alt'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizeHtml(html: string): string {
  return sanitize(html, SANITIZE_OPTIONS);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderStoryBody(keyPoints: string[], whyItMatters: string): string {
  const points = keyPoints.map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  return `<h3>Key points</h3><ul>${points}</ul><h3>Why it matters</h3><p>${escapeHtml(whyItMatters)}</p>`;
}

export function renderFallbackBody(items: RawItem[]): string {
  return items
    .filter((i) => i.snippet)
    .map((i) => `<p><strong>${escapeHtml(i.siteName)}:</strong> ${escapeHtml(i.snippet)}</p>`)
    .join('');
}
