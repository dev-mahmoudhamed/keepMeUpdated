import type { RawItem, RecentPostRef } from './types';

export { normalizeUrl } from '../../shared/url';

const STOPWORDS = new Set(
  'the and for with from into that this are was were has have had its out new now our your you how why what when who will can not but all any more about after over than then them they their via vs into onto per'.split(' '),
);
// "new" is meaningful in dev news ("new API"), so it is not a stopword.
STOPWORDS.delete('new');

const isVersion = (t: string) => /^\d[\d.]*$/.test(t);

export function titleTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => (isVersion(t) ? true : t.length >= 3 && !STOPWORDS.has(t)));
  return new Set(tokens);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Jaccard of title tokens, but titles naming different versions are never the same story. */
export function titleSimilarity(a: Set<string>, b: Set<string>): number {
  const va = [...a].filter(isVersion);
  const vb = [...b].filter(isVersion);
  if (va.length && vb.length && !va.some((v) => vb.includes(v))) return 0;
  return jaccard(a, b);
}

/** Greedy single-link clustering on title similarity. Returns groups of item ids. */
export function clusterByTitle(items: RawItem[], threshold = 0.5): string[][] {
  const tokens = items.map((i) => titleTokens(i.title));
  const clusters: number[][] = [];
  items.forEach((_, idx) => {
    const home = clusters.find((c) => c.some((j) => titleSimilarity(tokens[idx], tokens[j]) >= threshold));
    if (home) home.push(idx);
    else clusters.push([idx]);
  });
  return clusters.map((c) => c.map((idx) => items[idx].id));
}

export function matchExisting(title: string, recent: RecentPostRef[], threshold = 0.5): string | undefined {
  const t = titleTokens(title);
  let best: { id: string; score: number } | undefined;
  for (const r of recent) {
    const score = titleSimilarity(t, titleTokens(r.title));
    if (score >= threshold && (!best || score > best.score)) best = { id: r.id, score };
  }
  return best?.id;
}
