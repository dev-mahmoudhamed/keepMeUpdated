import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
const setting = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(toml)?.[1];

describe('netlify.toml', () => {
  it('publishes the folder the Angular application builder writes (else @netlify/angular-runtime fails the build)', () => {
    const angular = JSON.parse(readFileSync(join(root, 'angular.json'), 'utf8'));
    const [name, project] = Object.entries(angular.projects)[0] as [string, { architect: { build: { builder: string; options: { outputPath?: string } } } }];
    expect(project.architect.build.builder).toBe('@angular/build:application');
    expect(setting('publish')).toBe(`${project.architect.build.options.outputPath ?? `dist/${name}`}/browser`);
  });

  it('builds the data before the site and serves the functions', () => {
    expect(setting('command')).toBe('npm run build');
    expect(setting('directory')).toBe('netlify/functions');
  });

  it('routes deep links to the app', () => {
    expect(toml).toMatch(/from = "\/\*"\s+to = "\/index.html"\s+status = 200/);
  });
});

describe('Netlify function routes', () => {
  // Netlify reads `export const config` at build time without running the code, so only literal values work.
  // A template literal like `${PREFIX}/*` is silently ignored and the route falls through to the app.
  const routes: [file: string, path: string][] = [
    ['netlify/functions/auth.ts', '/api/auth/*'],
    ['netlify/functions/github.ts', '/api/github/*'],
  ];

  it.each(routes)('%s declares its path as a plain string', (file, path) => {
    const source = readFileSync(join(root, file), 'utf8');
    const config = /export const config[^=]*=\s*\{\s*path:\s*([^}]*?)\s*\}/.exec(source)?.[1];
    expect(config).toBe(`'${path}'`);
  });
});
