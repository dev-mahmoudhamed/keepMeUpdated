// The gather: (1) collect every link from the last 4 months (settings.retentionDays), site by site; (2) put every story on the site, one post
// per story with all the sites that reported it; (3) visit the articles and summarize them with Gemini.
import { normalizeUrl } from '../../shared/feed';
import type { Db, Post, PostSource, Run, RunTrigger } from '../../shared/models';
import { type AiClient, AiBudget, type Cluster, type RawItem, type StorySummary, SUMMARY_BATCH, TRIAGE_BATCH, chunk, releaseSeries, similarPosts } from './ai';
import {
  DAY_MS,
  RUNS_KEPT,
  applyRetention,
  loadContent,
  newId,
  renderFallbackBody,
  renderStoryBody,
  sanitizeHtml,
  saveContent,
  uniqueSlug,
} from './content';
import { type HttpGet, collectArticleText, fetchSource } from './fetch';

export type GatherMode = 'gather' | 'resummarize' | 'dry-run';

export interface GatherDeps {
  http: HttpGet;
  makeAi: (budget: AiBudget) => AiClient;
  now?: () => Date;
}

export interface GatherOptions extends GatherDeps {
  root: string;
  mode: GatherMode;
  postId?: string;
  trigger?: RunTrigger;
}

export interface GatherResult {
  /** Markdown for the GitHub job summary. */
  summary: string;
  /** Content files that were rewritten (to commit). */
  changed: string[];
  /** True when the workflow should fail so the admin sees it. */
  failed: boolean;
}

const FETCH_CONCURRENCY = 4;

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
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Runs one mode against the content files in `root` and saves them. */
export async function runGather(opts: GatherOptions): Promise<GatherResult> {
  const now = opts.now ?? (() => new Date());
  const db = await loadContent(opts.root);

  if (opts.mode === 'dry-run') {
    const since = now().getTime() - db.settings.retentionDays * DAY_MS;
    const rows = await Promise.all(
      db.sources
        .filter((s) => s.enabled)
        .map(async (s) => {
          try {
            const items = await fetchSource(s, opts.http, since);
            const newest = items.map((i) => i.publishedAt ?? '').sort().at(-1)?.slice(0, 10) || '-';
            return `| ${cell(s.name)} | ${items.length} | ${newest} |  |`;
          } catch (err) {
            return `| ${cell(s.name)} | 0 | - | ${cell(errorMessage(err))} |`;
          }
        }),
    );
    const summary = ['## Dry run', '', 'Nothing was saved.', '', '| Source | Items | Newest | Error |', '| --- | --- | --- | --- |', ...rows].join('\n');
    return { summary, changed: [], failed: false };
  }

  if (opts.mode === 'resummarize') {
    const id = opts.postId?.trim() ?? '';
    const result = await resummarizePost(db, id, opts.http, opts.makeAi(new AiBudget(2)), now());
    const changed = result === 'updated' ? (await saveContent(opts.root, db)).changed : [];
    const summary = `## Re-summarize\n\n${RESUMMARIZE_MESSAGES[result].replace('%s', id)}`;
    return { summary, changed, failed: result !== 'updated' };
  }

  const retention = applyRetention(db, now());
  const run = await gather(db, { ...opts, now }, opts.trigger ?? 'manual');
  const { changed } = await saveContent(opts.root, db);
  const summary = [
    `## Gather (${run.trigger})`,
    '',
    `Status: **${run.status}**`,
    '',
    `- Removed ${retention.removedPosts} posts older than ${db.settings.retentionDays} days and ${retention.removedSeen} old seen links`,
    ...run.log.map((l) => `- ${l}`),
    ...(run.errors.length ? ['', '### Errors', '', ...run.errors.map((e) => `- ${e.message}`)] : []),
  ].join('\n');
  return { summary, changed, failed: run.status === 'failed' };
}

