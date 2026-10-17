import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchRss } from './rss';
import { fetchHtml } from './html';
import { fetchSource } from './index';
import type { HttpGet } from '../http';
import type { Source } from '../../../shared/models';

const fixture = (name: string) => readFileSync(join(__dirname, '../../test/fixtures', name), 'utf8');
const httpReturning = (text: string, finalUrl = 'https://site.test/blog/'): HttpGet => async () => ({ status: 200, text, finalUrl });

const src = (over: Partial<Source> = {}): Source => ({
  id: 's1', name: 'Site', siteUrl: 'https://site.test', type: 'rss', feedUrl: 'https://site.test/feed',
  defaultTags: [], enabled: true, ...over,
});

const htmlSource = src({
  type: 'html',
  feedUrl: 'https://site.test/blog/',
  selectors: { item: 'article.post', title: 'h2', link: 'a@href', date: 'time', summary: '.excerpt' },
});

describe('fetchRss', () => {
  it('parses RSS 2.0 items', async () => {
    const items = await fetchRss(src(), httpReturning(fixture('feed.rss.xml')));
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ sourceId: 's1', siteName: 'Site', title: 'Angular 22 released', url: 'https://blog.test/angular-22' });
    expect(items[0].publishedAt).toBe('2026-10-16T10:00:00.000Z');
    expect(items[0].snippet.length).toBeLessThanOrEqual(500);
    expect(items[0].snippet).not.toContain('<p>');
    expect(items[2].publishedAt).toBeUndefined();
  });

  it('parses Atom entries', async () => {
    const items = await fetchRss(src(), httpReturning(fixture('feed.atom.xml')));
    expect(items.map((i) => i.url)).toEqual(['https://v8.test/blog/json', 'https://v8.test/blog/maglev']);
    expect(items[1].snippet).toBe('New tier.');
  });

  it('throws on HTML served as feed', async () => {
    await expect(fetchRss(src(), httpReturning(fixture('listing.html')))).rejects.toThrow(/Not a valid RSS/);
  });
});

describe('fetchHtml', () => {
  it('extracts items with selectors and resolves relative links', async () => {
    const items = await fetchHtml(htmlSource, httpReturning(fixture('listing.html')));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Bun 2.0 is here', url: 'https://site.test/blog/bun-2', snippet: 'Bun 2 ships a new bundler.' });
    expect(items[0].publishedAt).toBe('2026-10-16T09:00:00.000Z');
    expect(items[1].url).toBe('https://other.test/kv');
  });

  it('throws when selectors match nothing', async () => {
    const source = { ...htmlSource, selectors: { ...htmlSource.selectors!, item: '.nope' } };
    await expect(fetchHtml(source, httpReturning(fixture('listing.html')))).rejects.toThrow(/matched no items/);
  });

  it('throws when an html source has no selectors', async () => {
    await expect(fetchHtml({ ...htmlSource, selectors: undefined }, httpReturning(''))).rejects.toThrow(/selectors/);
  });
});

it('fetchSource dispatches on type', async () => {
  expect(await fetchSource(htmlSource, httpReturning(fixture('listing.html')))).toHaveLength(2);
  expect(await fetchSource(src(), httpReturning(fixture('feed.rss.xml')))).toHaveLength(3);
});

it('names the project when a release feed titles items with a bare version', async () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Release notes</title>
<entry><title>22.2.3</title><link href="https://github.com/angular/angular-cli/releases/tag/22.2.3"/><updated>2026-10-15T00:00:00Z</updated></entry>
<entry><title>v10.0.0-rc.2</title><link href="https://github.com/dotnet/runtime/releases/tag/v10.0.0-rc.2"/><updated>2026-10-13T00:00:00Z</updated></entry>
<entry><title>Big feature release</title><link href="https://github.com/x/y/releases/tag/z"/><updated>2026-10-13T00:00:00Z</updated></entry>
</feed>`;
  const items = await fetchRss(src({ name: 'Angular CLI releases' }), httpReturning(atom));
  expect(items.map((i) => i.title)).toEqual(['Angular CLI 22.2.3', 'Angular CLI v10.0.0-rc.2', 'Big feature release']);
});
