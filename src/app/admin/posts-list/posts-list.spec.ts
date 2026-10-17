import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Post } from '../../../../shared/models';
import { PostsList } from './posts-list';

const post = (id: string, status: Post['status']): Post => ({
  id,
  slug: id,
  title: `Post ${id}`,
  tldr: '',
  bodyHtml: '',
  tags: [],
  sources: [{ siteName: 'A', url: 'https://a.test', title: 'a' }],
  relevance: 5,
  status,
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-17T04:00:00Z',
  updatedAt: '2026-10-17T04:00:00Z',
});

describe('PostsList', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(PostsList);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne((r) => r.url === '/api/admin/posts').flush([post('a', 'published'), post('b', 'draft')]);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders a row per post with its status', async () => {
    const fixture = await render();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[1].textContent).toContain('Draft');
  });

  it('deletes a post after confirming', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('tbody tr button[data-action="delete"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement).click();
    const req = http.expectOne('/api/admin/posts/a');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    TestBed.tick();
    http.expectOne((r) => r.url === '/api/admin/posts').flush([post('b', 'draft')]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(1);
  });

  it('publishes a draft', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelectorAll('tbody tr')[1].querySelector('button[data-action="toggle"]') as HTMLButtonElement).click();
    const req = http.expectOne('/api/admin/posts/b');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.status).toBe('published');
    req.flush({ ...post('b', 'published') });
    TestBed.tick();
    http.expectOne((r) => r.url === '/api/admin/posts').flush([]);
    await fixture.whenStable();
  });
});
