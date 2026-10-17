import cron from 'node-cron';
import type { JsonStore } from '../store/json-store';
import type { GatherService } from './pipeline';

/**
 * True when the daily run was missed (machine off/asleep at the scheduled time):
 * today's slot has passed and no run has started since it. Only "m h * * *" schedules qualify.
 */
export function shouldCatchUp(lastRunStartedAt: string | undefined, now: Date, cronExpr: string): boolean {
  const m = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(cronExpr.trim());
  if (!m) return false;
  const slot = new Date(now);
  slot.setHours(Number(m[2]), Number(m[1]), 0, 0);
  if (now < slot) return false;
  if (!lastRunStartedAt) return true;
  return Date.parse(lastRunStartedAt) < slot.getTime();
}

export interface SchedulerHandle {
  nextRunAt(): Date | null;
  stop(): void;
}

interface CronTask {
  on(event: 'execution:missed', fn: () => void): void;
  getNextRun(): Date | null;
  stop(): unknown;
}

export function startScheduler(
  cronExpr: string,
  service: GatherService,
  store: JsonStore,
  schedule: (expr: string, fn: () => void) => CronTask = (expr, fn) => cron.schedule(expr, fn),
): SchedulerHandle {
  const trigger = (kind: 'cron' | 'catch-up') => {
    const started = service.start(kind);
    if ('conflict' in started) console.log(`[gather] ${kind} run skipped: run ${started.conflict} is still going`);
    else console.log(`[gather] ${kind} run ${started.id} started`);
  };

  if (!cron.validate(cronExpr)) {
    console.warn(`[gather] GATHER_CRON "${cronExpr}" is not a valid cron expression; automatic runs are off.`);
    return { nextRunAt: () => null, stop: () => undefined };
  }
  const task = schedule(cronExpr, () => trigger('cron'));
  // node-cron skips a slot the machine slept through; run it as soon as we wake up.
  task.on('execution:missed', () => trigger('catch-up'));

  const last = store.read().runs.find((r) => r.status !== 'failed' && r.status !== 'running');
  if (shouldCatchUp(last?.startedAt, new Date(), cronExpr)) trigger('catch-up');

  return {
    nextRunAt: () => task.getNextRun(),
    stop: () => void task.stop(),
  };
}
