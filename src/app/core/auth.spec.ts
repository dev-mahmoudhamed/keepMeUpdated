import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, authGuard, githubErrorInterceptor } from './auth';
import { RepoClient, TokenError, TokenStore } from './github';

function setup() {
  sessionStorage.clear();
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      provideHttpClient(withInterceptors([githubErrorInterceptor])),
      provideHttpClientTesting(),
    ],
  });
}

describe('authGuard', () => {
  const runGuard = (url: string) =>
    TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)) as Promise<boolean | UrlTree>;

  beforeEach(setup);

  it('sends signed-out visitors to the login page with a return url', async () => {
    vi.spyOn(TestBed.inject(AuthService), 'check').mockResolvedValue(false);
    const result = await runGuard('/admin/sources');
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/admin/login?next=%2Fadmin%2Fsources');
  });

  it('lets signed-in admins through', async () => {
    vi.spyOn(TestBed.inject(AuthService), 'check').mockResolvedValue(true);
    expect(await runGuard('/admin')).toBe(true);
  });
});

describe('AuthService', () => {
  beforeEach(setup);

  it('signs in with a token that can push', async () => {
    vi.spyOn(TestBed.inject(RepoClient), 'verifyToken').mockResolvedValue({ login: 'mahmoud' });
    const auth = TestBed.inject(AuthService);
    await auth.signIn('  tok  ', false);
    expect(auth.user()).toEqual({ login: 'mahmoud' });
    expect(TestBed.inject(TokenStore).get()).toBe('tok');
    expect(localStorage.getItem('kmu.gh.token')).toBeNull();
  });

  it('remembers the token only when asked', async () => {
    vi.spyOn(TestBed.inject(RepoClient), 'verifyToken').mockResolvedValue({ login: 'mahmoud' });
    await TestBed.inject(AuthService).signIn('tok', true);
    expect(localStorage.getItem('kmu.gh.token')).toBe('tok');
  });

  it('does not store a rejected token', async () => {
    vi.spyOn(TestBed.inject(RepoClient), 'verifyToken').mockRejectedValue(new TokenError('no-access'));
    await expect(TestBed.inject(AuthService).signIn('tok', true)).rejects.toEqual(new TokenError('no-access'));
    expect(TestBed.inject(TokenStore).get()).toBeNull();
  });

  it('checks a stored token once and forgets a revoked one', async () => {
    TestBed.inject(TokenStore).set('old', true);
    const verify = vi.spyOn(TestBed.inject(RepoClient), 'verifyToken').mockRejectedValue(new TokenError('invalid'));
    const auth = TestBed.inject(AuthService);
    expect(await auth.check()).toBe(false);
    expect(await auth.check()).toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(TokenStore).get()).toBeNull();
  });

  it('drops the token and redirects on 401', async () => {
    TestBed.inject(TokenStore).set('tok', false);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/admin/sources');
    const call = firstValueFrom(TestBed.inject(HttpClient).get('https://api.github.com/repos/me/kmu/git/ref/heads/main'));
    TestBed.inject(HttpTestingController)
      .expectOne('https://api.github.com/repos/me/kmu/git/ref/heads/main')
      .flush({ message: 'Bad credentials' }, { status: 401, statusText: 'Unauthorized' });
    await expect(call).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r));
    expect(TestBed.inject(TokenStore).get()).toBeNull();
    expect(router.url).toBe('/admin/login?expired=1&next=%2Fadmin%2Fsources');
  });
});
