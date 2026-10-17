import 'dotenv/config';
import { join } from 'node:path';
import { createApp } from './app';
import { loadConfig } from './config';
import { AiBudget } from './gather/ai/budget';
import { FallbackAiClient } from './gather/ai/fallback';
import { GeminiAiClient } from './gather/ai/gemini';
import { httpGet } from './gather/http';
import { GatherService } from './gather/pipeline';
import { startScheduler } from './gather/scheduler';
import { JsonStore } from './store/json-store';
import { createInitialDb } from './store/seed';

async function main() {
  const config = loadConfig(process.env);
  const dbPath = join(config.dataDir, 'db.json');
  const store = await JsonStore.open(dbPath, createInitialDb);

  const gemini = (budget: AiBudget) =>
    config.geminiApiKey ? new GeminiAiClient({ apiKey: config.geminiApiKey, model: config.geminiModel, budget }) : undefined;

  const gather = new GatherService({
    store,
    http: httpGet,
    makeAi: (budget) => gemini(budget) ?? new FallbackAiClient(),
  });
  const scheduler = startScheduler(config.gatherCron, gather, store);

  const app = createApp({
    config,
    store,
    gather,
    scheduler,
    http: httpGet,
    makeSummarizer: () => gemini(new AiBudget(2)),
  });

  app.listen(config.port, () => {
    const mode = config.geminiApiKey ? `Gemini (${config.geminiModel})` : 'fallback (no GEMINI_API_KEY)';
    console.log(`[kmu] API on http://localhost:${config.port} · data ${dbPath} · AI ${mode}`);
    console.log(`[kmu] next gather: ${scheduler.nextRunAt()?.toLocaleString() ?? 'not scheduled'}`);
  });
}

main().catch((err) => {
  console.error(`[kmu] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
