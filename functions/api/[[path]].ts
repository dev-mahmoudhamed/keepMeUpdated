// /api/*: the admin API on Cloudflare Pages Functions. /api/auth/* is the email-code sign-in, /api/github/* the admin
// panel's repository calls, made with the server's GitHub token after checking the session.
import {
  SESSION_COOKIE,
  type D1Like,
  clearedCookie,
  cookieValue,
  d1CodeStore,
  proxyGitHub,
  readAuthEnv,
  readSession,
  requestCode,
  resendMailer,
  sessionCookie,
  signSession,
  verifyCode,
} from '../../server/lib';

/** Set in Cloudflare → the Pages project → Settings: variables and secrets, and the D1 binding named DB. */
export interface Env {
  ADMIN_EMAIL?: string;
  AUTH_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  DB?: D1Like;
}

const GITHUB_PREFIX = '/api/github';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  // Requiring JSON means a cross-site form can't post here.
  if (!req.headers.get('content-type')?.startsWith('application/json')) return null;
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handle(req: Request, vars: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const route = `${req.method} ${path}`;
  const env = readAuthEnv(vars as Record<string, string | undefined>);
  if ('missing' in env) {
    console.error(`[api] missing environment variables: ${env.missing.join(', ')}`);
    return json(503, {
      message:
        'Admin sign-in isn’t set up yet. Add the missing environment variables in Cloudflare.',
    });
  }
  const now = Date.now();
  const session = () =>
    readSession(cookieValue(req.headers.get('cookie'), SESSION_COOKIE), env, now);

  if (path === GITHUB_PREFIX || path.startsWith(`${GITHUB_PREFIX}/`)) {
    if (!vars.GITHUB_TOKEN || !vars.GITHUB_REPO) {
      console.error('[api] missing GITHUB_TOKEN or GITHUB_REPO');
      return json(503, {
        message: 'The admin API isn’t set up yet. Add GITHUB_TOKEN and GITHUB_REPO in Cloudflare.',
      });
    }
    if (!(await session())) return json(401, { message: 'Your session ended. Sign in again.' });
    if (req.method !== 'GET' && !req.headers.get('content-type')?.startsWith('application/json')) {
      return json(415, { message: 'Send JSON.' });
    }
    return proxyGitHub(
      {
        method: req.method,
        path: url.pathname.slice(GITHUB_PREFIX.length),
        search: url.searchParams,
        accept: req.headers.get('accept'),
        body: req.method === 'GET' ? null : await req.text(),
      },
      { token: vars.GITHUB_TOKEN, repo: vars.GITHUB_REPO },
    );
  }

  if (route === 'GET /api/auth/session') {
    const current = await session();
    return current ? json(200, { email: current.email }) : json(401, { message: 'Signed out.' });
  }

  if (route === 'POST /api/auth/sign-out')
    return json(200, { ok: true }, { 'set-cookie': clearedCookie() });

  if (route === 'POST /api/auth/code' || route === 'POST /api/auth/verify') {
    if (!vars.DB) {
      console.error('[api] missing the D1 binding DB');
      return json(503, {
        message: 'Admin sign-in isn’t set up yet. Bind a D1 database as DB in Cloudflare.',
      });
    }
    const store = d1CodeStore(vars.DB);
    const body = await readBody(req);

    if (route === 'POST /api/auth/code') {
      if (typeof body?.['email'] !== 'string' || !body['email'].includes('@'))
        return json(400, { message: 'Enter your email address.' });
      if (!vars.RESEND_API_KEY) {
        console.error('[api] missing environment variable: RESEND_API_KEY');
        return json(503, { message: 'Email isn’t set up yet. Add RESEND_API_KEY in Cloudflare.' });
      }
      try {
        const send = resendMailer({
          apiKey: vars.RESEND_API_KEY,
          from: vars.EMAIL_FROM,
          site: url.origin,
        });
        await requestCode({ email: body['email'], env, store, send, now });
      } catch (err) {
        console.error(`[api] could not send the code: ${err instanceof Error ? err.message : err}`);
        return json(502, { message: 'Couldn’t send the email. Try again in a minute.' });
      }
      return json(200, { ok: true });
    }

    const email = body?.['email'];
    const code = body?.['code'];
    if (typeof email !== 'string' || typeof code !== 'string')
      return json(400, { reason: 'invalid' });
    const remember = body?.['remember'] === true;
    const result = await verifyCode({ email, code, remember, env, store, now });
    if (!result.ok) return json(400, { reason: result.reason });
    const cookie = sessionCookie(
      await signSession(result.session, env.secret),
      result.session,
      remember,
      now,
    );
    return json(200, { email: result.session.email }, { 'set-cookie': cookie });
  }

  return json(404, { message: 'Not found.' });
}

export const onRequest = (context: { request: Request; env: Env }) =>
  handle(context.request, context.env);
