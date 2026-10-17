const TRACKING_PARAMS = /^(utm_.*|ref|fbclid|gclid|mc_cid|mc_eid)$/i;

/** Canonical form used to detect "same link" across sources and runs. */
export function normalizeUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const path = u.pathname.replace(/\/+$/, '');
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}${path}${query}`;
}
