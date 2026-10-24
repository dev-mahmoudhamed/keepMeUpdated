// Types shared by the gather scripts and the Angular app.

export interface Settings {
  /** Gemini requests per run (free tier). Grouping uses at most half; the rest writes summaries. */
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
  /** normalized url -> ISO date first seen (dates articles that have no date of their own) */
  seen: Record<string, string>;
  settings: Settings;
}

/** Fetch history for one source, keyed by normalized feed url in content/state.json. */
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

/** public/data/posts.json — every published post, newest first. */
export interface FeedIndex {
  generatedAt: string;
  posts: PostSummary[];
}

/** public/data/site.json — where the admin panel finds the repository. */
export interface SiteConfig {
  /** owner/name */
  repo: string;
  branch: string;
  gatherWorkflow: string;
  /** Cron (UTC) of the daily gather. */
  schedule: string;
}

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
