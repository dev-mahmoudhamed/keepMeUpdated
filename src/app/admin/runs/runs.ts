import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCircleAlert, LucideCircleCheck, LucideExternalLink, LucideFlaskConical, LucideLoaderCircle, LucidePlay, LucideRefreshCw } from '@lucide/angular';
import type { Run } from '../../../../shared/models';
import { type WorkflowRun, githubErrorText } from '../../core/github';
import { ToastService } from '../../core/toast';
import { ContentRepo } from '../content-repo';

/** Must match the cron in .github/workflows/gather.yml (UTC). */
export const GATHER_CRON = '0 3 * * *';
const POLL_MS = 10_000;
const POLL_FOR_MS = 15 * 60_000;

const TRIGGER_LABEL: Record<Run['trigger'], string> = { cron: 'Scheduled', manual: 'Manual', 'catch-up': 'Catch-up' };
const STATUS_LABEL: Record<Run['status'], string> = { running: 'Running', success: 'Done', partial: 'Done with errors', failed: 'Failed' };

/** Next time a daily "m h * * *" UTC cron fires after `now`. */
export function nextRunAt(cron: string, now = new Date()): Date {
  const [m, h] = cron.trim().split(/\s+/).map(Number);
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

@Component({
  selector: 'app-runs',
  imports: [RouterLink, LucidePlay,LucideFlaskConical, LucideRefreshCw, LucideLoaderCircle, LucideCircleCheck, LucideCircleAlert, LucideExternalLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './runs.html',
  styleUrl: './runs.css',
})
export class Runs {
  private readonly content = inject(ContentRepo);
  private readonly toast = inject(ToastService);

  protected readonly state = resource({ loader: () => this.content.loadState() });
  protected readonly live = resource({ loader: () => this.content.listGatherRuns() });
  protected readonly history = computed(() => (this.state.hasValue() ? (this.state.value()?.runs ?? []) : []));
  protected readonly liveRuns = computed(() => (this.live.hasValue() ? this.live.value() : []));
  protected readonly lastAiMode = computed(() => {
    const line = this.history()[0]?.log.find((l) => /\((gemini|fallback) mode\)/.test(l));
    if (!line) return null;
    return line.includes('gemini mode') ? 'Gemini' : 'Fallback (no Gemini key)';
  });
  protected readonly nextRun = nextRunAt(GATHER_CRON);
  protected readonly dispatching = signal<string | null>(null);
  protected readonly triggerLabel = TRIGGER_LABEL;
  protected readonly statusLabel = STATUS_LABEL;
  private poll?: ReturnType<typeof setInterval>;
  private pollUntil = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.poll));
  }

  protected liveLabel(run: WorkflowRun): string {
    if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending') return 'Queued';
    if (run.status !== 'completed') return 'Running';
    return run.conclusion === 'success' ? 'Done' : run.conclusion === 'cancelled' ? 'Cancelled' : 'Failed';
  }

  protected async start(mode: 'gather' | 'dry-run'): Promise<void> {
    if (this.dispatching()) return;
    this.dispatching.set(mode);
    try {
      await this.content.dispatchGather({ mode });
      this.toast.show(mode === 'gather' ? 'Gather started on GitHub. It takes a few minutes.' : 'Dry run started. Open it on GitHub to see each source’s results.');
      this.watch();
    } catch (err) {
      this.toast.show(githubErrorText(err), 'error');
    } finally {
      this.dispatching.set(null);
    }
  }

  protected refresh(): void {
    this.live.reload();
    this.state.reload();
  }

  /** Refresh the live list while a dispatched run is likely queued or running. */
  private watch(): void {
    this.pollUntil = Date.now() + POLL_FOR_MS;
    clearInterval(this.poll);
    this.poll = setInterval(() => {
      if (Date.now() > this.pollUntil) {
        clearInterval(this.poll);
        return;
      }
      this.refresh();
    }, POLL_MS);
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
