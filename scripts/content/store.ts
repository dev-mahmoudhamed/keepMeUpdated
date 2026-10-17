import type { Db } from '../../shared/models';

/** What the gather pipeline needs from storage: read the data, and change it. */
export interface Store {
  read(): Readonly<Db>;
  update<T>(fn: (db: Db) => T): Promise<T>;
}

/** Keeps the data in memory; the CLI saves it to content files when the run is done. */
export class MemoryStore implements Store {
  constructor(private readonly db: Db) {}

  read(): Readonly<Db> {
    return this.db;
  }

  async update<T>(fn: (db: Db) => T): Promise<T> {
    return fn(this.db);
  }
}
