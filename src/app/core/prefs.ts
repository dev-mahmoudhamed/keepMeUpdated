/** localStorage helpers that never throw (private mode, blocked storage). */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference just won't persist.
  }
}

const LAST_VISIT = 'kmu.lastVisit';
const VISIT_SINCE = 'kmu.newSince';

/**
 * When the reader was last here, so posts since then can be marked New. It stays the same for the whole tab
 * session (reloading keeps the marks); the next session compares with this one. Null on a first visit.
 */
export function previousVisit(now = new Date()): string | null {
  let since: string | null = null;
  try {
    since = sessionStorage.getItem(VISIT_SINCE);
  } catch {
    // No session storage: compare with the last visit every time.
  }
  if (since === null) {
    since = readPref(LAST_VISIT) ?? '';
    try {
      sessionStorage.setItem(VISIT_SINCE, since);
    } catch {
      // As above.
    }
  }
  writePref(LAST_VISIT, now.toISOString());
  return since || null;
}
