import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { ADMIN_API } from './github';

export const AUTH_API = '/api/auth';

export interface AdminUser {
  email: string;
}

export type SignInFailure = 'invalid' | 'expired' | 'locked' | 'unavailable';

export class SignInError extends Error {
  constructor(
    readonly reason: SignInFailure,
    /** The server's explanation, when it gave one (e.g. sign-in isn't set up yet). */
    readonly detail?: string,
  ) {
    super(detail ?? reason);
    this.name = 'SignInError';
  }
}

function toSignInError(err: unknown): SignInError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { reason?: SignInFailure; message?: string } | null;
    if (err.status === 400 && body?.reason) return new SignInError(body.reason);
    return new SignInError('unavailable', body?.message);
  }
  return new SignInError('unavailable');
}

/** The admin is whoever can read the sign-in code mailed to ADMIN_EMAIL. The session lives in an HttpOnly cookie. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  /** undefined = not checked yet, null = signed out. */
  private readonly _user = signal<AdminUser | null | undefined>(undefined);
  readonly user = this._user.asReadonly();

  async check(): Promise<boolean> {
    if (this._user() !== undefined) return !!this._user();
    try {
      this._user.set(await firstValueFrom(this.http.get<AdminUser>(`${AUTH_API}/session`)));
      return true;
    } catch {
      this._user.set(null);
      return false;
    }
  }

  /** Asks the server to email a code. It answers the same way for any address, so this can't reveal the admin email. */
  async requestCode(email: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${AUTH_API}/code`, { email: email.trim() }));
    } catch (err) {
      throw toSignInError(err);
    }
  }

  /** Throws SignInError when the code is wrong, expired or used up. */
  async verifyCode(email: string, code: string, remember: boolean): Promise<void> {
    try {
      const user = await firstValueFrom(this.http.post<AdminUser>(`${AUTH_API}/verify`, { email: email.trim(), code: code.trim(), remember }));
      this._user.set(user);
    } catch (err) {
      throw toSignInError(err);
    }
  }

  async signOut(): Promise<void> {
    this._user.set(null);
    await firstValueFrom(this.http.post(`${AUTH_API}/sign-out`, {})).catch(() => undefined);
  }

  /** The server already ended the session (e.g. it expired): forget it here without another request. */
  forget(): void {
    this._user.set(null);
  }
}

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.check()) return true;
  return router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
};

/** A 401 from the admin API means the session ended: go back to the sign-in page. */
export const adminSessionInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(ADMIN_API)) return next(req);
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      const onLogin = router.url.startsWith('/admin/login');
      if (err instanceof HttpErrorResponse && err.status === 401 && !onLogin) {
        auth.forget();
        void router.navigate(['/admin/login'], { queryParams: { expired: 1, next: router.url } });
      }
      return throwError(() => err);
    }),
  );
};
