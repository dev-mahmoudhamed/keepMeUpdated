import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Db } from '../../shared/models';

/**
 * Whole-file JSON store. Reads come from memory; every update is applied in memory and
 * then persisted through a single queue (write temp file, then rename over the original).
 */
export class JsonStore {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private db: Db,
  ) {}

  static async open(filePath: string, init: () => Db): Promise<JsonStore> {
    let raw: string | undefined;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (raw === undefined) {
      const store = new JsonStore(filePath, init());
      await mkdir(dirname(filePath), { recursive: true });
      await store.persist();
      return store;
    }
    let db: Db;
    try {
      db = JSON.parse(raw) as Db;
    } catch {
      throw new Error(`${filePath} is not valid JSON — fix or move it; refusing to overwrite`);
    }
    return new JsonStore(filePath, db);
  }

  read(): Readonly<Db> {
    return this.db;
  }

  update<T>(fn: (db: Db) => T): Promise<T> {
    const next = this.queue.then(async () => {
      const result = fn(this.db);
      await this.persist();
      return result;
    });
    // Keep the queue alive even if one update fails.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}
