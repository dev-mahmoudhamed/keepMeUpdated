import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../store/json-store';
import { GatherService } from './pipeline';
import type { HttpGet } from './http';
import type { AiClient, Cluster, RawItem, RecentPostRef, StoryInput, StorySummary } from './types';
import type { Db, Post, Source } from '../../shared/models';

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

const rss = (items: FeedItem[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items
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
      stories.map((s) => ({
        clusterId: s.clusterId,
        title: `Summary of ${s.items[0].title}`,
        tldr: 'Short version.',
        keyPoints: ['Point one'],
        whyItMatters: 'It matters.',
        tags: ['ai-tag'],
      })),
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

const baseDb = (sources: Source[], posts: Post[] = []): Db => ({
  version: 1,
  posts,
  sources,
  runs: [],
  seen: {},
  settings: { relevanceThreshold: 6, maxItemAgeHours: 48, maxAiCallsPerRun: 15 },
});

const existingPost = (over: Partial<Post> = {}): Post => ({
  id: 'p1',
  slug: 'angular-22-released',
  title: 'Angular 22 released',
  tldr: 't',
  bodyHtml: '<p>b</p>',
  tags: ['angular'],
  sources: [{ siteName: 'Old', url: 'https://old.test/a22', title: 'Angular 22 released' }],
  relevance: 8,
  status: 'published',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-16T05:00:00.000Z',
  updatedAt: '2026-10-16T05:00:00.000Z',
  publishedAt: '2026-10-16T05:00:00.000Z',
  ...over,
});

describe('GatherService', () => {
  let file: string;
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'kmu-pipe-')), 'db.json');
  });

  const setup = async (db: Db, routes: Record<string, string | Error>, ai: AiClient) => {
    const store = await JsonStore.open(file, () => db);
    const service = new GatherService({ store, http: httpFrom(routes), makeAi: () => ai, now: () => NOW });
    return { store, service };
  };

  const twoSourcesSameStory = {
    'https://a.test/feed': rss([{ title: 'Angular 22 released', url: 'https://a.test/angular-22', date: '2026-10-17T08:00:00Z' }]),
    'https://b.test/feed': rss([{ title: 'Angular 22 is out', url: 'https://b.test/ng22', date: '2026-10-17T07:00:00Z' }]),
  };

  it('creates one post per cluster with all source links', async () => {
    const ai = new FakeAi(allInOneCluster);
    const { store, service } = await setup(baseDb([source('a'), source('b')]), twoSourcesSameStory, ai);
    const run = await service.runOnce('manual');

    expect(run.status).toBe('success');
    expect(run.stats).toMatchObject({ fetched: 2, fresh: 2, clusters: 1, created: 1, merged: 0, skipped: 0 });
    const [post] = store.read().posts;
    expect(store.read().posts).toHaveLength(1);
    expect(post).toMatchObject({
      title: 'Summary of Angular 22 released',
      tldr: 'Short version.',
      status: 'published',
      origin: 'auto',
      aiPending: false,
      tags: ['ai-tag', 'angular'],
      runId: run.id,
      publishedAt: NOW.toISOString(),
    });
    expect(post.sources.map((s) => s.url)).toEqual(['https://a.test/angular-22', 'https://b.test/ng22']);
    expect(post.bodyHtml).toContain('<h3>Key points</h3>');
    expect(post.slug).toBe('summary-of-angular-22-released');
    expect(store.read().runs[0]).toMatchObject({ id: run.id, status: 'success' });
    expect(run.log.length).toBeGreaterThan(0);
  });

  it('merges into an existing recent post instead of duplicating', async () => {
    const ai = new FakeAi((items) => [{ id: 'c0', itemIds: items.map((i) => i.id), existingPostId: 'p1', relevance: 8, tags: [] }]);
    const { store, service } = await setup(baseDb([source('a')], [existingPost()]), twoSourcesSameStory, ai);
    const run = await service.runOnce('manual');

    expect(run.stats.merged).toBe(1);
    expect(store.read().posts).toHaveLength(1);
    expect(store.read().posts[0].sources.map((s) => s.url)).toEqual(['https://old.test/a22', 'https://a.test/angular-22']);
    expect(ai.triageCalls[0].recent).toEqual([{ id: 'p1', title: 'Angular 22 released' }]);
    expect(ai.summarizeCalls).toEqual([]);
  });

  it('does not add a link the post already has', async () => {
    const post = existingPost({ sources: [{ siteName: 'A', url: 'https://a.test/angular-22?utm_source=x', title: 'x' }] });
    const ai = new FakeAi((items) => [{ id: 'c0', itemIds: items.map((i) => i.id), existingPostId: 'p1', relevance: 8, tags: [] }]);
    const { store, service } = await setup(baseDb([source('a')], [post]), twoSourcesSameStory, ai);
    await service.runOnce('manual');
    expect(store.read().posts[0].sources).toHaveLength(1);
  });

  it('skips items already seen on a second run', async () => {
    const ai = new FakeAi(oneClusterPerItem());
    const { store, service } = await setup(baseDb([source('a'), source('b')]), twoSourcesSameStory, ai);
    await service.runOnce('manual');
    const second = await service.runOnce('manual');
    expect(second.stats.fresh).toBe(0);
    expect(store.read().posts).toHaveLength(2);
    expect(store.read().runs.map((r) => r.id)).toEqual([second.id, expect.any(String)]);
  });

  it('skips clusters below relevance threshold', async () => {
    const { store, service } = await setup(baseDb([source('a'), source('b')]), twoSourcesSameStory, new FakeAi(oneClusterPerItem(3)));
    const run = await service.runOnce('manual');
    expect(run.stats.skipped).toBe(2);
    expect(store.read().posts).toHaveLength(0);
  });

  it('creates fallback post with aiPending when summary missing', async () => {
    const ai = new FakeAi(oneClusterPerItem(), () => []);
    const { store, service } = await setup(baseDb([source('a')]), twoSourcesSameStory, ai);
    await service.runOnce('manual');
    const [post] = store.read().posts;
    expect(post).toMatchObject({ title: 'Angular 22 released', tldr: 'Angular 22 released desc', aiPending: true, tags: ['t'] });
    expect(post.bodyHtml).toBe('<p><strong>A:</strong> Angular 22 released desc</p>');
  });

  it('passes article text to summarize and survives article fetch failures', async () => {
    const ai = new FakeAi(allInOneCluster);
    const routes = { ...twoSourcesSameStory, 'https://a.test/angular-22': '<article><p>Full article body.</p></article>' };
    const { service } = await setup(baseDb([source('a'), source('b')]), routes, ai);
    await service.runOnce('manual');
    expect(ai.summarizeCalls[0][0].text).toContain('Full article body.');
  });

  it('marks run partial when one source throws', async () => {
    const routes = { ...twoSourcesSameStory, 'https://b.test/feed': new Error('HTTP 403 for https://b.test/feed') };
    const { store, service } = await setup(baseDb([source('a'), source('b')]), routes, new FakeAi(oneClusterPerItem()));
    const run = await service.runOnce('manual');
    expect(run.status).toBe('partial');
    expect(run.errors).toEqual([{ sourceId: 'b', message: 'HTTP 403 for https://b.test/feed' }]);
    const b = store.read().sources.find((s) => s.id === 'b')!;
    expect(b.lastError).toBe('HTTP 403 for https://b.test/feed');
    expect(store.read().sources.find((s) => s.id === 'a')!).toMatchObject({ lastItemCount: 1, lastFetchedAt: NOW.toISOString() });
    expect(store.read().sources.find((s) => s.id === 'a')!.lastError).toBeUndefined();
    expect(store.read().posts).toHaveLength(1);
  });

  it('marks run failed when every source fails', async () => {
    const routes = { 'https://a.test/feed': new Error('boom') };
    const { service } = await setup(baseDb([source('a')]), routes, new FakeAi(oneClusterPerItem()));
    expect((await service.runOnce('manual')).status).toBe('failed');
  });

  it('ignores disabled sources', async () => {
    const { store, service } = await setup(baseDb([source('a'), { ...source('b'), enabled: false }]), twoSourcesSameStory, new FakeAi(oneClusterPerItem()));
    const run = await service.runOnce('manual');
    expect(run.stats.fetched).toBe(1);
    expect(store.read().posts).toHaveLength(1);
  });

  it('refuses a second concurrent run', async () => {
    const { service } = await setup(baseDb([source('a')]), twoSourcesSameStory, new FakeAi(oneClusterPerItem()));
    const first = service.start('manual');
    const second = service.start('cron');
    expect('id' in first).toBe(true);
    expect(second).toEqual({ conflict: (first as { id: string }).id });
    expect(service.isRunning()).toBe((first as { id: string }).id);
    await service.whenIdle();
    expect(service.isRunning()).toBeNull();
  });

  it('ignores items older than maxItemAgeHours', async () => {
    const routes = {
      'https://a.test/feed': rss([
        { title: 'Old news', url: 'https://a.test/old', date: '2026-10-14T08:00:00Z' },
        { title: 'Undated news', url: 'https://a.test/undated' },
      ]),
    };
    const { service } = await setup(baseDb([source('a')]), routes, new FakeAi(oneClusterPerItem()));
    const run = await service.runOnce('manual');
    expect(run.stats).toMatchObject({ fetched: 2, fresh: 1 });
  });

  it('drops duplicate links within one run', async () => {
    const routes = {
      'https://a.test/feed': rss([{ title: 'Same', url: 'https://x.test/p?utm_source=a', date: '2026-10-17T08:00:00Z' }]),
      'https://b.test/feed': rss([{ title: 'Same', url: 'https://x.test/p', date: '2026-10-17T08:00:00Z' }]),
    };
    const { service } = await setup(baseDb([source('a'), source('b')]), routes, new FakeAi(oneClusterPerItem()));
    expect((await service.runOnce('manual')).stats.fresh).toBe(1);
  });

  it('records an unexpected error as a failed run and frees the lock', async () => {
    const ai = new FakeAi(() => {
      throw new Error('kaboom');
    });
    const { store, service } = await setup(baseDb([source('a')]), twoSourcesSameStory, ai);
    const run = await service.runOnce('manual');
    expect(run.status).toBe('failed');
    expect(run.errors.at(-1)?.message).toBe('kaboom');
    expect(service.isRunning()).toBeNull();
    expect(store.read().runs[0].finishedAt).toBeDefined();
  });

  it('keeps only the last 50 runs and prunes old seen urls', async () => {
    const db = baseDb([source('a')]);
    db.runs = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`, trigger: 'cron' as const, startedAt: '2026-01-01T00:00:00Z', status: 'success' as const,
      stats: { fetched: 0, fresh: 0, clusters: 0, created: 0, merged: 0, skipped: 0 }, errors: [], log: [],
    }));
    db.seen = { 'https://very.old/x': '2026-06-01T00:00:00.000Z', 'https://recent.test/y': '2026-10-10T00:00:00.000Z' };
    const { store, service } = await setup(db, twoSourcesSameStory, new FakeAi(oneClusterPerItem()));
    await service.runOnce('manual');
    expect(store.read().runs).toHaveLength(50);
    expect(store.read().seen['https://very.old/x']).toBeUndefined();
    expect(store.read().seen['https://recent.test/y']).toBeDefined();
    expect(store.read().seen['https://a.test/angular-22']).toBe(NOW.toISOString());
  });
});
