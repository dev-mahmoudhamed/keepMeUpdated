// Admin sign-in by email code. Pure logic: the store, the mailer and the clock are passed in, so it's testable.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

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

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const newCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
export const hashCode = (secret: string, code: string) => hmac(secret, `code:${code}`);

/** Reads the admin settings from the environment; returns the names of the missing variables instead when incomplete. */
export function readAuthEnv(env: Record<string, string | undefined>): AuthEnv | { missing: string[] } {
  const adminEmail = env['ADMIN_EMAIL']?.trim() ?? '';
  const secret = env['AUTH_SECRET']?.trim() ?? '';
  const missing = [!adminEmail && 'ADMIN_EMAIL', secret.length < 32 && 'AUTH_SECRET (32+ characters)'].filter((m): m is string => !!m);
  return missing.length ? { missing } : { adminEmail, secret };
}

/**
 * Mails a sign-in code when `email` is the admin's. Any other address gets the same (silent) answer, so the
 * page can't be used to discover the admin email.
 */
export async function requestCode(opts: { email: string; env: AuthEnv; store: CodeStore; send: SendCode; now: number }): Promise<void> {
  const { email, env, store, send, now } = opts;
  if (!sameEmail(email, env.adminEmail)) return;

  const pending = await store.read();
  if (pending && pending.value.expiresAt > now && now - pending.value.sentAt < RESEND_AFTER_MS) return;

  const code = newCode();
  await store.write({ hash: hashCode(env.secret, code), expiresAt: now + CODE_TTL_MS, sentAt: now, attempts: 0 });
  try {
    await send(env.adminEmail, code);
  } catch (err) {
    await store.clear();
    throw err;
  }
}

export type VerifyResult = { ok: true; session: Session } | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

/** Checks a code. Each check uses up one attempt before comparing, so parallel guesses can't exceed MAX_ATTEMPTS. */
export async function verifyCode(opts: { email: string; code: string; remember: boolean; env: AuthEnv; store: CodeStore; now: number }): Promise<VerifyResult> {
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
  if (!(await store.update({ ...pending.value, attempts }, pending.etag))) return { ok: false, reason: 'invalid' };

  if (!safeEqual(hashCode(env.secret, code.trim()), pending.value.hash)) {
    if (attempts >= MAX_ATTEMPTS) {
      await store.clear();
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'invalid' };
  }

  await store.clear();
  return { ok: true, session: { email: env.adminEmail, exp: now + (remember ? LONG_SESSION_MS : SHORT_SESSION_MS) } };
}

export function signSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${hmac(secret, `session:${payload}`)}`;
}

/** The session in a cookie value, or null when it's missing, forged, expired, or for an address that is no longer the admin. */
export function readSession(token: string | undefined, env: AuthEnv, now: number): Session | null {
  if (!token) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined || !safeEqual(hmac(env.secret, `session:${payload}`), sig)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    if (typeof session.exp !== 'number' || session.exp <= now || !sameEmail(session.email ?? '', env.adminEmail)) return null;
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
export function sessionCookie(token: string, session: Session, remember: boolean, now: number): string {
  const maxAge = remember ? `; Max-Age=${Math.floor((session.exp - now) / 1000)}` : '';
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict${maxAge}`;
}

export const clearedCookie = () => `${SESSION_COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