/** One gather run over `db` (changed in place). The run is recorded in db.runs. */
export async function gather(db: Db, deps: GatherDeps, trigger: RunTrigger): Promise<Run> {
  const now = deps.now ?? (() => new Date());
  const nowIso = now().toISOString();
  const run: Run = {
    id: newId(),
    trigger,
    startedAt: nowIso,
    status: 'running',
    stats: { fetched: 0, fresh: 0, clusters: 0, created: 0, merged: 0 },
    errors: [],
    log: [],
  };
  const log = (line: string) => run.log.push(line);
  db.runs.unshift(run);

  try {
    // 1. Collect: every link each enabled source published in the window
    const cutoff = Date.parse(nowIso) - db.settings.retentionDays * DAY_MS;
    const enabled = db.sources.filter((s) => s.enabled);
    const results = await mapLimit(enabled, FETCH_CONCURRENCY, async (source) => {
      try {
        return { source, items: await fetchSource(source, deps.http, cutoff) };
      } catch (err) {
        return { source, error: errorMessage(err) };
      }
    });
    for (const r of results) {
      r.source.lastFetchedAt = nowIso;
      if (r.error !== undefined) {
        r.source.lastError = r.error;
        run.errors.push({ sourceId: r.source.id, message: r.error });
      } else {
        delete r.source.lastError;
        r.source.lastItemCount = r.items!.length;
      }
    }
    const failed = results.filter((r) => r.error !== undefined).length;
    const fetched = results.flatMap((r) => r.items ?? []);
    run.stats.fetched = fetched.length;

    // A link that is already in a post is on the site: it isn't opened or summarized again.
    const posted = new Set(db.posts.flatMap((p) => p.sources.map((s) => normalizeUrl(s.url))));
    const runKeys = new Set<string>();
    const fresh: RawItem[] = [];
    for (const item of fetched) {
      const key = normalizeUrl(item.url);
      if (runKeys.has(key)) continue;
      runKeys.add(key);
      // Undated articles get the date they were first seen, so they still age out.
      const publishedAt = item.publishedAt ?? (db.seen[key] ??= nowIso);
      if (Date.parse(publishedAt) < cutoff || posted.has(key)) continue;
      fresh.push({ ...item, publishedAt, id: `i${fresh.length}` });
    }
    run.stats.fresh = fresh.length;
    log(`Collected ${fetched.length} links from ${enabled.length} sources${failed ? ` (${failed} failed)` : ''}; ${fresh.length} new from the last ${db.settings.retentionDays} days`);

    // 2. Post: one post per story. Every update of one product's major version ("Angular 22.2.3", "22.3.0-next.1",
    // "What's new in Angular 22.2?") goes into that version's single post. Batches see the posts earlier batches
    // made, so a story is never posted twice.
    const budget = new AiBudget(db.settings.maxAiCallsPerRun);
    const ai = deps.makeAi(budget);
    const defaultTags = Object.fromEntries(db.sources.map((s) => [s.id, s.defaultTags]));
    const taken = new Set(db.posts.map((p) => p.slug));
    const series = new Map<string, RawItem[]>();
    const stories: RawItem[] = [];
    for (const item of fresh) {
      const key = releaseSeries(item.title)?.key;
      if (key) series.set(key, [...(series.get(key) ?? []), item]);
      else stories.push(item);
    }
    for (const [key, items] of series) {
      run.stats.clusters++;
      const existing = db.posts.find((p) => releaseSeries(p.title)?.key === key);
      if (existing) {
        if (addSources(existing, items, nowIso)) run.stats.merged++;
        continue;
      }
      const tags = [...new Set(items.flatMap((i) => defaultTags[i.sourceId] ?? []))];
      const post = newPost({ id: key, itemIds: [], relevance: 7, tags }, items, run.id, nowIso, taken);
      taken.add(post.slug);
      db.posts.push(post);
      run.stats.created++;
    }
    const byId = new Map(stories.map((i) => [i.id, i]));
    // Title matching alone would file "Upgrading to .NET 10" under ".NET 10 updates"; only Gemini may link to those.
    const linkable = () => (ai.mode === 'gemini' ? db.posts : db.posts.filter((p) => !releaseSeries(p.title)));
    for (const batch of chunk(stories, TRIAGE_BATCH)) {
      const clusters = await ai.triage(batch, similarPosts(batch, linkable()), defaultTags);
      run.stats.clusters += clusters.length;
      for (const c of clusters) {
        const items = c.itemIds.map((id) => byId.get(id)).filter((i): i is RawItem => !!i);
        if (!items.length) continue;
        const existing = c.existingPostId ? db.posts.find((p) => p.id === c.existingPostId) : undefined;
        if (existing) {
          if (addSources(existing, items, nowIso)) run.stats.merged++;
          continue;
        }
        const post = newPost(c, items, run.id, nowIso, taken);
        taken.add(post.slug);
        db.posts.push(post);
        run.stats.created++;
      }
    }
    log(`Grouped into ${run.stats.clusters} stories (${ai.mode} mode): ${run.stats.created} new posts, ${run.stats.merged} posts got another site's link`);

    // 3. Summarize: visit the articles of posts still showing the feed's description, newest first
    if (ai.mode === 'gemini') {
      const queue = db.posts
        .filter((p) => p.aiPending && p.origin === 'auto' && p.sources.length)
        .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
      let summarized = 0;
      for (const group of chunk(queue, SUMMARY_BATCH)) {
        if (budget.exhausted) break;
        const stories = await mapLimit(group, FETCH_CONCURRENCY, async (p) => {
          const items = itemsFromPost(p);
          return { clusterId: p.id, items, text: await collectArticleText(items, deps.http) };
        });
        for (const summary of await ai.summarize(stories)) {
          const post = group.find((p) => p.id === summary.clusterId);
          if (!post) continue;
          applySummary(post, summary, nowIso);
          summarized++;
        }
      }
      log(`Summarized ${summarized} posts; ${queue.length - summarized} wait for the next run (AI calls left: ${budget.remaining})`);
    }

    run.status = enabled.length > 0 && failed === enabled.length ? 'failed' : failed ? 'partial' : 'success';
  } catch (err) {
    run.status = 'failed';
    run.errors.push({ message: errorMessage(err) });
    log(`Run failed: ${errorMessage(err)}`);
  } finally {
    run.finishedAt = now().toISOString();
    db.runs.splice(RUNS_KEPT);
  }
  return run;
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

/** Adds the links a post doesn't have yet. A gathered post is summarized again, so the summary covers every site. */
function addSources(post: Post, items: RawItem[], nowIso: string): boolean {
  const have = new Set(post.sources.map((s) => normalizeUrl(s.url)));
  const added = items.filter((i) => !have.has(normalizeUrl(i.url)));
  if (!added.length) return false;
  post.sources.push(...added.map(toPostSource));
  const release = releaseSeries(post.title);
  if (release) {
    newestFirst(post.sources);
    post.publishedAt = post.sources[0].publishedAt ?? post.publishedAt;
    if (post.origin === 'auto') post.title = release.title;
  }
  if (post.origin === 'auto') post.aiPending = true;
  post.updatedAt = nowIso;
  return true;
}

const newestFirst = <T extends { publishedAt?: string }>(list: T[]) =>
  list.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

/**
 * A new post with the feed's description; step 3 replaces it with the AI summary. A release series is titled for the
 * major version, lists the newest update first, and is dated by it.
 */
function newPost(cluster: Cluster, items: RawItem[], runId: string, nowIso: string, taken: Set<string>): Post {
  const release = releaseSeries(items[0].title);
  if (release) items = newestFirst([...items]);
  const title = release?.title ?? items[0].title;
  const dates = items.map((i) => i.publishedAt).filter((d): d is string => !!d).sort();
  return {
    id: newId(),
    slug: uniqueSlug(title, taken),
    title,
    tldr: truncate(items.find((i) => i.snippet)?.snippet || title, 300),
    bodyHtml: sanitizeHtml(renderFallbackBody(items)),
    tags: cluster.tags.slice(0, 6),
    sources: items.map(toPostSource),
    relevance: cluster.relevance,
    status: 'published',
    origin: 'auto',
    aiPending: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    // The story's own date (its earliest report), so it lands on the right day and ages out with the window.
    publishedAt: (release ? dates.at(-1) : dates[0]) ?? nowIso,
    runId,
  };
}

/** A post's source links as gather items, so they can be summarized again. */
export function itemsFromPost(post: Post): RawItem[] {
  return post.sources.map((s, i) => ({
    id: `i${i}`,
    sourceId: s.sourceId ?? '',
    siteName: s.siteName,
    title: s.title || post.title,
    url: s.url,
    snippet: i === 0 ? post.tldr : '',
    ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
  }));
}

/** Replace a post's TL;DR and body with an AI summary (the title and slug stay). */
export function applySummary(post: Post, summary: StorySummary, nowIso: string): void {
  post.tldr = summary.tldr;
  post.bodyHtml = sanitizeHtml(renderStoryBody(summary.keyPoints, summary.whyItMatters));
  post.tags = [...new Set([...post.tags, ...summary.tags])].slice(0, 10);
  post.aiPending = false;
  post.updatedAt = nowIso;
}

export type ResummarizeResult = 'updated' | 'not-found' | 'no-sources' | 'no-ai' | 'no-summary';

const RESUMMARIZE_MESSAGES: Record<ResummarizeResult, string> = {
  updated: 'Summary updated.',
  'not-found': 'No post with id "%s". It may have been deleted.',
  'no-sources': 'The post has no source links to summarize.',
  'no-ai': 'Re-summarizing needs a Gemini key. Add GEMINI_API_KEY in Settings → Secrets and variables → Actions.',
  'no-summary': 'Gemini did not return a summary. Try again later.',
};

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
