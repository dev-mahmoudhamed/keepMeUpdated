import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService, SignInError } from '../../core/auth';
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
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const fill = async (id: string, value: string) => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle();
    };
    return { fixture, el, fill, settle };
  }

  it('lays out the form in its own panel, not a story card', async () => {
    const { el } = await render();
    expect(el.querySelector('.login-panel')).not.toBeNull();
    expect(el.querySelector('.card')).toBeNull();
    expect(el.querySelector('label[for="email"]')?.textContent).toContain('Email address');
  });

  it('asks for a valid email before sending a code', async () => {
    const requestCode = vi.spyOn(TestBed.inject(AuthService), 'requestCode');
    const { el, fill } = await render();
    await fill('email', 'not-an-email');
    expect(requestCode).not.toHaveBeenCalled();
    expect(el.querySelector('#email-error')?.textContent).toContain('valid email');
  });

  it('sends a code, then asks for it', async () => {
    const requestCode = vi.spyOn(TestBed.inject(AuthService), 'requestCode').mockResolvedValue();
    const { el, fill } = await render();
    await fill('email', 'me@example.com');
    expect(requestCode).toHaveBeenCalledWith('me@example.com');
    expect(el.querySelector('h1')?.textContent).toContain('Check your email');
    expect(el.querySelector('.intro')?.textContent).toContain('me@example.com');
    expect(el.querySelector('#code')).not.toBeNull();
  });

  it('shows why a code could not be sent', async () => {
    vi.spyOn(TestBed.inject(AuthService), 'requestCode').mockRejectedValue(new SignInError('unavailable', 'Email isn’t set up yet.'));
    const { el, fill } = await render();
    await fill('email', 'me@example.com');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Email isn’t set up yet.');
    expect(el.querySelector('#code')).toBeNull();
  });

  it('signs in with the code and goes to the page the admin asked for', async () => {
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'requestCode').mockResolvedValue();
    const verify = vi.spyOn(auth, 'verifyCode').mockResolvedValue();
    const { el, fill } = await render({ next: '/admin/sources' });
    await fill('email', 'me@example.com');
    (el.querySelector('#remember') as HTMLInputElement).click();
    await fill('code', '123456');
    expect(verify).toHaveBeenCalledWith('me@example.com', '123456', true);
    expect(TestBed.inject(Router).url).toBe('/admin/sources');
  });

  it('wants 6 digits before checking', async () => {
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'requestCode').mockResolvedValue();
    const verify = vi.spyOn(auth, 'verifyCode');
    const { el, fill } = await render();
    await fill('email', 'me@example.com');
    await fill('code', '12ab');
    expect(verify).not.toHaveBeenCalled();
    expect(el.querySelector('#code-error')?.textContent).toContain('6 digits');
  });

  it('explains a wrong code', async () => {
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'requestCode').mockResolvedValue();
    vi.spyOn(auth, 'verifyCode').mockRejectedValue(new SignInError('invalid'));
    const { el, fill } = await render();
    await fill('email', 'me@example.com');
    await fill('code', '000000');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('That code isn’t right');
  });

  it('can send a new code and go back to the email step', async () => {
    const requestCode = vi.spyOn(TestBed.inject(AuthService), 'requestCode').mockResolvedValue();
    const { el, fill, settle } = await render();
    await fill('email', 'me@example.com');
    const [back, resend] = Array.from(el.querySelectorAll<HTMLButtonElement>('.links button'));
    resend.click();
    await settle();
    expect(requestCode).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[role="status"]')?.textContent).toContain('A new code is on its way');
    back.click();
    await settle();
    expect(el.querySelector('#email')).not.toBeNull();
  });

  it('explains an ended session', async () => {
    const { el } = await render({ expired: '1' });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Your session ended');
  });
});
