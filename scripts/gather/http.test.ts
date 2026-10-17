import { it, expect, vi, afterEach } from 'vitest';
import { httpGet } from './http';

afterEach(() => vi.unstubAllGlobals());

it('explains network failures with the host and cause', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
    }),
  );
  await expect(httpGet('https://feeds.example.test/rss')).rejects.toThrow('Could not reach feeds.example.test (ENOTFOUND)');
});

it('reports timeouts clearly', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }),
  );
  await expect(httpGet('https://slow.test/feed')).rejects.toThrow('slow.test did not respond within 15s');
});

it('throws on non-2xx status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  await expect(httpGet('https://a.test/feed')).rejects.toThrow('HTTP 403 for https://a.test/feed');
});
