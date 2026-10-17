import { it, expect } from 'vitest';
import { newId, slugify, uniqueSlug } from './ids';

it('newId returns distinct uuids', () => {
  expect(newId()).not.toBe(newId());
});
it('slugifies latin text', () => {
  expect(slugify('Angular 22 ships Zoneless!')).toBe('angular-22-ships-zoneless');
});
it('returns empty slug for non-latin text', () => {
  expect(slugify('مرحبا')).toBe('');
});
it('suffixes taken slugs', () => {
  expect(uniqueSlug('Hello', new Set(['hello']))).toBe('hello-2');
  expect(uniqueSlug('Hello', new Set(['hello', 'hello-2']))).toBe('hello-3');
});
it('falls back to a random slug when the title has no latin chars', () => {
  expect(uniqueSlug('مرحبا', new Set())).toMatch(/^post-[a-z0-9]{6}$/);
});
