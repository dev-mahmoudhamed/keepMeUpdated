import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="nf wrap">
      <h1>This page isn't in any edition</h1>
      <p>The link may be old, or the story was removed.</p>
      <a routerLink="/" class="btn btn--primary">Today's edition</a>
    </div>
  `,
  styles: `
    .nf {
      display: grid;
      gap: var(--s-4);
      justify-items: start;
      padding-block: var(--s-8);
    }
    h1 {
      font-size: var(--step-4);
      max-width: 18ch;
    }
    p {
      color: var(--ink-soft);
    }
  `,
})
export class NotFound {}
