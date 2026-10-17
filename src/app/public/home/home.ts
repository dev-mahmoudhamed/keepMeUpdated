import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { LucideSearch, LucideX } from '@lucide/angular';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { groupSummaries, summaryTagCounts } from '../../../../shared/feed';
import type { FeedIndex } from '../../../../shared/models';
import { dataUrl } from '../../core/api';
import { readPref, writePref } from '../../core/prefs';
import { DaySection, type FeedView } from '../day-section/day-section';

const VIEW_KEY = 'kmu.view';
const PAGE_DAYS = 7;

@Component({
  selector: 'app-home',
  imports: [DaySection, LucideSearch, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  protected readonly q = signal('');
  protected readonly tag = signal<string | null>(null);
  // 'compact' is the old name for List.
  protected readonly view = signal<FeedView>(['list', 'compact'].includes(readPref(VIEW_KEY) ?? '') ? 'list' : 'cards');
  private readonly debouncedQ = toSignal(toObservable(this.q).pipe(debounceTime(300), distinctUntilChanged()), { initialValue: '' });

  /** Every published post of the last 30 days, as one static file. */
  protected readonly index = httpResource<FeedIndex>(() => dataUrl('posts.json'));
  private readonly posts = computed(() => (this.index.hasValue() ? this.index.value().posts : []));
  private readonly daysShown = signal(PAGE_DAYS);

  private readonly feed = computed(() =>
    groupSummaries(this.posts(), { days: this.daysShown(), tag: this.tag() ?? undefined, q: this.debouncedQ() }),
  );
  protected readonly days = computed(() => this.feed().days);
  protected readonly hasOlder = computed(() => !!this.feed().nextBefore);
  protected readonly topTags = computed(() => summaryTagCounts(this.posts()).slice(0, 12));
  protected readonly filtered = computed(() => !!this.tag() || !!this.debouncedQ().trim());

  constructor() {
    // New filters start again from the newest week.
    effect(() => {
      this.tag();
      this.debouncedQ();
      untracked(() => this.daysShown.set(PAGE_DAYS));
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
    this.daysShown.update((d) => d + PAGE_DAYS);
  }
}
