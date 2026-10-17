import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { AuthService, authGuard } from './auth';

describe('authGuard', () => {
  const runGuard = (url: string) =>
    TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)) as Promise<boolean | UrlTree>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  });

  it('sends signed-out visitors to the login page with a return url', async () => {
    vi.spyOn(TestBed.inject(AuthService), 'check').mockResolvedValue(false);
    const result = await runGuard('/admin/sources');
    expect(result instanceof UrlTree).toBe(true);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/admin/login?next=%2Fadmin%2Fsources');
  });

  it('lets signed-in admins through', async () => {
    vi.spyOn(TestBed.inject(AuthService), 'check').mockResolvedValue(true);
    expect(await runGuard('/admin')).toBe(true);
  });
});

describe('AuthService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  });

  it('asks the server once and remembers the answer', async () => {
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);
    const first = auth.check();
    http.expectOne('/api/auth/me').flush({ email: 'a@b.c' });
    expect(await first).toBe(true);
    expect(await auth.check()).toBe(true);
    http.verify();
    expect(auth.user()).toEqual({ email: 'a@b.c' });
  });

  it('treats a 401 as signed out', async () => {
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);
    const result = auth.check();
    http.expectOne('/api/auth/me').flush({ error: 'Sign in required' }, { status: 401, statusText: 'Unauthorized' });
    expect(await result).toBe(false);
    expect(auth.user()).toBeNull();
  });
});
