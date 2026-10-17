import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Post } from '../../shared/models';
import type { HttpGet } from '../gather/http';
import type { AiClient, StoryInput } from '../gather/types';
import { runGather } from './run-gather';

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
    stories.map((s) => ({ clusterId: s.clusterId, title: 'Angular 23 is out', tldr: 'New version.', keyPoints: ['k'], whyItMatters: 'w', tags: [] })),
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
      JSON.stringify([post('ancient', { publishedAt: '2026-09-01T00:00:00.000Z' }), post('recent')]),
    );
  });

  it('gather mode prunes, gathers and saves', async () => {
    const result = await runGather({ root, mode: 'gather', http, makeAi: summaryAi, now: () => NOW, trigger: 'cron' });
    const posts = await readPosts();
    expect(posts.map((p) => p.title)).toEqual(['Angular 23 is out', 'recent']);
    expect(result.changed.sort()).toEqual(['content/posts.json', 'content/state.json']);
    expect(result.failed).toBe(false);
    expect(result.summary).toContain('Created 1 posts');
    expect(result.summary).toContain('Removed 1 posts older than 30 days');
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
