// The admin API's logic: email-code sign-in (codes kept in Cloudflare D1, mailed with Resend) and the GitHub proxy.
// Web APIs only (Web Crypto, fetch), so it runs on Cloudflare Pages Functions and in Node for the tests.

export const CODE_TTL_MS = 10 * 60_000;
/** A second "send code" within this window keeps the code already sent instead of mailing a new one. */
export const RESEND_AFTER_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export const SESSION_COOKIE = 'kmu_session';
export const SHORT_SESSION_MS = 12 * 3_600_000;
export const LONG_SESSION_MS = 30 * 24 * 3_600_000;

export interface AuthEnv {
  adminEmail: string;
  /** Signs codes and sessions. Changing it signs everyone out. */
  secret: string;
}

/** The one code waiting to be entered (there is only one admin). */
export interface PendingCode {
  hash: string;
  expiresAt: number;
  sentAt: number;
  attempts: number;
}

export interface CodeStore {
  read(): Promise<{ value: PendingCode; etag: string } | null>;
  /** Replaces the entry only if it still has `etag`; false when another request changed it first. */
  update(value: PendingCode, etag: string): Promise<boolean>;
  write(value: PendingCode): Promise<void>;
  clear(): Promise<void>;
}

export type SendCode = (to: string, code: string) => Promise<void>;

export interface Session {
  email: string;
  exp: number;
}

const utf8 = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export const encodeBase64Url = (text: string) => toBase64Url(utf8.encode(text));
export const decodeBase64Url = (text: string) => new TextDecoder().decode(fromBase64Url(text));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(data))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const sameEmail = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** A uniform 6-digit code: random values at or above the last whole million are drawn again. */
export function newCode(): string {
  const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
  const n = new Uint32Array(1);
  do crypto.getRandomValues(n);
  while (n[0] >= limit);
  return (n[0] % 1_000_000).toString().padStart(6, '0');
}

export const hashCode = (secret: string, code: string) => hmac(secret, `code:${code}`);

/** Reads the admin settings from the environment; returns the names of the missing variables instead when incomplete. */
export function readAuthEnv(
  env: Record<string, string | undefined>,
): AuthEnv | { missing: string[] } {
  const adminEmail = env['ADMIN_EMAIL']?.trim() ?? '';
  const secret = env['AUTH_SECRET']?.trim() ?? '';
  const missing = [
    !adminEmail && 'ADMIN_EMAIL',
    secret.length < 32 && 'AUTH_SECRET (32+ characters)',
  ].filter((m): m is string => !!m);
  return missing.length ? { missing } : { adminEmail, secret };
}

/**
 * Mails a sign-in code when `email` is the admin's. Any other address gets the same (silent) answer, so the
 * page can't be used to discover the admin email.
 */
export async function requestCode(opts: {
  email: string;
  env: AuthEnv;
  store: CodeStore;
  send: SendCode;
  now: number;
}): Promise<void> {
  const { email, env, store, send, now } = opts;
  if (!sameEmail(email, env.adminEmail)) return;

  const pending = await store.read();
  if (pending && pending.value.expiresAt > now && now - pending.value.sentAt < RESEND_AFTER_MS)
    return;

  const code = newCode();
  await store.write({
    hash: await hashCode(env.secret, code),
    expiresAt: now + CODE_TTL_MS,
    sentAt: now,
    attempts: 0,
  });
  try {
    await send(env.adminEmail, code);
  } catch (err) {
    await store.clear();
    throw err;
  }
}

export type VerifyResult =
  { ok: true; session: Session } | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

