import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from './json-store';
import type { Db, Post } from '../../shared/models';

const emptyDb = (): Db => ({
  version: 1,
  posts: [],
  sources: [],
  runs: [],
  seen: {},
  settings: { relevanceThreshold: 6, maxItemAgeHours: 48, maxAiCallsPerRun: 15 },
});

const post = (i: number): Post => ({
  id: `p${i}`, slug: `p-${i}`, title: `Post ${i}`, tldr: '', bodyHtml: '', tags: [], sources: [],
  relevance: 5, status: 'published', origin: 'manual', aiPending: false,
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
});

describe('JsonStore', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kmu-'));
    file = join(dir, 'db.json');
  });

  it('creates file from init when missing', async () => {
    const store = await JsonStore.open(file, emptyDb);
    expect(store.read().posts.length).toBe(0);
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);
  });

  it('persists updates atomically and sequentially', async () => {
    const store = await JsonStore.open(file, emptyDb);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.update((db) => db.posts.push(post(i)))));
    const reopened = await JsonStore.open(file, emptyDb);
    expect(reopened.read().posts).toHaveLength(20);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('returns the value produced by the update function', async () => {
    const store = await JsonStore.open(file, emptyDb);
    await expect(store.update((db) => db.posts.length + 7)).resolves.toBe(7);
  });

  it('throws on corrupted file and leaves it untouched', async () => {
    await writeFile(file, '{oops');
    await expect(JsonStore.open(file, emptyDb)).rejects.toThrow(/not valid JSON/);
    expect(await readFile(file, 'utf8')).toBe('{oops');
  });
});
