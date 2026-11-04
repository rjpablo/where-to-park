// Email + password sign-in / sign-up (rj): input checks and friendly errors. Pure, tested.

export type EmailAuthMode = 'signin' | 'signup';

/** Matches Supabase Auth password_min_length on staging/prod config. */
export const MIN_PASSWORD_LENGTH = 8;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** null when the form can be sent, else the message to show. */
export function validateEmailPassword(
  email: string,
  password: string,
  mode: EmailAuthMode
): string | null {
  const e = normalizeEmail(email);
  if (!e) return 'Enter your email';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Enter a valid email';
  if (!password) return 'Enter your password';
  if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password`;
  }
  return null;
}

/** Map a Supabase Auth error to a message for the sign-in screen. */
export function emailAuthErrorMessage(
  err: { message?: string; code?: string; status?: number } | null | undefined,
  mode: EmailAuthMode
): string {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  const m = msg.toLowerCase();
  if (code === 'invalid_credentials' || m.includes('invalid login credentials')) {
    return 'Wrong email or password';
  }
  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    m.includes('already registered')
  ) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (code === 'weak_password' || m.includes('password should be')) {
    return `Use a stronger password (at least ${MIN_PASSWORD_LENGTH} characters)`;
  }
  if (code === 'email_not_confirmed' || m.includes('email not confirmed')) {
    return 'Confirm your email first (check your inbox)';
  }
  if (code === 'email_address_invalid' || (m.includes('email address') && m.includes('invalid'))) {
    return 'Enter a valid email';
  }
  if (code === 'signup_disabled' || code === 'email_provider_disabled') {
    return 'Email sign-up is not available right now';
  }
  if (code === 'over_request_rate_limit' || err?.status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  return msg || (mode === 'signup' ? 'Could not create the account' : 'Sign-in failed');
}

/** Password show/hide toggle (rj t171u): the eye button's icon and accessibility label. */
export function passwordToggle(visible: boolean): {
  icon: 'eye' | 'eye-off';
  label: 'Show password' | 'Hide password';
} {
  return visible
    ? { icon: 'eye-off', label: 'Hide password' }
    : { icon: 'eye', label: 'Show password' };
}
