import { randomUUID, randomBytes } from 'node:crypto';
import { slugify } from '../../shared/slug';

export { slugify };

export function newId(): string {
  return randomUUID();
}

export function uniqueSlug(text: string, taken: Set<string>): string {
  const base = slugify(text) || `post-${randomBytes(4).toString('hex').slice(0, 6)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
