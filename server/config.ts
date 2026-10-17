import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export interface Config {
  port: number;
  geminiApiKey?: string;
  geminiModel: string;
  adminEmail: string;
  adminPassword: string;
  sessionSecret: string;
  gatherCron: string;
  dataDir: string;
  isProd: boolean;
}

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
    port: Number(env['PORT']) || 3000,
    geminiApiKey: env['GEMINI_API_KEY']?.trim() || undefined,
    geminiModel: env['GEMINI_MODEL']?.trim() || 'gemini-flash-latest',
    adminEmail: env['ADMIN_EMAIL']?.trim() || 'admin@keepmeupdated.local',
    adminPassword: env['ADMIN_PASSWORD'] || 'ChangeMe!2026',
    sessionSecret,
    gatherCron: env['GATHER_CRON']?.trim() || '0 4 * * *',
    dataDir: env['DATA_DIR']?.trim() || join(process.cwd(), 'data'),
    isProd: env['NODE_ENV'] === 'production',
  };
}
