// Pure helpers for the Google (OAuth) redirect back into the app. No React Native imports,
// so they run in the node unit tests.

export const OAUTH_CALLBACK_PATH = 'oauth-callback';
export const APP_SCHEME = 'wheretopark';

export type OAuthIntent = 'signin' | 'link';

export interface OAuthCallback {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorDescription: string | null;
}

/** Reads ?code=… (PKCE) or #access_token=… (implicit) and ?error=… from a redirect URL. */
export function parseOAuthCallback(url: string): OAuthCallback {
  const params = new Map<string, string>();
  const take = (part: string) => {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const k = decodeURIComponent((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '));
      const v = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
      if (!params.has(k)) params.set(k, v);
    }
  };
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const q = beforeHash.indexOf('?');
  if (q >= 0) take(beforeHash.slice(q + 1));
  if (hashAt >= 0) take(url.slice(hashAt + 1));
  const get = (k: string) => (params.get(k) || '').trim() || null;
  return {
    code: get('code'),
    accessToken: get('access_token'),
    refreshToken: get('refresh_token'),
    error: get('error') || get('error_code'),
    errorDescription: get('error_description'),
  };
}

/** What the user sees for a failed Google sign-in or link. */
export function oauthErrorMessage(error: string | null, description: string | null): string {
  const d = `${error || ''} ${description || ''}`.toLowerCase();
  if (/access_denied|cancel/.test(d)) return 'Google sign-in was cancelled';
  if (/already.*linked|identity_already_exists|already exists/.test(d))
    return 'That Google account is already linked to another Where To Park account';
  if (/database error|oauth_email|unexpected_failure|server_error/.test(d))
    return "This Google account can't be used here: Google hasn't verified its email, or the email belongs to another Where To Park account";
  if (/code verifier|flow state|invalid_grant|expired/.test(d))
    return 'That Google sign-in expired or was started in another browser. Please try again';
  if (/manual linking|linking.*disabled/.test(d)) return 'Linking Google is not available yet';
  return description || error || 'Google sign-in failed';
}

/** Where the redirect lands: the web origin's /oauth-callback, or wheretopark://oauth-callback. */
export function oauthRedirectFor(platform: string, webOrigin: string | null): string {
  if (platform === 'web' && webOrigin)
    return `${webOrigin.replace(/\/+$/, '')}/${OAUTH_CALLBACK_PATH}`;
  return `${APP_SCHEME}://${OAUTH_CALLBACK_PATH}`;
}
