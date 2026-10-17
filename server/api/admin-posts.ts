import { Router } from 'express';
import { z } from 'zod';
import type { Post } from '../../shared/models';
import { collectArticleText } from '../gather/pipeline';
import type { HttpGet } from '../gather/http';
import type { AiClient, RawItem } from '../gather/types';
import type { JsonStore } from '../store/json-store';
import { newId, uniqueSlug } from '../util/ids';
import { renderStoryBody, sanitizeHtml } from '../util/sanitize';
import { httpUrl, parseBody, tagList } from './validate';

const postBody = z.object({
  title: z.string().trim().min(1, 'Add a title').max(300),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
    .max(100)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  tldr: z.string().trim().max(600).default(''),
  bodyHtml: z.string().max(200_000).default(''),
  tags: tagList(z, 10).default([]),
  status: z.enum(['published', 'draft', 'hidden']),
  relevance: z.number().int().min(0).max(10).optional(),
  sources: z
    .array(
      z.object({
        sourceId: z.string().optional(),
        siteName: z.string().trim().min(1, 'Add a site name').max(100),
        url: httpUrl(z),
        title: z.string().trim().max(300).default(''),
        publishedAt: z.string().optional(),
      }),
    )
    .max(30)
    .default([]),
});

export interface AdminPostsDeps {
  store: JsonStore;
  http: HttpGet;
  /** Returns a Gemini-backed client, or undefined when no API key is configured. */
  makeSummarizer: () => AiClient | undefined;
}

export function adminPostsRouter({ store, http, makeSummarizer }: AdminPostsDeps): Router {
  const router = Router();
  const find = (id: string) => store.read().posts.find((p) => p.id === id);
  const slugTaken = (slug: string, exceptId?: string) => store.read().posts.some((p) => p.slug === slug && p.id !== exceptId);

  router.get('/', (req, res) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : '';
    const q = typeof req.query['q'] === 'string' ? req.query['q'].trim().toLowerCase() : '';
    const posts = store
      .read()
      .posts.filter((p) => !status || p.status === status)
      .filter((p) => !q || p.title.toLowerCase().includes(q) || p.tags.includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(posts);
  });

  router.get('/:id', (req, res) => {
    const post = find(req.params.id);
    if (!post) res.status(404).json({ error: 'Not found' });
    else res.json(post);
  });

  router.post('/', async (req, res) => {
    const body = parseBody(postBody, req, res);
    if (!body) return;
    if (body.slug && slugTaken(body.slug)) {
      res.status(409).json({ error: 'That slug is already used' });
      return;
    }
    const now = new Date().toISOString();
    const post = await store.update((db) => {
      const created: Post = {
        id: newId(),
        slug: body.slug ?? uniqueSlug(body.title, new Set(db.posts.map((p) => p.slug))),
        title: body.title,
        tldr: body.tldr,
        bodyHtml: sanitizeHtml(body.bodyHtml),
        tags: body.tags,
        sources: body.sources,
        relevance: body.relevance ?? 5,
        status: body.status,
        origin: 'manual',
        aiPending: false,
        createdAt: now,
        updatedAt: now,
        ...(body.status === 'published' ? { publishedAt: now } : {}),
      };
      db.posts.push(created);
      return created;
    });
    res.status(201).json(post);
  });

  router.put('/:id', async (req, res) => {
    const body = parseBody(postBody, req, res);
    if (!body) return;
    const existing = find(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const slug = body.slug ?? existing.slug;
    if (slugTaken(slug, existing.id)) {
      res.status(409).json({ error: 'That slug is already used' });
      return;
    }
    const now = new Date().toISOString();
    const post = await store.update((db) => {
      const p = db.posts.find((x) => x.id === existing.id)!;
      Object.assign(p, {
        slug,
        title: body.title,
        tldr: body.tldr,
        bodyHtml: sanitizeHtml(body.bodyHtml),
        tags: body.tags,
        sources: body.sources,
        status: body.status,
        relevance: body.relevance ?? p.relevance,
        updatedAt: now,
      });
      if (body.status === 'published' && !p.publishedAt) p.publishedAt = now;
      return p;
    });
    res.json(post);
  });

  router.delete('/:id', async (req, res) => {
    const removed = await store.update((db) => {
      const i = db.posts.findIndex((p) => p.id === req.params.id);
      return i === -1 ? false : (db.posts.splice(i, 1), true);
    });
    if (!removed) res.status(404).json({ error: 'Not found' });
    else res.status(204).end();
  });

  router.post('/:id/resummarize', async (req, res) => {
    const post = find(req.params.id);
    if (!post) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const ai = makeSummarizer();
    if (!ai) {
      res.status(409).json({ error: 'Add GEMINI_API_KEY to .env to use AI summaries' });
      return;
    }
    if (!post.sources.length) {
      res.status(409).json({ error: 'Add at least one source link first' });
      return;
    }
    const items: RawItem[] = post.sources.map((s, i) => ({
      id: `i${i}`,
      sourceId: s.sourceId ?? '',
      siteName: s.siteName,
      title: s.title || post.title,
      url: s.url,
      snippet: i === 0 ? post.tldr : '',
    }));
    const [summary] = await ai.summarize([{ clusterId: post.id, items, text: await collectArticleText(items, http) }]);
    if (!summary) {
      res.status(502).json({ error: 'Gemini did not return a summary. Try again later.' });
      return;
    }
    const updated = await store.update((db) => {
      const p = db.posts.find((x) => x.id === post.id)!;
      p.tldr = summary.tldr;
      p.bodyHtml = sanitizeHtml(renderStoryBody(summary.keyPoints, summary.whyItMatters));
      p.tags = [...new Set([...p.tags, ...summary.tags])].slice(0, 10);
      p.aiPending = false;
      p.updatedAt = new Date().toISOString();
      return p;
    });
    res.json(updated);
  });

  return router;
}
