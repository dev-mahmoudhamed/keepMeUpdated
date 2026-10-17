import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DeferBlockBehavior } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { PostEditor } from './post-editor';

describe('PostEditor (new post)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: '**', children: [] }])],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(PostEditor);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('/api/admin/status').flush({ geminiConfigured: false, model: 'm', nextRunAt: null, running: null });
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

  it('fills the slug from the title until the slug is edited by hand', async () => {
    const { el, type } = await render();
    type('#title', 'Angular 22 is out!');
    expect((el.querySelector('#slug') as HTMLInputElement).value).toBe('angular-22-is-out');
    type('#slug', 'my-slug');
    type('#title', 'Something else');
    expect((el.querySelector('#slug') as HTMLInputElement).value).toBe('my-slug');
  });

  it('turns comma separated text into lowercase tags', async () => {
    const { fixture, el, type } = await render();
    type('#tags', 'Angular, signals, angular');
    (el.querySelector('#tags') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    const chips = [...el.querySelectorAll('.chip-tag')].map((c) => c.textContent?.trim().replace(/\s+/g, ' '));
    expect(chips.map((c) => c?.split(' ')[0])).toEqual(['#angular', '#signals']);
  });

  it('posts the body, tags and sources when saving a new post', async () => {
    const { fixture, el, type } = await render();
    type('#title', 'Hand written');
    type('#tldr', 'Short version');
    (el.querySelector('button[data-action="add-source"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('[data-field="siteName"]', 'Angular Blog');
    type('[data-field="url"]', 'https://blog.angular.dev/x');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/admin/posts');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      title: 'Hand written',
      slug: 'hand-written',
      tldr: 'Short version',
      bodyHtml: '',
      status: 'draft',
      tags: [],
      sources: [{ siteName: 'Angular Blog', url: 'https://blog.angular.dev/x', title: '' }],
    });
    req.flush({ id: 'new-id', status: 'draft' });
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/admin/posts/new-id');
  });

  it('shows a slug conflict next to the slug field', async () => {
    const { fixture, el, type } = await render();
    type('#title', 'Taken');
    type('#tldr', 'x');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http.expectOne('/api/admin/posts').flush({ error: 'That slug is already used' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('#slug-error')?.textContent).toContain('That slug is already used');
  });

  it('does not save without a title and tldr', async () => {
    const { fixture, el } = await render();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    http.expectNone('/api/admin/posts');
    expect(el.querySelector('#title-error')?.textContent).toContain('Add a title');
  });
});
