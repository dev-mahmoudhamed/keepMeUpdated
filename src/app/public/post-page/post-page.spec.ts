import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Post } from '../../../../shared/models';
import { PostPage } from './post-page';

const post: Post = {
  id: 'p1',
  slug: 'angular-22',
  title: 'Angular 22 ships zoneless by default',
  tldr: 'Zoneless is now the default for new apps.',
  bodyHtml: '<h3>Key points</h3><ul><li>One</li></ul>',
  tags: ['angular'],
  sources: [
    { siteName: 'Angular Blog', url: 'https://blog.angular.dev/a22', title: 'Announcing Angular 22' },
    { siteName: 'Hacker News', url: 'https://news.ycombinator.com/item?id=1', title: 'Angular 22' },
    { siteName: 'Dev.to', url: 'https://dev.to/x', title: 'What is new' },
  ],
  relevance: 9,
  status: 'published',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-17T04:00:00Z',
  updatedAt: '2026-10-17T04:00:00Z',
  publishedAt: '2026-10-17T04:00:00Z',
};

describe('PostPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(respond: (url: string) => void) {
    const fixture = TestBed.createComponent(PostPage);
    fixture.componentRef.setInput('slug', 'angular-22');
    fixture.detectChanges();
    TestBed.tick();
    respond('/api/posts/angular-22');
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the tldr, the summary and every original link', async () => {
    const el = await render((url) => http.expectOne(url).flush(post));
    expect(el.querySelector('h1')?.textContent).toContain('Angular 22 ships zoneless');
    expect(el.querySelector('.tldr')?.textContent).toContain('Zoneless is now the default');
    const links = el.querySelectorAll('.originals a[target="_blank"][rel~="noopener"]');
    expect(links.length).toBe(3);
    expect((links[0] as HTMLAnchorElement).href).toBe('https://blog.angular.dev/a22');
    expect(el.querySelector('.body h3')?.textContent).toBe('Key points');
    expect(document.title).toBe('Angular 22 ships zoneless by default · keepMeUpdated');
  });

  it('says when the summary is still pending', async () => {
    const el = await render((url) => http.expectOne(url).flush({ ...post, aiPending: true }));
    expect(el.textContent).toContain('AI summary pending');
  });

  it('does not credit AI for hand-written posts', async () => {
    const el = await render((url) => http.expectOne(url).flush({ ...post, origin: 'manual' }));
    expect(el.querySelector('.note')?.textContent).not.toContain('AI');
    expect(el.querySelector('.note')?.textContent).toContain('Check the originals');
  });

  it('shows the not-found page for a 404', async () => {
    const el = await render((url) => http.expectOne(url).flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' }));
    expect(el.querySelector('h1')?.textContent).toContain("This page isn't in any edition");
  });
});
