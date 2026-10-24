import type { Post, PostSource, PostStatus } from '../../../shared/models';
import { slugify } from '../../../shared/feed';

/** What the editor saves. */
export interface PostInput {
  title: string;
  slug?: string;
  tldr: string;
  bodyHtml: string;
  tags: string[];
  status: PostStatus;
  sources: PostSource[];
}

export class SlugTakenError extends Error {
  constructor() {
    super('That slug is already used');
    this.name = 'SlugTakenError';
  }
}

const postTime = (p: Post) => p.publishedAt ?? p.createdAt;

export function parsePosts(text: string): Post[] {
  return text.trim() ? (JSON.parse(text) as Post[]) : [];
}

/** Same layout the gather writes (newest first, 2-space JSON), so admin commits make small diffs. */
export function serializePosts(posts: Post[]): string {
  const sorted = [...posts].sort((a, b) => postTime(b).localeCompare(postTime(a)));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function uniqueSlugIn(title: string, posts: Post[], exceptId: string): string {
  const taken = new Set(posts.filter((p) => p.id !== exceptId).map((p) => p.slug));
  const base = slugify(title) || `post-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Create (new id) or update a post. Throws SlugTakenError when an explicit slug belongs to another post. */
export function upsertPost(posts: Post[], id: string, input: PostInput, now: string): { posts: Post[]; post: Post } {
  const existing = posts.find((p) => p.id === id);
  const slug = input.slug?.trim();
  if (slug && posts.some((p) => p.slug === slug && p.id !== id)) throw new SlugTakenError();

  const post: Post = {
    ...(existing ?? { id, origin: 'manual', relevance: 5, aiPending: false, createdAt: now }),
    title: input.title,
    slug: slug || existing?.slug || uniqueSlugIn(input.title, posts, id),
    tldr: input.tldr,
    bodyHtml: input.bodyHtml,
    tags: input.tags,
    status: input.status,
    sources: input.sources,
    updatedAt: now,
  } as Post;
  if (input.status === 'published' && !post.publishedAt) post.publishedAt = now;
  // Edited text is the editor's: the gather no longer summarizes this post again.
  if (existing && (existing.tldr !== input.tldr || existing.bodyHtml !== input.bodyHtml)) {
    post.origin = 'manual';
    post.aiPending = false;
  }

  return { posts: existing ? posts.map((p) => (p.id === id ? post : p)) : [...posts, post], post };
}

export function setStatus(posts: Post[], id: string, status: PostStatus, now: string): Post[] {
  return posts.map((p) =>
    p.id === id ? { ...p, status, updatedAt: now, ...(status === 'published' && !p.publishedAt ? { publishedAt: now } : {}) } : p,
  );
}

export function deletePost(posts: Post[], id: string): Post[] {
  return posts.filter((p) => p.id !== id);
}
