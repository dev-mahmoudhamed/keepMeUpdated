import { describe, expect, it, vi } from 'vitest';
import { isAllowed, proxyGitHub, type ProxyRequest } from './github-proxy';

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
    expect(isAllowed('POST', '/actions/workflows/gather.yml/dispatches')).toBe(true);
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
    const fetch = vi.fn().mockResolvedValue(new Response('# Sources', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const res = await proxyGitHub(req(), { token: 'srv', repo: 'me/kmu', fetch });
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/me/kmu/contents/sources.md?ref=abc', expect.anything());
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer srv');
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/vnd.github.raw+json');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('# Sources');
  });

  it('sends JSON bodies through', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"sha":"b1"}', { status: 201 }));
    const res = await proxyGitHub(req({ method: 'POST', path: '/git/blobs', body: '{"content":"x"}', search: new URLSearchParams() }), { token: 't', repo: 'me/kmu', fetch });
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/me/kmu/git/blobs');
    expect((fetch.mock.calls[0][1] as RequestInit).body).toBe('{"content":"x"}');
    expect(res.status).toBe(201);
  });

  it('keeps 204 responses empty', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const res = await proxyGitHub(req({ method: 'POST', path: '/actions/workflows/gather.yml/dispatches', body: '{}' }), { token: 't', repo: 'me/kmu', fetch });
    expect(res.status).toBe(204);
  });

  it('does not call GitHub for a disallowed call', async () => {
    const fetch = vi.fn();
    const res = await proxyGitHub(req({ method: 'DELETE', path: '/git/refs/heads/main' }), { token: 't', repo: 'me/kmu', fetch });
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns a rejected server token into a setup error, not a sign-out', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"message":"Bad credentials"}', { status: 401 }));
    const res = await proxyGitHub(req(), { token: 'old', repo: 'me/kmu', fetch });
    expect(res.status).toBe(502);
    expect((await res.json()).message).toContain('GITHUB_TOKEN');
  });
});
