import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth';
import { TokenError } from '../../core/github';
import { Login } from './login';

describe('Login', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: '**', children: [] }])],
    });
  });

  async function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(Login);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('data/site.json')
      .flush({ repo: 'me/kmu', branch: 'main', gatherWorkflow: 'gather.yml', schedule: '0 3 * * *' });
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const submit = async (token: string) => {
      const input = el.querySelector('#token') as HTMLInputElement;
      input.value = token;
      input.dispatchEvent(new Event('input'));
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, submit };
  }

  it('lays out the form in its own panel, not a story card', async () => {
    const { el } = await render();
    expect(el.querySelector('.login-panel')).not.toBeNull();
    expect(el.querySelector('.card')).toBeNull();
    expect(el.querySelector('label[for="token"]')?.textContent).toContain('GitHub access token');
  });

  it('shows why a token was rejected', async () => {
    vi.spyOn(TestBed.inject(AuthService), 'signIn').mockRejectedValue(new TokenError('no-access'));
    const { el, submit } = await render();
    await submit('ghp_x');
    expect(el.querySelector('[role="alert"]')?.textContent).toMatch(/This token can.t edit me\/kmu/);
  });

  it('asks for a token before calling GitHub', async () => {
    const signIn = vi.spyOn(TestBed.inject(AuthService), 'signIn');
    const { el, submit } = await render();
    await submit('   ');
    expect(signIn).not.toHaveBeenCalled();
    expect(el.querySelector('#token-error')?.textContent).toContain('Paste your token');
  });

  it('signs in and goes to the page the admin asked for', async () => {
    const signIn = vi.spyOn(TestBed.inject(AuthService), 'signIn').mockResolvedValue();
    const { el, submit } = await render({ next: '/admin/sources' });
    (el.querySelector('#remember') as HTMLInputElement).click();
    await submit('github_pat_abc');
    expect(signIn).toHaveBeenCalledWith('github_pat_abc', true);
    expect(TestBed.inject(Router).url).toBe('/admin/sources');
  });

  it('explains an expired session', async () => {
    const { el } = await render({ expired: '1' });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Your token expired or was revoked');
  });
});
