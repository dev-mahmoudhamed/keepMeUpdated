import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Run } from '../../../../shared/models';
import { Runs } from './runs';

const run = (status: Run['status']): Run => ({
  id: 'r1',
  trigger: 'manual',
  startedAt: '2026-10-17T10:00:00Z',
  status,
  stats: { fetched: 10, fresh: 4, clusters: 3, created: 2, merged: 1, skipped: 0 },
  errors: [],
  log: ['Fetched 12 sources: 10 items'],
});

describe('Runs', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.useRealTimers());

  /** Let resource promises resolve (timers are fake, microtasks are real), then render. */
  async function settle(fixture: { detectChanges(): void }) {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    TestBed.tick();
    fixture.detectChanges();
  }

  async function render() {
    const fixture = TestBed.createComponent(Runs);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('/api/admin/status').flush({ geminiConfigured: false, model: 'gemini-flash-latest', nextRunAt: '2026-10-18T04:00:00Z', running: null });
    http.expectOne('/api/admin/runs').flush([]);
    await settle(fixture);
    return fixture;
  }

  it('starts a run and polls until it finishes', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Fallback');

    (el.querySelector('button[data-action="run"]') as HTMLButtonElement).click();
    const start = http.expectOne('/api/admin/runs');
    expect(start.request.method).toBe('POST');
    start.flush({ id: 'r1' });

    vi.advanceTimersByTime(0);
    http.expectOne('/api/admin/runs/r1').flush(run('running'));
    await settle(fixture);
    expect(el.querySelector('button[data-action="run"]')?.textContent).toContain('Gathering');

    vi.advanceTimersByTime(2000);
    http.expectOne('/api/admin/runs/r1').flush(run('success'));

    vi.advanceTimersByTime(4000);
    http.expectNone('/api/admin/runs/r1');

    await settle(fixture);
    http.expectOne('/api/admin/runs').flush([run('success')]);
    http.expectOne('/api/admin/status').flush({ geminiConfigured: false, model: 'm', nextRunAt: null, running: null });
  });
});
