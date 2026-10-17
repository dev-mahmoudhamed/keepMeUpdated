import * as cheerio from 'cheerio';

/** Pull readable text out of an article page for summarization. */
export function extractArticleText(html: string, maxChars: number): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg').remove();
  const root = [$('article').first(), $('main').first(), $('body').first()].find((el) => el.length) ?? $.root();
  const blocks = root
    .find('p, li, h2, h3')
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const text = (blocks.length ? blocks.join('\n') : root.text().replace(/\s+/g, ' ').trim());
  return text.slice(0, maxChars);
}
