import type { PostSummary } from '../../../shared/models';
import { formatDay, pickLead, sourcesLabel } from './feed-utils';

const p = (id: string, relevance: number, publishedAt: string): PostSummary => ({
  id,
  slug: id,
  title: id,
  tldr: '',
  tags: [],
  relevance,
  publishedAt,
  aiPending: false,
  sourceCount: 1,
});

describe('pickLead', () => {
  it('picks the most relevant post, newest on ties, and keeps the rest in order', () => {
    const a = p('a', 5, '2026-10-17T05:00:00Z');
    const b = p('b', 8, '2026-10-17T04:00:00Z');
    const c = p('c', 8, '2026-10-17T06:00:00Z');
    const { lead, rest } = pickLead([a, b, c]);
    expect(lead).toBe(c);
    expect(rest).toEqual([a, b]);
  });

  it('handles an empty day', () => {
    expect(pickLead([])).toEqual({ lead: null, rest: [] });
  });
});

describe('formatDay', () => {
  const today = new Date('2026-10-17T10:00:00');
  it('names today and yesterday', () => {
    expect(formatDay('2026-10-17', today)).toBe('Today');
    expect(formatDay('2026-10-16', today)).toBe('Yesterday');
  });
  it('spells out older days', () => {
    expect(formatDay('2026-10-15', today)).toBe('Thursday, 15 October');
  });
  it('adds the year for days from another year', () => {
    expect(formatDay('2025-12-31', today)).toBe('Wednesday, 31 December 2025');
  });
});

describe('sourcesLabel', () => {
  it('pluralizes', () => {
    expect(sourcesLabel(1)).toBe('1 source');
    expect(sourcesLabel(3)).toBe('3 sources');
  });
});
