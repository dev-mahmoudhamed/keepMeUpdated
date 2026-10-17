import { it, expect } from 'vitest';
import { shouldCatchUp } from './scheduler';

// Dates without a zone are local time, matching how the cron schedule is interpreted.
it('catches up when there has never been a run', () => {
  expect(shouldCatchUp(undefined, new Date('2026-10-17T09:00'), '0 4 * * *')).toBe(true);
});

it('does not catch up when today already ran', () => {
  expect(shouldCatchUp('2026-10-17T04:00:00', new Date('2026-10-17T09:00'), '0 4 * * *')).toBe(false);
});

it('waits for today’s slot before catching up', () => {
  expect(shouldCatchUp('2026-10-15T04:00:00', new Date('2026-10-17T03:00'), '0 4 * * *')).toBe(false);
});

it('catches up when the last run is stale and the slot has passed', () => {
  expect(shouldCatchUp('2026-10-15T04:00:00', new Date('2026-10-17T05:00'), '0 4 * * *')).toBe(true);
});

it('respects minutes in the schedule', () => {
  expect(shouldCatchUp('2026-10-15T04:00:00', new Date('2026-10-17T04:10'), '30 4 * * *')).toBe(false);
  expect(shouldCatchUp('2026-10-15T04:00:00', new Date('2026-10-17T04:31'), '30 4 * * *')).toBe(true);
});

it('ignores schedules that are not daily', () => {
  expect(shouldCatchUp(undefined, new Date('2026-10-17T09:00'), '*/5 * * * *')).toBe(false);
});

it('catches up when the only recent run was before today’s slot', () => {
  expect(shouldCatchUp('2026-10-16T10:00:00', new Date('2026-10-17T05:00'), '0 4 * * *')).toBe(true);
});
