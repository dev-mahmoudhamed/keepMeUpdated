import Parser from 'rss-parser';
import type { Source } from '../../../shared/models';
import type { HttpGet } from '../http';
import type { RawItem } from '../types';
import { toIsoDate, toPlainText } from './text';

const parser = new Parser();

export async function fetchRss(source: Source, http: HttpGet): Promise<Omit<RawItem, 'id'>[]> {
  const { text, finalUrl } = await http(source.feedUrl);
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
      title: toPlainText(i.title, 300),
      url: new URL(i.link!, finalUrl).toString(),
      snippet: toPlainText(i.contentSnippet || i['summary'] || i.content),
      publishedAt: toIsoDate(i.isoDate ?? i.pubDate),
    }));
}
