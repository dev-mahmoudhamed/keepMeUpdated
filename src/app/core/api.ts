/** Static data written by `npm run build:data`. Relative, so it resolves under the GitHub Pages base path. */
export const dataUrl = (file: string) => `data/${file}`;
export const postUrl = (slug: string) => dataUrl(`p/${encodeURIComponent(slug)}.json`);
