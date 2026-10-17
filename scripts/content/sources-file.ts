import type { Source, SourceSelectors } from '../../shared/models';
import { normalizeUrl } from '../gather/dedupe';
import { newId } from '../util/ids';

/** A source as written in sources.md: configuration only, no fetch history. */
export type SourceDef = Omit<Source, 'id' | 'lastFetchedAt' | 'lastError' | 'lastItemCount'>;

export interface ParsedSources {
  sources: SourceDef[];
  warnings: string[];
  /** False when the file has no source table at all (empty, half-saved, or wrong file). */
  hasTable: boolean;
}

const COLUMNS = ['name', 'feed', 'website', 'tags', 'enabled', 'selectors'] as const;
type Column = (typeof COLUMNS)[number];
const SELECTOR_KEYS = ['item', 'title', 'link', 'date', 'summary'] as const;
const HTTP = /^https?:\/\/\S+$/i;
const OFF = /^(no|false|off|0|disabled|-)$/i;

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

/** `[text](url)`, `<url>` or `` `url` `` → url. */
function cleanUrl(cell: string): string {
  const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(cell);
  const raw = link ? link[1] : cell;
  return raw.replace(/^[<`]+|[>`]+$/g, '').trim();
}

function parseSelectors(cell: string): SourceSelectors | null {
  const pairs = Object.fromEntries(
    cell
      .replace(/`/g, '')
      .split(';')
      .map((p) => p.split('=').map((x) => x.trim()))
      .filter(([k, v]) => k && v && (SELECTOR_KEYS as readonly string[]).includes(k.toLowerCase()))
      .map(([k, v]) => [k.toLowerCase(), v]),
  ) as Partial<SourceSelectors>;
  if (!pairs.item || !pairs.title || !pairs.link) return null;
  return {
    item: pairs.item,
    title: pairs.title,
    link: pairs.link,
    ...(pairs.date ? { date: pairs.date } : {}),
    ...(pairs.summary ? { summary: pairs.summary } : {}),
  };
}

export function parseSourcesMd(md: string): ParsedSources {
  const sources: SourceDef[] = [];
  const warnings: string[] = [];
  let group: string | undefined;
  let columns: Partial<Record<Column, number>> | null = null;
  let hasTable = false;

  for (const line of md.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      group = heading[1].trim();
      columns = null;
      continue;
    }
    if (!line.trim().startsWith('|')) {
      if (line.trim()) columns = null;
      continue;
    }
    const cells = splitRow(line);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

    const lower = cells.map((c) => c.toLowerCase());
    if (lower.includes('name') && lower.includes('feed')) {
      columns = Object.fromEntries(COLUMNS.map((col) => [col, lower.indexOf(col)]).filter(([, i]) => (i as number) >= 0));
      hasTable = true;
      continue;
    }
    if (!columns) continue;

    const cell = (col: Column) => (columns![col] !== undefined ? (cells[columns![col]!] ?? '') : '');
    const name = cell('name').replace(/\*\*/g, '').trim();
    const feedUrl = cleanUrl(cell('feed'));
    if (!name || !HTTP.test(feedUrl)) {
      warnings.push(`Skipped "${name || line.trim()}": the feed link must start with http:// or https://`);
      continue;
    }
    const website = cleanUrl(cell('website'));
    const selectorsCell = cell('selectors');
    const selectors = selectorsCell ? parseSelectors(selectorsCell) : null;
    if (selectorsCell && !selectors) {
      warnings.push(`Skipped "${name}": selectors need item=, title= and link=`);
      continue;
    }
    sources.push({
      name,
      siteUrl: HTTP.test(website) ? website : new URL(feedUrl).origin,
      type: selectors ? 'html' : 'rss',
      feedUrl,
      ...(selectors ? { selectors } : {}),
      defaultTags: [
        ...new Set(
          cell('tags')
            .split(',')
            .map((t) => t.replace(/[`#]/g, '').trim().toLowerCase())
            .filter(Boolean),
        ),
      ],
      enabled: !OFF.test(cell('enabled').trim()),
      ...(group ? { group } : {}),
    });
  }
  return { sources, warnings, hasTable };
}

const escapeCell = (text: string) => text.replace(/\|/g, '\\|');

const INTRO = `# News sources

The daily gather reads every **enabled** source below. Edit this file or use **Admin → Sources**; the two stay in
sync (the server reloads this file when you save it, and rewrites it when you change sources in the admin panel).

- One table row per source. \`##\` headings group sources into sections.
- **Feed**: an RSS/Atom link, or a web page link when **Selectors** is filled in.
- **Tags**: comma separated; used when the AI can't tag a story.
- **Enabled**: \`yes\` or \`no\`.
- **Selectors** (only for sites without a feed): \`item=…; title=…; link=…; date=…; summary=…\`.
  Add \`@attr\` to read an attribute, e.g. \`link=a@href\`.
`;

export function renderSourcesMd(sources: Pick<Source, keyof SourceDef>[]): string {
  const groups = new Map<string, typeof sources>();
  for (const s of sources) {
    const g = s.group?.trim() || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  }
  const sections = [...groups].map(([group, rows]) => {
    const lines = rows.map((s) => {
      const sel = s.type === 'html' && s.selectors
        ? SELECTOR_KEYS.filter((k) => s.selectors![k]).map((k) => `${k}=${s.selectors![k]}`).join('; ')
        : '';
      return `| ${escapeCell(s.name)} | ${s.feedUrl} | ${s.siteUrl} | ${s.defaultTags.join(', ')} | ${s.enabled ? 'yes' : 'no'} | ${escapeCell(sel)} |`;
    });
    return [`## ${group}`, '', '| Name | Feed | Website | Tags | Enabled | Selectors |', '| --- | --- | --- | --- | --- | --- |', ...lines].join('\n');
  });
  return `${INTRO}\n${sections.join('\n\n')}\n`;
}

const configKey = (s: Partial<SourceDef>) =>
  JSON.stringify([s.name, s.siteUrl, s.type, s.feedUrl, s.selectors ?? null, s.defaultTags, s.enabled, s.group ?? null]);

/** Make the database's sources match the file, keeping ids and fetch history for feeds already known. */
export function syncSources(existing: Source[], defs: SourceDef[]): { sources: Source[]; changes: { added: number; updated: number; removed: number } } {
  const byFeed = new Map(existing.map((s) => [normalizeUrl(s.feedUrl), s]));
  const used = new Set<string>();
  let added = 0;
  let updated = 0;
  const sources = defs.map((def) => {
    const prev = byFeed.get(normalizeUrl(def.feedUrl));
    if (!prev || used.has(prev.id)) {
      added++;
      return { ...def, id: newId() } as Source;
    }
    used.add(prev.id);
    if (configKey(prev) !== configKey(def)) updated++;
    const { selectors: _drop, group: _g, ...runtime } = prev;
    return { ...runtime, ...def, id: prev.id } as Source;
  });
  return { sources, changes: { added, updated, removed: existing.filter((s) => !used.has(s.id)).length } };
}
