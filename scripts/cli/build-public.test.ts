import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Post } from '../../shared/models';
import { buildPublic, repoFromRemote } from './build-public';

const post = (id: string, over: Partial<Post> = {}): Post => ({
  id,
  slug: `slug-${id}`,
  title: id,
  tldr: 't',
  bodyHtml: '<p>ok</p>',
  tags: ['x'],
  sources: [{ siteName: 'S', url: 'https://s.test', title: 's' }],
  relevance: 5,
  status: 'published',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  publishedAt: '2026-10-15T00:00:00.000Z',
  ...over,
});

describe('buildPublic', () => {
  let root: string;
  let out: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kmu-pub-'));
    out = join(root, 'public/data');
    await mkdir(join(root, 'content'));
    await writeFile(
      join(root, 'content/posts.json'),
      JSON.stringify([
        post('older', { publishedAt: '2026-10-14T00:00:00.000Z' }),
        post('newer', { publishedAt: '2026-10-16T00:00:00.000Z', bodyHtml: '<p onclick="x()">hi</p><script>alert(1)</script>' }),
        post('draft', { status: 'draft', publishedAt: undefined }),
        post('hidden', { status: 'hidden' }),
      ]),
    );
  });

  const json = async (rel: string) => JSON.parse(await readFile(join(out, rel), 'utf8'));

  it('writes only published posts to the public index, newest first', async () => {
    expect(await buildPublic({ root, outDir: out, repo: 'me/kmu', branch: 'main' })).toEqual({ posts: 2 });
    const index = await json('posts.json');
    expect(index.posts.map((p: { id: string }) => p.id)).toEqual(['newer', 'older']);
    expect(index.posts[0]).toEqual(expect.objectContaining({ slug: 'slug-newer', sourceCount: 1 }));
    expect(index.posts[0].bodyHtml).toBeUndefined();
    expect(existsSync(join(out, 'p/slug-draft.json'))).toBe(false);
    expect(existsSync(join(out, 'p/slug-hidden.json'))).toBe(false);
  });

  it('sanitizes bodyHtml in public post files', async () => {
    await buildPublic({ root, outDir: out, repo: 'me/kmu', branch: 'main' });
    const p = await json('p/slug-newer.json');
    expect(p.bodyHtml).toBe('<p>hi</p>');
  });

  it('writes site.json with the repo', async () => {
    await buildPublic({ root, outDir: out, repo: 'me/kmu', branch: 'main' });
    expect(await json('site.json')).toEqual({ repo: 'me/kmu', branch: 'main', gatherWorkflow: 'gather.yml', schedule: '0 3 * * *' });
  });

  it('removes stale public files', async () => {
    await mkdir(join(out, 'p'), { recursive: true });
    await writeFile(join(out, 'p/gone.json'), '{}');
    await buildPublic({ root, outDir: out, repo: 'me/kmu', branch: 'main' });
    expect(existsSync(join(out, 'p/gone.json'))).toBe(false);
  });
});

it('reads owner/name from a git remote url', () => {
  expect(repoFromRemote('https://github.com/dev-mahmoudhamed/keepMeUpdated.git')).toBe('dev-mahmoudhamed/keepMeUpdated');
  expect(repoFromRemote('git@github.com:me/kmu.git')).toBe('me/kmu');
  expect(repoFromRemote('https://gitlab.com/x/y')).toBeUndefined();
});
