import sanitize from 'sanitize-html';
import type { RawItem } from '../gather/types';

const OPTIONS: sanitize.IOptions = {
  allowedTags: ['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'strong', 'em', 'img', 'hr', 'br', 's'],
  allowedAttributes: { a: ['href', 'rel', 'target'], img: ['src', 'alt'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizeHtml(html: string): string {
  return sanitize(html, OPTIONS);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderStoryBody(keyPoints: string[], whyItMatters: string): string {
  const points = keyPoints.map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  return `<h3>Key points</h3><ul>${points}</ul><h3>Why it matters</h3><p>${escapeHtml(whyItMatters)}</p>`;
}

export function renderFallbackBody(items: RawItem[]): string {
  return items
    .filter((i) => i.snippet)
    .map((i) => `<p><strong>${escapeHtml(i.siteName)}:</strong> ${escapeHtml(i.snippet)}</p>`)
    .join('');
}
