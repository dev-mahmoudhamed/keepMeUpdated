import { Router } from 'express';
import type { AdminStatus, RunTrigger } from '../../shared/models';
import type { Config } from '../config';
import type { JsonStore } from '../store/json-store';

export interface GatherLike {
  isRunning(): string | null;
  start(trigger: RunTrigger): { id: string } | { conflict: string };
}

export interface RunsDeps {
  config: Config;
  store: JsonStore;
  gather: GatherLike;
  scheduler: { nextRunAt(): Date | null };
}

export function adminRunsRouter({ config, store, gather, scheduler }: RunsDeps): Router {
  const router = Router();

  router.get('/runs', (_req, res) => {
    res.json(store.read().runs);
  });

  router.get('/runs/:id', (req, res) => {
    const run = store.read().runs.find((r) => r.id === req.params.id);
    if (!run) res.status(404).json({ error: 'Not found' });
    else res.json(run);
  });

  router.post('/runs', (_req, res) => {
    const started = gather.start('manual');
    if ('conflict' in started) {
      res.status(409).json({ error: 'A gather run is already in progress', id: started.conflict });
      return;
    }
    res.status(202).json({ id: started.id });
  });

  router.get('/status', (_req, res) => {
    const status: AdminStatus = {
      geminiConfigured: !!config.geminiApiKey,
      model: config.geminiModel,
      nextRunAt: scheduler.nextRunAt()?.toISOString() ?? null,
      running: gather.isRunning(),
    };
    res.json(status);
  });

  return router;
}
