import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Masthead } from './masthead/masthead';

@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, Masthead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip" href="#main" (click)="$event.preventDefault(); main.focus()">Skip to content</a>
    <app-masthead />
    <main id="main" tabindex="-1" #main>
      <router-outlet />
    </main>
    <footer class="foot wrap">
      <p>Summaries are written by AI from the linked sources. Read the originals before acting on them.</p>
      <a routerLink="/admin">Admin</a>
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
    }
    main {
      flex: 1;
      outline: none;
    }
    .skip {
      position: absolute;
      left: var(--s-4);
      top: -60px;
      padding: var(--s-2) var(--s-4);
      background: var(--accent);
      color: var(--on-accent);
      border-radius: var(--radius);
      z-index: 10;
    }
    .skip:focus {
      top: var(--s-4);
    }
    .foot {
      display: flex;
      justify-content: space-between;
      gap: var(--s-4);
      flex-wrap: wrap;
      padding-block: var(--s-7) var(--s-6);
      color: var(--ink-muted);
      font-size: var(--step--1);
    }
  `,
})
export class PublicLayout {}
