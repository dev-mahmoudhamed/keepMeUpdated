import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideKeyRound } from '@lucide/angular';
import { AuthService, SignInError, type SignInFailure } from '../../core/auth';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, LucideKeyRound, LucideArrowLeft],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  /** Query params (component input binding). */
  readonly next = input<string>();
  readonly expired = input<string>();

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected readonly step = signal<'email' | 'code'>('email');
  protected readonly emailForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
  });
  protected readonly codeForm = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\s*\d{6}\s*$/)] }),
    remember: new FormControl(false, { nonNullable: true }),
  });
  protected readonly busy = signal(false);
  protected readonly sentTo = signal('');
  private readonly failure = signal<{ reason: SignInFailure; detail?: string } | null>(null);
  private readonly submitted = signal(false);
  private readonly resent = signal(false);

  protected readonly error = computed(() => {
    const f = this.failure();
    switch (f?.reason) {
      case 'invalid':
        return 'That code isn’t right. Check the latest email and try again.';
      case 'expired':
        return 'This code expired or was already used. Send a new one.';
      case 'locked':
        return 'Too many wrong codes. Send a new one.';
      case 'unavailable':
        return f.detail ?? 'Couldn’t reach the server. Check your connection and try again.';
      default:
        return this.expired() && this.step() === 'email' ? 'Your session ended. Sign in again.' : '';
    }
  });
  protected readonly notice = computed(() => (this.resent() && !this.failure() ? 'A new code is on its way.' : ''));

  protected emailInvalid(): boolean {
    const c = this.emailForm.controls.email;
    return c.invalid && (c.touched || this.submitted());
  }

  protected codeInvalid(): boolean {
    const c = this.codeForm.controls.code;
    return c.invalid && (c.touched || this.submitted());
  }

  protected async sendCode(): Promise<void> {
    this.submitted.set(true);
    this.failure.set(null);
    if (this.emailForm.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      const { email } = this.emailForm.getRawValue();
      await this.auth.requestCode(email);
      this.sentTo.set(email.trim());
      this.submitted.set(false);
      this.codeForm.controls.code.reset();
      this.step.set('code');
      setTimeout(() => this.codeInput()?.nativeElement.focus());
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async resend(): Promise<void> {
    if (this.busy()) return;
    this.failure.set(null);
    this.resent.set(false);
    this.busy.set(true);
    try {
      await this.auth.requestCode(this.sentTo());
      this.resent.set(true);
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected changeEmail(): void {
    this.failure.set(null);
    this.resent.set(false);
    this.submitted.set(false);
    this.step.set('email');
  }

  protected async signIn(): Promise<void> {
    this.submitted.set(true);
    this.failure.set(null);
    this.resent.set(false);
    if (this.codeForm.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      const { code, remember } = this.codeForm.getRawValue();
      await this.auth.verifyCode(this.sentTo(), code, remember);
      const next = this.next();
      await this.router.navigateByUrl(next?.startsWith('/admin') && !next.startsWith('/admin/login') ? next : '/admin');
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  private fail(err: unknown): void {
    this.failure.set(err instanceof SignInError ? { reason: err.reason, detail: err.detail } : { reason: 'unavailable' });
  }
}
