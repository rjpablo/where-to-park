// Staff invites (rj t181u): the invite answer never says whether an account exists; a
// resend is allowed 3 minutes after the last send (also enforced by invite_staff, 0082).

export const INVITE_RESEND_SECONDS = 180;

/** Seconds until Resend is allowed (0 = now). */
export function resendSecondsLeft(lastSentAt: number | null, now: number): number {
  if (lastSentAt == null) return 0;
  return Math.max(0, Math.ceil((lastSentAt + INVITE_RESEND_SECONDS * 1000 - now) / 1000));
}

/** 2:05, 0:09 */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** When the server reports a cooldown, the send time it implies. */
export function lastSentFromCooldown(retryAfterSeconds: number, now: number): number {
  const left = Math.min(INVITE_RESEND_SECONDS, Math.max(0, retryAfterSeconds));
  return now - (INVITE_RESEND_SECONDS - left) * 1000;
}

/** invite_staff error codes -> text. None of them depends on whether an account exists. */
export function inviteErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'email_or_phone_required':
      return 'Enter an email or phone number.';
    case 'invalid_email':
      return 'Enter a valid email address.';
    case 'invalid_phone':
      return 'Enter a valid phone number.';
    case 'cannot_invite_self':
      return "That's you. Invite someone else.";
    case 'cannot_invite_owner':
      return 'The owner role cannot be given by invite.';
    case 'cooldown':
      return 'Please wait a few minutes before sending this invite again.';
    case 'Permission denied':
      return 'Only owners and managers can invite staff.';
    default:
      return code || 'Could not send the invite. Try again.';
  }
}
