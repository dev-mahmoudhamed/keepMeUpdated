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
      <a routerLink="/" class="wordmark" aria-label="keepMeUpdated, today's edition">keepMeUpdated</a>
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
      <div class="band" aria-hidden="true"></div>
    </header>
  `,
  styles: `
    .masthead {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: baseline;
      gap: var(--s-2) var(--s-5);
      padding-block: var(--s-6) var(--s-4);
    }
    /* Kufic letterforms: geometric, square-shouldered. */
    .wordmark {
      font-family: var(--font-mark);
      font-size: clamp(1.75rem, 1.3rem + 1.6vw, 2.25rem);
      font-weight: 700;
      letter-spacing: 0.01em;
      line-height: 1;
      color: var(--accent);
      text-decoration: none;
    }
    /* A frieze of eight-pointed stars on a hairline, like a tile border. */
    .band {
      grid-column: 1 / -1;
      position: relative;
      height: 16px;
      margin-top: var(--s-3);
    }
    .band::before {
      content: '';
      position: absolute;
      inset: 50% 0 auto;
      border-top: 1px solid var(--rule-strong);
    }
    .band::after {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--accent);
      opacity: 0.55;
      -webkit-mask: var(--star) 0 0 / 34px 16px repeat-x;
      mask: var(--star) 0 0 / 34px 16px repeat-x;
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
      .tagline {
        grid-column: 1 / -1;
        grid-row: 2;
      }
      .band {
        grid-row: 3;
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
