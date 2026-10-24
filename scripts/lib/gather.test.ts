import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Post } from '../../shared/models';
import type { HttpGet } from './fetch';
import { type AiClient, type Cluster, FallbackAiClient, type RawItem, type RecentPostRef, type StoryInput, type StorySummary } from './ai';
import { gather, runGather } from './gather';
import type { Db, Source } from '../../shared/models';

describe('runGather', () => {
const NOW = new Date('2026-10-17T03:00:00.000Z');

const SOURCES_MD = `## Angular

| Name | Feed | Website | Tags | Enabled |
| --- | --- | --- | --- | --- |
| Angular Blog | https://blog.test/feed | https://blog.test | angular | yes |
| Disabled | https://off.test/feed | https://off.test | x | no |
`;

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Angular 23 released</title><link>https://blog.test/a23</link><pubDate>${new Date('2026-10-17T01:00:00Z').toUTCString()}</pubDate><description>Big release.</description></item>
</channel></rss>`;

const http: HttpGet = async (url) => {
  if (url === 'https://blog.test/feed') return { status: 200, text: rss, finalUrl: url };
  throw new Error(`HTTP 404 for ${url}`);
};

const summaryAi = (): AiClient => ({
  mode: 'gemini',
  triage: async (items) => items.map((i, n) => ({ id: `c${n}`, itemIds: [i.id], relevance: 9, tags: ['angular'] })),
  summarize: async (stories: StoryInput[]) =>
    stories.map((s) => ({ clusterId: s.clusterId, tldr: 'New version.', keyPoints: ['k'], whyItMatters: 'w', tags: [] })),
});

const post = (id: string, over: Partial<Post> = {}): Post => ({
  id,
  slug: id,
  title: id,
  tldr: 'old tldr',
  bodyHtml: '',
  tags: [],
  sources: [{ siteName: 'Blog', url: 'https://blog.test/post', title: 'Post' }],
  relevance: 5,
  status: 'published',
  origin: 'auto',
  aiPending: true,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  publishedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

describe('runGather', () => {
  let root: string;
  const readPosts = async () => JSON.parse(await readFile(join(root, 'content/posts.json'), 'utf8')) as Post[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kmu-cli-'));
    await writeFile(join(root, 'sources.md'), SOURCES_MD);
    await mkdir(join(root, 'content'));
    await writeFile(
      join(root, 'content/posts.json'),
      JSON.stringify([post('ancient', { publishedAt: '2026-05-01T00:00:00.000Z' }), post('recent')]),
    );
  });

  it('gather mode prunes, gathers and saves', async () => {
    const result = await runGather({ root, mode: 'gather', http, makeAi: summaryAi, now: () => NOW, trigger: 'cron' });
    const posts = await readPosts();
    expect(posts.map((p) => p.title)).toEqual(['Angular 23 updates', 'recent']);
    expect(result.changed.sort()).toEqual(['content/posts.json', 'content/state.json']);
    expect(result.failed).toBe(false);
    expect(result.summary).toContain('1 new posts');
    expect(result.summary).toContain('Removed 1 posts older than 120 days');
    const state = JSON.parse(await readFile(join(root, 'content/state.json'), 'utf8'));
    expect(state.runs[0]).toMatchObject({ trigger: 'cron', status: 'success' });
  });

  it('dry-run reports per-source counts and writes nothing', async () => {
    const result = await runGather({ root, mode: 'dry-run', http, makeAi: summaryAi, now: () => NOW });
    expect(result.summary).toContain('| Angular Blog | 1 | 2026-10-17 |  |');
    expect(result.summary).not.toContain('Disabled');
    expect(result.changed).toEqual([]);
    expect(existsSync(join(root, 'content/state.json'))).toBe(false);
  });

  it('resummarize updates one post', async () => {
    const result = await runGather({ root, mode: 'resummarize', postId: 'recent', http, makeAi: summaryAi, now: () => NOW });
    const recent = (await readPosts()).find((p) => p.id === 'recent')!;
    expect(recent).toMatchObject({ tldr: 'New version.', aiPending: false, updatedAt: NOW.toISOString() });
    expect(recent.bodyHtml).toContain('Key points');
    expect(result.changed).toContain('content/posts.json');
    expect(result.failed).toBe(false);
  });

  it('resummarize reports a missing post', async () => {
    const result = await runGather({ root, mode: 'resummarize', postId: 'nope', http, makeAi: summaryAi, now: () => NOW });
    expect(result.failed).toBe(true);
    expect(result.summary).toContain('No post with id "nope"');
    expect(result.changed).toEqual([]);
  });

  it('resummarize explains that it needs a Gemini key', async () => {
    const fallback = (): AiClient => ({ mode: 'fallback', triage: async () => [], summarize: async () => [] });
    const result = await runGather({ root, mode: 'resummarize', postId: 'recent', http, makeAi: fallback, now: () => NOW });
    expect(result.failed).toBe(true);
    expect(result.summary).toContain('GEMINI_API_KEY');
  });
});
});

describe('gather', () => {
const NOW = new Date('2026-10-17T10:00:00Z');

const source = (id: string): Source => ({
  id,
  name: id.toUpperCase(),
  siteUrl: `https://${id}.test`,
  type: 'rss',
  feedUrl: `https://${id}.test/feed`,
  defaultTags: [id],
  enabled: true,
});

