import * as cheerio from 'cheerio';
import type { Source } from '../../../shared/models';
import type { HttpGet } from '../http';
import type { RawItem } from '../types';
import { toIsoDate, toPlainText } from './text';

/** Split "a@href" into selector + attribute. */
function parseSelector(spec: string): { selector: string; attr?: string } {
  const at = spec.lastIndexOf('@');
  if (at > 0 && /^[\w-]+$/.test(spec.slice(at + 1))) return { selector: spec.slice(0, at).trim(), attr: spec.slice(at + 1) };
  return { selector: spec.trim() };
}

export async function fetchHtml(source: Source, http: HttpGet): Promise<Omit<RawItem, 'id'>[]> {
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

  const items: Omit<RawItem, 'id'>[] = [];
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
