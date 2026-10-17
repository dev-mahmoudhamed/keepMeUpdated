// Daily gather, run by .github/workflows/gather.yml (or locally: npm run gather -- --mode dry-run).
import { appendFile } from 'node:fs/promises';
import type { RunTrigger } from '../shared/models';
import { type GatherMode, runGather } from './cli/run-gather';
import type { AiBudget } from './gather/ai/budget';
import { FallbackAiClient } from './gather/ai/fallback';
import { GeminiAiClient } from './gather/ai/gemini';
import { httpGet } from './gather/http';

const MODES: GatherMode[] = ['gather', 'resummarize', 'dry-run'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

(async () => {
  const mode = (arg('mode') ?? 'gather') as GatherMode;
  if (!MODES.includes(mode)) throw new Error(`Unknown --mode "${mode}". Use one of: ${MODES.join(', ')}`);

  const apiKey = process.env['GEMINI_API_KEY']?.trim();
  const model = process.env['GEMINI_MODEL']?.trim() || 'gemini-flash-latest';
  const makeAi = (budget: AiBudget) => (apiKey ? new GeminiAiClient({ apiKey, model, budget }) : new FallbackAiClient());
  const trigger: RunTrigger = process.env['GITHUB_EVENT_NAME'] === 'schedule' ? 'cron' : 'manual';

  console.log(`[gather] mode=${mode} ai=${apiKey ? `gemini (${model})` : 'fallback (no GEMINI_API_KEY)'}`);
  const result = await runGather({ root: process.cwd(), mode, postId: arg('post'), http: httpGet, makeAi, trigger });

  console.log(result.summary);
  console.log(`[gather] changed: ${result.changed.join(', ') || 'nothing'}`);
  const stepSummary = process.env['GITHUB_STEP_SUMMARY'];
  if (stepSummary) await appendFile(stepSummary, `${result.summary}\n`);
  if (result.failed) process.exitCode = 1;
})().catch((err) => {
  console.error(`[gather] ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