interface FeedItem {
  title: string;
  url: string;
  date?: string;
  description?: string;
}

const rss = (items: FeedItem[], extra = '') =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${extra}${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.url}</link>${i.date ? `<pubDate>${new Date(i.date).toUTCString()}</pubDate>` : ''}<description>${i.description ?? `${i.title} desc`}</description></item>`,
    )
    .join('')}</channel></rss>`;

/** Fake HTTP: feeds map to RSS text; Error values throw; anything else 404s. */
const httpFrom =
  (routes: Record<string, string | Error>): HttpGet =>
  async (url) => {
    const r = routes[url];
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error(`HTTP 404 for ${url}`);
    return { status: 200, text: r, finalUrl: url };
  };

/** Scripted AI: triage maps items into clusters via a callback; summarize via a callback. */
class FakeAi implements AiClient {
  readonly mode = 'gemini' as const;
  triageCalls: { items: RawItem[]; recent: RecentPostRef[] }[] = [];
  summarizeCalls: StoryInput[][] = [];
  constructor(
    private readonly onTriage: (items: RawItem[]) => Cluster[],
    private readonly onSummarize: (stories: StoryInput[]) => StorySummary[] = (stories) =>
      stories.map((s) => ({ clusterId: s.clusterId, tldr: 'Short version.', keyPoints: ['Point one'], whyItMatters: 'It matters.', tags: ['ai-tag'] })),
  ) {}
  async triage(items: RawItem[], recent: RecentPostRef[]) {
    this.triageCalls.push({ items, recent });
    return this.onTriage(items);
  }
  async summarize(stories: StoryInput[]) {
    this.summarizeCalls.push(stories);
    return this.onSummarize(stories);
  }
}

const oneClusterPerItem = (relevance = 8) => (items: RawItem[]) =>
  items.map((i, n) => ({ id: `c${n}`, itemIds: [i.id], relevance, tags: ['t'] }));

const allInOneCluster = (items: RawItem[]): Cluster[] =>
  items.length ? [{ id: 'c0', itemIds: items.map((i) => i.id), relevance: 8, tags: ['angular'] }] : [];

const sameAsP1 = (items: RawItem[]): Cluster[] => [{ id: 'c0', itemIds: items.map((i) => i.id), existingPostId: 'p1', relevance: 8, tags: [] }];

const baseDb = (sources: Source[], posts: Post[] = []): Db => ({
  version: 1,
  posts,
  sources,
  runs: [],
  seen: {},
  settings: { maxAiCallsPerRun: 15, retentionDays: 30 },
});

const existingPost = (over: Partial<Post> = {}): Post => ({
  id: 'p1',
  slug: 'signal-forms-are-stable',
  title: 'Signal Forms are stable',
  tldr: 't',
  bodyHtml: '<p>b</p>',
  tags: ['angular'],
  sources: [{ siteName: 'Old', url: 'https://old.test/a22', title: 'Signal Forms are stable' }],
  relevance: 8,
  status: 'published',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-16T05:00:00.000Z',
  updatedAt: '2026-10-16T05:00:00.000Z',
  publishedAt: '2026-10-16T05:00:00.000Z',
  ...over,
});

const run = (db: Db, routes: Record<string, string | Error>, ai: AiClient) =>
  gather(db, { http: httpFrom(routes), makeAi: () => ai, now: () => NOW }, 'manual');

const twoSourcesSameStory = {
  'https://a.test/feed': rss([{ title: 'Signal Forms are stable', url: 'https://a.test/angular-22', date: '2026-10-17T08:00:00Z' }]),
  'https://b.test/feed': rss([{ title: 'Signal Forms now stable', url: 'https://b.test/ng22', date: '2026-10-17T07:00:00Z' }]),
};

