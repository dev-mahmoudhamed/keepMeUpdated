import { Router } from 'express';
import { z } from 'zod';
import type { Source } from '../../shared/models';
import { fetchSource } from '../gather/fetchers';
import type { HttpGet } from '../gather/http';
import type { JsonStore } from '../store/json-store';
import { newId } from '../util/ids';
import { httpUrl, parseBody, tagList } from './validate';

const selector = z.string().trim().max(200);

const sourceBody = z
  .object({
    name: z.string().trim().min(1, 'Add a name').max(100),
    siteUrl: httpUrl(z),
    type: z.enum(['rss', 'html']),
    feedUrl: httpUrl(z),
    selectors: z
      .object({
        item: selector.min(1, 'Add an item selector'),
        title: selector.min(1, 'Add a title selector'),
        link: selector.min(1, 'Add a link selector'),
        date: selector.optional(),
        summary: selector.optional(),
      })
      .optional(),
    defaultTags: tagList(z, 6).default([]),
    enabled: z.boolean().default(true),
    group: z.string().trim().max(60).optional(),
  })
  .refine((s) => s.type === 'rss' || s.selectors, { message: 'HTML sources need item, title and link selectors', path: ['selectors'] });

type SourceInput = z.infer<typeof sourceBody>;

const toSource = (id: string, body: SourceInput, prev?: Source): Source => ({
  ...(prev ?? {}),
  id,
  name: body.name,
  siteUrl: body.siteUrl,
  type: body.type,
  feedUrl: body.feedUrl,
  ...(body.type === 'html' && body.selectors ? { selectors: body.selectors } : { selectors: undefined }),
  defaultTags: body.defaultTags,
  enabled: body.enabled,
  group: body.group || prev?.group || undefined,
});

export interface AdminSourcesDeps {
  store: JsonStore;
  http: HttpGet;
  /** Called after every change so sources.md can be rewritten. */
  onSourcesChanged?: () => Promise<void>;
}

export function adminSourcesRouter({ store, http, onSourcesChanged }: AdminSourcesDeps): Router {
  const router = Router();
  const changed = async () => {
    try {
      await onSourcesChanged?.();
    } catch (err) {
      console.error('[sources] could not update sources.md:', err);
    }
  };

  router.get('/', (_req, res) => {
    res.json(store.read().sources);
  });

  router.post('/test', async (req, res) => {
    const body = parseBody(sourceBody, req, res);
    if (!body) return;
    try {
      const items = await fetchSource(toSource('test', body), http);
      res.json({ items: items.slice(0, 10) });
    } catch (err) {
      res.status(422).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/', async (req, res) => {
    const body = parseBody(sourceBody, req, res);
    if (!body) return;
    const source = toSource(newId(), body);
    await store.update((db) => db.sources.push(source));
    await changed();
    res.status(201).json(source);
  });

  router.put('/:id', async (req, res) => {
    const body = parseBody(sourceBody, req, res);
    if (!body) return;
    const updated = await store.update((db) => {
      const i = db.sources.findIndex((s) => s.id === req.params.id);
      if (i === -1) return undefined;
      db.sources[i] = toSource(db.sources[i].id, body, db.sources[i]);
      return db.sources[i];
    });
    if (!updated) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await changed();
    res.json(updated);
  });

  router.delete('/:id', async (req, res) => {
    const removed = await store.update((db) => {
      const i = db.sources.findIndex((s) => s.id === req.params.id);
      return i === -1 ? false : (db.sources.splice(i, 1), true);
    });
    if (!removed) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await changed();
    res.status(204).end();
  });

  return router;
}
