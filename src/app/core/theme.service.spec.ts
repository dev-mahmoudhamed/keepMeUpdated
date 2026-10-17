import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  it('starts light, whatever the system prefers', () => {
    const theme = TestBed.inject(ThemeService);
    expect(theme.mode()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('toggles between light and dark and remembers the choice', () => {
    const theme = TestBed.inject(ThemeService);
    theme.toggle();
    expect(theme.mode()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('kmu.theme')).toBe('dark');

    theme.toggle();
    expect(theme.mode()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem('kmu.theme')).toBe('light');
  });

  it('restores a saved dark choice', () => {
    localStorage.setItem('kmu.theme', 'dark');
    expect(TestBed.inject(ThemeService).mode()).toBe('dark');
  });

  it('treats the old "system" setting as light', () => {
    localStorage.setItem('kmu.theme', 'system');
    expect(TestBed.inject(ThemeService).mode()).toBe('light');
  });
});
