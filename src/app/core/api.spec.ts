import { dataUrl, postUrl } from './api';

describe('static data urls', () => {
  it('are relative so they work under the GitHub Pages base path', () => {
    expect(postUrl('angular-22')).toBe('data/p/angular-22.json');
    expect(dataUrl('posts.json')).toBe('data/posts.json');
    expect(postUrl('a/b')).toBe('data/p/a%2Fb.json');
  });
});
