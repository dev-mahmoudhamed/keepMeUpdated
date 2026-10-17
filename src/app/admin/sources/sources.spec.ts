import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ContentState } from '../../../../shared/models';
import type { SourceDef } from '../../../../shared/sources-md';
import { FakeContent, provideFakeContent, settle } from '../testing/fake-content';
import { Sources } from './sources';

const rss: SourceDef = {
  name: 'Angular Blog',
  siteUrl: 'https://blog.angular.dev',
  type: 'rss',
  feedUrl: 'https://blog.angular.dev/feed',
  defaultTags: ['angular'],
  enabled: true,
  group: 'Angular',
};

const state: ContentState = {
  version: 1,
  settings: { relevanceThreshold: 6, maxItemAgeHours: 48, maxAiCallsPerRun: 15, retentionDays: 30 },
  seen: {},
  runs: [],
  sourceStatus: {
    'https://blog.angular.dev/feed': { lastFetchedAt: '2026-10-17T03:00:00Z', lastItemCount: 10 },
    'https://broken.test/feed': { lastError: 'HTTP 403 for x' },
  },
};

describe('Sources', () => {
  let fake: FakeContent;

  beforeEach(() => {
    fake = new FakeContent([], [rss, { ...rss, name: 'Broken', feedUrl: 'https://broken.test/feed', group: '.NET' }], state);
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideFakeContent(fake)] });
  });

  async function render() {
    const fixture = TestBed.createComponent(Sources);
    fixture.detectChanges();
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const type = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    return { fixture, el, type };
  }

  it('lists sources under their sections with their last fetch result', async () => {
    const { el } = await render();
    expect(el.querySelectorAll('.source-row').length).toBe(2);
    expect([...el.querySelectorAll('.group-title')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Angular 1', '.NET 1']);
    expect(el.textContent).toContain('HTTP 403 for x');
    expect(el.textContent).toContain('10 items');
  });

  it('only asks for selectors on html sources', async () => {
    const { fixture, el } = await render();
    (el.querySelector('button[data-action="add"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('#sel-item')).toBeNull();
    (el.querySelector('input[name="type"][value="html"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el.querySelector('#sel-item')).not.toBeNull();
    expect(el.querySelector('button[data-action="test"]')).toBeNull();
  });

  it('adds a source to sources.md with its section', async () => {
    const { fixture, el, type } = await render();
    (el.querySelector('button[data-action="add"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('#src-name', 'Bun');
    type('#src-site', 'https://bun.sh');
    type('#src-feed', 'https://bun.sh/rss.xml');
    type('#src-group', 'JavaScript');
    (el.querySelector('.drawer form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(fake.sources.at(-1)).toMatchObject({ name: 'Bun', feedUrl: 'https://bun.sh/rss.xml', group: 'JavaScript', type: 'rss', enabled: true });
    expect(fake.commits).toEqual(['admin: add source "Bun"']);
  });

  it('refuses a feed that is already listed', async () => {
    const { fixture, el, type } = await render();
    (el.querySelector('button[data-action="add"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('#src-name', 'Dup');
    type('#src-site', 'https://blog.angular.dev');
    type('#src-feed', 'https://www.blog.angular.dev/feed/');
    (el.querySelector('.drawer form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(fake.commits).toEqual([]);
    expect(el.querySelector('.drawer [role="alert"]')?.textContent).toContain('already in the list');
  });

  it('toggles a source on and off', async () => {
    const { fixture, el } = await render();
    (el.querySelector('.source-row [role="switch"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(fake.sources[0].enabled).toBe(false);
    expect(fake.commits).toEqual(['admin: turn off source "Angular Blog"']);
  });
});
