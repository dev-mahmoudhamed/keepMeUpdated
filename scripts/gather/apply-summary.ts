import type { Post } from '../../shared/models';
import { renderStoryBody, sanitizeHtml } from '../util/sanitize';
import type { RawItem, StorySummary } from './types';

/** A post's source links as gather items, so they can be summarized again. */
export function itemsFromPost(post: Post): RawItem[] {
  return post.sources.map((s, i) => ({
    id: `i${i}`,
    sourceId: s.sourceId ?? '',
    siteName: s.siteName,
    title: s.title || post.title,
    url: s.url,
    snippet: i === 0 ? post.tldr : '',
    ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
  }));
}

/** Replace a post's TL;DR and body with an AI summary (the title and slug stay). */
export function applySummary(post: Post, summary: StorySummary, nowIso: string): void {
  post.tldr = summary.tldr;
  post.bodyHtml = sanitizeHtml(renderStoryBody(summary.keyPoints, summary.whyItMatters));
  post.tags = [...new Set([...post.tags, ...summary.tags])].slice(0, 10);
  post.aiPending = false;
  post.updatedAt = nowIso;
}
