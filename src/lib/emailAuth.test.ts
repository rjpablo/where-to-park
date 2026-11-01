import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailAuthErrorMessage, normalizeEmail, validateEmailPassword } from './emailAuth.ts';
import { phoneSignInEnabled } from './authConfig.ts';

test('phone sign-in is off unless the flag is set', () => {
  assert.equal(phoneSignInEnabled(undefined), false);
  assert.equal(phoneSignInEnabled(''), false);
  assert.equal(phoneSignInEnabled('0'), false);
  assert.equal(phoneSignInEnabled('1'), true);
  assert.equal(phoneSignInEnabled('true'), true);
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Sarah@Example.COM '), 'sarah@example.com');
});

test('validateEmailPassword', () => {
  assert.equal(validateEmailPassword('', 'x', 'signin'), 'Enter your email');
  assert.equal(validateEmailPassword('nope', 'x', 'signin'), 'Enter a valid email');
  assert.equal(validateEmailPassword('a@b.co', '', 'signin'), 'Enter your password');
  // Sign-in never checks length (old accounts); sign-up needs 8+.
  assert.equal(validateEmailPassword('a@b.co', 'short', 'signin'), null);
  assert.match(validateEmailPassword('a@b.co', 'short', 'signup') || '', /at least 8/);
  assert.equal(validateEmailPassword(' A@B.co ', '12345678', 'signup'), null);
});

test('emailAuthErrorMessage maps Supabase Auth errors', () => {
  assert.equal(
    emailAuthErrorMessage(
      { code: 'invalid_credentials', message: 'Invalid login credentials' },
      'signin'
    ),
    'Wrong email or password'
  );
  assert.match(
    emailAuthErrorMessage(
      { code: 'user_already_exists', message: 'User already registered' },
      'signup'
    ),
    /already exists/
  );
  assert.match(
    emailAuthErrorMessage({ code: 'weak_password', message: 'x' }, 'signup'),
    /stronger/
  );
  assert.match(emailAuthErrorMessage({ status: 429, message: 'x' }, 'signin'), /Too many/);
  assert.equal(emailAuthErrorMessage({ message: 'Boom' }, 'signin'), 'Boom');
  assert.equal(emailAuthErrorMessage(null, 'signup'), 'Could not create the account');
});
