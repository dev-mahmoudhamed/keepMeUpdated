// /api/auth/*: email-code sign-in for the admin panel.
import type { Config } from '@netlify/functions';
import {
  SESSION_COOKIE,
  blobCodeStore,
  clearedCookie,
  cookieValue,
  readAuthEnv,
  readSession,
  requestCode,
  resendMailer,
  sessionCookie,
  signSession,
  verifyCode,
} from '../lib';
import { loadDevEnv } from '../../config/dev-env';

// Local only: reads .env when IS_DEV_ENV is true (config/dev-env.ts). A no-op on Netlify.
loadDevEnv();

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

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

export default async (req: Request): Promise<Response> => {
  const route = `${req.method} ${new URL(req.url).pathname.replace(/\/+$/, '')}`;
  const env = readAuthEnv(process.env);
  if ('missing' in env) {
    console.error(`[auth] missing environment variables: ${env.missing.join(', ')}`);
    return json(503, { message: 'Admin sign-in isn’t set up yet. Add the missing environment variables in Netlify.' });
  }
  const now = Date.now();

  if (route === 'GET /api/auth/session') {
    const session = readSession(cookieValue(req.headers.get('cookie'), SESSION_COOKIE), env, now);
    return session ? json(200, { email: session.email }) : json(401, { message: 'Signed out.' });
  }

  if (route === 'POST /api/auth/sign-out') return json(200, { ok: true }, { 'set-cookie': clearedCookie() });

  if (route === 'POST /api/auth/code') {
    const body = await readBody(req);
    if (typeof body?.['email'] !== 'string' || !body['email'].includes('@')) return json(400, { message: 'Enter your email address.' });
    const apiKey = process.env['RESEND_API_KEY'];
    if (!apiKey) {
      console.error('[auth] missing environment variable: RESEND_API_KEY');
      return json(503, { message: 'Email isn’t set up yet. Add RESEND_API_KEY in Netlify.' });
    }
    try {
      const send = resendMailer({ apiKey, from: process.env['EMAIL_FROM'], site: process.env['URL'] ?? '' });
      await requestCode({ email: body['email'], env, store: blobCodeStore(), send, now });
    } catch (err) {
      console.error(`[auth] could not send the code: ${err instanceof Error ? err.message : err}`);
      return json(502, { message: 'Couldn’t send the email. Try again in a minute.' });
    }
    return json(200, { ok: true });
  }

  if (route === 'POST /api/auth/verify') {
    const body = await readBody(req);
    const email = body?.['email'];
    const code = body?.['code'];
    if (typeof email !== 'string' || typeof code !== 'string') return json(400, { reason: 'invalid' });
    const remember = body?.['remember'] === true;
    const result = await verifyCode({ email, code, remember, env, store: blobCodeStore(), now });
    if (!result.ok) return json(400, { reason: result.reason });
    const cookie = sessionCookie(signSession(result.session, env.secret), result.session, remember, now);
    return json(200, { email: result.session.email }, { 'set-cookie': cookie });
  }

  return json(404, { message: 'Not found.' });
};

export const config: Config = { path: '/api/auth/*' };
