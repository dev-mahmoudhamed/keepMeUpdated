import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { GITHUB_API, RepoClient, TokenError, TokenStore } from './github';

export interface AdminUser {
  login: string;
}

/** The admin is whoever holds a GitHub token that can push to this site's repository. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly repo = inject(RepoClient);
  private readonly tokens = inject(TokenStore);
  /** undefined = not checked yet, null = signed out. */
  private readonly _user = signal<AdminUser | null | undefined>(undefined);
  readonly user = this._user.asReadonly();

  async check(): Promise<boolean> {
    if (this._user() !== undefined) return !!this._user();
    const token = this.tokens.get();
    if (!token) {
      this._user.set(null);
      return false;
    }
    try {
      this._user.set(await this.repo.verifyToken(token));
      return true;
    } catch (err) {
      // A network blip shouldn't throw away a good token; a rejected one should.
      if (err instanceof TokenError && err.reason !== 'network') this.tokens.clear();
      this._user.set(null);
      return false;
    }
  }

  /** Verifies the token with GitHub before keeping it. Throws TokenError. */
  async signIn(token: string, remember: boolean): Promise<void> {
    const clean = token.trim();
    const user = await this.repo.verifyToken(clean);
    this.tokens.set(clean, remember);
    this._user.set(user);
  }

  signOut(): void {
    this.tokens.clear();
    this._user.set(null);
  }
}

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.check()) return true;
  return router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
};

/** A 401 from GitHub means the stored token expired or was revoked: sign out and ask for a new one. */
export const githubErrorInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(GITHUB_API)) return next(req);
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      const onLogin = router.url.startsWith('/admin/login');
      if (err instanceof HttpErrorResponse && err.status === 401 && !onLogin) {
        auth.signOut();
        void router.navigate(['/admin/login'], { queryParams: { expired: 1, next: router.url } });
      }
      return throwError(() => err);
    }),
  );
};