it('posts one story per cluster with every site that reported it, then summarizes it', async () => {
  const ai = new FakeAi(allInOneCluster);
  const db = baseDb([source('a'), source('b')]);
  const r = await run(db, twoSourcesSameStory, ai);

  expect(r.status).toBe('success');
  expect(r.stats).toEqual({ fetched: 2, fresh: 2, clusters: 1, created: 1, merged: 0 });
  expect(db.posts).toHaveLength(1);
  const [post] = db.posts;
  expect(post).toMatchObject({
    title: 'Signal Forms are stable',
    slug: 'signal-forms-are-stable',
    tldr: 'Short version.',
    status: 'published',
    origin: 'auto',
    aiPending: false,
    tags: ['angular', 'ai-tag'],
    runId: r.id,
    publishedAt: '2026-10-17T07:00:00.000Z',
    createdAt: NOW.toISOString(),
  });
  expect(post.sources.map((s) => s.url)).toEqual(['https://a.test/angular-22', 'https://b.test/ng22']);
  expect(post.bodyHtml).toContain('<h3>Key points</h3>');
  expect(ai.summarizeCalls[0][0].items.map((i) => i.siteName)).toEqual(['A', 'B']);
  expect(db.runs[0]).toMatchObject({ id: r.id, status: 'success' });
});

it('posts every story, whatever its relevance score', async () => {
  const db = baseDb([source('a'), source('b')]);
  await run(db, twoSourcesSameStory, new FakeAi(oneClusterPerItem(1)));
  expect(db.posts).toHaveLength(2);
});

it('adds another site to an existing post and summarizes it again from all its sites', async () => {
  const ai = new FakeAi(sameAsP1);
  const db = baseDb([source('a')], [existingPost()]);
  const r = await run(db, twoSourcesSameStory, ai);

  expect(r.stats.merged).toBe(1);
  expect(db.posts).toHaveLength(1);
  expect(db.posts[0].sources.map((s) => s.url)).toEqual(['https://old.test/a22', 'https://a.test/angular-22']);
  expect(ai.triageCalls[0].recent).toEqual([{ id: 'p1', title: 'Signal Forms are stable' }]);
  expect(ai.summarizeCalls[0][0].items.map((i) => i.url)).toEqual(['https://old.test/a22', 'https://a.test/angular-22']);
  expect(db.posts[0]).toMatchObject({ tldr: 'Short version.', aiPending: false });
});

it('does not rewrite a post the editor wrote when another site reports the story', async () => {
  const ai = new FakeAi(sameAsP1);
  const db = baseDb([source('a')], [existingPost({ origin: 'manual', tldr: 'Mine' })]);
  await run(db, twoSourcesSameStory, ai);
  expect(db.posts[0]).toMatchObject({ tldr: 'Mine', aiPending: false });
  expect(db.posts[0].sources).toHaveLength(2);
  expect(ai.summarizeCalls).toEqual([]);
});

it('never opens or summarizes a link that is already on the site, and keeps its post', async () => {
  const post = existingPost({ sources: [{ siteName: 'A', url: 'https://a.test/angular-22?utm_source=x', title: 'x' }] });
  const ai = new FakeAi(oneClusterPerItem());
  const db = baseDb([source('a')], [post]);
  const routes = { ...twoSourcesSameStory, 'https://a.test/angular-22': '<article><p>Should not be read.</p></article>' };
  const http = vi.fn(httpFrom(routes));
  const r = await gather(db, { http, makeAi: () => ai, now: () => NOW }, 'manual');

  expect(r.stats.fresh).toBe(0);
  expect(ai.triageCalls).toEqual([]);
  expect(ai.summarizeCalls).toEqual([]);
  expect(http.mock.calls.map(([url]) => url)).toEqual(['https://a.test/feed']);
  expect(db.posts).toEqual([post]);
});

it('a second run finds nothing new and keeps every post', async () => {
  const db = baseDb([source('a'), source('b')]);
  await run(db, twoSourcesSameStory, new FakeAi(oneClusterPerItem()));
  const second = await run(db, twoSourcesSameStory, new FakeAi(oneClusterPerItem()));
  expect(second.stats.fresh).toBe(0);
  expect(db.posts).toHaveLength(2);
  expect(db.runs.map((x) => x.id)).toEqual([second.id, expect.any(String)]);
});

