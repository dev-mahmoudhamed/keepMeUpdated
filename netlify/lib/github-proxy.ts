// Forwards the admin panel's GitHub calls with the server's token. Only the calls the panel makes, on this repo only.
export const GITHUB_API = 'https://api.github.com';

const ROUTES: [method: string, path: RegExp][] = [
  ['GET', /^\/git\/ref\/heads\/[\w.-]+$/],
  ['GET', /^\/git\/commits\/[0-9a-f]{40,64}$/],
  ['GET', /^\/contents\/[\w.-]+(\/[\w.-]+)*$/],
  ['POST', /^\/git\/(blobs|trees|commits)$/],
  ['PATCH', /^\/git\/refs\/heads\/[\w.-]+$/],
  ['GET', /^\/actions\/workflows\/[\w.-]+\/runs$/],
  ['POST', /^\/actions\/workflows\/[\w.-]+\/dispatches$/],
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
  return !path.split('/').some((s) => s === '.' || s === '..') && ROUTES.some(([m, re]) => m === method && re.test(path));
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function proxyGitHub(req: ProxyRequest, opts: { token: string; repo: string; fetch?: typeof fetch }): Promise<Response> {
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
  if (res.status === 401) return json(502, { message: 'The site’s GitHub token was rejected. Update GITHUB_TOKEN in Netlify.' });

  return new Response(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}
