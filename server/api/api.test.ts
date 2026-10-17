import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { createApp, type GatherLike } from '../app';
import { JsonStore } from '../store/json-store';
import { loadConfig } from '../config';
import type { Db, Post } from '../../shared/models';
import type { HttpGet } from '../gather/http';
import type { AiClient } from '../gather/types';

const config = { ...loadConfig({ SESSION_SECRET: 'test-secret-test-secret-test-secret' }), adminPassword: 'pw-123' };

const db = (): Db => ({
  version: 1,
  posts: [
    {
      id: 'p1', slug: 'live', title: 'Live post', tldr: 't', bodyHtml: '<p>b</p>', tags: ['x'],
      sources: [{ siteName: 'A', url: 'https://a.test/1', title: 'one' }], relevance: 5, status: 'published',
      origin: 'auto', aiPending: false, createdAt: '2026-10-17T12:00:00.000Z', updatedAt: '2026-10-17T12:00:00.000Z',
      publishedAt: '2026-10-17T12:00:00.000Z',
    },
    {
      id: 'p2', slug: 'draft', title: 'Draft post', tldr: 't', bodyHtml: '', tags: [], sources: [], relevance: 5,
      status: 'draft', origin: 'manual', aiPending: false, createdAt: '2026-10-17T12:00:00.000Z', updatedAt: '2026-10-17T12:00:00.000Z',
    },
  ],
  sources: [{ id: 's1', name: 'A', siteUrl: 'https://a.test', type: 'rss', feedUrl: 'https://a.test/feed', defaultTags: ['a'], enabled: true }],
  runs: [],
  seen: {},
  settings: { relevanceThreshold: 6, maxItemAgeHours: 48, maxAiCallsPerRun: 15 },
});

class FakeGather implements GatherLike {
  running: string | null = null;
  isRunning() {
    return this.running;
  }
  start() {
    if (this.running) return { conflict: this.running };
    this.running = 'run-1';
    return { id: 'run-1' };
  }
}

const listing = '<html><body><article class="p"><h2>Hello</h2><a href="/hello">x</a></article></body></html>';
const http: HttpGet = async (url) => {
  if (url === 'https://html.test/') return { status: 200, text: listing, finalUrl: url };
  throw new Error(`HTTP 404 for ${url}`);
};

