import { it, expect } from 'vitest';
import { sanitizeHtml, renderStoryBody, renderFallbackBody, escapeHtml } from './sanitize';

it('strips scripts, handlers and javascript urls', () => {
  const out = sanitizeHtml('<p onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(1)">a</a><img src=x onerror=y></p>');
  expect(out).not.toMatch(/script|onclick|onerror|javascript:/);
  expect(out).toContain('hi');
});

it('forces safe rel and target on links', () => {
  const out = sanitizeHtml('<a href="https://a.dev">a</a>');
  expect(out).toContain('rel="noopener noreferrer"');
  expect(out).toContain('target="_blank"');
});

it('keeps allowed formatting', () => {
  const html = '<h2>T</h2><p><strong>b</strong> <em>i</em> <code>c</code></p><ul><li>x</li></ul><blockquote>q</blockquote><pre><code>z</code></pre><hr><img src="https://a.dev/i.png" alt="i">';
  expect(sanitizeHtml(html)).toBe(html.replace('<hr>', '<hr />').replace('alt="i">', 'alt="i" />'));
});

it('drops h1 and style attributes but keeps their text', () => {
  expect(sanitizeHtml('<h1 style="color:red">Big</h1>')).toBe('Big');
});

it('escapes model text when rendering a story body', () => {
  const html = renderStoryBody(['<b>x</b>', 'y & z'], 'Because "reasons"');
  expect(html).toBe('<h3>Key points</h3><ul><li>&lt;b&gt;x&lt;/b&gt;</li><li>y &amp; z</li></ul><h3>Why it matters</h3><p>Because &quot;reasons&quot;</p>');
});

it('renders fallback body from snippets', () => {
  const html = renderFallbackBody([
    { id: 'i0', sourceId: 's', siteName: 'Blog', title: 't', url: 'u', snippet: 'Hello <world>' },
    { id: 'i1', sourceId: 's', siteName: 'Other', title: 't', url: 'u', snippet: '' },
  ]);
  expect(html).toBe('<p><strong>Blog:</strong> Hello &lt;world&gt;</p>');
});

it('escapeHtml escapes quotes and angle brackets', () => {
  expect(escapeHtml(`<a href="x">'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;');
});
