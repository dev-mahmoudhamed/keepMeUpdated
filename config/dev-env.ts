import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// Namespace import: a named import of parseEnv would fail to load on an older function runtime even when unused.
import * as util from 'node:util';

/**
 * Set to `true` ONLY on your own machine to read the variables from `.env` (copy `.env.example`)
 * when running `npm run gather` locally. (`npm run preview` reads `.env` by itself.)
 *
 * Keep it `false` in git: on GitHub Actions the variables come from its settings.
 * A test fails while it is `true`, so it can't be committed by accident.
 */
export const IS_DEV_ENV = false;

export const DEV_ENV_FILE = '.env';

export interface LoadDevEnvOptions {
  enabled?: boolean;
  file?: string;
  env?: NodeJS.ProcessEnv;
}

/** When the flag is on, copies every variable from `.env` into the environment (the file's values win). Returns the names loaded. */
export function loadDevEnv(opts: LoadDevEnvOptions = {}): string[] {
  const enabled = opts.enabled ?? IS_DEV_ENV;
  if (!enabled) return [];
  const file = opts.file ?? join(process.cwd(), DEV_ENV_FILE);
  const env = opts.env ?? process.env;
  if (!existsSync(file)) {
    console.warn(`[dev-env] IS_DEV_ENV is true but ${file} doesn't exist; using the existing environment.`);
    return [];
  }
  const values = util.parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(values)) env[key] = value;
  const loaded = Object.keys(values);
  // Names only: values are secrets.
  console.log(`[dev-env] loaded ${loaded.length} variables from ${DEV_ENV_FILE}: ${loaded.join(', ')}`);
  return loaded;
}
