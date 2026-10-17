import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideLayers } from '@lucide/angular';
import type { DayGroup } from '../../../../shared/models';
import { formatDay, pickLead, sourcesLabel, timeOf } from '../feed-utils';
import { PostRow } from '../post-row/post-row';

export type FeedView = 'cards' | 'list';

@Component({
  selector: 'app-day-section',
  imports: [RouterLink, PostRow, LucideLayers],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="day" [attr.aria-labelledby]="headingId()">
      <header class="day-head">
        <h2 [id]="headingId()">{{ title() }}</h2>
        <p class="count mono">{{ day().posts.length }} {{ day().posts.length === 1 ? 'update' : 'updates' }}</p>
      </header>

      @if (view() === 'cards') {
        <div class="edition" [class.edition--solo]="!split().rest.length">
          @if (split().lead; as lead) {
            <article class="lead card">
              <h3>
                <a class="stretched" [routerLink]="['/p', lead.slug]">{{ lead.title }}</a>
              </h3>
              @if (lead.tldr) {
                <p class="lead-tldr"><span class="marker">{{ lead.tldr }}</span></p>
              }
              <div class="lead-meta">
                @for (tag of lead.tags.slice(0, 3); track tag) {
                  <span class="tag">{{ tag }}</span>
                }
                <span class="mono muted">
                  <svg lucideLayers [size]="14" aria-hidden="true"></svg>
                  {{ sources(lead.sourceCount) }}
                </span>
                <time class="mono muted" [attr.datetime]="lead.publishedAt">{{ time(lead.publishedAt) }}</time>
                @if (lead.aiPending) {
                  <span class="pending">Summary pending</span>
                }
              </div>
            </article>
          }
          @if (split().rest.length) {
            <ul class="rows rows--cards" role="list">
              @for (post of split().rest; track post.id) {
                <li><app-post-row [post]="post" /></li>
              }
            </ul>
          }
        </div>
      } @else {
        <ul class="rows rows--compact card" role="list">
          @for (post of day().posts; track post.id) {
            <li><app-post-row [post]="post" [compact]="true" /></li>
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
      margin-bottom: var(--s-4);
      border-bottom: 2px solid var(--ink);
    }
    h2 {
      font-size: var(--step-3);
      font-variation-settings: 'opsz' 60;
    }
    .count,
    .muted {
      color: var(--ink-muted);
    }
    .edition {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      gap: var(--s-7);
      align-items: start;
    }
    .edition--solo {
      grid-template-columns: minmax(0, 1fr);
    }
    .edition--solo .lead {
      max-width: var(--measure);
    }
    .lead {
      padding: var(--s-6);
    }
    .lead h3 {
      font-size: var(--step-4);
      font-weight: 650;
      font-variation-settings: 'opsz' 72;
      letter-spacing: -0.025em;
      line-height: 1.05;
    }
    .lead h3 a {
      text-decoration: none;
    }
    .lead h3 a:hover {
      text-decoration: underline;
      text-decoration-thickness: 2px;
      text-decoration-color: var(--accent);
    }
    .lead-tldr {
      margin-top: var(--s-4);
      font-size: var(--step-read);
      line-height: 1.6;
      max-width: 60ch;
    }
    .lead-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s-2) var(--s-4);
      margin-top: var(--s-5);
    }
    .lead-meta .mono {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pending {
      font-size: 0.8125rem;
      color: var(--ink-soft);
      border: 1px dashed var(--rule);
      padding: 2px 8px;
      border-radius: 999px;
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .rows--cards {
      display: grid;
      gap: var(--s-3);
    }
    .rows--compact {
      padding: var(--s-1) var(--s-4);
    }
    .rows--compact > li + li {
      border-top: 1px solid var(--rule);
    }
    @media (max-width: 960px) {
      .edition {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--s-3);
      }
    }
    @media (max-width: 560px) {
      .lead {
        padding: var(--s-5) var(--s-4);
      }
    }
  `,
})
export class DaySection {
  readonly day = input.required<DayGroup>();
  readonly view = input<FeedView>('cards');

  protected readonly split = computed(() => pickLead(this.day().posts));
  protected readonly title = computed(() => formatDay(this.day().date));
  protected readonly headingId = computed(() => `day-${this.day().date}`);
  protected readonly time = timeOf;
  protected readonly sources = sourcesLabel;
}
