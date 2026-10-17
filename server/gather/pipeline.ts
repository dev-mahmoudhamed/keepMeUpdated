import type { Post, PostSource, Run, RunTrigger } from '../../shared/models';
import type { JsonStore } from '../store/json-store';
import { newId, uniqueSlug } from '../util/ids';
import { renderFallbackBody, renderStoryBody, sanitizeHtml } from '../util/sanitize';
import { AiBudget } from './ai/budget';
import { normalizeUrl } from './dedupe';
import { extractArticleText } from './extract';
import { fetchSource } from './fetchers';
import type { HttpGet } from './http';
import type { AiClient, Cluster, RawItem, StoryInput, StorySummary } from './types';

const FETCH_CONCURRENCY = 4;
const ARTICLE_TIMEOUT_MS = 10_000;
const ARTICLE_LINKS = 3;
const ARTICLE_CHARS = 6_000;
const MERGE_WINDOW_DAYS = 7;
const SEEN_TTL_DAYS = 60;
const RUNS_KEPT = 50;
const DAY_MS = 86_400_000;

export interface GatherDeps {
  store: JsonStore;
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

  /** Call once at boot: runs still marked "running" were cut off by a previous process. */
  async recoverInterrupted(): Promise<void> {
    if (!this.deps.store.read().runs.some((r) => r.status === 'running')) return;
    const at = this.now().toISOString();
    await this.deps.store.update((db) => {
      for (const run of db.runs) {
        if (run.status !== 'running') continue;
        run.status = 'failed';
        run.finishedAt = at;
        run.errors.push({ message: 'Interrupted: the server stopped before this run finished' });
      }
    });
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

      // 2. Keep only fresh, unseen, unique links
      const seen = store.read().seen;
      const cutoff = nowMs - settings.maxItemAgeHours * 3_600_000;
      const runKeys = new Set<string>();
      const fresh: RawItem[] = [];
      for (const item of fetched) {
        const key = normalizeUrl(item.url);
        if (seen[key] || runKeys.has(key)) continue;
        runKeys.add(key);
        if (item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
        fresh.push({ ...item, id: `i${fresh.length}` });
      }
      run.stats.fresh = fresh.length;
      log(`Fresh items: ${fresh.length}`);

      // 3. Triage
      const budget = new AiBudget(settings.maxAiCallsPerRun);
      const ai = this.deps.makeAi(budget);
      const recentCutoff = nowMs - MERGE_WINDOW_DAYS * DAY_MS;
      const recent = store
        .read()
        .posts.filter((p) => Date.parse(p.createdAt) >= recentCutoff)
        .map((p) => ({ id: p.id, title: p.title }));
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
      const toCreate = candidates
        .filter((c) => c.relevance >= settings.relevanceThreshold)
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
        for (const key of runKeys) db.seen[key] ??= nowIso;
        const seenCutoff = nowMs - SEEN_TTL_DAYS * DAY_MS;
        for (const [key, at] of Object.entries(db.seen)) if (Date.parse(at) < seenCutoff) delete db.seen[key];
      });
      log(`Created ${run.stats.created} posts`);

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
    publishedAt: nowIso,
    runId,
  };
}
