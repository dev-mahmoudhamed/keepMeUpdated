import { it, expect } from 'vitest';
import { loadConfig } from './config';

it('applies defaults', () => {
  const c = loadConfig({});
  expect(c.geminiModel).toBe('gemini-flash-latest');
  expect(c.port).toBe(3000);
  expect(c.adminEmail).toBe('admin@keepmeupdated.local');
  expect(c.gatherCron).toBe('0 4 * * *');
  expect(c.sessionSecret.length).toBeGreaterThanOrEqual(32);
  expect(c.geminiApiKey).toBeUndefined();
});
it('reads env values', () => {
  const c = loadConfig({ PORT: '4000', GEMINI_API_KEY: 'k', NODE_ENV: 'production' });
  expect(c.port).toBe(4000);
  expect(c.geminiApiKey).toBe('k');
  expect(c.isProd).toBe(true);
});

it('prefers API_PORT over PORT so the dev server can own PORT', () => {
  expect(loadConfig({ PORT: '4201', API_PORT: '3000' }).port).toBe(3000);
});

it('listens on localhost only unless HOST says otherwise', () => {
  expect(loadConfig({}).host).toBe('127.0.0.1');
  expect(loadConfig({ HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
});

it('flags the published default admin password', () => {
  expect(loadConfig({}).usingDefaultPassword).toBe(true);
  expect(loadConfig({ ADMIN_PASSWORD: 'something-else' }).usingDefaultPassword).toBe(false);
});
