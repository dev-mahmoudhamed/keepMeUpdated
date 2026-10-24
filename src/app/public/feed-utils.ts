import type { PostSummary } from '../../../shared/models';

/** Published after the reader's previous visit. Nothing is new on a first visit. */
export function isNewSince(post: PostSummary, since: string | null): boolean {
  return !!since && !!post.publishedAt && post.publishedAt > since;
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

/** "today at 09:14", "yesterday at 18:02" or "Thursday, 15 October at 09:14". */
export function visitLabel(iso: string, today = new Date()): string {
  const day = formatDay(localKey(new Date(iso)), today);
  return `${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day} at ${timeOf(iso)}`;
}
