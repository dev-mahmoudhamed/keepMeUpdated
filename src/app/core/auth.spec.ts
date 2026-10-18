import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, SignInError, adminSessionInterceptor, authGuard } from './auth';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      provideHttpClient(withInterceptors([adminSessionInterceptor])),
      provideHttpClientTesting(),
    ],
  });
}

const tick = () => new Promise((r) => setTimeout(r));

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
  let http: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    setup();
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => http.verify());

  it('asks the server once whether there is a session', async () => {
    const first = auth.check();
    http.expectOne('/api/auth/session').flush({ email: 'admin@example.com' });
    expect(await first).toBe(true);
    expect(await auth.check()).toBe(true);
    expect(auth.user()).toEqual({ email: 'admin@example.com' });
  });

  it('is signed out when the server says so', async () => {
    const p = auth.check();
    http.expectOne('/api/auth/session').flush({ message: 'Signed out.' }, { status: 401, statusText: 'Unauthorized' });
    expect(await p).toBe(false);
    expect(auth.user()).toBeNull();
  });

  it('requests a code for the trimmed email', async () => {
    const p = auth.requestCode('  me@example.com ');
    const req = http.expectOne('/api/auth/code');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'me@example.com' });
    req.flush({ ok: true });
    await expect(p).resolves.toBeUndefined();
  });

  it('passes on why the server could not send a code', async () => {
    const p = auth.requestCode('me@example.com');
    http.expectOne('/api/auth/code').flush({ message: 'Email isn’t set up yet.' }, { status: 503, statusText: 'Unavailable' });
    await expect(p).rejects.toEqual(new SignInError('unavailable', 'Email isn’t set up yet.'));
  });

  it('signs in with a valid code', async () => {
    const p = auth.verifyCode('me@example.com', ' 123456 ', true);
    const req = http.expectOne('/api/auth/verify');
    expect(req.request.body).toEqual({ email: 'me@example.com', code: '123456', remember: true });
    req.flush({ email: 'me@example.com' });
    await p;
    expect(auth.user()).toEqual({ email: 'me@example.com' });
  });

  it('reports why a code was refused', async () => {
    const p = auth.verifyCode('me@example.com', '000000', false);
    http.expectOne('/api/auth/verify').flush({ reason: 'locked' }, { status: 400, statusText: 'Bad Request' });
    await expect(p).rejects.toEqual(new SignInError('locked'));
    expect(auth.user()).toBeUndefined();
  });

  it('signs out on the server too', async () => {
    const p = auth.signOut();
    expect(auth.user()).toBeNull();
    http.expectOne('/api/auth/sign-out').flush({ ok: true });
    await p;
  });

  it('goes back to sign-in when the admin API says the session ended', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/admin/sources');
    const call = firstValueFrom(TestBed.inject(HttpClient).get('/api/github/git/ref/heads/main'));
    http.expectOne('/api/github/git/ref/heads/main').flush({ message: 'Your session ended.' }, { status: 401, statusText: 'Unauthorized' });
    await expect(call).rejects.toBeTruthy();
    await tick();
    expect(auth.user()).toBeNull();
    expect(router.url).toBe('/admin/login?expired=1&next=%2Fadmin%2Fsources');
  });
});