it('merges the same story across batches into one post', async () => {
  const items = Array.from({ length: 101 }, (_, n) => ({ title: `Story number ${n}`, url: `https://a.test/s${n}`, date: '2026-10-16T08:00:00Z' }));
  items[100] = { title: 'Story number 0', url: 'https://b.test/s0', date: '2026-10-16T09:00:00Z' };
  const ai: FakeAi = new FakeAi((batch) => {
    const recent = ai.triageCalls.at(-1)!.recent;
    return batch.map((i, n) => {
      const same = recent.find((p) => p.title === i.title);
      return { id: `c${n}`, itemIds: [i.id], relevance: 5, tags: [], ...(same ? { existingPostId: same.id } : {}) };
    });
  });
  const db = baseDb([source('a')]);
  const r = await run(db, { 'https://a.test/feed': rss(items) }, ai);

  expect(ai.triageCalls.map((c) => c.items.length)).toEqual([100, 1]);
  expect(r.stats).toMatchObject({ created: 100, merged: 1 });
  expect(db.posts.find((p) => p.title === 'Story number 0')!.sources.map((s) => s.url)).toEqual(['https://a.test/s0', 'https://b.test/s0']);
});

it('posts stories with the feed description until they are summarized on a later run', async () => {
  const db = baseDb([source('a')]);
  await run(db, twoSourcesSameStory, new FakeAi(oneClusterPerItem(), () => []));
  expect(db.posts[0]).toMatchObject({ title: 'Signal Forms are stable', tldr: 'Signal Forms are stable desc', aiPending: true, tags: ['t'] });
  expect(db.posts[0].bodyHtml).toBe('<p><strong>A:</strong> Signal Forms are stable desc</p>');

  const r = await run(db, twoSourcesSameStory, new FakeAi(oneClusterPerItem()));
  expect(db.posts[0]).toMatchObject({ tldr: 'Short version.', aiPending: false });
  expect(r.log.join(' / ')).toContain('Summarized 1 posts; 0 wait for the next run');
});

it('summarizes the newest waiting posts first', async () => {
  const older = existingPost({ id: 'old', slug: 'old', aiPending: true, publishedAt: '2026-10-01T00:00:00.000Z' });
  const newer = existingPost({ id: 'new', slug: 'new', aiPending: true, publishedAt: '2026-10-15T00:00:00.000Z' });
  const ai = new FakeAi(oneClusterPerItem());
  await run(baseDb([source('a')], [older, newer]), { 'https://a.test/feed': rss([]) }, ai);
  expect(ai.summarizeCalls[0].map((s) => s.clusterId)).toEqual(['new', 'old']);
});

it('passes article text to summarize and survives article fetch failures', async () => {
  const ai = new FakeAi(allInOneCluster);
  const routes = { ...twoSourcesSameStory, 'https://a.test/angular-22': '<article><p>Full article body.</p></article>' };
  await run(baseDb([source('a'), source('b')]), routes, ai);
  expect(ai.summarizeCalls[0][0].text).toContain('Full article body.');
});

it('does not summarize without AI', async () => {
  const fallbackAi: AiClient = { mode: 'fallback', triage: async (items) => oneClusterPerItem(5)(items), summarize: vi.fn(async () => []) };
  const db = baseDb([source('a'), source('b')], [existingPost({ id: 'p9', aiPending: true })]);
  await run(db, twoSourcesSameStory, fallbackAi);
  expect(fallbackAi.summarize).not.toHaveBeenCalled();
  expect(db.posts).toHaveLength(3);
});

it('reads older feed pages until it reaches the start of the window', async () => {
  const wp = '<generator>https://wordpress.org/?v=6.8</generator>';
  const routes = {
    'https://a.test/feed': rss([{ title: 'Page one', url: 'https://a.test/1', date: '2026-10-16T08:00:00Z' }], wp),
    'https://a.test/feed?paged=2': rss([{ title: 'Page two', url: 'https://a.test/2', date: '2026-10-01T08:00:00Z' }], wp),
    'https://a.test/feed?paged=3': rss(
      [
        { title: 'Page three', url: 'https://a.test/3', date: '2026-09-20T08:00:00Z' },
        { title: 'Too old', url: 'https://a.test/old', date: '2026-09-10T08:00:00Z' },
      ],
      wp,
    ),
    'https://a.test/feed?paged=4': rss([{ title: 'Never read', url: 'https://a.test/4', date: '2026-09-01T08:00:00Z' }], wp),
  };
  const db = baseDb([source('a')]);
  const r = await run(db, routes, new FakeAi(oneClusterPerItem()));
  expect(r.stats).toMatchObject({ fetched: 4, fresh: 3, created: 3 });
  expect(db.posts.map((p) => p.title).sort()).toEqual(['Page one', 'Page three', 'Page two']);
});

