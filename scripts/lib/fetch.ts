// Reading the sources (RSS/Atom feeds and web pages with CSS selectors) and the articles they link to.
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import type { Source } from '../../shared/models';
import type { RawItem } from './ai';

export interface HttpResponse {
  status: number;
  text: string;
  finalUrl: string;
}

export type HttpGet = (url: string, timeoutMs?: number) => Promise<HttpResponse>;

export type SourceItem = Omit<RawItem, 'id'>;

/** A feed is followed to older pages until it reaches the start of the window, up to this many pages. */
const MAX_PAGES = 30;
const ARTICLE_TIMEOUT_MS = 10_000;
const ARTICLE_LINKS = 3;
const ARTICLE_CHARS = 4_500;

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

/** Strip tags, decode entities, collapse whitespace, and cut to `max` chars. */
export function toPlainText(html: string | undefined, max = 500): string {
  if (!html) return '';
  const text = cheerio.load(`<div>${html}</div>`).text().replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const parser = new Parser();
const BARE_VERSION = /^v?\d+(\.\d+)+\S*$/i;

/** Release feeds often title entries "22.2.3"; give them the project's name so the headline makes sense. */
function headline(title: string, sourceName: string): string {
  if (!BARE_VERSION.test(title)) return title;
  return `${sourceName.replace(/\s+releases?$/i, '')} ${title}`;
}

async function parseFeed(source: Source, text: string, finalUrl: string): Promise<SourceItem[]> {
  let feed: Awaited<ReturnType<typeof parser.parseString>>;
  try {
    feed = await parser.parseString(text);
  } catch {
    throw new Error('Not a valid RSS/Atom feed');
  }
  return feed.items
    .filter((i) => i.title && i.link)
    .map((i) => ({
      sourceId: source.id,
      siteName: source.name,
      title: headline(toPlainText(i.title, 300), source.name),
      url: new URL(i.link!, finalUrl).toString(),
      snippet: toPlainText(i.contentSnippet || i['summary'] || i.content),
      publishedAt: toIsoDate(i.isoDate ?? i.pubDate),
    }));
}

/** WordPress feeds, even when the generator tag is hidden. */
const WORDPRESS = /<generator>[^<]*wordpress\.(org|com)|\/wp-content\/|wellformedweb\.org\/CommentAPI/i;

/** The feed's next (older) page: an Atom rel="next" link, WordPress's ?paged=N, or GitHub's ?page=N. */
export function nextPageUrl(feedUrl: string, text: string, page: number): string | undefined {
  const link = /<(?:atom:)?link\b[^>]*\brel=["']next["'][^>]*>/i.exec(text)?.[0];
  const href = link && /\bhref=["']([^"']+)["']/i.exec(link)?.[1];
  if (href) return new URL(href.replace(/&amp;/g, '&'), feedUrl).toString();
  const url = new URL(feedUrl);
  if (WORDPRESS.test(text)) url.searchParams.set('paged', String(page));
  else if (url.hostname === 'github.com' && url.pathname.endsWith('.atom')) url.searchParams.set('page', String(page));
  else return undefined;
  return url.toString();
}

/**
 * Every item of a feed published since `since` (ms): older pages are read while the oldest item is still inside the
 * window. Without `since`, only the first page.
 */
export async function fetchRss(source: Source, http: HttpGet, since?: number): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  const urls = new Set<string>();
  let url: string | undefined = source.feedUrl;
  for (let page = 1; url && page <= MAX_PAGES; page++) {
    let pageItems: SourceItem[];
    let text: string;
    try {
      const res = await http(url);
      text = res.text;
      pageItems = await parseFeed(source, res.text, res.finalUrl);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    const added = pageItems.filter((i) => !urls.has(i.url));
    if (!added.length) break;
    for (const i of added) {
      urls.add(i.url);
      items.push(i);
    }
    const dates = added.map((i) => i.publishedAt).filter((d): d is string => !!d);
    if (since === undefined || !dates.length || dates.some((d) => Date.parse(d) < since)) break;
    url = nextPageUrl(source.feedUrl, text, page + 1);
  }
  return items;
}

/** Split "a@href" into selector + attribute. */
function parseSelector(spec: string): { selector: string; attr?: string } {
  const at = spec.lastIndexOf('@');
  if (at > 0 && /^[\w-]+$/.test(spec.slice(at + 1))) return { selector: spec.slice(0, at).trim(), attr: spec.slice(at + 1) };
  return { selector: spec.trim() };
}

export async function fetchHtml(source: Source, http: HttpGet): Promise<SourceItem[]> {
  const sel = source.selectors;
  if (!sel?.item || !sel.title || !sel.link) throw new Error('HTML sources need item, title and link selectors');
  const { text, finalUrl } = await http(source.feedUrl);
  const $ = cheerio.load(text);
  const nodes = $(sel.item).toArray();
  if (nodes.length === 0) throw new Error('Selector matched no items');

  const read = (root: cheerio.Cheerio<any>, spec: string | undefined, defaultAttr?: string): string | undefined => {
    if (!spec) return undefined;
    const { selector, attr } = parseSelector(spec);
    const el = selector ? root.find(selector).first() : root;
    if (!el.length) return undefined;
    const name = attr ?? defaultAttr;
    return (name ? el.attr(name) : undefined) ?? (attr ? undefined : el.text());
  };

  const items: SourceItem[] = [];
  for (const node of nodes) {
    const root = $(node);
    const title = toPlainText(read(root, sel.title), 300);
    const href = read(root, sel.link, 'href');
    if (!title || !href) continue;
    let url: string;
    try {
      url = new URL(href, finalUrl).toString();
    } catch {
      continue;
    }
    items.push({
      sourceId: source.id,
      siteName: source.name,
      title,
      url,
      snippet: toPlainText(read(root, sel.summary)),
      publishedAt: toIsoDate(read(root, sel.date, 'datetime')),
    });
  }
  return items;
}

export function fetchSource(source: Source, http: HttpGet, since?: number): Promise<SourceItem[]> {
  return source.type === 'html' ? fetchHtml(source, http) : fetchRss(source, http, since);
}

/** Pull readable text out of an article page for summarization. */
export function extractArticleText(html: string, maxChars: number): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg').remove();
  const candidates: cheerio.Cheerio<any>[] = [$('article').first(), $('main').first(), $('body').first()];
  const root = candidates.find((el) => el.length) ?? $.root();
  const blocks = root
    .find('p, li, h2, h3')
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const text = blocks.length ? blocks.join('\n') : root.text().replace(/\s+/g, ' ').trim();
  return text.slice(0, maxChars);
}

/** Readable text from up to 3 of a story's article pages; falls back to feed snippets. */
export async function collectArticleText(items: RawItem[], http: HttpGet): Promise<string> {
  const links = items.slice(0, ARTICLE_LINKS);
  if (!links.length) return '';
  const perLink = Math.floor(ARTICLE_CHARS / links.length);
  const parts = await Promise.all(
    links.map(async (item) => {
      try {
        const { text } = await http(item.url, ARTICLE_TIMEOUT_MS);
        return extractArticleText(text, perLink) || item.snippet;
      } catch {
        return item.snippet;
      }
    }),
  );
  return parts.filter(Boolean).join('\n\n').slice(0, ARTICLE_CHARS);
}
