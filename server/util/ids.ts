import { randomUUID, randomBytes } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function uniqueSlug(text: string, taken: Set<string>): string {
  const base = slugify(text) || `post-${randomBytes(4).toString('hex').slice(0, 6)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
