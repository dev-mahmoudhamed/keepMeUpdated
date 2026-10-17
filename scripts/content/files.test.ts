import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db, Post, Run } from '../../shared/models';
import { DEFAULT_SETTINGS, applyRetention, loadContent, saveContent, sourceIdFor } from './files';

const SOURCES_MD = `## Angular

| Name | Feed | Website | Tags | Enabled |
| --- | --- | --- | --- | --- |
| Angular Blog | https://blog.angular.dev/feed | https://blog.angular.dev | angular | yes |
`;

const post = (id: string, over: Partial<Post> = {}): Post => ({
  id,
  slug: id,
  title: `Post ${id}`,
  tldr: 't',
  bodyHtml: '<p>b</p>',
  tags: [],
  sources: [],
  relevance: 5,
  status: 'published',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-16T04:00:00.000Z',
  updatedAt: '2026-10-16T04:00:00.000Z',
  publishedAt: '2026-10-16T04:00:00.000Z',
  ...over,
});

const run = (i: number): Run => ({
  id: `r${i}`,
  trigger: 'cron',
  startedAt: '2026-10-16T03:00:00.000Z',
  status: 'success',
  stats: { fetched: 0, fresh: 0, clusters: 0, created: 0, merged: 0, skipped: 0 },
  errors: [],
  log: [],
});

describe('content files', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kmu-content-'));
  });

  it('loads defaults when content files are missing', async () => {
    const db = await loadContent(root);
    expect(db).toEqual({ version: 1, posts: [], sources: [], runs: [], seen: {}, settings: DEFAULT_SETTINGS });
    expect(DEFAULT_SETTINGS.retentionDays).toBe(30);
  });

  it('round-trips posts, state and source status', async () => {
    await writeFile(join(root, 'sources.md'), SOURCES_MD);
    const db = await loadContent(root);
    db.posts.push(post('a'));
    db.runs.push(run(1));
    db.seen['https://x.test/a'] = '2026-10-16T04:00:00.000Z';
    db.sources[0].lastFetchedAt = '2026-10-16T03:00:00.000Z';
    db.sources[0].lastItemCount = 10;
    await saveContent(root, db);

    const again = await loadContent(root);
    expect(again).toEqual(db);
    // Keyed by normalized feed url so the browser admin can match status to sources.md rows.
    expect(JSON.parse(await readFile(join(root, 'content/state.json'), 'utf8')).sourceStatus).toEqual({
      'https://blog.angular.dev/feed': { lastFetchedAt: '2026-10-16T03:00:00.000Z', lastItemCount: 10 },
    });
  });

  it('only rewrites files whose content changed', async () => {
    const db = await loadContent(root);
    expect((await saveContent(root, db)).changed.sort()).toEqual(['content/posts.json', 'content/state.json']);
    expect((await saveContent(root, db)).changed).toEqual([]);
    db.posts.push(post('b'));
    expect((await saveContent(root, db)).changed).toEqual(['content/posts.json']);
  });

  it('never writes sources.md', async () => {
    await writeFile(join(root, 'sources.md'), SOURCES_MD);
    const db = await loadContent(root);
    db.sources[0].name = 'Changed';
    await saveContent(root, db);
    expect(await readFile(join(root, 'sources.md'), 'utf8')).toBe(SOURCES_MD);
  });

  it('gives sources stable ids from their feed url', () => {
    expect(sourceIdFor('https://www.blog.angular.dev/feed/')).toBe(sourceIdFor('https://blog.angular.dev/feed'));
    expect(sourceIdFor('https://blog.angular.dev/feed')).toMatch(/^[0-9a-f]{12}$/);
    expect(sourceIdFor('https://a.test/feed')).not.toBe(sourceIdFor('https://b.test/feed'));
  });

  it('throws on invalid JSON', async () => {
    await mkdir(join(root, 'content'), { recursive: true });
    await writeFile(join(root, 'content/posts.json'), '{oops');
    await expect(loadContent(root)).rejects.toThrow(/content\/posts\.json is not valid JSON/);
  });
});

describe('applyRetention', () => {
  const now = new Date('2026-10-17T00:00:00.000Z');
  const db = (): Db => ({
    version: 1,
    posts: [
      post('edge', { publishedAt: '2026-09-17T00:00:00.000Z' }),
      post('old', { publishedAt: '2026-09-16T23:59:59.000Z' }),
      post('old-draft', { status: 'draft', publishedAt: undefined, createdAt: '2026-09-01T00:00:00.000Z' }),
      post('new-draft', { status: 'draft', publishedAt: undefined, createdAt: '2026-10-10T00:00:00.000Z' }),
    ],
    sources: [],
    runs: Array.from({ length: 55 }, (_, i) => run(i)),
    seen: { 'https://old.test': '2026-09-01T00:00:00.000Z', 'https://new.test': '2026-10-16T00:00:00.000Z' },
    settings: DEFAULT_SETTINGS,
  });

  it('prunes posts and seen links older than retentionDays', () => {
    const d = db();
    expect(applyRetention(d, now)).toEqual({ removedPosts: 2, removedSeen: 1 });
    expect(d.posts.map((p) => p.id)).toEqual(['edge', 'new-draft']);
    expect(Object.keys(d.seen)).toEqual(['https://new.test']);
    expect(d.runs).toHaveLength(50);
  });
});
