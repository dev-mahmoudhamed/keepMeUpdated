import { it, expect } from 'vitest';
import { createInitialDb } from './seed';

it('starts with no sources; they come from sources.md', () => {
  const db = createInitialDb();
  expect(db.sources).toEqual([]);
  expect(db.settings).toEqual({ relevanceThreshold: 6, maxItemAgeHours: 48, maxAiCallsPerRun: 15 });
  expect(db.posts).toEqual([]);
  expect(db.version).toBe(1);
});
