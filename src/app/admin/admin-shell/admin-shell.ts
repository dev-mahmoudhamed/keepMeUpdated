import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { LucideExternalLink, LucideFileText, LucideLogOut, LucideRefreshCw, LucideRss, LucideX } from '@lucide/angular';
import { AuthService } from '../../core/auth';
import { ToastService } from '../../core/toast';

@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideFileText, LucideRss, LucideRefreshCw, LucideExternalLink, LucideLogOut, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <aside class="side">
        <a routerLink="/admin" class="brand"><img class="logo-mark" src="favicon.svg" alt="" width="32" height="32" />keepMeUpdated<span>Admin</span></a>
        <nav aria-label="Admin">
          <a routerLink="/admin" class="nav" [class.on]="postsActive()" [attr.aria-current]="postsActive() ? 'page' : null">
            <svg lucideFileText [size]="18" aria-hidden="true"></svg>Posts
          </a>
          <a routerLink="/admin/sources" routerLinkActive="on" class="nav">
            <svg lucideRss [size]="18" aria-hidden="true"></svg>Sources
          </a>
          <a routerLink="/admin/runs" routerLinkActive="on" class="nav">
            <svg lucideRefreshCw [size]="18" aria-hidden="true"></svg>Gather runs
          </a>
        </nav>
        <div class="side-end">
          <a routerLink="/" target="_blank" rel="noopener" class="nav">
            <svg lucideExternalLink [size]="18" aria-hidden="true"></svg>View site
            <span class="visually-hidden">(opens in a new tab)</span>
          </a>
          <button type="button" class="nav" (click)="signOut()">
            <svg lucideLogOut [size]="18" aria-hidden="true"></svg>Sign out
          </button>
        </div>
      </aside>
      <main class="main" id="main">
        <router-outlet />
      </main>
    </div>

    <div class="toasts" role="status" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class.toast--error]="t.tone === 'error'">
          <span>{{ t.text }}</span>
          <button type="button" (click)="toast.dismiss(t.id)" aria-label="Dismiss">
            <svg lucideX [size]="16" aria-hidden="true"></svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      --admin-side: 232px;
      display: block;
      font-size: 0.9375rem;
    }
    .shell {
      display: grid;
      grid-template-columns: var(--admin-side) minmax(0, 1fr);
      min-height: 100dvh;
    }
    .side {
      position: sticky;
      top: 0;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      gap: var(--s-5);
      padding: var(--s-5) var(--s-4);
      border-right: 1px solid var(--rule);
      background: var(--paper-raised);
    }
    .brand {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      column-gap: 10px;
      align-items: center;
      font-family: var(--font-mono);
      font-weight: 700;
      font-size: 1.25rem;
      letter-spacing: -0.03em;
      line-height: 1.1;
      text-decoration: none;
      padding-inline: var(--s-3);
    }
    .brand img {
      grid-row: span 2;
    }
    .brand span {
      grid-column: 2;
      font-family: var(--font-body);
      font-size: 0.8125rem;
      font-weight: 500;
      letter-spacing: 0;
      color: var(--ink-muted);
    }
    nav,
    .side-end {
      display: grid;
      gap: 2px;
    }
    .side-end {
      margin-top: auto;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      min-height: 40px;
      padding: 0 var(--s-3);
      border: 0;
      border-radius: var(--radius);
      background: transparent;
      color: var(--ink-soft);
      text-decoration: none;
      text-align: left;
      font-weight: 500;
      transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
    }
    .nav:hover {
      background: var(--paper);
      color: var(--ink);
    }
    .nav.on {
      background: var(--accent-wash);
      color: var(--accent);
    }
    .main {
      padding: var(--s-6) clamp(16px, 4vw, 48px) var(--s-8);
      min-width: 0;
    }
    .toasts {
      position: fixed;
      left: var(--s-5);
      right: var(--s-5);
      bottom: var(--s-5);
      display: grid;
      justify-items: end;
      pointer-events: none;
      gap: var(--s-2);
      z-index: 50;
    }
    .toast {
      max-width: 32rem;
      overflow-wrap: anywhere;
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: var(--s-3);
      padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4);
      border-radius: var(--radius);
      background: var(--ink);
      color: var(--paper);
      box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
    }
    .toast--error {
      background: var(--danger);
      color: var(--paper);
    }
    .toast button {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: var(--radius);
      background: transparent;
      color: inherit;
    }
    @media (max-width: 768px) {
      .shell {
        grid-template-columns: minmax(0, 1fr);
      }
      .side {
        position: static;
        height: auto;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--s-2);
        padding: var(--s-3) var(--s-4);
        border-right: 0;
        border-bottom: 1px solid var(--rule);
      }
      .brand {
        width: 100%;
      }
      nav,
      .side-end {
        display: flex;
        flex-wrap: wrap;
        margin: 0;
      }
      .main {
        padding-top: var(--s-5);
      }
    }
  `,
})
export class AdminShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly toast = inject(ToastService);
  /** Posts covers the list and the editor (/admin, /admin/posts/...). */
  protected readonly postsActive = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => /^\/admin(\/posts(\/|$)|\/?(\?|$))/.test(this.router.url)),
    ),
    { initialValue: false },
  );

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/admin/login');
  }
}
