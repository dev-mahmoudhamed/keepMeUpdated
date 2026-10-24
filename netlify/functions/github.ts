// /api/github/*: the admin panel's repository calls, made with the server's GitHub token after checking the session.
import type { Config } from '@netlify/functions';
import { SESSION_COOKIE, cookieValue, readAuthEnv, readSession, proxyGitHub } from '../lib';
import { loadDevEnv } from '../../config/dev-env';

// Local only: reads .env when IS_DEV_ENV is true (config/dev-env.ts). A no-op on Netlify.
loadDevEnv();

const PREFIX = '/api/github';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req: Request): Promise<Response> => {
  const env = readAuthEnv(process.env);
  const token = process.env['GITHUB_TOKEN'];
  const repo = process.env['GITHUB_REPO'];
  if ('missing' in env || !token || !repo) {
    console.error('[github] missing ADMIN_EMAIL, AUTH_SECRET, GITHUB_TOKEN or GITHUB_REPO');
    return json(503, { message: 'The admin API isn’t set up yet. Add the missing environment variables in Netlify.' });
  }
  if (!readSession(cookieValue(req.headers.get('cookie'), SESSION_COOKIE), env, Date.now())) {
    return json(401, { message: 'Your session ended. Sign in again.' });
  }
  if (req.method !== 'GET' && !req.headers.get('content-type')?.startsWith('application/json')) {
    return json(415, { message: 'Send JSON.' });
  }

  const url = new URL(req.url);
  return proxyGitHub(
    {
      method: req.method,
      path: url.pathname.slice(PREFIX.length),
      search: url.searchParams,
      accept: req.headers.get('accept'),
      body: req.method === 'GET' ? null : await req.text(),
    },
    { token, repo },
  );
};

// Must be a plain string: Netlify reads this at build time without running the code (a template literal is ignored).
export const config: Config = { path: '/api/github/*' };
