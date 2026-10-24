import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ContentState, Run } from '../../../../shared/models';
import { FakeContent, provideFakeContent, settle } from '../testing/fake-content';
import { Runs, nextRunAt } from './runs';

const run: Run = {
  id: 'r1',
  trigger: 'cron',
  startedAt: '2026-10-17T03:00:00Z',
  finishedAt: '2026-10-17T03:01:10Z',
  status: 'success',
  stats: { fetched: 419, fresh: 5, clusters: 5, created: 5, merged: 0 },
  errors: [],
  log: ['Fetched 20 sources: 419 items', 'Grouped into 5 stories (gemini mode)'],
};

const state: ContentState = {
  version: 1,
  settings: { maxAiCallsPerRun: 15, retentionDays: 30 },
  seen: {},
  runs: [run],
  sourceStatus: {},
};

describe('Runs', () => {
  let fake: FakeContent;

  beforeEach(() => {
    fake = new FakeContent([], [], state, [
      { id: 9, status: 'in_progress', conclusion: null, createdAt: '2026-10-17T12:00:00Z', url: 'https://github.com/me/kmu/actions/runs/9', event: 'workflow_dispatch', title: 'Gather news' },
    ]);
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideFakeContent(fake)] });
  });

  async function render() {
    const fixture = TestBed.createComponent(Runs);
    fixture.detectChanges();
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the last AI mode, live GitHub runs and the run history', async () => {
    const { el } = await render();
    expect(el.querySelector('.cards')?.textContent).toContain('Gemini');
    expect(el.querySelector('.live a')?.getAttribute('href')).toBe('https://github.com/me/kmu/actions/runs/9');
    expect(el.querySelector('.live')?.textContent).toContain('Running');
    expect(el.querySelector('.history')?.textContent).toContain('+5 new');
  });

  it('starts a gather and a dry run through the workflow', async () => {
    const { fixture, el } = await render();
    (el.querySelector('button[data-action="run"]') as HTMLButtonElement).click();
    await settle(fixture);
    (el.querySelector('button[data-action="dry-run"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(fake.dispatched).toEqual([{ mode: 'gather' }, { mode: 'dry-run' }]);
  });
});

describe('nextRunAt', () => {
  it('is today at 03:00 UTC when that is still ahead, otherwise tomorrow', () => {
    expect(nextRunAt('0 3 * * *', new Date('2026-10-17T01:00:00Z')).toISOString()).toBe('2026-10-17T03:00:00.000Z');
    expect(nextRunAt('0 3 * * *', new Date('2026-10-17T05:00:00Z')).toISOString()).toBe('2026-10-18T03:00:00.000Z');
  });
});
