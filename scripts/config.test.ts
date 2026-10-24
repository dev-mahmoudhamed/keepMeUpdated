import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { IS_DEV_ENV, loadDevEnv } from '../config/dev-env';

describe('workflows', () => {
const load = (name: string) => {
  const text = readFileSync(join(__dirname, '../.github/workflows', name), 'utf8');
  return { text, wf: parse(text) };
};

describe('gather.yml', () => {
  const { text, wf } = load('gather.yml');

  it('runs daily at 03:00 UTC, and by hand from the admin panel or the Run workflow button on GitHub', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['repository_dispatch', 'schedule', 'workflow_dispatch']);
    expect(wf.on.schedule).toEqual([{ cron: '0 3 * * *' }]);
    expect(wf.on.repository_dispatch).toEqual({ types: ['gather'] });
    expect(wf.on.workflow_dispatch.inputs.mode.options).toEqual(['gather', 'resummarize', 'dry-run']);
    expect(wf.on.workflow_dispatch.inputs.mode.default).toBe('gather');
    expect(wf.jobs.gather.env.MODE).toBe("${{ github.event.client_payload.mode || inputs.mode || 'gather' }}");
  });

  it('never runs two gathers at once', () => {
    expect(wf.concurrency).toEqual({ group: 'gather', 'cancel-in-progress': false });
  });

  it('can write content and leaves deploying to Netlify', () => {
    expect(wf.jobs.gather.permissions).toEqual({ contents: 'write' });
    expect(Object.keys(wf.jobs)).toEqual(['gather']);
  });

  it('passes the Gemini key from secrets to the gather step only', () => {
    const steps = wf.jobs.gather.steps as { env?: Record<string, string> }[];
    const withKey = steps.filter((s) => s.env?.['GEMINI_API_KEY']);
    expect(withKey).toHaveLength(1);
    expect(withKey[0].env!['GEMINI_API_KEY']).toBe('${{ secrets.GEMINI_API_KEY }}');
  });

  it('retries the push when main moved', () => {
    expect(text).toContain('git pull --rebase');
  });
});

it('uses no secrets other than GEMINI_API_KEY', () => {
  for (const name of ['gather.yml']) {
    const secrets = [...load(name).text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(secrets.every((s) => s === 'GEMINI_API_KEY')).toBe(true);
  }
});

it('never interpolates the dispatch payload directly into shell commands', () => {
  for (const name of ['gather.yml']) {
    const runs = (Object.values(load(name).wf.jobs) as { steps?: { run?: string }[] }[]).flatMap((j) => j.steps ?? []).map((s) => s.run ?? '');
    expect(runs.some((r) => r.includes('${{ inputs.') || r.includes('client_payload'))).toBe(false);
  }
});

it('knows the branch on scheduled runs, whose event has no repository info', () => {
  const { wf } = load('gather.yml');
  const fallback = '${{ github.event.repository.default_branch || github.ref_name }}';
  expect(wf.jobs.gather.env.BRANCH).toBe(fallback);
  const checkout = (wf.jobs.gather.steps as { uses?: string; with?: { ref?: string } }[]).find((s) => s.uses?.startsWith('actions/checkout'));
  expect(checkout?.with?.ref).toBe(fallback);
});
});

describe('netlify', () => {
const root = join(__dirname, '..');
const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
const setting = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(toml)?.[1];

describe('netlify.toml', () => {
  it('publishes the folder the Angular application builder writes (else @netlify/angular-runtime fails the build)', () => {
    const angular = JSON.parse(readFileSync(join(root, 'angular.json'), 'utf8'));
    const [name, project] = Object.entries(angular.projects)[0] as [string, { architect: { build: { builder: string; options: { outputPath?: string } } } }];
    expect(project.architect.build.builder).toBe('@angular/build:application');
    expect(setting('publish')).toBe(`${project.architect.build.options.outputPath ?? `dist/${name}`}/browser`);
  });

  it('builds the data before the site and serves the functions', () => {
    expect(setting('command')).toBe('npm run build');
    expect(setting('directory')).toBe('netlify/functions');
  });

  it('routes deep links to the app', () => {
    expect(toml).toMatch(/from = "\/\*"\s+to = "\/index.html"\s+status = 200/);
  });
});

describe('Netlify function routes', () => {
  // Netlify reads `export const config` at build time without running the code, so only literal values work.
  // A template literal like `${PREFIX}/*` is silently ignored and the route falls through to the app.
  const routes: [file: string, path: string][] = [
    ['netlify/functions/auth.ts', '/api/auth/*'],
    ['netlify/functions/github.ts', '/api/github/*'],
  ];

  it.each(routes)('%s declares its path as a plain string', (file, path) => {
    const source = readFileSync(join(root, file), 'utf8');
    const config = /export const config[^=]*=\s*\{\s*path:\s*([^}]*?)\s*\}/.exec(source)?.[1];
    expect(config).toBe(`'${path}'`);
  });
});
});

describe('dev-env', () => {
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
});