it('marks the run partial when one source throws', async () => {
  const routes = { ...twoSourcesSameStory, 'https://b.test/feed': new Error('HTTP 403 for https://b.test/feed') };
  const db = baseDb([source('a'), source('b')]);
  const r = await run(db, routes, new FakeAi(oneClusterPerItem()));
  expect(r.status).toBe('partial');
  expect(r.errors).toEqual([{ sourceId: 'b', message: 'HTTP 403 for https://b.test/feed' }]);
  expect(db.sources.find((s) => s.id === 'b')!.lastError).toBe('HTTP 403 for https://b.test/feed');
  expect(db.sources.find((s) => s.id === 'a')!).toMatchObject({ lastItemCount: 1, lastFetchedAt: NOW.toISOString() });
  expect(db.sources.find((s) => s.id === 'a')!.lastError).toBeUndefined();
  expect(db.posts).toHaveLength(1);
});

it('marks the run failed when every source fails', async () => {
  const r = await run(baseDb([source('a')]), { 'https://a.test/feed': new Error('boom') }, new FakeAi(oneClusterPerItem()));
  expect(r.status).toBe('failed');
});

it('ignores disabled sources', async () => {
  const db = baseDb([source('a'), { ...source('b'), enabled: false }]);
  const r = await run(db, twoSourcesSameStory, new FakeAi(oneClusterPerItem()));
  expect(r.stats.fetched).toBe(1);
  expect(db.posts).toHaveLength(1);
});

it('keeps every article from the last 30 days, even ones seen before', async () => {
  const db = baseDb([source('a')]);
  db.seen = { 'https://a.test/week-old': '2026-10-10T00:00:00.000Z' };
  const routes = {
    'https://a.test/feed': rss([
      { title: 'Week old news', url: 'https://a.test/week-old', date: '2026-10-10T08:00:00Z' },
      { title: 'Too old news', url: 'https://a.test/too-old', date: '2026-09-16T08:00:00Z' },
    ]),
  };
  const r = await run(db, routes, new FakeAi(oneClusterPerItem()));
  expect(r.stats).toMatchObject({ fetched: 2, fresh: 1, created: 1 });
  expect(db.posts[0]).toMatchObject({ title: 'Week old news', publishedAt: '2026-10-10T08:00:00.000Z' });
});

it('dates undated articles by when they were first seen', async () => {
  const db = baseDb([source('a')]);
  db.seen = { 'https://a.test/older-undated': '2026-10-01T00:00:00.000Z', 'https://a.test/ancient-undated': '2026-09-01T00:00:00.000Z' };
  const routes = {
    'https://a.test/feed': rss([
      { title: 'New undated', url: 'https://a.test/undated' },
      { title: 'Older undated', url: 'https://a.test/older-undated' },
      { title: 'Ancient undated', url: 'https://a.test/ancient-undated' },
    ]),
  };
  const r = await run(db, routes, new FakeAi(oneClusterPerItem()));
  expect(r.stats.fresh).toBe(2);
  expect(db.seen['https://a.test/undated']).toBe(NOW.toISOString());
  expect(db.seen['https://a.test/older-undated']).toBe('2026-10-01T00:00:00.000Z');
  expect(db.posts.map((p) => p.publishedAt).sort()).toEqual(['2026-10-01T00:00:00.000Z', NOW.toISOString()]);
});

it('drops duplicate links within one run', async () => {
  const routes = {
    'https://a.test/feed': rss([{ title: 'Same', url: 'https://x.test/p?utm_source=a', date: '2026-10-17T08:00:00Z' }]),
    'https://b.test/feed': rss([{ title: 'Same', url: 'https://x.test/p', date: '2026-10-17T08:00:00Z' }]),
  };
  expect((await run(baseDb([source('a'), source('b')]), routes, new FakeAi(oneClusterPerItem()))).stats.fresh).toBe(1);
});

it('records an unexpected error as a failed run', async () => {
  const ai = new FakeAi(() => {
    throw new Error('kaboom');
  });
  const db = baseDb([source('a')]);
  const r = await run(db, twoSourcesSameStory, ai);
  expect(r.status).toBe('failed');
  expect(r.errors.at(-1)?.message).toBe('kaboom');
  expect(db.runs[0].finishedAt).toBeDefined();
});

