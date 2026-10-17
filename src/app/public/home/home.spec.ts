import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { FeedResponse, PostSummary } from '../../../../shared/models';
import { Home } from './home';

const post = (id: string, relevance = 5): PostSummary => ({
  id,
  slug: id,
  title: `Title ${id}`,
  tldr: `Summary ${id}`,
  tags: ['angular'],
  relevance,
  publishedAt: '2026-10-17T04:10:00Z',
  aiPending: false,
  sourceCount: 2,
});

const feed: FeedResponse = {
  days: [
    { date: '2026-10-17', posts: [post('a', 9), post('b')] },
    { date: '2026-10-16', posts: [post('c')] },
  ],
  nextBefore: '2026-10-16',
};

describe('Home', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne((r) => r.url.startsWith('/api/posts')).flush(feed);
    http.expectOne('/api/tags').flush([{ tag: 'angular', count: 3 }]);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders one section per day with the lead story first', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('app-day-section').length).toBe(2);
    expect(el.querySelector('.lead h3')?.textContent).toContain('Title a');
  });

  it('switches to compact view and remembers it', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('input[value="compact"]') as HTMLInputElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(localStorage.getItem('kmu.view')).toBe('compact');
    expect(el.querySelectorAll('.row--compact').length).toBe(3);
    expect(el.querySelector('.lead')).toBeNull();
  });

  it('loads older days and appends them', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.older') as HTMLButtonElement).click();
    const req = http.expectOne((r) => r.url.includes('before=2026-10-16'));
    req.flush({ days: [{ date: '2026-10-15', posts: [post('d')] }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelectorAll('app-day-section').length).toBe(3);
    expect(el.querySelector('.older')).toBeNull();
  });
});
