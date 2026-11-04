import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oauthErrorMessage, oauthRedirectFor, parseOAuthCallback } from './oauthCallback.ts';

test('reads a PKCE code', () => {
  const r = parseOAuthCallback('wheretopark://oauth-callback?code=abc-123&state=x');
  assert.equal(r.code, 'abc-123');
  assert.equal(r.error, null);
});

test('reads implicit tokens from the hash', () => {
  const r = parseOAuthCallback(
    'https://where-to-park.expo.app/oauth-callback#access_token=a.b.c&refresh_token=r1&type=bearer'
  );
  assert.equal(r.accessToken, 'a.b.c');
  assert.equal(r.refreshToken, 'r1');
  assert.equal(r.code, null);
});

test('reads errors from query or hash', () => {
  const r = parseOAuthCallback(
    'wheretopark://oauth-callback?error=server_error&error_description=Database+error+saving+new+user'
  );
  assert.equal(r.error, 'server_error');
  assert.equal(r.errorDescription, 'Database error saving new user');
  const h = parseOAuthCallback('https://x.app/oauth-callback#error=access_denied&error_code=403');
  assert.equal(h.error, 'access_denied');
});

test('error messages', () => {
  assert.match(
    oauthErrorMessage('server_error', 'Database error saving new user'),
    /can't be used here/
  );
  assert.match(
    oauthErrorMessage('identity_already_exists', 'Identity is already linked to another user'),
    /already linked/
  );
  assert.equal(oauthErrorMessage('access_denied', null), 'Google sign-in was cancelled');
  assert.equal(oauthErrorMessage(null, 'Something else'), 'Something else');
  assert.match(
    oauthErrorMessage(
      'AuthPKCECodeVerifierMissingError',
      'PKCE code verifier not found in storage.'
    ),
    /expired/
  );
});

test('redirect URLs', () => {
  assert.equal(
    oauthRedirectFor('web', 'https://where-to-park.expo.app/'),
    'https://where-to-park.expo.app/oauth-callback'
  );
  assert.equal(oauthRedirectFor('android', null), 'wheretopark://oauth-callback');
  assert.equal(oauthRedirectFor('ios', 'ignored'), 'wheretopark://oauth-callback');
});
