import { describe, it, expect } from 'vitest';
import type { Source } from '../../shared/models';
import { parseSourcesMd, renderSourcesMd, syncSources } from '../../shared/sources-md';

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
