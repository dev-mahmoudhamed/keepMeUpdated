import { it, expect } from 'vitest';
import { normalizeUrl, jaccard, titleTokens, clusterByTitle, matchExisting } from './dedupe';
import type { RawItem } from './types';

const item = (id: string, title: string): RawItem => ({ id, sourceId: 's', siteName: 'S', title, url: `https://x.dev/${id}`, snippet: '' });

it('normalizes urls', () => {
  expect(normalizeUrl('https://www.Example.com/a/?utm_source=x&b=2&a=1#top')).toBe('https://example.com/a?a=1&b=2');
  expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  expect(normalizeUrl('https://example.com/p?fbclid=1&ref=hn')).toBe('https://example.com/p');
});

it('returns invalid urls unchanged', () => {
  expect(normalizeUrl('not a url')).toBe('not a url');
});

it('computes jaccard similarity', () => {
  expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  expect(jaccard(new Set(), new Set())).toBe(0);
});

it('drops stopwords and short words but keeps version numbers', () => {
  expect([...titleTokens('The Angular 22 is out with a new API')]).toEqual(['angular', '22', 'new', 'api']);
});

it('clusters similar titles', () => {
  const items = [
    item('i0', 'Angular 22 released with zoneless default'),
    item('i1', 'Angular 22 released: zoneless by default'),
    item('i2', 'Node 26 LTS'),
  ];
  const clusters = clusterByTitle(items);
  expect(clusters.map((c) => c.length).sort()).toEqual([1, 2]);
  expect(clusters.find((c) => c.length === 2)).toEqual(['i0', 'i1']);
});

it('matches existing recent posts', () => {
  const recent = [{ id: 'p1', title: 'Angular 22 released, zoneless default' }];
  expect(matchExisting('Angular 22 is released with zoneless', recent)).toBe('p1');
  expect(matchExisting('Bun 2.0', [{ id: 'p1', title: 'Angular 22 released' }])).toBeUndefined();
});

it('keeps different versions apart', () => {
  expect(clusterByTitle([item('i0', 'Angular 21 released'), item('i1', 'Angular 22 released')])).toHaveLength(2);
});
