import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { readPref, writePref } from './prefs';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'kmu.theme';
const ORDER: ThemeMode[] = ['system', 'light', 'dark'];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly _mode = signal<ThemeMode>(this.saved());
  readonly mode = this._mode.asReadonly();

  constructor() {
    this.apply(this._mode());
  }

  cycle(): void {
    const next = ORDER[(ORDER.indexOf(this._mode()) + 1) % ORDER.length];
    this._mode.set(next);
    writePref(KEY, next);
    this.apply(next);
  }

  private saved(): ThemeMode {
    const v = readPref(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  }

  private apply(mode: ThemeMode): void {
    const root = this.doc.documentElement;
    if (mode === 'system') delete root.dataset['theme'];
    else root.dataset['theme'] = mode;
  }
}
