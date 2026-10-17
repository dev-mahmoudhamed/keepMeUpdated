import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  it('starts in system mode with no data-theme', () => {
    const theme = TestBed.inject(ThemeService);
    expect(theme.mode()).toBe('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
  });

  it('cycles system -> light -> dark -> system and persists the choice', () => {
    const theme = TestBed.inject(ThemeService);
    theme.cycle();
    expect(theme.mode()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem('kmu.theme')).toBe('light');

    theme.cycle();
    expect(theme.mode()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');

    theme.cycle();
    expect(theme.mode()).toBe('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(localStorage.getItem('kmu.theme')).toBe('system');
  });

  it('restores a saved choice', () => {
    localStorage.setItem('kmu.theme', 'dark');
    const theme = TestBed.inject(ThemeService);
    expect(theme.mode()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});