it('keeps only the last 50 runs', async () => {
  const db = baseDb([source('a')]);
  db.runs = Array.from({ length: 50 }, (_, i) => ({
    id: `r${i}`,
    trigger: 'cron' as const,
    startedAt: '2026-01-01T00:00:00Z',
    status: 'success' as const,
    stats: { fetched: 0, fresh: 0, clusters: 0, created: 0, merged: 0 },
    errors: [],
    log: [],
  }));
  await run(db, twoSourcesSameStory, new FakeAi(oneClusterPerItem()));
  expect(db.runs).toHaveLength(50);
});

it('puts every update of one major version into one post, newest first', async () => {
  const routes = {
    'https://a.test/feed': rss([
      { title: 'Angular 22.2.3', url: 'https://a.test/22.2.3', date: '2026-10-14T08:00:00Z' },
      { title: 'Angular 22.3.0-next.2', url: 'https://a.test/22.3.0-next.2', date: '2026-10-16T08:00:00Z' },
      { title: 'Angular 21.2.9', url: 'https://a.test/21.2.9', date: '2026-10-15T08:00:00Z' },
    ]),
    'https://b.test/feed': rss([
      { title: "What's new in Angular 22.2?", url: 'https://b.test/whats-new-22-2', date: '2026-10-10T08:00:00Z' },
      { title: 'Signals in depth', url: 'https://b.test/signals', date: '2026-10-12T08:00:00Z' },
    ]),
  };
  const ai = new FakeAi(oneClusterPerItem());
  const db = baseDb([source('a'), source('b')]);
  const r = await run(db, routes, ai);

  expect(r.stats).toMatchObject({ created: 3, merged: 0 });
  expect(ai.triageCalls.flatMap((c) => c.items.map((i) => i.title))).toEqual(['Signals in depth']);
  const v22 = db.posts.find((p) => p.title === 'Angular 22 updates')!;
  expect(v22.sources.map((s) => s.url)).toEqual(['https://a.test/22.3.0-next.2', 'https://a.test/22.2.3', 'https://b.test/whats-new-22-2']);
  expect(v22).toMatchObject({ slug: 'angular-22-updates', publishedAt: '2026-10-16T08:00:00.000Z', tags: ['a', 'b', 'ai-tag'] });
  expect(db.posts.find((p) => p.title === 'Angular 21 updates')!.sources).toHaveLength(1);
});

it('adds a later update to the existing post for that version and summarizes it again', async () => {
  const post = existingPost({ id: 'p22', slug: 'angular-22-2-3', title: 'Angular 22.2.3', publishedAt: '2026-10-14T08:00:00.000Z', sources: [{ siteName: 'A', url: 'https://a.test/22.2.3', title: 'Angular 22.2.3', publishedAt: '2026-10-14T08:00:00.000Z' }] });
  const routes = { 'https://a.test/feed': rss([{ title: 'Angular 22.2.4', url: 'https://a.test/22.2.4', date: '2026-10-20T08:00:00Z' }]) };
  const ai = new FakeAi(oneClusterPerItem());
  const db = baseDb([source('a')], [post]);
  const r = await run(db, routes, ai);

  expect(r.stats).toMatchObject({ created: 0, merged: 1 });
  expect(db.posts).toHaveLength(1);
  expect(db.posts[0]).toMatchObject({ title: 'Angular 22 updates', slug: 'angular-22-2-3', publishedAt: '2026-10-20T08:00:00.000Z', aiPending: false });
  expect(db.posts[0].sources.map((s) => s.url)).toEqual(['https://a.test/22.2.4', 'https://a.test/22.2.3']);
  expect(ai.summarizeCalls[0][0].items.map((i) => i.title)).toEqual(['Angular 22.2.4', 'Angular 22.2.3']);
});

it('without AI, does not file an article under a version-update post just because the titles look alike', async () => {
  const post = existingPost({ id: 'n10', slug: 'net-10-updates', title: '.NET 10 updates' });
  const routes = { 'https://a.test/feed': rss([{ title: 'Upgrading to .NET 10', url: 'https://a.test/upgrading', date: '2026-10-18T08:00:00Z' }]) };
  const db = baseDb([source('a')], [post]);
  await run(db, routes, new FallbackAiClient());
  expect(db.posts.map((p) => p.title).sort()).toEqual(['.NET 10 updates', 'Upgrading to .NET 10']);
});
});
