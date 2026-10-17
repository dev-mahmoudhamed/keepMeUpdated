import type { FeedResponse, Post, PostSummary, TagCount } from './models';

export interface FeedOptions {
  days: number;
  /** Only days strictly before this YYYY-MM-DD date. */
  before?: string;
  tag?: string;
  q?: string;
}

/** YYYY-MM-DD in the server's local time zone. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toSummary(p: Post): PostSummary {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    tldr: p.tldr,
    tags: p.tags,
    relevance: p.relevance,
    publishedAt: p.publishedAt,
    aiPending: p.aiPending,
    sourceCount: p.sources.length,
  };
}

const isLive = (p: Post) => p.status === 'published' && !!p.publishedAt;

/** Day groups from already-published summaries (the static site's index). */
export function groupSummaries(summaries: PostSummary[], opts: FeedOptions): FeedResponse {
  const q = opts.q?.trim().toLowerCase();
  const tag = opts.tag?.trim().toLowerCase();
  const matches = summaries
    .filter((p) => !!p.publishedAt)
    .filter((p) => !tag || p.tags.includes(tag))
    .filter(
      (p) =>
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.tldr.toLowerCase().includes(q) ||
        p.tags.some((t) => t.includes(q)),
    )
    .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!));

  const groups = new Map<string, PostSummary[]>();
  for (const p of matches) {
    const date = localDate(p.publishedAt!);
    if (opts.before && date >= opts.before) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(p);
  }

  const dates = [...groups.keys()];
  const page = dates.slice(0, opts.days);
  return {
    days: page.map((date) => ({ date, posts: groups.get(date)! })),
    ...(dates.length > page.length ? { nextBefore: page.at(-1) } : {}),
  };
}

export function groupByDay(posts: Post[], opts: FeedOptions): FeedResponse {
  return groupSummaries(posts.filter(isLive).map(toSummary), opts);
}

export function summaryTagCounts(summaries: PostSummary[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const p of summaries) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function tagCounts(posts: Post[]): TagCount[] {
  return summaryTagCounts(posts.filter(isLive).map(toSummary));
}
