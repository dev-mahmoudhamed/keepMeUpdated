// The pending sign-in code, kept in Netlify Blobs (site-wide, strongly consistent).
import { getStore } from '@netlify/blobs';
import type { CodeStore, PendingCode } from './auth';

const KEY = 'pending-code';

export function blobCodeStore(): CodeStore {
  const store = getStore({ name: 'admin-auth', consistency: 'strong' });
  return {
    async read() {
      const entry = await store.getWithMetadata(KEY, { type: 'json' });
      return entry?.etag ? { value: entry.data as PendingCode, etag: entry.etag } : null;
    },
    async update(value, etag) {
      return (await store.setJSON(KEY, value, { onlyIfMatch: etag })).modified;
    },
    async write(value) {
      await store.setJSON(KEY, value);
    },
    async clear() {
      await store.delete(KEY);
    },
  };
}
