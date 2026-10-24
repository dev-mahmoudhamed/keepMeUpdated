import type { Post } from '../../../shared/models';
import { SlugTakenError, deletePost, parsePosts, serializePosts, setStatus, upsertPost } from './post-changes';

const NOW = '2026-10-17T12:00:00.000Z';

const post = (id: string, over: Partial<Post> = {}): Post => ({
  id,
  slug: id,
  title: `Post ${id}`,
  tldr: 't',
  bodyHtml: '',
  tags: [],
  sources: [],
  relevance: 5,
  status: 'draft',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

const input = { title: 'Hello world', tldr: 'Short', bodyHtml: '<p>x</p>', tags: ['a'], status: 'draft' as const, sources: [] };

describe('post changes', () => {
  it('creates a manual post with a unique slug', () => {
    const { posts, post: created } = upsertPost([post('hello-world')], 'new-id', input, NOW);
    expect(created).toMatchObject({ id: 'new-id', slug: 'hello-world-2', origin: 'manual', relevance: 5, createdAt: NOW, updatedAt: NOW });
    expect(created.publishedAt).toBeUndefined();
    expect(posts).toHaveLength(2);
  });

  it('keeps createdAt and origin when updating, and sets publishedAt on first publish', () => {
    const same = { ...input, tldr: 't', bodyHtml: '', slug: 'p1', status: 'published' as const };
    const { post: updated } = upsertPost([post('p1')], 'p1', same, NOW);
    expect(updated).toMatchObject({ createdAt: '2026-10-10T00:00:00.000Z', origin: 'auto', updatedAt: NOW, publishedAt: NOW, title: 'Hello world' });
    const again = upsertPost([updated], 'p1', same, '2026-10-18T00:00:00.000Z').post;
    expect(again.publishedAt).toBe(NOW);
  });

  it('makes a gathered post the editor’s once its text is edited, so the gather won’t rewrite it', () => {
    const { post: edited } = upsertPost([post('p1', { aiPending: true })], 'p1', { ...input, slug: 'p1' }, NOW);
    expect(edited).toMatchObject({ origin: 'manual', aiPending: false, tldr: 'Short' });
  });

  it('rejects a slug another post uses', () => {
    expect(() => upsertPost([post('taken')], 'p1', { ...input, slug: 'taken' }, NOW)).toThrow(SlugTakenError);
  });

  it('falls back to a generated slug for titles without latin letters', () => {
    expect(upsertPost([], 'id', { ...input, title: 'مرحبا' }, NOW).post.slug).toMatch(/^post-[a-z0-9]{6}$/);
  });

  it('changes status and deletes', () => {
    const published = setStatus([post('p1')], 'p1', 'published', NOW);
    expect(published[0]).toMatchObject({ status: 'published', publishedAt: NOW, updatedAt: NOW });
    expect(deletePost(published, 'p1')).toEqual([]);
  });

  it('serializes newest first in the same format the gather writes', () => {
    const text = serializePosts([post('old'), post('new', { publishedAt: '2026-10-16T00:00:00.000Z' })]);
    expect(parsePosts(text).map((p) => p.id)).toEqual(['new', 'old']);
    expect(text.endsWith('}\n]\n')).toBe(true);
    expect(text.startsWith('[\n  {')).toBe(true);
    expect(parsePosts('')).toEqual([]);
  });
});
