import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Post } from '../../../../shared/models';
import { FakeContent, provideFakeContent, settle } from '../testing/fake-content';
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
  ...(status === 'published' ? { publishedAt: '2026-10-17T04:00:00Z' } : {}),
});

describe('PostsList', () => {
  let fake: FakeContent;

  beforeEach(() => {
    fake = new FakeContent([post('a', 'published'), post('b', 'draft')]);
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideFakeContent(fake)] });
  });

  async function render() {
    const fixture = TestBed.createComponent(PostsList);
    fixture.detectChanges();
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders a row per post with its status', async () => {
    const { el } = await render();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[1].textContent).toContain('Draft');
  });

  it('filters by status in the browser', async () => {
    const { fixture, el } = await render();
    const select = el.querySelector('select') as HTMLSelectElement;
    select.value = 'draft';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('deletes a post after confirming', async () => {
    const { fixture, el } = await render();
    (el.querySelector('tbody tr button[data-action="delete"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(fake.posts.map((p) => p.id)).toEqual(['b']);
    expect(fake.commits).toEqual(['admin: delete post "Post a"']);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('publishes a draft', async () => {
    const { fixture, el } = await render();
    (el.querySelectorAll('tbody tr')[1].querySelector('button[data-action="toggle"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(fake.posts.find((p) => p.id === 'b')).toMatchObject({ status: 'published', publishedAt: expect.any(String) });
    expect(fake.commits).toEqual(['admin: publish "Post b"']);
  });
});
