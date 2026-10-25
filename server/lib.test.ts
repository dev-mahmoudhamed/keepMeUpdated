import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  CODE_TTL_MS,
  LONG_SESSION_MS,
  MAX_ATTEMPTS,
  RESEND_AFTER_MS,
  SHORT_SESSION_MS,
  type AuthEnv,
  type CodeStore,
  type D1Like,
  type PendingCode,
  cookieValue,
  d1CodeStore,
  encodeBase64Url,
  hashCode,
  newCode,
  readAuthEnv,
  readSession,
  requestCode,
  sessionCookie,
  signSession,
  verifyCode,
  isAllowed,
  proxyGitHub,
  type ProxyRequest,
} from './lib';
import { handle } from '../functions/api/[[path]]';

describe('auth', () => {
  const env: AuthEnv = { adminEmail: 'Admin@Example.com', secret: 's'.repeat(40) };
  const T = 1_700_000_000_000;

  function memoryStore(initial?: PendingCode) {
    let value = initial;
    let version = 0;
    const store: CodeStore = {
      read: async () => (value ? { value, etag: String(version) } : null),
      update: async (v, etag) => {
        if (!value || etag !== String(version)) return false;
        value = v;
        version++;
        return true;
      },
      write: async (v) => {
        value = v;
        version++;
      },
      clear: async () => {
        value = undefined;
        version++;
      },
    };
    return { store, current: () => value };
  }

  const pending = async (code: string, extra: Partial<PendingCode> = {}): Promise<PendingCode> => ({
    hash: await hashCode(env.secret, code),
    expiresAt: T + CODE_TTL_MS,
    sentAt: T,
    attempts: 0,
    ...extra,
  });

  describe('readAuthEnv', () => {
    it('needs the admin email and a long secret', () => {
      expect(readAuthEnv({})).toEqual({ missing: ['ADMIN_EMAIL', 'AUTH_SECRET (32+ characters)'] });
      expect(readAuthEnv({ ADMIN_EMAIL: 'a@b.c', AUTH_SECRET: 'short' })).toEqual({
        missing: ['AUTH_SECRET (32+ characters)'],
      });
      expect(readAuthEnv({ ADMIN_EMAIL: ' a@b.c ', AUTH_SECRET: 'x'.repeat(32) })).toEqual({
        adminEmail: 'a@b.c',
        secret: 'x'.repeat(32),
      });
    });
  });

  describe('requestCode', () => {
    it('mails a 6-digit code to the admin, whatever the letter case', async () => {
      const { store, current } = memoryStore();
      const send = vi.fn().mockResolvedValue(undefined);
      await requestCode({ email: ' admin@example.COM ', env, store, send, now: T });
      expect(send).toHaveBeenCalledTimes(1);
      const [to, code] = send.mock.calls[0];
      expect(to).toBe('Admin@Example.com');
      expect(code).toMatch(/^\d{6}$/);
      expect(current()).toEqual({
        hash: await hashCode(env.secret, code),
        expiresAt: T + CODE_TTL_MS,
        sentAt: T,
        attempts: 0,
      });
    });

    it('silently ignores any other address', async () => {
      const { store, current } = memoryStore();
      const send = vi.fn();
      await requestCode({ email: 'someone@else.com', env, store, send, now: T });
      expect(send).not.toHaveBeenCalled();
      expect(current()).toBeUndefined();
    });

    it('does not send a second code within a minute, but does after', async () => {
      const { store } = memoryStore(await pending('123456'));
      const send = vi.fn().mockResolvedValue(undefined);
      await requestCode({ email: env.adminEmail, env, store, send, now: T + RESEND_AFTER_MS - 1 });
      expect(send).not.toHaveBeenCalled();
      await requestCode({ email: env.adminEmail, env, store, send, now: T + RESEND_AFTER_MS });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('forgets the code when the email could not be sent', async () => {
      const { store, current } = memoryStore();
      await expect(
        requestCode({
          email: env.adminEmail,
          env,
          store,
          send: () => Promise.reject(new Error('down')),
          now: T,
        }),
      ).rejects.toThrow('down');
      expect(current()).toBeUndefined();
    });
  });

  describe('verifyCode', () => {
    const verify = (
      store: CodeStore,
      code: string,
      opts: { email?: string; remember?: boolean; now?: number } = {},
    ) =>
      verifyCode({
        email: opts.email ?? 'admin@example.com',
        code,
        remember: opts.remember ?? false,
        env,
        store,
        now: opts.now ?? T + 1000,
      });

    it('accepts the right code once and starts a session', async () => {
      const { store, current } = memoryStore(await pending('042317'));
      expect(await verify(store, ' 042317 ')).toEqual({
        ok: true,
        session: { email: env.adminEmail, exp: T + 1000 + SHORT_SESSION_MS },
      });
      expect(current()).toBeUndefined();
      expect(await verify(store, '042317')).toEqual({ ok: false, reason: 'expired' });
    });

    it('gives a long session when asked to remember', async () => {
      const { store } = memoryStore(await pending('111111'));
      const result = await verify(store, '111111', { remember: true });
      expect(result.ok && result.session.exp).toBe(T + 1000 + LONG_SESSION_MS);
    });

    it('rejects a wrong code and counts the attempt', async () => {
      const { store, current } = memoryStore(await pending('111111'));
      expect(await verify(store, '222222')).toEqual({ ok: false, reason: 'invalid' });
      expect(current()?.attempts).toBe(1);
    });

    it('rejects the right code for the wrong email', async () => {
      const { store } = memoryStore(await pending('111111'));
      expect(await verify(store, '111111', { email: 'x@y.z' })).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('locks the code after too many wrong tries, even if the next one is right', async () => {
      const { store, current } = memoryStore(await pending('111111'));
      for (let i = 1; i < MAX_ATTEMPTS; i++)
        expect(await verify(store, '000000')).toEqual({ ok: false, reason: 'invalid' });
      expect(await verify(store, '000000')).toEqual({ ok: false, reason: 'locked' });
      expect(current()).toBeUndefined();
      expect(await verify(store, '111111')).toEqual({ ok: false, reason: 'expired' });
    });

    it('rejects an expired code', async () => {
      const { store, current } = memoryStore(await pending('111111'));
      expect(await verify(store, '111111', { now: T + CODE_TTL_MS })).toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(current()).toBeUndefined();
    });

    it('does not compare when another guess changed the entry first', async () => {
      const { store } = memoryStore(await pending('111111'));
      const raced: CodeStore = { ...store, update: async () => false };
      expect(await verify(raced, '111111')).toEqual({ ok: false, reason: 'invalid' });
    });
  });

  describe('newCode', () => {
    it('is always six digits', () => {
      for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
    });
  });

  /** Cloudflare's D1 API over Node's built-in SQLite, so the store's SQL runs for real. */
  function sqliteD1(): D1Like {
    const db = new DatabaseSync(':memory:');
    const statement = (sql: string, values: unknown[] = []) => ({
      bind: (...next: unknown[]) => statement(sql, next),
      first: async <T>() => (db.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
      run: async () => ({
        meta: { changes: Number(db.prepare(sql).run(...(values as never[])).changes) },
      }),
    });
    return { prepare: (sql) => statement(sql) };
  }

  describe('d1CodeStore', () => {
    it('reads nothing at first, then what was written', async () => {
      const store = d1CodeStore(sqliteD1());
      expect(await store.read()).toBeNull();
      const code = await pending('123456');
      await store.write(code);
      expect((await store.read())?.value).toEqual(code);
    });

    it('updates only with the latest etag', async () => {
      const store = d1CodeStore(sqliteD1());
      await store.write(await pending('123456'));
      const first = (await store.read())!;
      expect(await store.update({ ...first.value, attempts: 1 }, first.etag)).toBe(true);
      expect(await store.update({ ...first.value, attempts: 2 }, first.etag)).toBe(false);
      expect((await store.read())?.value.attempts).toBe(1);
    });

    it('never lets an update from before a clear land on the next code', async () => {
      const store = d1CodeStore(sqliteD1());
      await store.write(await pending('123456'));
      const old = (await store.read())!;
      await store.clear();
      expect(await store.read()).toBeNull();
      expect(await store.update({ ...old.value, attempts: 1 }, old.etag)).toBe(false);
      const next = await pending('654321');
      await store.write(next);
      expect(await store.update({ ...old.value, attempts: 1 }, old.etag)).toBe(false);
      expect((await store.read())?.value).toEqual(next);
    });

    it('runs the whole sign-in against the database', async () => {
      const store = d1CodeStore(sqliteD1());
      const send = vi.fn().mockResolvedValue(undefined);
      await requestCode({ email: env.adminEmail, env, store, send, now: T });
      const code = send.mock.calls[0][1] as string;
      const wrong = code === '000000' ? '000001' : '000000';
      expect(
        await verifyCode({
          email: env.adminEmail,
          code: wrong,
          remember: false,
          env,
          store,
          now: T,
        }),
      ).toEqual({ ok: false, reason: 'invalid' });
      expect(
        (await verifyCode({ email: env.adminEmail, code, remember: false, env, store, now: T })).ok,
      ).toBe(true);
      expect(await store.read()).toBeNull();
    });
  });

  describe('sessions', () => {
    const session = { email: env.adminEmail, exp: T + 60_000 };

    it('round-trips a signed session', async () => {
      expect(await readSession(await signSession(session, env.secret), env, T)).toEqual(session);
    });

    it('signs like the Node version did, so existing sessions stay valid', async () => {
      const { createHmac } = await import('node:crypto');
      const token = await signSession(session, env.secret);
      const [payload, sig] = token.split('.');
      expect(payload).toBe(Buffer.from(JSON.stringify(session)).toString('base64url'));
      expect(sig).toBe(
        createHmac('sha256', env.secret).update(`session:${payload}`).digest('base64url'),
      );
    });

    it('rejects a tampered, expired or foreign session', async () => {
      const token = await signSession(session, env.secret);
      const [, sig] = token.split('.');
      const forged = `${encodeBase64Url(JSON.stringify({ ...session, exp: T * 2 }))}.${sig}`;
      expect(await readSession(forged, env, T)).toBeNull();
      expect(await readSession(token, env, T + 60_000)).toBeNull();
      expect(await readSession(token, { ...env, secret: 'o'.repeat(40) }, T)).toBeNull();
      expect(await readSession(token, { ...env, adminEmail: 'new@admin.com' }, T)).toBeNull();
      expect(await readSession(undefined, env, T)).toBeNull();
      expect(await readSession('garbage', env, T)).toBeNull();
      expect(await readSession('%%%.@@@', env, T)).toBeNull();
    });

    it('reads a cookie from the header', () => {
      expect(cookieValue('a=1; kmu_session=abc.def=; b=2', 'kmu_session')).toBe('abc.def=');
      expect(cookieValue(null, 'kmu_session')).toBeUndefined();
    });

    it('sets a locked-down cookie that only lasts when remembered', () => {
      expect(sessionCookie('tok', session, false, T)).toBe(
        'kmu_session=tok; Path=/api; HttpOnly; Secure; SameSite=Strict',
      );
      expect(sessionCookie('tok', session, true, T)).toBe(
        'kmu_session=tok; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=60',
      );
    });
  });
  describe('api function', () => {
    const vars = {
      ADMIN_EMAIL: env.adminEmail,
      AUTH_SECRET: env.secret,
      GITHUB_TOKEN: 't',
      GITHUB_REPO: 'me/kmu',
    };
    const call = (path: string, init: RequestInit = {}, v: Parameters<typeof handle>[1] = vars) =>
      handle(new Request(`https://kmu.pages.dev${path}`, init), v);

    it('asks for the missing settings instead of failing', async () => {
      const res = await call('/api/auth/session', {}, {});
      expect(res.status).toBe(503);
      expect((await res.json()).message).toContain('Cloudflare');
      expect(
        (
          await call('/api/auth/code', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"email":"a@b.c"}',
          })
        ).status,
      ).toBe(503);
    });

    it('reports a signed-out session and signs out', async () => {
      expect((await call('/api/auth/session')).status).toBe(401);
      const res = await call('/api/auth/sign-out', { method: 'POST' });
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });

    it('recognises a signed-in session', async () => {
      const token = await signSession(
        { email: env.adminEmail, exp: Date.now() + 60_000 },
        env.secret,
      );
      const res = await call('/api/auth/session', { headers: { cookie: `kmu_session=${token}` } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ email: env.adminEmail });
    });

    it('keeps the GitHub proxy behind the session', async () => {
      expect((await call('/api/github/contents/sources.md')).status).toBe(401);
      expect((await call('/api/nothing')).status).toBe(404);
    });

    it('signs in end to end with a code from the database', async () => {
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      try {
        const v = { ...vars, RESEND_API_KEY: 're_x', DB: sqliteD1() };
        const post = (path: string, body: unknown) =>
          call(
            path,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
            v,
          );
        expect((await post('/api/auth/code', { email: env.adminEmail })).status).toBe(200);
        const mail = JSON.parse(fetch.mock.calls[0][1]!.body as string);
        expect(mail.text).toContain('https://kmu.pages.dev');
        const code = /\b(\d{6})\b/.exec(mail.subject)![1];
        const res = await post('/api/auth/verify', { email: env.adminEmail, code, remember: true });
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toMatch(
          /^kmu_session=[^;]+; Path=\/api; HttpOnly; Secure; SameSite=Strict; Max-Age=\d+$/,
        );
      } finally {
        fetch.mockRestore();
      }
    });
  });
});

describe('github-proxy', () => {
  const SHA = 'a'.repeat(40);

  describe('isAllowed', () => {
    it('allows exactly the calls the admin panel makes', () => {
      expect(isAllowed('GET', '/git/ref/heads/main')).toBe(true);
      expect(isAllowed('GET', `/git/commits/${SHA}`)).toBe(true);
      expect(isAllowed('GET', '/contents/content/posts.json')).toBe(true);
      expect(isAllowed('GET', '/contents/sources.md')).toBe(true);
      expect(isAllowed('POST', '/git/blobs')).toBe(true);
      expect(isAllowed('POST', '/git/trees')).toBe(true);
      expect(isAllowed('POST', '/git/commits')).toBe(true);
      expect(isAllowed('PATCH', '/git/refs/heads/main')).toBe(true);
      expect(isAllowed('GET', '/actions/workflows/gather.yml/runs')).toBe(true);
      expect(isAllowed('POST', '/dispatches')).toBe(true);
    });

    it('refuses anything else', () => {
      expect(isAllowed('DELETE', '/git/refs/heads/main')).toBe(false);
      expect(isAllowed('PUT', '/contents/sources.md')).toBe(false);
      expect(isAllowed('GET', '')).toBe(false);
      expect(isAllowed('GET', '/collaborators')).toBe(false);
      expect(isAllowed('GET', '/contents/../../user')).toBe(false);
      expect(isAllowed('GET', '/contents/a/./b')).toBe(false);
      expect(isAllowed('GET', '/contents/a//b')).toBe(false);
      expect(isAllowed('PATCH', '/git/refs/tags/v1')).toBe(false);
      expect(isAllowed('POST', '/actions/workflows/gather.yml/dispatches')).toBe(false);
    });
  });

  describe('proxyGitHub', () => {
    const req = (over: Partial<ProxyRequest> = {}): ProxyRequest => ({
      method: 'GET',
      path: '/contents/sources.md',
      search: new URLSearchParams('ref=abc&evil=1'),
      accept: 'application/vnd.github.raw+json',
      body: null,
      ...over,
    });

    it('forwards to this repo with the server token, keeping only known query params', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response('# Sources', { status: 200, headers: { 'content-type': 'text/plain' } }),
        );
      const res = await proxyGitHub(req(), { token: 'srv', repo: 'me/kmu', fetch });
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/me/kmu/contents/sources.md?ref=abc',
        expect.anything(),
      );
      const init = fetch.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer srv');
      expect((init.headers as Record<string, string>)['Accept']).toBe(
        'application/vnd.github.raw+json',
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('# Sources');
    });

    it('sends JSON bodies through', async () => {
      const fetch = vi.fn().mockResolvedValue(new Response('{"sha":"b1"}', { status: 201 }));
      const res = await proxyGitHub(
        req({
          method: 'POST',
          path: '/git/blobs',
          body: '{"content":"x"}',
          search: new URLSearchParams(),
        }),
        { token: 't', repo: 'me/kmu', fetch },
      );
      expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/me/kmu/git/blobs');
      expect((fetch.mock.calls[0][1] as RequestInit).body).toBe('{"content":"x"}');
      expect(res.status).toBe(201);
    });

    it('keeps 204 responses empty', async () => {
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const res = await proxyGitHub(req({ method: 'POST', path: '/dispatches', body: '{}' }), {
        token: 't',
        repo: 'me/kmu',
        fetch,
      });
      expect(res.status).toBe(204);
    });

    it('does not call GitHub for a disallowed call', async () => {
      const fetch = vi.fn();
      const res = await proxyGitHub(req({ method: 'DELETE', path: '/git/refs/heads/main' }), {
        token: 't',
        repo: 'me/kmu',
        fetch,
      });
      expect(res.status).toBe(404);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('turns a rejected server token into a setup error, not a sign-out', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response('{"message":"Bad credentials"}', { status: 401 }));
      const res = await proxyGitHub(req(), { token: 'old', repo: 'me/kmu', fetch });
      expect(res.status).toBe(502);
      expect((await res.json()).message).toContain('GITHUB_TOKEN');
    });
  });
});
