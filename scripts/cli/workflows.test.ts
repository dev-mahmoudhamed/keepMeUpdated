import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const load = (name: string) => {
  const text = readFileSync(join(__dirname, '../../.github/workflows', name), 'utf8');
  return { text, wf: parse(text) };
};

describe('gather.yml', () => {
  const { text, wf } = load('gather.yml');

  it('runs daily at 03:00 UTC and on demand with a mode', () => {
    expect(wf.on.schedule).toEqual([{ cron: '0 3 * * *' }]);
    expect(wf.on.workflow_dispatch.inputs.mode.options).toEqual(['gather', 'resummarize', 'dry-run']);
    expect(wf.on.workflow_dispatch.inputs.mode.default).toBe('gather');
    expect(wf.on.workflow_dispatch.inputs.post_id).toBeDefined();
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

it('never interpolates workflow inputs directly into shell commands', () => {
  for (const name of ['gather.yml']) {
    const runs = (Object.values(load(name).wf.jobs) as { steps?: { run?: string }[] }[]).flatMap((j) => j.steps ?? []).map((s) => s.run ?? '');
    expect(runs.some((r) => r.includes('${{ inputs.'))).toBe(false);
  }
});

it('knows the branch on scheduled runs, whose event has no repository info', () => {
  const { wf } = load('gather.yml');
  const fallback = '${{ github.event.repository.default_branch || github.ref_name }}';
  expect(wf.jobs.gather.env.BRANCH).toBe(fallback);
  const checkout = (wf.jobs.gather.steps as { uses?: string; with?: { ref?: string } }[]).find((s) => s.uses?.startsWith('actions/checkout'));
  expect(checkout?.with?.ref).toBe(fallback);
});
