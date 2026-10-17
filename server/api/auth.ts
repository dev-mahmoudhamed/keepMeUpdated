import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config';

export const SESSION_COOKIE = 'kmu_session';
const SESSION_MS = 7 * 86_400_000;

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signSession(email: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ sub: email, exp: now + SESSION_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the session's email if the token is authentic and unexpired. */
export function verifySession(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub: string; exp: number };
    return typeof sub === 'string' && typeof exp === 'number' && exp > now ? sub : null;
  } catch {
    return null;
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function requireAdmin(config: Config): RequestHandler {
  return (req, res, next) => {
    const email = verifySession(req.cookies?.[SESSION_COOKIE], config.sessionSecret);
    if (!email || email !== config.adminEmail) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    next();
  };
}

const loginBody = z.object({ email: z.string().max(200), password: z.string().max(200) });

export function authRouter(config: Config): Router {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.isProd,
    path: '/',
  };

  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Wait a minute and try again.' },
  });

  router.post('/login', loginLimiter, (req, res) => {
    const parsed = loginBody.safeParse(req.body);
    const ok =
      parsed.success &&
      safeEqual(parsed.data.email.trim().toLowerCase(), config.adminEmail.toLowerCase()) &&
      safeEqual(parsed.data.password, config.adminPassword);
    if (!ok) {
      res.status(401).json({ error: 'Email or password is wrong' });
      return;
    }
    res.cookie(SESSION_COOKIE, signSession(config.adminEmail, config.sessionSecret), { ...cookieOptions, maxAge: SESSION_MS });
    res.status(204).end();
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    const email = verifySession(req.cookies?.[SESSION_COOKIE], config.sessionSecret);
    if (!email || email !== config.adminEmail) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    res.json({ email });
  });

  return router;
}
