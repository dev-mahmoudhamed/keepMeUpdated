import type { Db, Source } from '../../shared/models';
import { newId } from '../util/ids';

const rss = (name: string, siteUrl: string, feedUrl: string, defaultTags: string[]): Omit<Source, 'id'> => ({
  name,
  siteUrl,
  type: 'rss',
  feedUrl,
  defaultTags,
  enabled: true,
});

/** Sources seeded on first boot. Manage them from the admin panel afterwards. */
export const DEFAULT_SOURCES: Omit<Source, 'id'>[] = [
  rss('Angular Blog', 'https://blog.angular.dev', 'https://blog.angular.dev/feed', ['angular']),
  rss('React Blog', 'https://react.dev/blog', 'https://react.dev/rss.xml', ['react']),
  rss('Next.js Blog', 'https://nextjs.org/blog', 'https://nextjs.org/feed.xml', ['nextjs', 'react']),
  rss('Node.js Blog', 'https://nodejs.org/en/blog', 'https://nodejs.org/en/feed/blog.xml', ['node']),
  rss('TypeScript Blog', 'https://devblogs.microsoft.com/typescript', 'https://devblogs.microsoft.com/typescript/feed/', ['typescript']),
  rss('GitHub Changelog', 'https://github.blog/changelog', 'https://github.blog/changelog/feed/', ['github']),
  rss('Chrome for Developers', 'https://developer.chrome.com/blog', 'https://developer.chrome.com/static/blog/feed.xml', ['chrome', 'web']),
  rss('V8 Blog', 'https://v8.dev/blog', 'https://v8.dev/blog.atom', ['javascript']),
  rss('MDN Blog', 'https://developer.mozilla.org/en-US/blog', 'https://developer.mozilla.org/en-US/blog/rss.xml', ['web']),
  rss('Deno Blog', 'https://deno.com/blog', 'https://deno.com/feed', ['deno']),
  rss('Bun Blog', 'https://bun.sh/blog', 'https://bun.sh/rss.xml', ['bun']),
  rss('Hacker News', 'https://news.ycombinator.com', 'https://hnrss.org/frontpage?points=200', ['hn']),
];

/** The database a brand-new install starts with. Only used when db.json does not exist. */
export function createInitialDb(): Db {
  return {
    version: 1,
    posts: [],
    sources: DEFAULT_SOURCES.map((s) => ({ ...s, id: newId() })),
    runs: [],
    seen: {},
    settings: { relevanceThreshold: 6, maxItemAgeHours: 48, maxAiCallsPerRun: 15 },
  };
}
