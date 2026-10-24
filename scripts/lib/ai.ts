// Grouping reports of the same story and summarizing stories: Gemini when a key is set, title matching otherwise.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { newId } from './content';

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
  /** Groups one batch of items into stories, linking a story to one of `recent` when it's the same news. */
  triage(items: RawItem[], recent: RecentPostRef[], defaultTags: Record<string, string[]>): Promise<Cluster[]>;
  summarize(stories: StoryInput[]): Promise<StorySummary[]>;
}

/** Items per triage request, and stories per summary request. */
export const TRIAGE_BATCH = 100;
export const SUMMARY_BATCH = 15;
/** Grouping may use at most this share of a run's calls; the rest is kept for summaries. */
const TRIAGE_SHARE = 0.5;
const MAX_RETRIES = 3;

const STOPWORDS = new Set(
  'the and for with from into that this are was were has have had its out our your you how why what when who will can not but all any more about after over than then them they their via vs onto per'.split(' '),
);

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

export interface ReleaseSeries {
  /** Product and major version, e.g. "angular cli 22". */
  key: string;
  /** The post title for every update of that major version, e.g. "Angular CLI 22 updates". */
  title: string;
}

const RELEASE_TITLE =
  /^(?:(announcing|introducing|releasing|what['’]?s new in)\s+)?(.+?)\s+(v)?(\d+)((?:\.(?:\d+|x))*)((?:[\s.-]+(?:preview|rc|release candidate|beta|alpha|next)(?:[\s.-]*\d+)*)*)\s*(.*)$/i;
const RELEASE_WORDS = /^(?:(?:is|has been)\s+)?(?:now\s+)?(?:out|here|available|released|release[sd]?|updates?)?\s*[!.?]*$/i;

/**
 * The release series a title announces: "Angular 22.2.3", "Angular CLI 22.3.0-next.2", "What's new in Angular 22.2?",
 * ".NET 10 Preview 7 is now available", "Angular 22.2: Error Boundaries…". Every version of one major is one series.
 */
export function releaseSeries(title: string): ReleaseSeries | undefined {
  const m = RELEASE_TITLE.exec(title.trim());
  if (!m) return undefined;
  const [, verb, rawProduct, v, major, minor, prerelease, rest] = m;
  const product = rawProduct.replace(/[\s:–—-]+$/, '').replace(/\s+(releases?|version)$/i, '').trim();
  if (!/[a-z]/i.test(product) || product.split(/\s+/).length > 4) return undefined;
  const versioned = !!(minor || v || prerelease);
  const announced = !!verb || (!!rest && RELEASE_WORDS.test(rest));
  const ok = !rest ? versioned || !!verb : RELEASE_WORDS.test(rest) ? versioned || announced : versioned && /^[:–—-]/.test(rest);
  if (!ok) return undefined;
  return { key: `${product.toLowerCase().replace(/\s+/g, ' ')} ${Number(major)}`, title: `${product} ${Number(major)} updates` };
}

/** The posts whose titles look a little like any of `items`, most similar first: what triage compares a batch with. */
export function similarPosts(items: RawItem[], posts: RecentPostRef[], limit = 100, threshold = 0.2): RecentPostRef[] {
  const itemTokens = items.map((i) => titleTokens(i.title));
  return posts
    .map((p) => {
      const t = titleTokens(p.title);
      return { ref: { id: p.id, title: p.title }, score: Math.max(0, ...itemTokens.map((it) => titleSimilarity(it, t))) };
    })
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.ref);
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Caps Gemini usage for one run: a hard call limit, a per-minute throttle, and a
 * kill switch for when the daily free-tier quota is gone.
 */
export class AiBudget {
  private used = 0;
  private quotaGone = false;
  private readonly recent: number[] = [];

  constructor(
    readonly max: number,
    private readonly perMinute = 8,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }

  get exhausted(): boolean {
    return this.quotaGone || this.remaining === 0;
  }

  markQuotaExhausted(): void {
    this.quotaGone = true;
  }

  /** Reserve one call, leaving at least `keep` calls. Waits if the per-minute rate would be exceeded. */
  async take(keep = 0): Promise<boolean> {
    if (this.exhausted || this.remaining <= keep) return false;
    this.used++;
    this.dropExpired();
    if (this.recent.length >= this.perMinute) {
      await this.sleep(this.recent[0] + 60_000 - this.now());
      this.dropExpired();
    }
    this.recent.push(this.now());
    return true;
  }

  private dropExpired(): void {
    const windowStart = this.now() - 60_000;
    while (this.recent.length && this.recent[0] <= windowStart) this.recent.shift();
  }
}

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

export interface GenerateRequest {
  model: string;
  contents: string;
  config: { responseMimeType: 'application/json'; responseJsonSchema: object; systemInstruction: string };
}
export type GenerateFn = (req: GenerateRequest) => Promise<{ text: string | undefined }>;

const TRIAGE_INSTRUCTION =
  'You are an editor for a developer news digest. Group items that report the same news, even from different sites. ' +
  'Score relevance to working software developers 0-10 (releases, breaking changes, security, notable tooling = high; ' +
  'marketing, hiring, opinion fluff = low). Use short lowercase tags. Updates to the same major version of one product ' +
  '(e.g. Angular 21.0, 21.1 and 21.1.2) are one story. If a group is the same story as one of recentPosts, set ' +
  'existingPostId to that post id. Every item id must appear in exactly one group.';

const SUMMARY_INSTRUCTION =
  'Write a neutral, factual summary for developers for each story. A story can have several sources: combine them ' +
  'into one summary. If sources disagree on a fact, leave that fact out rather than stating either version. ' +
  'When the sources are several versions of one product, say what changed across them, newest version first. ' +
  'tldr is at most 2 sentences. 3-5 key points. whyItMatters is 1-3 sentences. No hype, no marketing language. ' +
  'Use only the provided text. Return one entry per clusterId.';

const triageSchema = z.object({
  clusters: z.array(
    z.object({
      itemIds: z.array(z.string()),
      existingPostId: z.string().nullish(),
      relevance: z.number(),
      tags: z.array(z.string()).default([]),
    }),
  ),
});

const summarySchema = z.object({
  stories: z.array(
    z.object({
      clusterId: z.string(),
      tldr: z.string().min(1),
      keyPoints: z.array(z.string()).default([]),
      whyItMatters: z.string().default(''),
      tags: z.array(z.string()).default([]),
    }),
  ),
});

const stringArray = { type: 'array', items: { type: 'string' } };

const TRIAGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemIds: stringArray,
          existingPostId: { type: 'string' },
          relevance: { type: 'integer', minimum: 0, maximum: 10 },
          tags: stringArray,
        },
        required: ['itemIds', 'relevance', 'tags'],
      },
    },
  },
  required: ['clusters'],
};

