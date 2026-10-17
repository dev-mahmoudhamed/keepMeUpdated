import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toSummary } from '../../shared/feed';
import type { FeedIndex, SiteConfig } from '../../shared/models';
import { loadContent } from '../content/files';
import { sanitizeHtml } from '../util/sanitize';

export interface BuildPublicOptions {
  root: string;
  outDir: string;
  repo: string;
  branch: string;
}

/** owner/name from an https or ssh GitHub remote url. */
export function repoFromRemote(remote: string): string | undefined {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** content/posts.json → the static files the site reads (published posts only, HTML sanitized). */
export async function buildPublic(opts: BuildPublicOptions): Promise<{ posts: number }> {
  const db = await loadContent(opts.root);
  const published = db.posts
    .filter((p) => p.status === 'published' && p.publishedAt)
    .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!));

  await rm(opts.outDir, { recursive: true, force: true });
  await mkdir(join(opts.outDir, 'p'), { recursive: true });

  const index: FeedIndex = { generatedAt: new Date().toISOString(), posts: published.map(toSummary) };
  await writeFile(join(opts.outDir, 'posts.json'), JSON.stringify(index));
  for (const post of published) {
    await writeFile(join(opts.outDir, 'p', `${post.slug}.json`), JSON.stringify({ ...post, bodyHtml: sanitizeHtml(post.bodyHtml) }));
  }
  const site: SiteConfig = { repo: opts.repo, branch: opts.branch, gatherWorkflow: 'gather.yml', schedule: '0 3 * * *' };
  await writeFile(join(opts.outDir, 'site.json'), JSON.stringify(site, null, 2));
  return { posts: published.length };
}
