import type { PostSummary } from '../../../shared/models';

/** The day's lead story: highest relevance, newest on ties. `rest` keeps feed order. */
export function pickLead(posts: PostSummary[]): { lead: PostSummary | null; rest: PostSummary[] } {
  if (!posts.length) return { lead: null, rest: [] };
  const lead = posts.reduce((best, p) =>
    p.relevance > best.relevance || (p.relevance === best.relevance && (p.publishedAt ?? '') > (best.publishedAt ?? '')) ? p : best,
  );
  return { lead, rest: posts.filter((p) => p !== lead) };
}

const localKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "Today", "Yesterday", or "Thursday, 15 October" (with the year when it differs). */
export function formatDay(date: string, today = new Date()): string {
  if (date === localKey(today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date === localKey(yesterday)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const weekday = day.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = day.toLocaleDateString('en-GB', { month: 'long' });
  return `${weekday}, ${d} ${month}${y !== today.getFullYear() ? ` ${y}` : ''}`;
}

export function sourcesLabel(n: number): string {
  return `${n} ${n === 1 ? 'source' : 'sources'}`;
}

export function timeOf(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
