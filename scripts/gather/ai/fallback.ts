import { newId } from '../../util/ids';
import { clusterByTitle, matchExisting } from '../dedupe';
import type { AiClient, Cluster, RawItem, RecentPostRef, StoryInput, StorySummary } from '../types';

const IMPORTANT = /\b(release|released|releases|v?\d+\.\d+(\.\d+)?|launch\w*|stable|deprecat\w*|security|cve|breaking)\b/i;

/** No-AI mode: title-similarity clustering and a simple relevance heuristic. */
export class FallbackAiClient implements AiClient {
  readonly mode = 'fallback' as const;

  async triage(items: RawItem[], recent: RecentPostRef[], defaultTags: Record<string, string[]>): Promise<Cluster[]> {
    const byId = new Map(items.map((i) => [i.id, i]));
    return clusterByTitle(items).map((ids) => {
      const members = ids.map((id) => byId.get(id)!);
      let relevance = 5;
      if (members.length >= 2) relevance++;
      if (members.some((m) => IMPORTANT.test(m.title))) relevance++;
      const tags = [...new Set(members.flatMap((m) => defaultTags[m.sourceId] ?? []))];
      const existingPostId = matchExisting(members[0].title, recent);
      return {
        id: newId(),
        itemIds: ids,
        relevance: Math.min(relevance, 10),
        tags,
        ...(existingPostId ? { existingPostId } : {}),
      };
    });
  }

  async summarize(_stories: StoryInput[]): Promise<StorySummary[]> {
    return [];
  }
}
