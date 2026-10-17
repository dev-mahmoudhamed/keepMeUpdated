import type { Source } from '../../../shared/models';
import type { HttpGet } from '../http';
import type { RawItem } from '../types';
import { fetchHtml } from './html';
import { fetchRss } from './rss';

export function fetchSource(source: Source, http: HttpGet): Promise<Omit<RawItem, 'id'>[]> {
  return source.type === 'html' ? fetchHtml(source, http) : fetchRss(source, http);
}
