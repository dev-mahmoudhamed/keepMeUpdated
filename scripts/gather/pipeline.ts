import type { Post, PostSource, Run, RunTrigger } from '../../shared/models';
import type { Store } from '../content/store';
import { newId, uniqueSlug } from '../util/ids';
import { renderFallbackBody, renderStoryBody, sanitizeHtml } from '../util/sanitize';
import { AiBudget } from './ai/budget';
import { normalizeUrl } from './dedupe';
import { extractArticleText } from './extract';
import { fetchSource } from './fetchers';
import type { HttpGet } from './http';
import type { AiClient, Cluster, RawItem, StoryInput, StorySummary } from './types';
import { applySummary, itemsFromPost } from './apply-summary';

const FETCH_CONCURRENCY = 4;
const ARTICLE_TIMEOUT_MS = 10_000;
const ARTICLE_LINKS = 3;
const ARTICLE_CHARS = 6_000;
/** Gemini summarizes up to 5 stories per request (see ai/gemini.ts). */
const CATCH_UP_PER_CALL = 5;
const RUNS_KEPT = 50;
const DAY_MS = 86_400_000;

export interface GatherDeps {
  store: Store;
  http: HttpGet;
  makeAi: (budget: AiBudget) => AiClient;
  now?: () => Date;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Runs the daily gather: fetch → fresh → triage → merge/create → publish. One run at a time. */
export class GatherService {
  private current: { id: string; done: Promise<Run> } | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: GatherDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  isRunning(): string | null {
    return this.current?.id ?? null;
  }

  /** Start a run in the background. Returns a conflict if one is already running. */
  start(trigger: RunTrigger): { id: string } | { conflict: string } {
    if (this.current) return { conflict: this.current.id };
    const run: Run = {
      id: newId(),
      trigger,
      startedAt: this.now().toISOString(),
      status: 'running',
      stats: { fetched: 0, fresh: 0, clusters: 0, created: 0, merged: 0, skipped: 0 },
      errors: [],
      log: [],
    };
    const done = this.execute(run).finally(() => {
      this.current = null;
    });
    this.current = { id: run.id, done };
    return { id: run.id };
  }

  /** Start a run and wait for it to finish. */
  async runOnce(trigger: RunTrigger): Promise<Run> {
    const started = this.start(trigger);
    if ('conflict' in started) throw new Error(`A gather run is already in progress (${started.conflict})`);
    return this.current!.done;
  }

  async whenIdle(): Promise<void> {
    await this.current?.done;
  }

