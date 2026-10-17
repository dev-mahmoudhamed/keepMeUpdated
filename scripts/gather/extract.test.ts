import { it, expect } from 'vitest';
import { extractArticleText } from './extract';

it('prefers article content and drops navigation', () => {
  expect(extractArticleText('<nav>menu</nav><article><p>One</p><p>Two</p></article>', 100)).toBe('One\nTwo');
});

it('falls back to main, then body', () => {
  expect(extractArticleText('<header>h</header><main><p>Main text</p></main>', 100)).toBe('Main text');
  expect(extractArticleText('<body><script>x()</script><p>Body text</p></body>', 100)).toBe('Body text');
});

it('truncates to maxChars', () => {
  expect(extractArticleText('<body><p>' + 'a'.repeat(50) + '</p></body>', 10)).toHaveLength(10);
});
