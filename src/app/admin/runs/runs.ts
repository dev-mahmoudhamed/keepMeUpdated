import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { LucideCircleAlert, LucideCircleCheck, LucideLoaderCircle, LucidePlay } from '@lucide/angular';
import { type Subscription, switchMap, takeWhile, timer } from 'rxjs';
import type { AdminStatus, Run } from '../../../../shared/models';
import { AdminApi, errorMessage } from '../../core/api';
import { ToastService } from '../../core/toast';

const POLL_MS = 2000;
const TRIGGER_LABEL: Record<Run['trigger'], string> = { cron: 'Scheduled', manual: 'Manual', 'catch-up': 'Catch-up' };
const STATUS_LABEL: Record<Run['status'], string> = { running: 'Running', success: 'Done', partial: 'Done with errors', failed: 'Failed' };

@Component({
  selector: 'app-runs',
  imports: [LucidePlay, LucideLoaderCircle, LucideCircleCheck, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './runs.html',
  styleUrl: './runs.css',
})
export class Runs {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly status = httpResource<AdminStatus>(() => '/api/admin/status');
  protected readonly runs = httpResource<Run[]>(() => '/api/admin/runs');
  protected readonly rows = computed(() => (this.runs.hasValue() ? this.runs.value() : []));
  protected readonly info = computed(() => (this.status.hasValue() ? this.status.value() : null));

  /** The run being watched, with its latest progress. */
  protected readonly live = signal<Run | null>(null);
  protected readonly starting = signal(false);
  protected readonly busy = computed(() => this.starting() || this.live()?.status === 'running');
  protected readonly triggerLabel = TRIGGER_LABEL;
  protected readonly statusLabel = STATUS_LABEL;
  private poll?: Subscription;

  constructor() {
    // A run already going when the page opens (e.g. the 04:00 one) gets watched too.
    effect(() => {
      const running = this.info()?.running;
      if (running) untracked(() => !this.poll && this.watch(running));
    });
    this.destroyRef.onDestroy(() => this.poll?.unsubscribe());
  }

  protected start(): void {
    if (this.busy()) return;
    this.starting.set(true);
    this.api.startRun().subscribe({
      next: ({ id }) => {
        this.starting.set(false);
        this.watch(id);
      },
      error: (err: unknown) => {
        this.starting.set(false);
        const id = err instanceof HttpErrorResponse && err.status === 409 ? (err.error as { id?: string })?.id : undefined;
        if (id) this.watch(id);
        else this.toast.show(errorMessage(err), 'error');
      },
    });
  }

  private watch(id: string): void {
    this.poll?.unsubscribe();
    this.poll = timer(0, POLL_MS)
      .pipe(
        switchMap(() => this.api.run(id)),
        takeWhile((run) => run.status === 'running', true),
      )
      .subscribe({
        next: (run) => {
          this.live.set(run);
          if (run.status !== 'running') this.finished(run);
        },
        error: () => {
          this.poll = undefined;
          this.toast.show('Lost track of the run. Refresh to see its result.', 'error');
        },
        complete: () => {
          this.poll = undefined;
        },
      });
  }

  private finished(run: Run): void {
    const s = run.stats;
    this.toast.show(
      run.status === 'failed'
        ? 'Gather failed. See the run log below.'
        : `Gather finished: ${s.created} new, ${s.merged} merged${run.status === 'partial' ? ', some sources failed' : ''}`,
      run.status === 'failed' ? 'error' : 'ok',
    );
    this.runs.reload();
    this.status.reload();
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected duration(run: Run): string {
    if (!run.finishedAt) return '';
    const secs = Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
    return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }
}
