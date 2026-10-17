import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { newId } from '../../util/ids';
import type { AiClient, Cluster, RawItem, RecentPostRef, StoryInput, StorySummary } from '../types';
import type { AiBudget } from './budget';
import { FallbackAiClient } from './fallback';

export interface GenerateRequest {
  model: string;
  contents: string;
  config: { responseMimeType: 'application/json'; responseJsonSchema: object; systemInstruction: string };
}
export type GenerateFn = (req: GenerateRequest) => Promise<{ text: string | undefined }>;

const TRIAGE_BATCH = 40;
const SUMMARY_BATCH = 5;
const MAX_RETRIES = 3;

const TRIAGE_INSTRUCTION =
  'You are an editor for a developer news digest. Group items about the same news. ' +
  'Score relevance to working software developers 0-10 (releases, breaking changes, security, notable tooling = high; ' +
  'marketing, hiring, opinion fluff = low). Use short lowercase tags. If a group is the same story as one of ' +
  'recentPosts, set existingPostId to that post id. Every item id must appear in exactly one group.';

const SUMMARY_INSTRUCTION =
  'Write a neutral, factual summary for developers for each story. tldr is at most 2 sentences. ' +
  '3-5 key points. whyItMatters is 1-3 sentences. No hype, no marketing language. Use only the provided text. ' +
  'Return one entry per clusterId.';

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
      title: z.string().min(1),
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
          title: { type: 'string' },
          tldr: { type: 'string' },
          keyPoints: stringArray,
          whyItMatters: { type: 'string' },
          tags: stringArray,
        },
        required: ['clusterId', 'title', 'tldr', 'keyPoints', 'whyItMatters', 'tags'],
      },
    },
  },
  required: ['stories'],
};

const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 5);

const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const DAILY_QUOTA = /per\s*day|daily/i;

export interface GeminiOptions {
  apiKey: string;
  model: string;
  budget: AiBudget;
  generate?: GenerateFn;
  sleep?: (ms: number) => Promise<void>;
}

export class GeminiAiClient implements AiClient {
  readonly mode = 'gemini' as const;
  private readonly fallback = new FallbackAiClient();
  private readonly generate: GenerateFn;
  private readonly sleep: (ms: number) => Promise<void>;

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

  async triage(items: RawItem[], recent: RecentPostRef[], defaultTags: Record<string, string[]>): Promise<Cluster[]> {
    const out: Cluster[] = [];
    for (const batch of chunk(items, TRIAGE_BATCH)) {
      out.push(...(await this.triageBatch(batch, recent, defaultTags)));
    }
    return out;
  }

  private async triageBatch(
    batch: RawItem[],
    recent: RecentPostRef[],
    defaultTags: Record<string, string[]>,
  ): Promise<Cluster[]> {
    const contents = JSON.stringify({
      items: batch.map((i) => ({ id: i.id, title: i.title, source: i.siteName, snippet: i.snippet.slice(0, 300) })),
      recentPosts: recent,
    });
    const parsed = triageSchema.safeParse(await this.callJson(contents, TRIAGE_INSTRUCTION, TRIAGE_JSON_SCHEMA));
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
  private async callJson(contents: string, systemInstruction: string, schema: object): Promise<unknown> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (!(await this.opts.budget.take())) return undefined;
      try {
        const res = await this.generate({
          model: this.opts.model,
          contents,
          config: { responseMimeType: 'application/json', responseJsonSchema: schema, systemInstruction },
        });
        return JSON.parse(res.text ?? '');
      } catch (err) {
        if (err instanceof SyntaxError) return undefined;
        const status = (err as { status?: number }).status;
        const message = err instanceof Error ? err.message : String(err);
        if (status === 429 && DAILY_QUOTA.test(message)) {
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
