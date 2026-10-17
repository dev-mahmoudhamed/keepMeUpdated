export interface HttpResponse {
  status: number;
  text: string;
  finalUrl: string;
}

export type HttpGet = (url: string, timeoutMs?: number) => Promise<HttpResponse>;

/** Turn undici's generic "fetch failed" into something an admin can act on. */
function describeFailure(err: unknown, url: string, timeoutMs: number): Error {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const name = (err as { name?: string }).name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new Error(`${host} did not respond within ${Math.round(timeoutMs / 1000)}s`);
  }
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const detail = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
  return new Error(`Could not reach ${host} (${detail})`);
}

export const httpGet: HttpGet = async (url, timeoutMs = 15_000) => {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: {
        'user-agent': 'keepMeUpdated/1.0 (+local)',
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
      },
    });
  } catch (err) {
    throw describeFailure(err, url, timeoutMs);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { status: res.status, text: await res.text(), finalUrl: res.url || url };
};
