import type { Db } from '../../shared/models';

/** The database a brand-new install starts with. Sources are loaded from sources.md right after. */
export function createInitialDb(): Db {
  return {
    version: 1,
    posts: [],
    sources: [],
    runs: [],
    seen: {},
    settings: { relevanceThreshold: 6, maxItemAgeHours: 48, maxAiCallsPerRun: 15 },
  };
}
