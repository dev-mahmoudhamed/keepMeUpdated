import type { PostSummary } from '../../../shared/models';
import { formatDay, isNewSince, sourcesLabel, tagTone } from './feed-utils';

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

describe('isNewSince', () => {
  it('marks posts published after the previous visit', () => {
    expect(isNewSince(p('a', 5, '2026-10-17T05:00:00Z'), '2026-10-17T04:00:00Z')).toBe(true);
    expect(isNewSince(p('b', 5, '2026-10-17T03:00:00Z'), '2026-10-17T04:00:00Z')).toBe(false);
  });

  it('marks nothing on a first visit', () => {
    expect(isNewSince(p('a', 5, '2026-10-17T05:00:00Z'), null)).toBe(false);
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

describe('tagTone', () => {
  it('gives each stack its colour', () => {
    expect(['angular', 'angular cli', 'ngrx'].map(tagTone)).toEqual(['angular', 'angular', 'angular']);
    expect(['.net', 'dotnet', 'c#', 'asp.net core', 'ef core', 'aspire'].map(tagTone)).toEqual(Array(6).fill('dotnet'));
    expect(['typescript', 'javascript'].map(tagTone)).toEqual(['typescript', 'typescript']);
    expect(tagTone('release')).toBe('release');
  });

  it('leaves other topics neutral', () => {
    expect(['security', 'cbor', 'web development'].map(tagTone)).toEqual([null, null, null]);
  });
});
