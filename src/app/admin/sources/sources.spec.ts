import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Source } from '../../../../shared/models';
import { Sources } from './sources';

const rss: Source = {
  id: 's1',
  name: 'Angular Blog',
  siteUrl: 'https://blog.angular.dev',
  type: 'rss',
  feedUrl: 'https://blog.angular.dev/feed',
  defaultTags: ['angular'],
  enabled: true,
  lastFetchedAt: '2026-10-17T04:00:00Z',
  lastItemCount: 10,
};

describe('Sources', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(Sources);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('/api/admin/sources').flush([rss, { ...rss, id: 's2', name: 'Broken', lastError: 'HTTP 403 for x' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const type = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    return { fixture, el, type };
  }

  it('lists sources with their last error', async () => {
    const { el } = await render();
    expect(el.querySelectorAll('.source-row').length).toBe(2);
    expect(el.textContent).toContain('HTTP 403 for x');
  });

  it('only asks for selectors on html sources', async () => {
    const { fixture, el } = await render();
    (el.querySelector('button[data-action="add"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('#sel-item')).toBeNull();
    (el.querySelector('input[name="type"][value="html"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el.querySelector('#sel-item')).not.toBeNull();
  });

  it('previews what a source returns with test fetch', async () => {
    const { fixture, el, type } = await render();
    (el.querySelector('button[data-action="add"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('#src-name', 'Bun');
    type('#src-site', 'https://bun.sh');
    type('#src-feed', 'https://bun.sh/rss.xml');
    (el.querySelector('button[data-action="test"]') as HTMLButtonElement).click();
    const req = http.expectOne('/api/admin/sources/test');
    expect(req.request.body).toMatchObject({ name: 'Bun', type: 'rss', feedUrl: 'https://bun.sh/rss.xml', enabled: true });
    req.flush({ items: [{ title: 'Bun 2.0', url: 'https://bun.sh/blog/2', snippet: '' }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.preview')?.textContent).toContain('Bun 2.0');
  });

  it('toggles a source on and off', async () => {
    const { el } = await render();
    (el.querySelector('.source-row [role="switch"]') as HTMLButtonElement).click();
    const req = http.expectOne('/api/admin/sources/s1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.enabled).toBe(false);
  });
});
