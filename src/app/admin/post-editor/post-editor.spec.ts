import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Post } from '../../../../shared/models';
import { FakeContent, provideFakeContent, settle } from '../testing/fake-content';
import { PostEditor } from './post-editor';

const existing: Post = {
  id: 'p1',
  slug: 'taken',
  title: 'Taken',
  tldr: 'x',
  bodyHtml: '<p>b</p>',
  tags: ['a'],
  sources: [{ siteName: 'Blog', url: 'https://blog.test/1', title: 'One' }],
  relevance: 7,
  status: 'published',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
  publishedAt: '2026-10-16T00:00:00.000Z',
};

describe('PostEditor', () => {
  let fake: FakeContent;

  beforeEach(() => {
    fake = new FakeContent([structuredClone(existing)]);
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }]), provideFakeContent(fake)],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    });
  });

  async function render(id?: string) {
    const fixture = TestBed.createComponent(PostEditor);
    if (id) fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const type = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const submit = async () => {
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle(fixture);
    };
    return { fixture, el, type, submit };
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
    const chips = [...el.querySelectorAll('.chip-tag')].map((c) => c.textContent?.trim().split(/\s+/)[0]);
    expect(chips).toEqual(['#angular', '#signals']);
  });

  it('commits a new post with its body, tags and sources, then opens it for editing', async () => {
    const { fixture, el, type, submit } = await render();
    type('#title', 'Hand written');
    type('#tldr', 'Short version');
    (el.querySelector('button[data-action="add-source"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    type('[data-field="siteName"]', 'Angular Blog');
    type('[data-field="url"]', 'https://blog.angular.dev/x');
    await submit();
    const created = fake.posts.find((p) => p.title === 'Hand written')!;
    expect(created).toMatchObject({
      slug: 'hand-written',
      tldr: 'Short version',
      status: 'draft',
      origin: 'manual',
      sources: [{ siteName: 'Angular Blog', url: 'https://blog.angular.dev/x', title: '' }],
    });
    expect(fake.commits).toEqual(['admin: add post "Hand written"']);
    expect(TestBed.inject(Router).url).toBe(`/admin/posts/${created.id}`);
  });

  it('keeps source details it does not show when saving an existing post', async () => {
    fake.posts[0].sources[0].sourceId = 'src-1';
    const { type, submit } = await render('p1');
    type('#title', 'Taken, edited');
    await submit();
    expect(fake.posts[0]).toMatchObject({ title: 'Taken, edited', relevance: 7, createdAt: existing.createdAt });
    expect(fake.posts[0].sources[0].sourceId).toBe('src-1');
  });

  it('shows a slug conflict next to the slug field', async () => {
    const { el, type, submit } = await render();
    type('#title', 'Taken');
    type('#tldr', 'x');
    await submit();
    expect(el.querySelector('#slug-error')?.textContent).toContain('That slug is already used');
    expect(fake.commits).toEqual([]);
  });

  it('does not save without a title and tldr', async () => {
    const { el, submit } = await render();
    await submit();
    expect(fake.commits).toEqual([]);
    expect(el.querySelector('#title-error')?.textContent).toContain('Add a title');
  });

  it('starts an AI re-summary through the workflow', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { el } = await render('p1');
    (el.querySelector('button[data-action="resummarize"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    expect(fake.dispatched).toEqual([{ mode: 'resummarize', post_id: 'p1' }]);
  });
});
