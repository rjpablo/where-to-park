// Which sign-in methods the app offers (rj: phone sign-in is off for now; Google and
// email + password only). The phone OTP code is kept: set EXPO_PUBLIC_PHONE_SIGN_IN=1
// (and enable the Phone provider in Supabase Auth) to bring it back.
export function phoneSignInEnabled(
  value: string | undefined = process.env.EXPO_PUBLIC_PHONE_SIGN_IN
): boolean {
  return value === '1' || value === 'true';
}

export const PHONE_SIGN_IN_ENABLED = phoneSignInEnabled();
