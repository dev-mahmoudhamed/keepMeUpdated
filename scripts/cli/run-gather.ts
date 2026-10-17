import type { RunTrigger } from '../../shared/models';
import { applyRetention, loadContent, saveContent } from '../content/files';
import { MemoryStore } from '../content/store';
import { AiBudget } from '../gather/ai/budget';
import { fetchSource } from '../gather/fetchers';
import type { HttpGet } from '../gather/http';
import { GatherService } from '../gather/pipeline';
import { type ResummarizeResult, resummarizePost } from '../gather/resummarize';
import type { AiClient } from '../gather/types';

export type GatherMode = 'gather' | 'resummarize' | 'dry-run';

export interface GatherOptions {
  root: string;
  mode: GatherMode;
  postId?: string;
  http: HttpGet;
  makeAi: (budget: AiBudget) => AiClient;
  now?: () => Date;
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

const RESUMMARIZE_MESSAGES: Record<ResummarizeResult, string> = {
  updated: 'Summary updated.',
  'not-found': 'No post with id "%s". It may have been deleted.',
  'no-sources': 'The post has no source links to summarize.',
  'no-ai': 'Re-summarizing needs a Gemini key. Add GEMINI_API_KEY in Settings → Secrets and variables → Actions.',
  'no-summary': 'Gemini did not return a summary. Try again later.',
};

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export async function runGather(opts: GatherOptions): Promise<GatherResult> {
  const now = opts.now ?? (() => new Date());
  const db = await loadContent(opts.root);

  if (opts.mode === 'dry-run') {
    const rows = await Promise.all(
      db.sources
        .filter((s) => s.enabled)
        .map(async (s) => {
          try {
            const items = await fetchSource(s, opts.http);
            const newest = items.map((i) => i.publishedAt ?? '').sort().at(-1)?.slice(0, 10) || '-';
            return `| ${cell(s.name)} | ${items.length} | ${newest} |  |`;
          } catch (err) {
            return `| ${cell(s.name)} | 0 | - | ${cell(err instanceof Error ? err.message : String(err))} |`;
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
  const service = new GatherService({ store: new MemoryStore(db), http: opts.http, makeAi: opts.makeAi, now });
  const run = await service.runOnce(opts.trigger ?? 'manual');
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