  private async execute(run: Run): Promise<Run> {
    const { store, http } = this.deps;
    const nowIso = run.startedAt;
    const nowMs = Date.parse(nowIso);
    const log = (line: string) => run.log.push(line);

    try {
      await store.update((db) => {
        db.runs.unshift(run);
      });
      const { settings } = store.read();

      // 1. Fetch
      const enabled = store.read().sources.filter((s) => s.enabled);
      const results = await mapLimit(enabled, FETCH_CONCURRENCY, async (source) => {
        try {
          return { source, items: await fetchSource(source, http) };
        } catch (err) {
          return { source, error: errorMessage(err) };
        }
      });
      const failed = results.filter((r) => 'error' in r);
      for (const r of failed) run.errors.push({ sourceId: r.source.id, message: r.error! });
      await store.update((db) => {
        for (const r of results) {
          const s = db.sources.find((x) => x.id === r.source.id);
          if (!s) continue;
          s.lastFetchedAt = nowIso;
          if (r.error !== undefined) {
            s.lastError = r.error;
          } else {
            delete s.lastError;
            s.lastItemCount = r.items!.length;
          }
        }
      });
      const fetched = results.flatMap((r) => r.items ?? []);
      run.stats.fetched = fetched.length;
      log(`Fetched ${enabled.length} sources: ${fetched.length} items${failed.length ? ` (${failed.length} failed)` : ''}`);

      // 2. Keep every article from the retention window (30 days) that isn't posted or rejected yet
      const { seen, skipped, posts } = store.read();
      const cutoff = nowMs - settings.retentionDays * DAY_MS;
      const posted = new Set(posts.flatMap((p) => p.sources.map((s) => normalizeUrl(s.url))));
      const runKeys = new Set<string>();
      /** Undated articles get the date they were first seen, so they still age out. */
      const firstSeen = new Map<string, string>();
      const fresh: RawItem[] = [];
      for (const item of fetched) {
        const key = normalizeUrl(item.url);
        if (runKeys.has(key)) continue;
        runKeys.add(key);
        let publishedAt = item.publishedAt;
        if (!publishedAt) {
          publishedAt = seen[key] ?? nowIso;
          firstSeen.set(key, publishedAt);
        }
        if (Date.parse(publishedAt) < cutoff) continue;
        if (posted.has(key) || skipped[key]) continue;
        fresh.push({ ...item, publishedAt, id: `i${fresh.length}` });
      }
      run.stats.fresh = fresh.length;
      log(`New articles from the last ${settings.retentionDays} days: ${fresh.length}`);

      // 3. Triage
      const budget = new AiBudget(settings.maxAiCallsPerRun);
      const ai = this.deps.makeAi(budget);
      const recent = store.read().posts.map((p) => ({ id: p.id, title: p.title }));
      const defaultTags = Object.fromEntries(store.read().sources.map((s) => [s.id, s.defaultTags]));
      const clusters = fresh.length ? await ai.triage(fresh, recent, defaultTags) : [];
      run.stats.clusters = clusters.length;
      log(`Grouped into ${clusters.length} stories (${ai.mode} mode)`);

      const byId = new Map(fresh.map((i) => [i.id, i]));
      const itemsOf = (c: Cluster) => c.itemIds.map((id) => byId.get(id)).filter((i): i is RawItem => !!i);

      // 4a. Merge into existing posts
      const postIds = new Set(store.read().posts.map((p) => p.id));
      const merges = clusters.filter((c) => c.existingPostId && postIds.has(c.existingPostId));
      if (merges.length) {
        await store.update((db) => {
          for (const c of merges) {
            const post = db.posts.find((p) => p.id === c.existingPostId)!;
            const have = new Set(post.sources.map((s) => normalizeUrl(s.url)));
            let added = false;
            for (const item of itemsOf(c)) {
              const key = normalizeUrl(item.url);
              if (have.has(key)) continue;
              have.add(key);
              post.sources.push(toPostSource(item));
              added = true;
            }
            if (added) post.updatedAt = nowIso;
          }
        });
      }
      run.stats.merged = merges.length;

      // 4b. Pick new stories worth posting
      const candidates = clusters.filter((c) => !merges.includes(c));
      // Without AI the relevance score is only a guess, so fallback mode posts every fresh story.
      const toCreate = candidates
        .filter((c) => ai.mode === 'fallback' || c.relevance >= settings.relevanceThreshold)
        .sort((a, b) => b.relevance - a.relevance);
      run.stats.skipped = candidates.length - toCreate.length;
      log(`Merged ${merges.length} into existing posts; skipped ${run.stats.skipped} below relevance ${settings.relevanceThreshold}`);

      // 4c. Summarize
      let summaries: StorySummary[] = [];
      if (toCreate.length && ai.mode === 'gemini') {
        const stories: StoryInput[] = await mapLimit(toCreate, FETCH_CONCURRENCY, async (c) => ({
          clusterId: c.id,
          items: itemsOf(c),
          text: await collectArticleText(itemsOf(c), this.deps.http),
        }));
        summaries = await ai.summarize(stories);
        log(`Summarized ${summaries.length} of ${toCreate.length} stories (AI calls left: ${budget.remaining})`);
      }
      const summaryOf = new Map(summaries.map((s) => [s.clusterId, s]));

      // 5. Publish
      await store.update((db) => {
        const taken = new Set(db.posts.map((p) => p.slug));
        for (const c of toCreate) {
          const items = itemsOf(c);
          if (!items.length) continue;
          const post = buildPost(c, items, summaryOf.get(c.id), run.id, nowIso, taken);
          taken.add(post.slug);
          db.posts.push(post);
          run.stats.created++;
        }
        for (const c of candidates) {
          if (toCreate.includes(c)) continue;
          for (const item of itemsOf(c)) db.skipped[normalizeUrl(item.url)] = item.publishedAt ?? nowIso;
        }
        for (const [key, at] of firstSeen) db.seen[key] ??= at;
      });
      log(`Created ${run.stats.created} posts`);

      // 6. Spend leftover AI budget on older posts that still only have the feed's description
      if (ai.mode === 'gemini' && !budget.exhausted) {
        const pending = store
          .read()
          .posts.filter((p) => p.aiPending && p.origin === 'auto' && p.sources.length)
          .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt))
          .slice(0, budget.remaining * CATCH_UP_PER_CALL);
        if (pending.length) {
          const stories: StoryInput[] = await mapLimit(pending, FETCH_CONCURRENCY, async (p) => {
            const items = itemsFromPost(p);
            return { clusterId: p.id, items, text: await collectArticleText(items, this.deps.http) };
          });
          const done = await ai.summarize(stories);
          await store.update((db) => {
            for (const summary of done) {
              const post = db.posts.find((p) => p.id === summary.clusterId);
              if (post) applySummary(post, summary, nowIso);
            }
          });
          log(`Summarized ${done.length} older posts (AI calls left: ${budget.remaining})`);
        }
      }

