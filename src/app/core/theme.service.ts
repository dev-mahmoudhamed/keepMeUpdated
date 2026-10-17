import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { readPref, writePref } from './prefs';

export type ThemeMode = 'light' | 'dark';

const KEY = 'kmu.theme';

/** Light by default; dark only when the reader picks it. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly _mode = signal<ThemeMode>(readPref(KEY) === 'dark' ? 'dark' : 'light');
  readonly mode = this._mode.asReadonly();

  constructor() {
    this.apply(this._mode());
  }

  toggle(): void {
    const next: ThemeMode = this._mode() === 'light' ? 'dark' : 'light';
    this._mode.set(next);
    writePref(KEY, next);
    this.apply(next);
  }

  private apply(mode: ThemeMode): void {
    this.doc.documentElement.dataset['theme'] = mode;
  }
}
