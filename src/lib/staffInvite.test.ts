import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCountdown,
  inviteErrorMessage,
  lastSentFromCooldown,
  resendSecondsLeft,
} from './staffInvite.ts';

test('resend countdown: 3 minutes from the last send', () => {
  assert.equal(resendSecondsLeft(null, 0), 0);
  assert.equal(resendSecondsLeft(0, 0), 180);
  assert.equal(resendSecondsLeft(0, 179_500), 1);
  assert.equal(resendSecondsLeft(0, 180_000), 0);
  assert.equal(formatCountdown(180), '3:00');
  assert.equal(formatCountdown(9), '0:09');
  assert.equal(resendSecondsLeft(lastSentFromCooldown(60, 1_000_000), 1_000_000), 60);
});

test('invite errors never mention whether an account exists', () => {
  for (const c of ['invalid_email', 'cooldown', 'cannot_invite_self', 'x']) {
    assert.doesNotMatch(inviteErrorMessage(c), /not found|no account|exists/i);
  }
});
