import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <a routerLink="/" class="brand">keepMeUpdated</a>
        <h1>Sign in to manage posts</h1>

        <div class="field">
          <label for="email">Email</label>
          <input id="email" class="input" type="email" formControlName="email" autocomplete="username" [attr.aria-invalid]="invalid('email')" aria-describedby="email-error" />
          @if (invalid('email')) {
            <p id="email-error" class="error-text">Enter your admin email.</p>
          }
        </div>

        <div class="field">
          <label for="password">Password</label>
          <input id="password" class="input" type="password" formControlName="password" autocomplete="current-password" [attr.aria-invalid]="invalid('password')" aria-describedby="password-error" />
          @if (invalid('password')) {
            <p id="password-error" class="error-text">Enter your password.</p>
          }
        </div>

        @if (error()) {
          <p class="error-text form-error" role="alert">{{ error() }}</p>
        }

        <button type="submit" class="btn btn--primary" [attr.aria-busy]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
      </form>
    </div>
  `,
  styles: `
    .page {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: var(--s-5) var(--s-4);
    }
    .card {
      width: min(100%, 380px);
      display: grid;
      gap: var(--s-4);
    }
    .brand {
      font-family: var(--font-head);
      font-size: 1.5rem;
      font-weight: 650;
      letter-spacing: -0.03em;
      text-decoration: none;
    }
    h1 {
      font-size: var(--step-2);
      margin-bottom: var(--s-2);
    }
    .form-error {
      font-size: 0.875rem;
    }
    button {
      margin-top: var(--s-2);
    }
  `,
})
export class Login {
  readonly next = input<string>();
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly submitted = signal(false);

  protected invalid(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set('');
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.login(email, password);
      const next = this.next();
      await this.router.navigateByUrl(next?.startsWith('/admin') ? next : '/admin');
    } catch (err) {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      this.error.set(
        status === 401
          ? 'Email or password is wrong.'
          : status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : "Couldn't reach the server. Check that it's running.",
      );
    } finally {
      this.busy.set(false);
    }
  }
}
