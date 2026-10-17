import * as cheerio from 'cheerio';

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
