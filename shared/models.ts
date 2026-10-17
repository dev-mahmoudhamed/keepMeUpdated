// Types shared by the Node server and the Angular app.

export interface Settings {
  relevanceThreshold: number;
  maxItemAgeHours: number;
  maxAiCallsPerRun: number;
  /** Posts and seen links older than this are deleted on every gather. */
  retentionDays: number;
}

export interface SourceSelectors {
  item: string;
  title: string;
  link: string;
  date?: string;
  summary?: string;
}

export interface Source {
  id: string;
  name: string;
  siteUrl: string;
  type: 'rss' | 'html';
  feedUrl: string;
  selectors?: SourceSelectors;
  defaultTags: string[];
  enabled: boolean;
  /** Section heading in sources.md, e.g. "Angular" or ".NET". */
  group?: string;
  lastFetchedAt?: string;
  lastError?: string;
  lastItemCount?: number;
}

export interface PostSource {
  sourceId?: string;
  siteName: string;
  url: string;
  title: string;
  publishedAt?: string;
}

export type PostStatus = 'published' | 'draft' | 'hidden';

export interface Post {
  id: string;
  slug: string;
  title: string;
  tldr: string;
  bodyHtml: string;
  tags: string[];
  sources: PostSource[];
  relevance: number;
  status: PostStatus;
  origin: 'auto' | 'manual';
  aiPending: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  runId?: string;
}

export type RunTrigger = 'cron' | 'manual' | 'catch-up';
export type RunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface RunStats {
  fetched: number;
  fresh: number;
  clusters: number;
  created: number;
  merged: number;
  skipped: number;
}

export interface Run {
  id: string;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  stats: RunStats;
  errors: { sourceId?: string; message: string }[];
  log: string[];
}

export interface Db {
  version: 1;
  posts: Post[];
  sources: Source[];
  runs: Run[];
  /** normalized url -> ISO date first seen */
  seen: Record<string, string>;
  settings: Settings;
}

/** Fetch history for one source, keyed by source id in content/state.json. */
export interface SourceStatus {
  lastFetchedAt?: string;
  lastError?: string;
  lastItemCount?: number;
}

/** content/state.json */
export interface ContentState {
  version: 1;
  settings: Settings;
  seen: Record<string, string>;
  runs: Run[];
  sourceStatus: Record<string, SourceStatus>;
}

export type PostSummary = Pick<
  Post,
  'id' | 'slug' | 'title' | 'tldr' | 'tags' | 'relevance' | 'publishedAt' | 'aiPending'
> & { sourceCount: number };

export interface DayGroup {
  /** YYYY-MM-DD in server local time */
  date: string;
  posts: PostSummary[];
}

export interface FeedResponse {
  days: DayGroup[];
  nextBefore?: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface AdminStatus {
  geminiConfigured: boolean;
  model: string;
  nextRunAt: string | null;
  running: string | null;
}
