import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideLayers, LucidePackage } from '@lucide/angular';
import type { PostSummary } from '../../../../shared/models';
import { sourcesLabel, tagTone, timeOf } from '../feed-utils';

/** One story: a card (Cards view) or a one-line row (List view). New stories carry a moss edge and "New". */
@Component({
  selector: 'app-post-row',
  imports: [RouterLink, LucideLayers, LucidePackage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = post();
    @if (compact()) {
      <a [routerLink]="['/p', p.slug]" class="row" [class.is-new]="isNew()">
        <time class="time mono" [attr.datetime]="p.publishedAt">{{ time(p.publishedAt) }}</time>
        <span class="main">
          <span class="title">{{ p.title }}</span>
          @if (p.tldr) {
            <span class="gist">{{ p.tldr }}</span>
          }
        </span>
        <span class="meta">
          <span class="slot">
            @if (isNew()) {
              <span class="new">New</span>
            }
          </span>
          <span class="slot">
            @if (release()) {
              <span class="kind" title="Release">
                <svg lucidePackage [size]="15" aria-hidden="true"></svg>
                <span class="visually-hidden">Release</span>
              </span>
            }
          </span>
          <span class="slot">
            @if (p.tags[0]; as tag) {
              <span class="tag" [attr.data-tone]="tone(tag)">{{ tag }}</span>
            }
          </span>
          <span class="count mono" [title]="sources(p.sourceCount)">
            <svg lucideLayers [size]="14" aria-hidden="true"></svg>
            <span class="visually-hidden">{{ sources(p.sourceCount) }}</span>
            <span aria-hidden="true">{{ p.sourceCount }}</span>
          </span>
        </span>
      </a>
    } @else {
      <article class="card story" [class.is-new]="isNew()">
        <header class="top">
          @if (p.tags[0]; as tag) {
            <span class="tag" [attr.data-tone]="tone(tag)">{{ tag }}</span>
          }
          <span class="when">
            @if (isNew()) {
              <span class="new">New</span>
            }
            <time class="mono" [attr.datetime]="p.publishedAt">{{ time(p.publishedAt) }}</time>
          </span>
        </header>
        <h3 class="title">
          <a class="stretched" [routerLink]="['/p', p.slug]">{{ p.title }}</a>
        </h3>
        <p class="tldr">{{ p.tldr }}</p>
        <footer class="foot">
          @if (release()) {
            <span class="kind">
              <svg lucidePackage [size]="15" aria-hidden="true"></svg>
              Release
            </span>
          }
          @if (p.aiPending) {
            <span class="pending">Summary pending</span>
          }
          <span class="count mono">
            <svg lucideLayers [size]="14" aria-hidden="true"></svg>
            {{ sources(p.sourceCount) }}
          </span>
        </footer>
      </article>
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .new {
      font-size: 0.8125rem;
    }
    .kind {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--ink-soft);
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .count {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--ink-muted);
    }

    /* Card: one fixed size. The title (3 lines) and TL;DR (4 lines) are clamped, so the longest still fits. */
    .story {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 20rem;
      padding: var(--s-5) var(--s-5) var(--s-4);
    }
    .story.is-new::before {
      content: '';
      position: absolute;
      left: -1px;
      top: var(--s-5);
      bottom: var(--s-5);
      width: 4px;
      border-radius: 0 4px 4px 0;
      background: var(--new-mark);
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
      min-height: 24px;
    }
    .top .tag {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .when {
      flex: none;
      display: inline-flex;
      align-items: baseline;
      gap: var(--s-2);
      margin-left: auto;
      color: var(--ink-muted);
    }
    .story .title {
      margin-top: var(--s-3);
      font-family: var(--font-title);
      font-size: 1.125rem;
      font-weight: 650;
      line-height: 1.3;
      letter-spacing: -0.01em;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .story .title a {
      text-decoration: none;
    }
    .story:hover .title a,
    .story .title a:focus-visible {
      text-decoration: underline;
      text-decoration-thickness: 2px;
      text-decoration-color: var(--accent);
      text-underline-offset: 0.16em;
    }
    .tldr {
      margin-top: var(--s-3);
      color: var(--ink-soft);
      font-size: 0.9375rem;
      line-height: 1.55;
      margin-bottom: var(--s-4);
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .foot {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      margin-top: auto;
      padding-top: var(--s-3);
      border-top: 1px solid var(--rule);
      min-height: 2.75rem;
    }
    .foot .count {
      margin-left: auto;
    }
    .pending {
      font-size: 0.8125rem;
      color: var(--ink-muted);
    }

    /* Row: time, title with a one-line gist, then the labels that help decide what to open. */
    .row {
      display: grid;
      grid-template-columns: 3.25rem minmax(0, 1fr) auto;
      align-items: baseline;
      column-gap: var(--s-3);
      padding: var(--s-3) var(--s-4);
      text-decoration: none;
      transition: background-color var(--dur) var(--ease);
    }
    .row:hover {
      background: var(--paper);
    }
    /* The list clips overflow, so the focus ring is drawn inside the row. */
    .row:focus-visible {
      outline-offset: -2px;
    }
    .row.is-new {
      box-shadow: inset 4px 0 0 var(--new-mark);
    }
    .time {
      color: var(--ink-muted);
    }
    .main {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .row .title {
      font-family: var(--font-title);
      font-weight: 600;
      line-height: 1.35;
      text-wrap: pretty;
    }
    .row:hover .title {
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 0.18em;
    }
    .gist {
      color: var(--ink-muted);
      font-size: 0.875rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Fixed columns, so New, Release, topic and sources line up from row to row. */
    .meta {
      display: grid;
      grid-template-columns: 2.25rem 1rem 8.5rem 2rem;
      align-items: center;
      justify-items: end;
      gap: var(--s-3);
    }
    .slot {
      display: inline-flex;
      max-width: 100%;
      min-width: 0;
    }
    .slot .tag {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (max-width: 640px) {
      .meta {
        display: flex;
      }
      .slot:empty {
        display: none;
      }
      .story {
        min-height: 0;
      }
      .row {
        grid-template-columns: 3.25rem minmax(0, 1fr);
        row-gap: var(--s-2);
      }
      .meta {
        grid-column: 2;
      }
    }
  `,
})
export class PostRow {
  readonly post = input.required<PostSummary>();
  readonly compact = input(false);
  readonly isNew = input(false);
  /** Posts that collect the updates of one version series ("Angular 22 updates") come from release feeds. */
  protected readonly release = computed(() => this.post().tags.includes('release'));
  protected readonly time = timeOf;
  protected readonly sources = sourcesLabel;
  protected readonly tone = tagTone;
}
