import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts', 'netlify/**/*.test.ts'],
    environment: 'node',
  },
});
