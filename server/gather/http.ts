export interface HttpResponse {
  status: number;
  text: string;
  finalUrl: string;
}

export type HttpGet = (url: string, timeoutMs?: number) => Promise<HttpResponse>;

export const httpGet: HttpGet = async (url, timeoutMs = 15_000) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: {
      'user-agent': 'keepMeUpdated/1.0 (+local)',
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { status: res.status, text: await res.text(), finalUrl: res.url || url };
};
