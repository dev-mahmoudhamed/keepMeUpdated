import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideExternalLink, LucideKeyRound } from '@lucide/angular';
import { AuthService } from '../../core/auth';
import { RepoClient, TokenError } from '../../core/github';

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, LucideKeyRound, LucideExternalLink],
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
  private readonly repo = inject(RepoClient);

  protected readonly newTokenUrl = NEW_TOKEN_URL;
  protected readonly repoName = signal('this site’s repository');
  protected readonly form = new FormGroup({
    token: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] }),
    remember: new FormControl(false, { nonNullable: true }),
  });
  protected readonly busy = signal(false);
  private readonly failure = signal<TokenError['reason'] | null>(null);
  private readonly submitted = signal(false);

  protected readonly error = computed(() => {
    switch (this.failure()) {
      case 'invalid':
        return 'GitHub didn’t accept this token. Check it was copied in full.';
      case 'no-access':
        return `This token can’t edit ${this.repoName()}. Give it Contents and Actions read and write access to this repository.`;
      case 'network':
        return 'Couldn’t reach GitHub. Check your connection and try again.';
      default:
        return this.expired() ? 'Your token expired or was revoked. Sign in with a new one.' : '';
    }
  });

  constructor() {
    this.repo
      .config()
      .then((c) => this.repoName.set(c.repo))
      .catch(() => undefined);
  }

  protected tokenMissing(): boolean {
    const c = this.form.controls.token;
    return c.invalid && (c.touched || this.submitted());
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.failure.set(null);
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      const { token, remember } = this.form.getRawValue();
      await this.auth.signIn(token, remember);
      const next = this.next();
      await this.router.navigateByUrl(next?.startsWith('/admin') && !next.startsWith('/admin/login') ? next : '/admin');
    } catch (err) {
      this.failure.set(err instanceof TokenError ? err.reason : 'network');
    } finally {
      this.busy.set(false);
    }
  }
}
