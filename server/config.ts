import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export interface Config {
  port: number;
  /** Interface to listen on. Localhost by default so the admin isn't exposed to the network. */
  host: string;
  geminiApiKey?: string;
  geminiModel: string;
  adminEmail: string;
  adminPassword: string;
  sessionSecret: string;
  gatherCron: string;
  dataDir: string;
  isProd: boolean;
  /** True while ADMIN_PASSWORD is still the value published in .env.example. */
  usingDefaultPassword: boolean;
}

const DEFAULT_PASSWORD = 'ChangeMe!2026';

let warnedSecret = false;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  let sessionSecret = env['SESSION_SECRET']?.trim();
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString('hex');
    if (!warnedSecret && env['NODE_ENV'] !== 'test' && !env['VITEST']) {
      console.warn('[config] SESSION_SECRET is not set; using a random one (sessions reset on restart).');
    }
    warnedSecret = true;
  }
  return {
    port: Number(env['API_PORT']) || Number(env['PORT']) || 3000,
    host: env['HOST']?.trim() || '127.0.0.1',
    geminiApiKey: env['GEMINI_API_KEY']?.trim() || undefined,
    geminiModel: env['GEMINI_MODEL']?.trim() || 'gemini-flash-latest',
    adminEmail: env['ADMIN_EMAIL']?.trim() || 'admin@keepmeupdated.local',
    adminPassword: env['ADMIN_PASSWORD'] || DEFAULT_PASSWORD,
    sessionSecret,
    gatherCron: env['GATHER_CRON']?.trim() || '0 4 * * *',
    dataDir: env['DATA_DIR']?.trim() || join(process.cwd(), 'data'),
    isProd: env['NODE_ENV'] === 'production',
    usingDefaultPassword: (env['ADMIN_PASSWORD'] || DEFAULT_PASSWORD) === DEFAULT_PASSWORD,
  };
}
