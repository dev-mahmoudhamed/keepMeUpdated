import { Router } from 'express';
import { z } from 'zod';
import type { JsonStore } from '../store/json-store';
import { groupByDay, tagCounts } from './feed';

const feedQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tag: z.string().max(50).optional(),
  q: z.string().max(200).optional(),
});

export function publicRouter(store: JsonStore): Router {
  const router = Router();

  router.get('/posts', (req, res) => {
    const parsed = feedQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid feed query' });
      return;
    }
    res.json(groupByDay(store.read().posts, parsed.data));
  });

  router.get('/posts/:slug', (req, res) => {
    const post = store.read().posts.find((p) => p.slug === req.params.slug && p.status === 'published');
    if (!post) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(post);
  });

  router.get('/tags', (_req, res) => {
    res.json(tagCounts(store.read().posts));
  });

  return router;
}