const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    stories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          clusterId: { type: 'string' },
          tldr: { type: 'string' },
          keyPoints: stringArray,
          whyItMatters: { type: 'string' },
          tags: stringArray,
        },
        required: ['clusterId', 'tldr', 'keyPoints', 'whyItMatters', 'tags'],
      },
    },
  },
  required: ['stories'],
};

const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 5);

export const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const DAILY_QUOTA = /per\s*day|daily/i;

export interface GeminiOptions {
  apiKey: string;
  /**
   * Models to use, in order. Each has its own free-tier daily quota, so when one runs out the next takes over
   * (e.g. gemini-flash-latest, then gemini-flash-lite-latest).
   */
  models: string[];
  budget: AiBudget;
  generate?: GenerateFn;
  sleep?: (ms: number) => Promise<void>;
}

export class GeminiAiClient implements AiClient {
  readonly mode = 'gemini' as const;
  private readonly fallback = new FallbackAiClient();
  private readonly generate: GenerateFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private modelIndex = 0;

  constructor(private readonly opts: GeminiOptions) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    if (opts.generate) {
      this.generate = opts.generate;
    } else {
      const client = new GoogleGenAI({ apiKey: opts.apiKey });
      this.generate = async (req) => {
        const res = await client.models.generateContent(req);
        return { text: res.text };
      };
    }
  }

  async triage(batch: RawItem[], recent: RecentPostRef[], defaultTags: Record<string, string[]>): Promise<Cluster[]> {
    const contents = JSON.stringify({
      items: batch.map((i) => ({ id: i.id, title: i.title, source: i.siteName, snippet: i.snippet.slice(0, 300) })),
      recentPosts: recent,
    });
    const keep = Math.ceil(this.opts.budget.max * (1 - TRIAGE_SHARE));
    const parsed = triageSchema.safeParse(await this.callJson(contents, TRIAGE_INSTRUCTION, TRIAGE_JSON_SCHEMA, keep));
    if (!parsed.success) return this.fallback.triage(batch, recent, defaultTags);

    const known = new Set(batch.map((i) => i.id));
    const recentIds = new Set(recent.map((r) => r.id));
    const used = new Set<string>();
    const clusters: Cluster[] = [];
    for (const c of parsed.data.clusters) {
      const itemIds = c.itemIds.filter((id) => known.has(id) && !used.has(id));
      if (!itemIds.length) continue;
      itemIds.forEach((id) => used.add(id));
      clusters.push({
        id: newId(),
        itemIds,
        relevance: Math.max(0, Math.min(10, Math.round(c.relevance))),
        tags: cleanTags(c.tags),
        ...(c.existingPostId && recentIds.has(c.existingPostId) ? { existingPostId: c.existingPostId } : {}),
      });
    }
    const forgotten = batch.filter((i) => !used.has(i.id));
    if (forgotten.length) clusters.push(...(await this.fallback.triage(forgotten, recent, defaultTags)));
    return clusters;
  }

  async summarize(stories: StoryInput[]): Promise<StorySummary[]> {
    const out: StorySummary[] = [];
    for (const group of chunk(stories, SUMMARY_BATCH)) {
      if (this.opts.budget.exhausted) break;
      const contents = JSON.stringify({
        stories: group.map((s) => ({
          clusterId: s.clusterId,
          sources: s.items.map((i) => ({ site: i.siteName, title: i.title, snippet: i.snippet })),
          text: s.text,
        })),
      });
      const parsed = summarySchema.safeParse(await this.callJson(contents, SUMMARY_INSTRUCTION, SUMMARY_JSON_SCHEMA));
      if (!parsed.success) continue;
      const wanted = new Set(group.map((s) => s.clusterId));
      for (const s of parsed.data.stories) {
        if (!wanted.delete(s.clusterId)) continue;
        out.push({ ...s, tags: cleanTags(s.tags) });
      }
    }
    return out;
  }

  /** One budgeted call with retries. Returns parsed JSON, or undefined on any failure. */
  private async callJson(contents: string, systemInstruction: string, schema: object, keep = 0): Promise<unknown> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (!(await this.opts.budget.take(keep))) return undefined;
      try {
        const res = await this.generate({
          model: this.opts.models[this.modelIndex],
          contents,
          config: { responseMimeType: 'application/json', responseJsonSchema: schema, systemInstruction },
        });
        return JSON.parse(res.text ?? '');
      } catch (err) {
        if (err instanceof SyntaxError) return undefined;
        const status = (err as { status?: number }).status;
        const message = err instanceof Error ? err.message : String(err);
        if (status === 429 && DAILY_QUOTA.test(message)) {
          if (this.modelIndex < this.opts.models.length - 1) {
            this.modelIndex++;
            console.warn(`[gemini] daily quota used up; switching to ${this.opts.models[this.modelIndex]}`);
            attempt--;
            continue;
          }
          this.opts.budget.markQuotaExhausted();
          return undefined;
        }
        const transient = status === 429 || (status !== undefined && status >= 500);
        if (!transient || attempt === MAX_RETRIES) return undefined;
        await this.sleep(1000 * 2 ** attempt);
      }
    }
    return undefined;
  }
}
