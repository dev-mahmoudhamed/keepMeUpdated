import { it, expect } from 'vitest';
import { normalizeUrl } from '../../shared/url';
import { normalizeUrl as fromDedupe } from '../gather/dedupe';

it('normalizes urls from the shared module', () => {
  expect(normalizeUrl('https://www.Example.com/a/?utm_source=x&b=2#top')).toBe('https://example.com/a?b=2');
});

it('is re-exported by the gather dedupe module', () => {
  expect(fromDedupe).toBe(normalizeUrl);
});
