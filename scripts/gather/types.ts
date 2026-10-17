export interface RawItem {
  /** run-local key, e.g. "i12" */
  id: string;
  sourceId: string;
  siteName: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

export interface Cluster {
  id: string;
  itemIds: string[];
  existingPostId?: string;
  relevance: number;
  tags: string[];
}

export interface StorySummary {
  clusterId: string;
  title: string;
  tldr: string;
  keyPoints: string[];
  whyItMatters: string;
  tags: string[];
}

export interface StoryInput {
  clusterId: string;
  items: RawItem[];
  text: string;
}

export interface RecentPostRef {
  id: string;
  title: string;
}

export interface AiClient {
  readonly mode: 'gemini' | 'fallback';
  triage(items: RawItem[], recent: RecentPostRef[], defaultTags: Record<string, string[]>): Promise<Cluster[]>;
  summarize(stories: StoryInput[]): Promise<StorySummary[]>;
}
