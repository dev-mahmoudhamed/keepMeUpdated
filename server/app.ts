import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { adminPostsRouter } from './api/admin-posts';
import { adminRunsRouter, type GatherLike } from './api/admin-runs';
import { adminSourcesRouter } from './api/admin-sources';
import { authRouter, requireAdmin } from './api/auth';
import { publicRouter } from './api/public';
import type { Config } from './config';
import type { HttpGet } from './gather/http';
import type { AiClient } from './gather/types';
import type { JsonStore } from './store/json-store';

export type { GatherLike };

export interface AppDeps {
  config: Config;
  store: JsonStore;
  gather: GatherLike;
  scheduler: { nextRunAt(): Date | null };
  http: HttpGet;
  makeSummarizer: () => AiClient | undefined;
  /** Rewrites sources.md after admin changes. */
  onSourcesChanged?: () => Promise<void>;
}

export function createApp(deps: AppDeps): Express {
  const { config, store } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', publicRouter(store));
  app.use('/api/auth', authRouter(config));
  const admin = express.Router();
  admin.use(requireAdmin(config));
  admin.use('/posts', adminPostsRouter(deps));
  admin.use('/sources', adminSourcesRouter(deps));
  admin.use('/', adminRunsRouter(deps));
  app.use('/api/admin', admin);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // In production the server also hosts the built Angular app.
  const browserDir = join(process.cwd(), 'dist', 'keepMeUpdated', 'browser');
  if (config.isProd && existsSync(browserDir)) {
    app.use(express.static(browserDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(join(browserDir, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    console.error('[api]', err);
    res.status(500).json({ error: 'Something went wrong' });
  };
  app.use(onError);
  return app;
}