/** Checks a code. Each check uses up one attempt before comparing, so parallel guesses can't exceed MAX_ATTEMPTS. */
export async function verifyCode(opts: {
  email: string;
  code: string;
  remember: boolean;
  env: AuthEnv;
  store: CodeStore;
  now: number;
}): Promise<VerifyResult> {
  const { email, code, remember, env, store, now } = opts;
  if (!sameEmail(email, env.adminEmail)) return { ok: false, reason: 'invalid' };

  const pending = await store.read();
  if (!pending || pending.value.expiresAt <= now) {
    if (pending) await store.clear();
    return { ok: false, reason: 'expired' };
  }
  if (pending.value.attempts >= MAX_ATTEMPTS) {
    await store.clear();
    return { ok: false, reason: 'locked' };
  }

  const attempts = pending.value.attempts + 1;
  if (!(await store.update({ ...pending.value, attempts }, pending.etag)))
    return { ok: false, reason: 'invalid' };

  if (!safeEqual(await hashCode(env.secret, code.trim()), pending.value.hash)) {
    if (attempts >= MAX_ATTEMPTS) {
      await store.clear();
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'invalid' };
  }

  await store.clear();
  return {
    ok: true,
    session: { email: env.adminEmail, exp: now + (remember ? LONG_SESSION_MS : SHORT_SESSION_MS) },
  };
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = encodeBase64Url(JSON.stringify(session));
  return `${payload}.${await hmac(secret, `session:${payload}`)}`;
}

/** The session in a cookie value, or null when it's missing, forged, expired, or for an address that is no longer the admin. */
export async function readSession(
  token: string | undefined,
  env: AuthEnv,
  now: number,
): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig, extra] = token.split('.');
  if (
    !payload ||
    !sig ||
    extra !== undefined ||
    !safeEqual(await hmac(env.secret, `session:${payload}`), sig)
  )
    return null;
  try {
    const session = JSON.parse(decodeBase64Url(payload)) as Session;
    if (
      typeof session.exp !== 'number' ||
      session.exp <= now ||
      !sameEmail(session.email ?? '', env.adminEmail)
    )
      return null;
    return session;
  } catch {
    return null;
  }
}

export function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/** HttpOnly, sent only to /api. A "remember me" session survives the browser closing; otherwise it doesn't. */
export function sessionCookie(
  token: string,
  session: Session,
  remember: boolean,
  now: number,
): string {
  const maxAge = remember ? `; Max-Age=${Math.floor((session.exp - now) / 1000)}` : '';
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict${maxAge}`;
}

export const clearedCookie = () =>
  `${SESSION_COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** The part of Cloudflare's D1 binding the code store uses. */
export interface D1Like {
  prepare(sql: string): D1StatementLike;
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

interface CodeRow {
  hash: string;
  expires_at: number;
  sent_at: number;
  attempts: number;
  version: number;
}

const schemas = new WeakMap<D1Like, Promise<unknown>>();

/**
 * One row, created on first use. It is never deleted: clearing empties the hash, so `version` only ever grows and an
 * update made with an older read can't land on a newer code.
 */
export function d1CodeStore(db: D1Like): CodeStore {
  const ready = () => {
    let schema = schemas.get(db);
    if (!schema) {
      schema = db
        .prepare(
          'CREATE TABLE IF NOT EXISTS pending_code (id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL, expires_at INTEGER NOT NULL, sent_at INTEGER NOT NULL, attempts INTEGER NOT NULL, version INTEGER NOT NULL)',
        )
        .run()
        .catch((err) => {
          schemas.delete(db);
          throw err;
        });
      schemas.set(db, schema);
    }
    return schema;
  };
  return {
    async read() {
      await ready();
      const row = await db
        .prepare(
          "SELECT hash, expires_at, sent_at, attempts, version FROM pending_code WHERE id = 1 AND hash != ''",
        )
        .first<CodeRow>();
      return row
        ? {
            value: {
              hash: row.hash,
              expiresAt: row.expires_at,
              sentAt: row.sent_at,
              attempts: row.attempts,
            },
            etag: String(row.version),
          }
        : null;
    },
    async update(value, etag) {
      await ready();
      const { meta } = await db
        .prepare(
          "UPDATE pending_code SET hash = ?, expires_at = ?, sent_at = ?, attempts = ?, version = version + 1 WHERE id = 1 AND version = ? AND hash != ''",
        )
        .bind(value.hash, value.expiresAt, value.sentAt, value.attempts, Number(etag))
        .run();
      return meta.changes === 1;
    },
    async write(value) {
      await ready();
      await db
        .prepare(
          'INSERT INTO pending_code (id, hash, expires_at, sent_at, attempts, version) VALUES (1, ?, ?, ?, ?, 0) ON CONFLICT (id) DO UPDATE SET hash = excluded.hash, expires_at = excluded.expires_at, sent_at = excluded.sent_at, attempts = excluded.attempts, version = version + 1',
        )
        .bind(value.hash, value.expiresAt, value.sentAt, value.attempts)
        .run();
    },
    async clear() {
      await ready();
      await db
        .prepare("UPDATE pending_code SET hash = '', version = version + 1 WHERE id = 1")
        .run();
    },
  };
}

/** Resend's shared test sender: it can mail the address that owns the Resend account without verifying a domain. */
export const DEFAULT_FROM = 'keepMeUpdated <onboarding@resend.dev>';

export function codeEmail(
  code: string,
  site: string,
): { subject: string; text: string; html: string } {
  const subject = `${code} is your keepMeUpdated sign-in code`;
  const text = `Your sign-in code for the keepMeUpdated admin is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email.\n\n${site}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="margin:0 0 16px">Your sign-in code for the <strong>keepMeUpdated</strong> admin:</p>
  <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,monospace">${code}</p>
  <p style="margin:0;color:#555;font-size:14px">It expires in 10 minutes. If you didn't ask for it, ignore this email.</p>
</div>`;
  return { subject, text, html };
}

export function resendMailer(opts: {
  apiKey: string;
  from?: string;
  site: string;
  fetch?: typeof fetch;
}): SendCode {
  return async (to, code) => {
    const res = await (opts.fetch ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: opts.from || DEFAULT_FROM,
        to: [to],
        ...codeEmail(code, opts.site),
      }),
    });
    if (!res.ok)
      throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  };
}

