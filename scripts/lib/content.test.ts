import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db, Post, Run } from '../../shared/models';
import { DEFAULT_SETTINGS, applyRetention, loadContent, saveContent, sourceIdFor, buildPublic, repoFromRemote, newId, uniqueSlug, sanitizeHtml, renderStoryBody, renderFallbackBody, escapeHtml } from './content';
import { slugify } from '../../shared/feed';
import { existsSync } from 'node:fs';

describe('content-files', () => {
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
  stats: { fetched: 0, fresh: 0, clusters: 0, created: 0, merged: 0 },
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
    expect(DEFAULT_SETTINGS.retentionDays).toBe(120);
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
    settings: { ...DEFAULT_SETTINGS, retentionDays: 30 },
  });

  it('prunes posts and seen links older than retentionDays', () => {
    const d = db();
    expect(applyRetention(d, now)).toEqual({ removedPosts: 2, removedSeen: 1 });
    expect(d.posts.map((p) => p.id)).toEqual(['edge', 'new-draft']);
    expect(Object.keys(d.seen)).toEqual(['https://new.test']);
    expect(d.runs).toHaveLength(50);
  });
});
});

describe('buildPublic', () => {
const post = (id: string, over: Partial<Post> = {}): Post => ({
  id,
  slug: `slug-${id}`,
  title: id,
  tldr: 't',
  bodyHtml: '<p>ok</p>',
  tags: ['x'],
  sources: [{ siteName: 'S', url: 'https://s.test', title: 's' }],
  relevance: 5,
  status: 'published',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  publishedAt: '2026-10-15T00:00:00.000Z',
  ...over,
});

describe('buildPublic', () => {
  let root: string;
  let out: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kmu-pub-'));
    out = join(root, 'public/data');
    await mkdir(join(root, 'content'));
    await writeFile(
      join(root, 'content/posts.json'),
      JSON.stringify([
        post('older', { publishedAt: '2026-10-14T00:00:00.000Z' }),
        post('newer', { publishedAt: '2026-10-16T00:00:00.000Z', bodyHtml: '<p onclick="x()">hi</p><script>alert(1)</script>' }),
        post('draft', { status: 'draft', publishedAt: undefined }),
        post('hidden', { status: 'hidden' }),
      ]),
    );
  });

  const json = async (rel: string) => JSON.parse(await readFile(join(out, rel), 'utf8'));

  it('writes only published posts to the public index, newest first', async () => {
    expect(await buildPublic({ root, outDir: out, repo: 'me/kmu', branch: 'main' })).toEqual({ posts: 2 });
    const index = await json('posts.json');
    expect(index.posts.map((p: { id: string }) => p.id)).toEqual(['newer', 'older']);
    expect(index.posts[0]).toEqual(expect.objectContaining({ slug: 'slug-newer', sourceCount: 1 }));
    expect(index.posts[0].bodyHtml).toBeUndefined();
    expect(existsSync(join(out, 'p/slug-draft.json'))).toBe(false);
    expect(existsSync(join(out, 'p/slug-hidden.json'))).toBe(false);
  });

  it('sanitizes bodyHtml in public post files', async () => {
    await buildPublic({ root, outDir: out, repo: 'me/kmu', branch: 'main' });
    const p = await json('p/slug-newer.json');
    expect(p.bodyHtml).toBe('<p>hi</p>');
  });

  it('writes site.json with the repo', async () => {
    await buildPublic({ root, outDir: out, repo: 'me/kmu', branch: 'main' });
    expect(await json('site.json')).toEqual({ repo: 'me/kmu', branch: 'main', gatherWorkflow: 'gather.yml', schedule: '0 3 * * *' });
  });

  it('removes stale public files', async () => {
    await mkdir(join(out, 'p'), { recursive: true });
    await writeFile(join(out, 'p/gone.json'), '{}');
    await buildPublic({ root, outDir: out, repo: 'me/kmu', branch: 'main' });
    expect(existsSync(join(out, 'p/gone.json'))).toBe(false);
  });
});

it('reads owner/name from a git remote url', () => {
  expect(repoFromRemote('https://github.com/dev-mahmoudhamed/keepMeUpdated.git')).toBe('dev-mahmoudhamed/keepMeUpdated');
  expect(repoFromRemote('git@github.com:me/kmu.git')).toBe('me/kmu');
  expect(repoFromRemote('https://gitlab.com/x/y')).toBeUndefined();
});
});

describe('ids', () => {
it('newId returns distinct uuids', () => {
  expect(newId()).not.toBe(newId());
});
it('slugifies latin text', () => {
  expect(slugify('Angular 22 ships Zoneless!')).toBe('angular-22-ships-zoneless');
});
it('returns empty slug for non-latin text', () => {
  expect(slugify('مرحبا')).toBe('');
});
it('suffixes taken slugs', () => {
  expect(uniqueSlug('Hello', new Set(['hello']))).toBe('hello-2');
  expect(uniqueSlug('Hello', new Set(['hello', 'hello-2']))).toBe('hello-3');
});
it('falls back to a random slug when the title has no latin chars', () => {
  expect(uniqueSlug('مرحبا', new Set())).toMatch(/^post-[a-z0-9]{6}$/);
});
});

describe('sanitize', () => {
it('strips scripts, handlers and javascript urls', () => {
  const out = sanitizeHtml('<p onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(1)">a</a><img src=x onerror=y></p>');
  expect(out).not.toMatch(/script|onclick|onerror|javascript:/);
  expect(out).toContain('hi');
});

it('forces safe rel and target on links', () => {
  const out = sanitizeHtml('<a href="https://a.dev">a</a>');
  expect(out).toContain('rel="noopener noreferrer"');
  expect(out).toContain('target="_blank"');
});

it('keeps allowed formatting', () => {
  const html = '<h2>T</h2><p><strong>b</strong> <em>i</em> <code>c</code></p><ul><li>x</li></ul><blockquote>q</blockquote><pre><code>z</code></pre><hr><img src="https://a.dev/i.png" alt="i">';
  expect(sanitizeHtml(html)).toBe(html.replace('<hr>', '<hr />').replace('alt="i">', 'alt="i" />'));
});

it('drops h1 and style attributes but keeps their text', () => {
  expect(sanitizeHtml('<h1 style="color:red">Big</h1>')).toBe('Big');
});

it('escapes model text when rendering a story body', () => {
  const html = renderStoryBody(['<b>x</b>', 'y & z'], 'Because "reasons"');
  expect(html).toBe('<h3>Key points</h3><ul><li>&lt;b&gt;x&lt;/b&gt;</li><li>y &amp; z</li></ul><h3>Why it matters</h3><p>Because &quot;reasons&quot;</p>');
});

it('renders fallback body from snippets', () => {
  const html = renderFallbackBody([
    { id: 'i0', sourceId: 's', siteName: 'Blog', title: 't', url: 'u', snippet: 'Hello <world>' },
    { id: 'i1', sourceId: 's', siteName: 'Other', title: 't', url: 'u', snippet: '' },
  ]);
  expect(html).toBe('<p><strong>Blog:</strong> Hello &lt;world&gt;</p>');
});

it('escapeHtml escapes quotes and angle brackets', () => {
  expect(escapeHtml(`<a href="x">'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;');
});
});
