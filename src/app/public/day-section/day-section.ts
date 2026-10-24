import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DayGroup, PostSummary } from '../../../../shared/models';
import { formatDay, isNewSince } from '../feed-utils';
import { PostRow } from '../post-row/post-row';

export type FeedView = 'cards' | 'list';

@Component({
  selector: 'app-day-section',
  imports: [PostRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="day" [attr.aria-labelledby]="headingId()">
      <header class="day-head">
        <h2 [id]="headingId()">{{ title() }}</h2>
        <p class="count mono">
          {{ day().posts.length }} {{ day().posts.length === 1 ? 'update' : 'updates' }}
          @if (newCount()) {
            <span class="new">{{ newCount() }} new</span>
          }
        </p>
      </header>

      @if (view() === 'cards') {
        <ul class="grid" role="list">
          @for (post of day().posts; track post.id) {
            <li><app-post-row [post]="post" [isNew]="isNew(post)" /></li>
          }
        </ul>
      } @else {
        <ul class="rows card" role="list">
          @for (post of day().posts; track post.id) {
            <li><app-post-row [post]="post" [compact]="true" [isNew]="isNew(post)" /></li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .day {
      padding-block: var(--s-6) var(--s-5);
    }
    .day-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--s-4);
      padding-bottom: var(--s-3);
      margin-bottom: var(--s-5);
      border-bottom: 2px solid var(--ink);
    }
    h2 {
      font-size: var(--step-3);
      font-variation-settings: 'opsz' 60;
    }
    .count {
      display: inline-flex;
      flex: none;
      gap: var(--s-3);
      color: var(--ink-muted);
      white-space: nowrap;
    }
    .new {
      color: var(--accent);
      font-weight: 700;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      grid-auto-rows: 1fr;
      gap: var(--s-5);
    }
    .rows {
      overflow: hidden;
    }
    .rows:hover {
      box-shadow: var(--shadow-card);
      border-color: var(--rule);
    }
    .rows > li + li {
      border-top: 1px solid var(--rule);
    }
    @media (max-width: 960px) {
      .grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 640px) {
      .grid {
        grid-template-columns: minmax(0, 1fr);
        grid-auto-rows: auto;
        gap: var(--s-4);
      }
    }
  `,
})
export class DaySection {
  readonly day = input.required<DayGroup>();
  readonly view = input<FeedView>('cards');
  /** The reader's previous visit; posts after it are marked New. */
  readonly since = input<string | null>(null);

  protected readonly title = computed(() => formatDay(this.day().date));
  protected readonly headingId = computed(() => `day-${this.day().date}`);
  protected readonly newCount = computed(() => this.day().posts.filter((p) => this.isNew(p)).length);

  protected isNew(post: PostSummary): boolean {
    return isNewSince(post, this.since());
  }
}