      run.status = enabled.length > 0 && failed.length === enabled.length ? 'failed' : failed.length ? 'partial' : 'success';
    } catch (err) {
      run.status = 'failed';
      run.errors.push({ message: errorMessage(err) });
      log(`Run failed: ${errorMessage(err)}`);
    } finally {
      run.finishedAt = this.now().toISOString();
      await store
        .update((db) => {
          const i = db.runs.findIndex((r) => r.id === run.id);
          if (i === -1) db.runs.unshift(run);
          else db.runs[i] = run;
          db.runs.splice(RUNS_KEPT);
        })
        .catch(() => undefined);
    }
    return run;
  }
}

/** Readable text from up to 3 article pages; falls back to feed snippets. */
export async function collectArticleText(items: RawItem[], http: HttpGet): Promise<string> {
  const links = items.slice(0, ARTICLE_LINKS);
  if (!links.length) return '';
  const perLink = Math.floor(ARTICLE_CHARS / links.length);
  const parts = await Promise.all(
    links.map(async (item) => {
      try {
        const { text } = await http(item.url, ARTICLE_TIMEOUT_MS);
        return extractArticleText(text, perLink) || item.snippet;
      } catch {
        return item.snippet;
      }
    }),
  );
  return parts.filter(Boolean).join('\n\n').slice(0, ARTICLE_CHARS);
}

function toPostSource(item: RawItem): PostSource {
  return {
    sourceId: item.sourceId,
    siteName: item.siteName,
    url: item.url,
    title: item.title,
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
  };
}

function buildPost(
  cluster: Cluster,
  items: RawItem[],
  summary: StorySummary | undefined,
  runId: string,
  nowIso: string,
  taken: Set<string>,
): Post {
  const title = summary?.title ?? items[0].title;
  const tags = [...new Set([...(summary?.tags ?? []), ...cluster.tags])].slice(0, 6);
  return {
    id: newId(),
    slug: uniqueSlug(title, taken),
    title,
    tldr: summary ? summary.tldr : truncate(items.find((i) => i.snippet)?.snippet || title, 300),
    bodyHtml: sanitizeHtml(summary ? renderStoryBody(summary.keyPoints, summary.whyItMatters) : renderFallbackBody(items)),
    tags,
    sources: items.map(toPostSource),
    relevance: cluster.relevance,
    status: 'published',
    origin: 'auto',
    aiPending: !summary,
    createdAt: nowIso,
    updatedAt: nowIso,
    // The story's own date (its earliest report), so it lands on the right day and ages out 30 days after.
    publishedAt: items.map((i) => i.publishedAt).filter((d): d is string => !!d).sort()[0] ?? nowIso,
    runId,
  };
}
