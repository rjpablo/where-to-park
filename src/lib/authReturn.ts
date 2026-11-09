const KEY = 'wtp-auth-next';

/**
 * An in-app path to open after sign-in. Anything else is dropped so a query
 * param cannot send the user off the app.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://') || path.includes('\\'))
    return null;
  return path;
}

export function rememberAuthNext(next: string | null): void {
  if (typeof sessionStorage === 'undefined') return;
  if (next) sessionStorage.setItem(KEY, next);
  else sessionStorage.removeItem(KEY);
}

export function peekAuthNext(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return safeNext(sessionStorage.getItem(KEY));
}

/** Reads and clears the path stored for the Google redirect, which leaves the app. */
export function takeAuthNext(): string | null {
  const next = peekAuthNext();
  rememberAuthNext(null);
  return next;
}

/** Where to go after a successful sign-in. The query param wins over the stored path. */
export function authDestination(paramNext: string | null | undefined): string {
  return safeNext(paramNext) || takeAuthNext() || '/search';
}
