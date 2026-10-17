import type { Db } from '../../shared/models';
import { renderStoryBody, sanitizeHtml } from '../util/sanitize';
import type { HttpGet } from './http';
import { collectArticleText } from './pipeline';
import type { AiClient, RawItem } from './types';

export type ResummarizeResult = 'updated' | 'not-found' | 'no-sources' | 'no-ai' | 'no-summary';

/** Rewrite one post's TL;DR and body from its source links (admin "Re-summarize with AI"). */
export async function resummarizePost(db: Db, postId: string, http: HttpGet, ai: AiClient, now = new Date()): Promise<ResummarizeResult> {
  const post = db.posts.find((p) => p.id === postId);
  if (!post) return 'not-found';
  if (!post.sources.length) return 'no-sources';
  if (ai.mode !== 'gemini') return 'no-ai';

  const items: RawItem[] = post.sources.map((s, i) => ({
    id: `i${i}`,
    sourceId: s.sourceId ?? '',
    siteName: s.siteName,
    title: s.title || post.title,
    url: s.url,
    snippet: i === 0 ? post.tldr : '',
  }));
  const [summary] = await ai.summarize([{ clusterId: post.id, items, text: await collectArticleText(items, http) }]);
  if (!summary) return 'no-summary';

  post.tldr = summary.tldr;
  post.bodyHtml = sanitizeHtml(renderStoryBody(summary.keyPoints, summary.whyItMatters));
  post.tags = [...new Set([...post.tags, ...summary.tags])].slice(0, 10);
  post.aiPending = false;
  post.updatedAt = now.toISOString();
  return 'updated';
}
