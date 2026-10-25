import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ContentState, Post, Run } from '../../../../shared/models';
import { FakeContent, provideFakeContent, settle } from '../testing/fake-content';
import { Report, buildReport } from './report';

const post = (id: string, over: Partial<Post> = {}): Post => ({
  id,
  slug: id,
  title: `Post ${id}`,
  tldr: '',
  bodyHtml: '',
  tags: [],
  sources: [],
  relevance: 5,
  status: 'published',
  origin: 'auto',
  aiPending: false,
  createdAt: '2026-10-24T17:00:00Z',
  updatedAt: '2026-10-24T17:00:00Z',
  publishedAt: '2026-10-20T00:00:00Z',
  ...over,
});

const reported: Run = {
  id: 'r2',
  trigger: 'manual',
  startedAt: '2026-10-24T17:34:00Z',
  finishedAt: '2026-10-24T17:40:00Z',
  status: 'partial',
  stats: { fetched: 9, fresh: 5, clusters: 3, created: 2, merged: 1 },
  errors: [{ sourceId: 'c', message: 'HTTP 500' }],
  log: [],
  report: {
    sources: [
      { sourceId: 'a', name: 'Angular Blog', read: 6, onSite: 3, tooOld: 0, repeated: 0, fresh: 3 },
      { sourceId: 'b', name: '.NET Blog', read: 3, onSite: 0, tooOld: 1, repeated: 0, fresh: 2 },
      { sourceId: 'c', name: 'Broken', read: 0, onSite: 0, tooOld: 0, repeated: 0, fresh: 0, error: 'HTTP 500' },
    ],
    links: [
      { sourceId: 'a', title: 'Signal forms', url: 'https://a.test/1', postId: 'n1', newPost: true },
      { sourceId: 'a', title: 'Signal forms, again', url: 'https://a.test/2', postId: 'n1', newPost: true },
      { sourceId: 'a', title: 'Angular 22.2.1', url: 'https://a.test/3', postId: 'old' },
      { sourceId: 'b', title: '.NET 11 preview', url: 'https://b.test/1', postId: 'n2', newPost: true },
      { sourceId: 'b', title: 'Lost link', url: 'https://b.test/2' },
    ],
  },
};

const posts = [
  post('n1', { publishedAt: '2026-08-03T00:00:00Z' }),
  post('n2', { publishedAt: '2026-10-22T00:00:00Z', status: 'hidden' }),
  post('old', { publishedAt: '2026-10-01T00:00:00Z' }),
];

describe('buildReport', () => {
  it('counts where the links went and which months the new posts show under', () => {
    const v = buildReport(reported, posts)!;
    expect(v).toMatchObject({ read: 9, sourceCount: 3, onSite: 3, tooOld: 1, repeated: 0, failedSources: 1, fresh: 5 });
    expect(v).toMatchObject({ newPosts: 2, newPostLinks: 3, addedLinks: 1, addedPosts: 1 });
    expect(v.months).toEqual([
      { label: 'Aug 2026', count: 1 },
      { label: 'Oct 2026', count: 1 },
    ]);
    expect(v.groups.map((g) => [g.postId, g.newPost, g.links.length])).toEqual([
      ['n2', true, 1],
      ['n1', true, 2],
      ['old', false, 1],
    ]);
    expect(v.sources.map((s) => s.name)).toEqual(['Broken', 'Angular Blog', '.NET Blog']);
  });

  it('explains anything that is not on the site', () => {
    const v = buildReport(reported, posts.filter((p) => p.id !== 'old'))!;
    expect(v.attention.map((a) => a.kind)).toEqual(['failed', 'unposted', 'removed', 'unpublished']);
    expect(v.attention[0].text).toContain('Broken couldn’t be read');
    expect(v.attention[2].text).toBe('“Angular 22.2.1” was posted, but that post has since been deleted.');
    expect(v.attention[3]).toMatchObject({ text: '“Post n2” is hidden, so it isn’t on the site.', postId: 'n2' });
  });

  it('has nothing to show for runs from before reports', () => {
    expect(buildReport({ ...reported, report: undefined }, posts)).toBeNull();
  });
});

describe('Report', () => {
  const state = (runs: Run[]): ContentState => ({
    version: 1,
    settings: { maxAiCallsPerRun: 60, retentionDays: 120 },
    seen: {},
    runs,
    sourceStatus: {},
  });

  async function render(runs: Run[]) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideFakeContent(new FakeContent(posts, [], state(runs)))] });
    const fixture = TestBed.createComponent(Report);
    fixture.detectChanges();
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the latest run: the funnel, what needs attention, each source and each new post', async () => {
    const el = await render([reported]);
    expect(el.querySelector('.row--total .num')?.textContent?.trim()).toBe('9');
    expect(el.querySelector('.attention')?.textContent).toContain('went into no post');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(el.querySelector('.groups .post-title')?.textContent).toContain('Post n2');
    expect(el.querySelector('.months')?.textContent).toContain('Aug 2026');
  });

  it('says so when nothing is missing', async () => {
    const clean: Run = {
      ...reported,
      report: { sources: [reported.report!.sources[0]], links: [reported.report!.links[0]] },
    };
    const el = await render([clean]);
    expect(el.querySelector('.all-good')?.textContent).toContain('Nothing is missing');
  });

  it('keeps the totals of runs from before reports', async () => {
    const el = await render([{ ...reported, report: undefined }]);
    expect(el.querySelector('.empty')?.textContent).toContain('made 2 new posts');
  });
});
