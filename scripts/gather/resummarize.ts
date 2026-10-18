import type { Db } from '../../shared/models';
import type { HttpGet } from './http';
import { collectArticleText } from './pipeline';
import type { AiClient } from './types';
import { applySummary, itemsFromPost } from './apply-summary';

export type ResummarizeResult = 'updated' | 'not-found' | 'no-sources' | 'no-ai' | 'no-summary';

/** Rewrite one post's TL;DR and body from its source links (admin "Re-summarize with AI"). */
export async function resummarizePost(db: Db, postId: string, http: HttpGet, ai: AiClient, now = new Date()): Promise<ResummarizeResult> {
  const post = db.posts.find((p) => p.id === postId);
  if (!post) return 'not-found';
  if (!post.sources.length) return 'no-sources';
  if (ai.mode !== 'gemini') return 'no-ai';

  const items = itemsFromPost(post);
  const [summary] = await ai.summarize([{ clusterId: post.id, items, text: await collectArticleText(items, http) }]);
  if (!summary) return 'no-summary';

  applySummary(post, summary, now.toISOString());
  return 'updated';
}
