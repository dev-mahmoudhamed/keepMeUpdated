import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { LucideSearch, LucideX } from '@lucide/angular';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import type { DayGroup, FeedResponse, TagCount } from '../../../../shared/models';
import { feedUrl, tagsUrl } from '../../core/api';
import { readPref, writePref } from '../../core/prefs';
import { DaySection, type FeedView } from '../day-section/day-section';

const VIEW_KEY = 'kmu.view';

@Component({
  selector: 'app-home',
  imports: [DaySection, LucideSearch, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private readonly http = inject(HttpClient);

  protected readonly q = signal('');
  protected readonly tag = signal<string | null>(null);
  protected readonly view = signal<FeedView>(readPref(VIEW_KEY) === 'compact' ? 'compact' : 'edition');
  private readonly debouncedQ = toSignal(toObservable(this.q).pipe(debounceTime(300), distinctUntilChanged()), { initialValue: '' });

  protected readonly feed = httpResource<FeedResponse>(() => feedUrl({ days: 7, tag: this.tag(), q: this.debouncedQ() }));
  protected readonly tags = httpResource<TagCount[]>(() => tagsUrl(), { defaultValue: [] });

  private readonly older = signal<DayGroup[]>([]);
  private readonly olderNext = signal<string | undefined | null>(null);
  protected readonly loadingOlder = signal(false);
  protected readonly olderError = signal(false);

  protected readonly days = computed(() => [...(this.feed.value()?.days ?? []), ...this.older()]);
  protected readonly nextBefore = computed(() => {
    const extra = this.olderNext();
    return extra === null ? this.feed.value()?.nextBefore : extra;
  });
  protected readonly topTags = computed(() => this.tags.value().slice(0, 12));
  protected readonly filtered = computed(() => !!this.tag() || !!this.debouncedQ().trim());

  constructor() {
    // A new first page (filters changed) discards pages loaded with the old filters.
    effect(() => {
      this.feed.value();
      untracked(() => {
        this.older.set([]);
        this.olderNext.set(null);
      });
    });
  }

  protected setView(view: FeedView): void {
    this.view.set(view);
    writePref(VIEW_KEY, view);
  }

  protected toggleTag(tag: string | null): void {
    this.tag.set(this.tag() === tag ? null : tag);
  }

  protected clearFilters(): void {
    this.q.set('');
    this.tag.set(null);
  }

  protected loadOlder(): void {
    const before = this.nextBefore();
    if (!before || this.loadingOlder()) return;
    this.loadingOlder.set(true);
    this.olderError.set(false);
    this.http.get<FeedResponse>(feedUrl({ days: 7, before, tag: this.tag(), q: this.debouncedQ() })).subscribe({
      next: (res) => {
        this.older.update((d) => [...d, ...res.days]);
        this.olderNext.set(res.nextBefore);
        this.loadingOlder.set(false);
      },
      error: () => {
        this.olderError.set(true);
        this.loadingOlder.set(false);
      },
    });
  }
}