export const GITHUB_API = 'https://api.github.com';

const ROUTES: [method: string, path: RegExp][] = [
  ['GET', /^\/git\/ref\/heads\/[\w.-]+$/],
  ['GET', /^\/git\/commits\/[0-9a-f]{40,64}$/],
  ['GET', /^\/contents\/[\w.-]+(\/[\w.-]+)*$/],
  ['POST', /^\/git\/(blobs|trees|commits)$/],
  ['PATCH', /^\/git\/refs\/heads\/[\w.-]+$/],
  ['GET', /^\/actions\/workflows\/[\w.-]+\/runs$/],
  // Starts the gather workflow (repository_dispatch), which has no "Run workflow" button on GitHub.
  ['POST', /^\/dispatches$/],
];
const QUERY = new Set(['ref', 'per_page']);
const ACCEPT = new Set(['application/vnd.github+json', 'application/vnd.github.raw+json']);

export interface ProxyRequest {
  method: string;
  /** Path inside the repo, e.g. `/git/ref/heads/main`. */
  path: string;
  search: URLSearchParams;
  accept: string | null;
  body: string | null;
}

export function isAllowed(method: string, path: string): boolean {
  return (
    !path.split('/').some((s) => s === '.' || s === '..') &&
    ROUTES.some(([m, re]) => m === method && re.test(path))
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function proxyGitHub(
  req: ProxyRequest,
  opts: { token: string; repo: string; fetch?: typeof fetch },
): Promise<Response> {
  if (!isAllowed(req.method, req.path)) return json(404, { message: 'Not an admin API call.' });

  const query = new URLSearchParams();
  for (const [k, v] of req.search) if (QUERY.has(k)) query.set(k, v);
  const qs = query.size ? `?${query}` : '';

  const res = await (opts.fetch ?? fetch)(`${GITHUB_API}/repos/${opts.repo}${req.path}${qs}`, {
    method: req.method,
    headers: {
      Accept: req.accept && ACCEPT.has(req.accept) ? req.accept : 'application/vnd.github+json',
      Authorization: `Bearer ${opts.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'keepMeUpdated-admin',
      ...(req.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: req.body || undefined,
  });

  // 401 to the browser means "your session ended"; a rejected server token is a setup problem instead.
  if (res.status === 401)
    return json(502, {
      message: 'The site’s GitHub token was rejected. Update GITHUB_TOKEN in Cloudflare.',
    });

  return new Response(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}
