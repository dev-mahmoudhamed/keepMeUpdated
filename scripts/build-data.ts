// Generates public/data/ (site index, post files, site.json) from content/. Runs before every site build.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { buildPublic, repoFromRemote } from './lib/content';

function detectRepo(): string {
  if (process.env['GITHUB_REPOSITORY']) return process.env['GITHUB_REPOSITORY'];
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return repoFromRemote(remote) ?? 'owner/keepMeUpdated';
  } catch {
    return 'owner/keepMeUpdated';
  }
}

(async () => {
  const root = process.cwd();
  const repo = detectRepo();
  const branch = process.env['GITHUB_REF_TYPE'] === 'branch' && process.env['GITHUB_REF_NAME'] ? process.env['GITHUB_REF_NAME'] : 'main';
  const { posts } = await buildPublic({ root, outDir: join(root, 'public', 'data'), repo, branch });
  console.log(`[build-data] ${posts} published posts → public/data (repo ${repo}, branch ${branch})`);
})().catch((err) => {
  console.error(`[build-data] ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
