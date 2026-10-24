import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideMoon, LucideSun } from '@lucide/angular';
import { ThemeService } from '../../core/theme.service';

const NEXT_LABEL = { light: 'Switch to dark theme', dark: 'Switch to light theme' } as const;

@Component({
  selector: 'app-masthead',
  imports: [RouterLink, LucideSun, LucideMoon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="masthead wrap">
      <a routerLink="/" class="wordmark" aria-label="keepMeUpdated, today's edition">
        <img class="logo logo-mark" src="favicon.svg" alt="" width="32" height="32" />
        keepMeUpdated
      </a>
      <p class="tagline">Developer news that matters, gathered every morning.</p>
      <div class="end">
        <time class="today" [attr.datetime]="isoToday">{{ today }}</time>
        <button type="button" class="btn btn--ghost btn--icon" (click)="theme.toggle()" [attr.aria-label]="nextLabel()" [title]="nextLabel()">
          @if (theme.mode() === 'light') {
            <svg lucideMoon [size]="18" aria-hidden="true"></svg>
          } @else {
            <svg lucideSun [size]="18" aria-hidden="true"></svg>
          }
        </button>
      </div>
    </header>
  `,
  styles: `
    .masthead {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: baseline;
      gap: var(--s-2) var(--s-5);
      padding-block: var(--s-6) var(--s-5);
      border-bottom: 1px solid var(--rule);
    }
    /* Set in mono, like a package name. */
    .wordmark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-family: var(--font-mono);
      font-size: clamp(1.5rem, 1.15rem + 1.3vw, 1.875rem);
      font-weight: 600;
      letter-spacing: -0.04em;
      line-height: 1;
      text-decoration: none;
    }
    .logo {
      width: 1.2em;
      height: 1.2em;
    }
    .tagline {
      color: var(--ink-muted);
      font-size: var(--step--1);
    }
    .end {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      align-self: center;
    }
    .today {
      color: var(--ink-soft);
      font-size: var(--step--1);
      white-space: nowrap;
    }
    @media (max-width: 900px) {
      .masthead {
        grid-template-columns: 1fr auto;
        padding-block: var(--s-5) var(--s-4);
      }
      .logo {
      width: 1.2em;
      height: 1.2em;
    }
    .tagline {
        grid-column: 1 / -1;
        grid-row: 2;
      }
      .today {
        display: none;
      }
    }
  `,
})
export class Masthead {
  protected readonly theme = inject(ThemeService);
  protected readonly nextLabel = computed(() => NEXT_LABEL[this.theme.mode()]);
  private readonly now = new Date();
  protected readonly today = this.now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  protected readonly isoToday = this.now.toISOString().slice(0, 10);
}
