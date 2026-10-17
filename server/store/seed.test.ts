import { it, expect } from 'vitest';
import { createInitialDb, DEFAULT_SOURCES } from './seed';

it('creates an initial db with the default sources and settings', () => {
  const db = createInitialDb();
  expect(db.sources).toHaveLength(DEFAULT_SOURCES.length);
  expect(db.sources.length).toBeGreaterThanOrEqual(10);
  expect(new Set(db.sources.map((s) => s.id)).size).toBe(db.sources.length);
  expect(db.sources.every((s) => s.enabled && s.type === 'rss' && s.defaultTags.length > 0)).toBe(true);
  expect(db.settings).toEqual({ relevanceThreshold: 6, maxItemAgeHours: 48, maxAiCallsPerRun: 15 });
  expect(db.posts).toEqual([]);
  expect(db.version).toBe(1);
});

it('includes the hacker news front page filtered by points', () => {
  expect(DEFAULT_SOURCES.find((s) => s.name === 'Hacker News')?.feedUrl).toBe('https://hnrss.org/frontpage?points=200');
});