describe('API', () => {
  let app: Express;
  let store: JsonStore;
  let gather: FakeGather;
  let aiFactory: (() => AiClient) | undefined;

  beforeEach(async () => {
    store = await JsonStore.open(join(await mkdtemp(join(tmpdir(), 'kmu-api-')), 'db.json'), db);
    gather = new FakeGather();
    aiFactory = undefined;
    app = createApp({
      config,
      store,
      gather,
      scheduler: { nextRunAt: () => new Date('2026-10-18T04:00:00Z') },
      http,
      makeSummarizer: () => aiFactory?.(),
    });
  });

  const login = async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: config.adminEmail, password: 'pw-123' }).expect(204);
    return agent;
  };

  describe('public', () => {
    it('lists published posts grouped by day', async () => {
      const res = await request(app).get('/api/posts').expect(200);
      expect(res.body.days[0].posts.map((p: { slug: string }) => p.slug)).toEqual(['live']);
    });

    it('GET /api/posts/:slug returns a published post', async () => {
      const res = await request(app).get('/api/posts/live').expect(200);
      expect(res.body.title).toBe('Live post');
    });

    it('GET /api/posts/:slug 404s for drafts', async () => {
      await request(app).get('/api/posts/draft').expect(404, { error: 'Not found' });
    });

    it('GET /api/tags counts published tags', async () => {
      await request(app).get('/api/tags').expect(200, [{ tag: 'x', count: 1 }]);
    });

    it('unknown api routes return json 404', async () => {
      await request(app).get('/api/nope').expect(404, { error: 'Not found' });
    });
  });

  describe('auth', () => {
    it('admin routes 401 without session', async () => {
      await request(app).get('/api/admin/posts').expect(401, { error: 'Sign in required' });
    });

    it('login with wrong password 401, right password sets HttpOnly cookie', async () => {
      await request(app).post('/api/auth/login').send({ email: config.adminEmail, password: 'nope' }).expect(401);
      const res = await request(app).post('/api/auth/login').send({ email: config.adminEmail, password: 'pw-123' }).expect(204);
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/kmu_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    });

    it('me reports the signed-in user, logout clears it', async () => {
      const agent = await login();
      await agent.get('/api/auth/me').expect(200, { email: config.adminEmail });
      await agent.post('/api/auth/logout').expect(204);
      await agent.get('/api/auth/me').expect(401);
    });

    it('rejects tampered session cookie', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: config.adminEmail, password: 'pw-123' });
      const token = /kmu_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1];
      const [payload, sig] = decodeURIComponent(token).split('.');
      const forged = Buffer.from(JSON.stringify({ sub: 'evil', exp: 9e15 })).toString('base64url');
      await request(app).get('/api/admin/posts').set('Cookie', `kmu_session=${forged}.${sig}`).expect(401);
      await request(app).get('/api/admin/posts').set('Cookie', `kmu_session=${payload}.${sig}`).expect(200);
    });

    it('rate limits login attempts', async () => {
      for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: 'x@y.z', password: 'bad' }).expect(401);
      const res = await request(app).post('/api/auth/login').send({ email: 'x@y.z', password: 'bad' }).expect(429);
      expect(res.body.error).toMatch(/Too many attempts/);
    });
  });

  describe('admin posts', () => {
    it('lists all posts including drafts', async () => {
      const agent = await login();
      const res = await agent.get('/api/admin/posts').expect(200);
      expect(res.body.map((p: Post) => p.id).sort()).toEqual(['p1', 'p2']);
      const drafts = await agent.get('/api/admin/posts?status=draft').expect(200);
      expect(drafts.body.map((p: Post) => p.id)).toEqual(['p2']);
    });

    it('creates, updates (sanitized), and deletes a post', async () => {
      const agent = await login();
      const created = await agent
        .post('/api/admin/posts')
        .send({ title: 'Hand written', tldr: 'Short', bodyHtml: '<p>ok</p><script>bad()</script>', tags: ['Mine'], status: 'draft', sources: [] })
        .expect(201);
      expect(created.body).toMatchObject({ slug: 'hand-written', origin: 'manual', bodyHtml: '<p>ok</p>', tags: ['mine'], status: 'draft' });
      expect(created.body.publishedAt).toBeUndefined();

      const updated = await agent
        .put(`/api/admin/posts/${created.body.id}`)
        .send({ ...created.body, status: 'published', bodyHtml: '<p onclick="x()">new</p>' })
        .expect(200);
      expect(updated.body.bodyHtml).toBe('<p>new</p>');
      expect(updated.body.publishedAt).toBeDefined();
      await request(app).get('/api/posts/hand-written').expect(200);

      await agent.delete(`/api/admin/posts/${created.body.id}`).expect(204);
      await agent.get(`/api/admin/posts/${created.body.id}`).expect(404);
    });

    it('POST /api/admin/posts 409 on duplicate slug', async () => {
      const agent = await login();
      await agent
        .post('/api/admin/posts')
        .send({ title: 'x', slug: 'live', tldr: '', bodyHtml: '', tags: [], status: 'draft', sources: [] })
        .expect(409, { error: 'That slug is already used' });
    });

    it('400s on invalid input with a readable message', async () => {
      const agent = await login();
      const res = await agent.post('/api/admin/posts').send({ title: '', tldr: '', bodyHtml: '', tags: [], status: 'draft', sources: [] }).expect(400);
      expect(res.body.error).toMatch(/title/i);
      await agent
        .post('/api/admin/posts')
        .send({ title: 'x', tldr: '', bodyHtml: '', tags: [], status: 'draft', sources: [{ siteName: 'a', url: 'javascript:alert(1)', title: '' }] })
        .expect(400);
    });

    it('resummarize 409s without Gemini', async () => {
      const agent = await login();
      await agent.post('/api/admin/posts/p1/resummarize').expect(409);
    });

    it('resummarize rewrites tldr and body with the summarizer', async () => {
      aiFactory = () => ({
        mode: 'gemini',
        triage: async () => [],
        summarize: async (stories) => [
          { clusterId: stories[0].clusterId, title: 'New title', tldr: 'New tldr', keyPoints: ['k'], whyItMatters: 'w', tags: ['z'] },
        ],
      });
      const agent = await login();
      const res = await agent.post('/api/admin/posts/p1/resummarize').expect(200);
      expect(res.body).toMatchObject({ tldr: 'New tldr', aiPending: false, title: 'Live post' });
      expect(res.body.bodyHtml).toContain('Key points');
    });
  });

  describe('admin sources', () => {
    it('creates, updates and deletes a source', async () => {
      const agent = await login();
      const created = await agent
        .post('/api/admin/sources')
        .send({ name: 'New', siteUrl: 'https://n.test', type: 'rss', feedUrl: 'https://n.test/feed', defaultTags: ['N'], enabled: true })
        .expect(201);
      expect(created.body.defaultTags).toEqual(['n']);
      await agent.put(`/api/admin/sources/${created.body.id}`).send({ ...created.body, enabled: false }).expect(200);
      expect(store.read().sources.find((s) => s.id === created.body.id)!.enabled).toBe(false);
      await agent.delete(`/api/admin/sources/${created.body.id}`).expect(204);
      expect(store.read().sources).toHaveLength(1);
    });

    it('requires selectors for html sources', async () => {
      const agent = await login();
      const res = await agent
        .post('/api/admin/sources')
        .send({ name: 'H', siteUrl: 'https://h.test', type: 'html', feedUrl: 'https://h.test/', defaultTags: [], enabled: true })
        .expect(400);
      expect(res.body.error).toMatch(/selector/i);
    });

    it('POST /api/admin/sources/test returns parsed items', async () => {
      const agent = await login();
      const res = await agent
        .post('/api/admin/sources/test')
        .send({ name: 'H', siteUrl: 'https://html.test', type: 'html', feedUrl: 'https://html.test/', defaultTags: [], enabled: true, selectors: { item: 'article.p', title: 'h2', link: 'a' } })
        .expect(200);
      expect(res.body.items).toEqual([expect.objectContaining({ title: 'Hello', url: 'https://html.test/hello' })]);
    });

    it('POST /api/admin/sources/test reports fetch errors', async () => {
      const agent = await login();
      const res = await agent
        .post('/api/admin/sources/test')
        .send({ name: 'R', siteUrl: 'https://r.test', type: 'rss', feedUrl: 'https://r.test/feed', defaultTags: [], enabled: true })
        .expect(422);
      expect(res.body.error).toMatch(/404/);
    });
  });

  describe('admin runs', () => {
    it('POST /api/admin/runs returns 202 then 409 while running', async () => {
      const agent = await login();
      await agent.post('/api/admin/runs').expect(202, { id: 'run-1' });
      const res = await agent.post('/api/admin/runs').expect(409);
      expect(res.body).toMatchObject({ id: 'run-1' });
    });

    it('status reports ai mode, next run and running id', async () => {
      const agent = await login();
      const res = await agent.get('/api/admin/status').expect(200);
      expect(res.body).toEqual({ geminiConfigured: false, model: 'gemini-flash-latest', nextRunAt: '2026-10-18T04:00:00.000Z', running: null });
    });

    it('lists runs and 404s unknown run', async () => {
      const agent = await login();
      await agent.get('/api/admin/runs').expect(200, []);
      await agent.get('/api/admin/runs/nope').expect(404);
    });
  });
});
