import { describe, it, expect } from 'vitest';
import { groupByDay, groupSummaries, summaryTagCounts, tagCounts, toSummary } from '../../shared/feed';
import type { Post } from '../../shared/models';

let n = 0;
const post = (day: string, over: Partial<Post> = {}): Post => {
  n++;
  return {
    id: `p${n}`,
    slug: `post-${n}`,
    title: `Post ${n}`,
    tldr: 'tl;dr',
    bodyHtml: '<p>x</p>',
    tags: ['angular'],
    sources: [{ siteName: 'A', url: 'https://a.test', title: 'a' }],
    relevance: 5,
    status: 'published',
    origin: 'auto',
    aiPending: false,
    createdAt: `${day}T12:00:00.000Z`,
    updatedAt: `${day}T12:00:00.000Z`,
    publishedAt: `${day}T12:00:00.000Z`,
    ...over,
  };
};

it('groups published posts by day, newest first, excluding drafts', () => {
  const posts = [
    post('2026-10-16'),
    post('2026-10-17', { publishedAt: '2026-10-17T10:00:00.000Z' }),
    post('2026-10-17', { publishedAt: '2026-10-17T14:00:00.000Z', title: 'Later' }),
    post('2026-10-17', { status: 'draft' }),
    post('2026-10-17', { status: 'hidden' }),
  ];
  const res = groupByDay(posts, { days: 7 });
  expect(res.days.map((d) => d.date)).toEqual(['2026-10-17', '2026-10-16']);
  expect(res.days[0].posts.map((p) => p.title)).toEqual(['Later', expect.any(String)]);
  expect(res.nextBefore).toBeUndefined();
});

it('paginates with before and returns nextBefore', () => {
  const days = Array.from({ length: 9 }, (_, i) => `2026-10-${String(17 - i).padStart(2, '0')}`);
  const posts = days.map((d) => post(d));
  const first = groupByDay(posts, { days: 7 });
  expect(first.days).toHaveLength(7);
  expect(first.nextBefore).toBe('2026-10-11');
  const second = groupByDay(posts, { days: 7, before: first.nextBefore });
  expect(second.days.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-09']);
  expect(second.nextBefore).toBeUndefined();
});

it('filters by tag and q', () => {
  const posts = [
    post('2026-10-17', { title: 'Signals land', tags: ['angular'] }),
    post('2026-10-17', { title: 'Bun 2', tags: ['bun'], tldr: 'A new bundler' }),
  ];
  expect(groupByDay(posts, { days: 7, tag: 'bun' }).days[0].posts.map((p) => p.title)).toEqual(['Bun 2']);
  expect(groupByDay(posts, { days: 7, q: 'BUNDLER' }).days[0].posts.map((p) => p.title)).toEqual(['Bun 2']);
  expect(groupByDay(posts, { days: 7, q: 'angular' }).days[0].posts.map((p) => p.title)).toEqual(['Signals land']);
  expect(groupByDay(posts, { days: 7, q: 'nothing-matches' }).days).toEqual([]);
});

it('summaries carry a source count and no body', () => {
  const s = toSummary(post('2026-10-17'));
  expect(s.sourceCount).toBe(1);
  expect('bodyHtml' in s).toBe(false);
});

it('counts tags on published posts only', () => {
  const posts = [post('2026-10-17', { tags: ['a', 'b'] }), post('2026-10-17', { tags: ['a'] }), post('2026-10-17', { tags: ['c'], status: 'draft' })];
  expect(tagCounts(posts)).toEqual([
    { tag: 'a', count: 2 },
    { tag: 'b', count: 1 },
  ]);
});

describe('summary helpers (static site index)', () => {
  const summaries = [
    toSummary(post('2026-10-17', { title: 'Signals land', tags: ['angular'] })),
    toSummary(post('2026-10-16', { title: 'Bun 2', tags: ['bun'] })),
  ];

  it('groups summaries by day with the same paging as groupByDay', () => {
    expect(groupSummaries(summaries, { days: 1 }).days.map((d) => d.date)).toEqual(['2026-10-17']);
    expect(groupSummaries(summaries, { days: 1 }).nextBefore).toBe('2026-10-17');
    expect(groupSummaries(summaries, { days: 7, tag: 'bun' }).days[0].posts[0].title).toBe('Bun 2');
  });

  it('counts tags across summaries', () => {
    expect(summaryTagCounts(summaries)).toEqual([
      { tag: 'angular', count: 1 },
      { tag: 'bun', count: 1 },
    ]);
  });
});
