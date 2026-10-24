import { describe, it, expect } from 'vitest';
import { groupByDay, groupSummaries, summaryTagCounts, tagCounts, toSummary, normalizeUrl } from '../shared/feed';
import type { Post, Source } from '../shared/models';
import { parseSourcesMd, renderSourcesMd, syncSources } from '../shared/sources-md';

describe('feed', () => {
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
});

describe('sources-md', () => {
const MD = `# News sources

Some intro text that the parser ignores.

## Angular

| Name | Feed | Website | Tags | Enabled |
| --- | --- | --- | --- | --- |
| Angular Blog | https://blog.angular.dev/feed | https://blog.angular.dev | angular | yes |
| Angular releases | [releases](https://github.com/angular/angular/releases.atom) | https://github.com/angular/angular | Angular, Release | no |
| Broken row | not-a-url | https://x.test | x | yes |

## .NET

| Name | Feed | Website | Tags | Enabled | Selectors |
|------|------|---------|------|---------|-----------|
| Some site | https://site.test/blog | https://site.test | dotnet | yes | item=article.post; title=h2; link=a@href; date=time@datetime |
`;

const source = (over: Partial<Source>): Source => ({
  id: 'id-1',
  name: 'Angular Blog',
  siteUrl: 'https://blog.angular.dev',
  type: 'rss',
  feedUrl: 'https://blog.angular.dev/feed',
  defaultTags: ['angular'],
  enabled: true,
  group: 'Angular',
  ...over,
});

describe('parseSourcesMd', () => {
  it('reads every table row under its section heading', () => {
    const { sources } = parseSourcesMd(MD);
    expect(sources.map((s) => [s.group, s.name])).toEqual([
      ['Angular', 'Angular Blog'],
      ['Angular', 'Angular releases'],
      ['.NET', 'Some site'],
    ]);
  });

  it('reads links, lowercase tags and the enabled flag', () => {
    const [, releases] = parseSourcesMd(MD).sources;
    expect(releases).toMatchObject({
      feedUrl: 'https://github.com/angular/angular/releases.atom',
      defaultTags: ['angular', 'release'],
      enabled: false,
      type: 'rss',
    });
  });

  it('turns a selectors cell into an html source', () => {
    const site = parseSourcesMd(MD).sources[2];
    expect(site.type).toBe('html');
    expect(site.selectors).toEqual({ item: 'article.post', title: 'h2', link: 'a@href', date: 'time@datetime' });
  });

  it('skips rows with a bad link and reports them', () => {
    const { warnings } = parseSourcesMd(MD);
    expect(warnings).toEqual([expect.stringContaining('Broken row')]);
  });

  it('flags a file with no source table so it is never treated as "delete everything"', () => {
    expect(parseSourcesMd('# Sources\n\nNothing here yet').hasTable).toBe(false);
    expect(parseSourcesMd(MD).hasTable).toBe(true);
  });
});

describe('renderSourcesMd', () => {
  it('round-trips through the parser', () => {
    const sources = parseSourcesMd(MD).sources.map((s, i) => ({ ...s, id: `id-${i}` }));
    const again = parseSourcesMd(renderSourcesMd(sources)).sources;
    expect(again).toEqual(parseSourcesMd(MD).sources);
  });

  it('escapes pipes in names', () => {
    const md = renderSourcesMd([source({ name: 'A | B' })]);
    expect(parseSourcesMd(md).sources[0].name).toBe('A | B');
  });
});

describe('syncSources', () => {
  it('updates matching sources in place, adds new ones and removes missing ones', () => {
    const existing = [
      source({ id: 'keep', name: 'Old name', lastFetchedAt: '2026-10-17T04:00:00Z', lastItemCount: 10 }),
      source({ id: 'gone', name: 'Removed', feedUrl: 'https://gone.test/feed' }),
    ];
    const defs = parseSourcesMd(MD).sources;
    const result = syncSources(existing, defs);
    expect(result.sources.map((s) => s.name)).toEqual(['Angular Blog', 'Angular releases', 'Some site']);
    expect(result.sources[0]).toMatchObject({ id: 'keep', lastFetchedAt: '2026-10-17T04:00:00Z', lastItemCount: 10 });
    expect(result.sources[1].id).toEqual(expect.any(String));
    expect(result.changes).toEqual({ added: 2, updated: 1, removed: 1 });
  });

  it('matches feeds even when the link differs only cosmetically', () => {
    const result = syncSources([source({ id: 'keep', feedUrl: 'https://www.blog.angular.dev/feed/' })], [
      { ...source({}), id: undefined } as never,
    ]);
    expect(result.sources[0].id).toBe('keep');
  });
});
});

describe('normalizeUrl', () => {
it('normalizes urls from the shared module', () => {
  expect(normalizeUrl('https://www.Example.com/a/?utm_source=x&b=2#top')).toBe('https://example.com/a?b=2');
});
});
