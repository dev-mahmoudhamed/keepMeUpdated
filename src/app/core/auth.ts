import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { AdminApi } from './api';

export interface AdminUser {
  email: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AdminApi);
  /** undefined = not checked yet, null = signed out. */
  private readonly _user = signal<AdminUser | null | undefined>(undefined);
  readonly user = this._user.asReadonly();

  async check(): Promise<boolean> {
    if (this._user() !== undefined) return !!this._user();
    try {
      this._user.set(await firstValueFrom(this.api.me()));
    } catch {
      this._user.set(null);
    }
    return !!this._user();
  }

  async login(email: string, password: string): Promise<void> {
    await firstValueFrom(this.api.login(email, password));
    this._user.set(await firstValueFrom(this.api.me()));
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      this._user.set(null);
    }
  }

  /** Called when the server says the session is gone. */
  signedOut(): void {
    this._user.set(null);
  }
}

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.check()) return true;
  return router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
};

/** Sends cookies with API calls and bounces to the login page when an admin call gets a 401. */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req.clone({ withCredentials: true })).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && req.url.startsWith('/api/admin/')) {
        auth.signedOut();
        void router.navigate(['/admin/login'], { queryParams: { next: router.url } });
      }
      return throwError(() => err);
    }),
  );
};
