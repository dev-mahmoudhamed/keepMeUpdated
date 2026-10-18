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
