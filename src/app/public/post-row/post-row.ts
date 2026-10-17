import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideLayers } from '@lucide/angular';
import type { PostSummary } from '../../../../shared/models';
import { sourcesLabel, timeOf } from '../feed-utils';

@Component({
  selector: 'app-post-row',
  imports: [RouterLink, LucideLayers],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = post();
    <a [routerLink]="['/p', p.slug]" class="row" [class.card]="!compact()" [class.row--compact]="compact()">
      <time class="time mono" [attr.datetime]="p.publishedAt">{{ time(p.publishedAt) }}</time>
      <span class="title">{{ p.title }}</span>
      <span class="meta">
        @if (p.tags[0]; as tag) {
          <span class="tag">{{ tag }}</span>
        }
        <span class="count mono" [title]="sources(p.sourceCount)">
          <svg lucideLayers [size]="14" aria-hidden="true"></svg>
          <span class="visually-hidden">{{ sources(p.sourceCount) }}</span>
          <span aria-hidden="true">{{ p.sourceCount }}</span>
        </span>
      </span>
      @if (!compact() && p.tldr) {
        <span class="tldr">{{ p.tldr }}</span>
      }
    </a>
  `,
  styles: `
    .row {
      display: grid;
      grid-template-columns: 3.25rem 1fr;
      grid-template-areas:
        'time title'
        '. tldr'
        '. meta';
      column-gap: var(--s-3);
      row-gap: var(--s-1);
      padding: var(--s-4);
      text-decoration: none;
    }
    .row--compact {
      margin-inline: calc(var(--s-3) * -1);
      padding-inline: var(--s-3);
      border-radius: var(--radius);
      transition: background-color var(--dur) var(--ease);
    }
    .row--compact:hover {
      background: var(--paper);
    }
    .row:hover .title {
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 0.18em;
    }
    .time {
      grid-area: time;
      color: var(--ink-muted);
      padding-top: 0.2em;
    }
    .title {
      grid-area: title;
      font-family: var(--font-head);
      font-size: var(--step-1);
      font-weight: 600;
      line-height: 1.25;
      text-wrap: pretty;
    }
    .tldr {
      grid-area: tldr;
      color: var(--ink-soft);
      font-size: 0.9375rem;
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .meta {
      grid-area: meta;
      display: flex;
      align-items: center;
      gap: var(--s-3);
      margin-top: var(--s-1);
    }
    .count {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--ink-muted);
    }
    .row--compact {
      grid-template-columns: 3.25rem 1fr auto;
      grid-template-areas: 'time title meta';
      align-items: baseline;
      padding-block: var(--s-2);
    }
    .row--compact .title {
      font-size: var(--step-0);
      font-family: var(--font-body);
      font-weight: 500;
    }
    .row--compact .meta {
      margin: 0;
    }
    @media (max-width: 560px) {
      .row--compact {
        grid-template-columns: 3.25rem 1fr;
        grid-template-areas: 'time title' '. meta';
      }
    }
  `,
})
export class PostRow {
  readonly post = input.required<PostSummary>();
  readonly compact = input(false);
  protected readonly time = timeOf;
  protected readonly sources = sourcesLabel;
}
