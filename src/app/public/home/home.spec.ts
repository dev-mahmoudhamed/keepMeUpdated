import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { FeedIndex, PostSummary } from '../../../../shared/models';
import { Home } from './home';

const post = (id: string, day: string, relevance = 5, tags = ['angular']): PostSummary => ({
  id,
  slug: id,
  title: `Title ${id}`,
  tldr: `Summary ${id}`,
  tags,
  relevance,
  publishedAt: `${day}T10:00:00Z`,
  aiPending: false,
  sourceCount: 2,
});

const twoDays: FeedIndex = {
  generatedAt: '2026-10-17T03:10:00Z',
  posts: [post('a', '2026-10-17', 9), post('b', '2026-10-17', 5, ['dotnet']), post('c', '2026-10-16')],
};

const nineDays: FeedIndex = {
  generatedAt: '2026-10-17T03:10:00Z',
  posts: Array.from({ length: 9 }, (_, i) => post(`p${i}`, `2026-10-${String(17 - i).padStart(2, '0')}`)),
};

describe('Home', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(index: FeedIndex = twoDays) {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('data/posts.json').flush(index);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders one section per day, newest story first', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('app-day-section').length).toBe(2);
    expect(el.querySelector('.story h3')?.textContent).toContain('Title a');
  });

  it('labels the views Cards and List', async () => {
    const fixture = await render();
    const labels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.view label')].map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Cards', 'List']);
  });

  it('shows every story as the same kind of card in a grid', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.grid article.story').length).toBe(3);
    expect(el.querySelector('.story .tldr')?.textContent).toContain('Summary a');
  });

  it('switches to List view and remembers it', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('input[value="list"]') as HTMLInputElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(localStorage.getItem('kmu.view')).toBe('list');
    expect(el.querySelectorAll('a.row').length).toBe(3);
    expect(el.querySelector('.story')).toBeNull();
  });

  it('reads the old "compact" preference as List', async () => {
    localStorage.setItem('kmu.view', 'compact');
    const fixture = await render();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('a.row').length).toBe(3);
  });

  it('marks nothing new on a first visit', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.fresh')).toBeNull();
    expect(el.querySelectorAll('.is-new').length).toBe(0);
    expect(localStorage.getItem('kmu.lastVisit')).not.toBeNull();
  });

  it('marks what arrived since the last visit and can show only that', async () => {
    localStorage.setItem('kmu.lastVisit', '2026-10-16T12:00:00Z');
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.fresh')?.textContent).toContain('2 new');
    expect(el.querySelectorAll('.story.is-new').length).toBe(2);
    (el.querySelector('.fresh .btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('app-day-section').length).toBe(1);
    expect(el.querySelectorAll('.story').length).toBe(2);
    expect(el.querySelector('.fresh .btn')?.textContent).toContain('Show all');
  });

  it('builds topic chips from the index and filters without new requests', async () => {
    const fixture = await render();
    const el: HTMLElement = fixture.nativeElement;
    const chips = [...el.querySelectorAll('.chip')].map((c) => c.textContent?.trim());
    expect(chips).toEqual(['All topics', '#angular', '#dotnet']);
    (el.querySelectorAll('.chip')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('app-day-section').length).toBe(1);
    expect(el.querySelector('.story h3')?.textContent).toContain('Title b');
  });

  it('shows a retry message when the index fails to load', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('data/posts.json').flush('missing', { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.state h2')?.textContent).toContain("Updates didn't load");
  });

  it('reveals older days from the same index', async () => {
    const fixture = await render(nineDays);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('app-day-section').length).toBe(7);
    (el.querySelector('.older') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('app-day-section').length).toBe(9);
    expect(el.querySelector('.older')).toBeNull();
  });
});
