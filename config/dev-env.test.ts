import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IS_DEV_ENV, loadDevEnv } from './dev-env';

describe('loadDevEnv', () => {
  let file: string;
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'kmu-env-')), '.env');
    await writeFile(file, '# comment\nADMIN_EMAIL="dummy dummy dummy"\nGITHUB_REPO=owner/repo\n');
  });

  it('is switched off in the repository, so Netlify and GitHub use their own settings', () => {
    expect(IS_DEV_ENV).toBe(false);
  });

  it('does nothing when the flag is off', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadDevEnv({ enabled: false, file, env })).toEqual([]);
    expect(env).toEqual({});
  });

  it('loads the .env file when the flag is on, and its values win', () => {
    const env: NodeJS.ProcessEnv = { GITHUB_REPO: 'from-netlify/repo', OTHER: 'kept' };
    expect(loadDevEnv({ enabled: true, file, env })).toEqual(['ADMIN_EMAIL', 'GITHUB_REPO']);
    expect(env).toEqual({ ADMIN_EMAIL: 'dummy dummy dummy', GITHUB_REPO: 'owner/repo', OTHER: 'kept' });
  });

  it('carries on without the file when it does not exist', () => {
    const env: NodeJS.ProcessEnv = { A: '1' };
    expect(loadDevEnv({ enabled: true, file: join(file, '..', 'missing.env'), env })).toEqual([]);
    expect(env).toEqual({ A: '1' });
  });
});

describe('entry points', () => {
  it.each(['netlify/functions/auth.ts', 'netlify/functions/github.ts', 'scripts/gather.ts'])('%s loads the dev env before reading variables', async (file) => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    const call = source.indexOf('loadDevEnv();');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(source.indexOf('process.env'));
  });
});
