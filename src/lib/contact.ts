// Contact Us (migration 0059): form rules mirrored from submit_contact, labels, paths.

export const CONTACT_MESSAGE_MAX = 2000;
export const CONTACT_CONTACT_MAX = 200;
export const CONTACT_IMAGE_MAX = 5;
export const CONTACT_BUCKET = 'contact-images';

export type ContactCategory = 'issue' | 'feedback' | 'suggestion';
export const CONTACT_CATEGORIES: { value: ContactCategory; label: string }[] = [
  { value: 'issue', label: 'Issue' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'suggestion', label: 'Suggestion' },
];

export function categoryLabel(c: string | null | undefined): string {
  return CONTACT_CATEGORIES.find((x) => x.value === c)?.label ?? 'Other';
}

/** Email or phone (7-15 digits, optional +, spaces/dashes/brackets allowed). */
export function isValidReplyContact(v: string): boolean {
  const s = v.trim();
  if (!s) return true;
  if (s.length > CONTACT_CONTACT_MAX) return false;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(s)) return true;
  return /^\+?[0-9]{7,15}$/.test(s.replace(/[\s()-]/g, ''));
}

/** First problem with the form, or null when it can be sent. */
export function contactFormError(v: {
  category: string | null;
  message: string;
  contact?: string;
  images?: number;
}): string | null {
  if (!v.category || !CONTACT_CATEGORIES.some((c) => c.value === v.category)) {
    return 'Pick a category';
  }
  const msg = v.message.trim();
  if (!msg) return 'Write a message';
  if (msg.length > CONTACT_MESSAGE_MAX) {
    return `Keep the message under ${CONTACT_MESSAGE_MAX} characters`;
  }
  if (v.contact && !isValidReplyContact(v.contact)) return 'Enter an email address or phone number';
  if ((v.images ?? 0) > CONTACT_IMAGE_MAX) return `Up to ${CONTACT_IMAGE_MAX} images`;
  return null;
}

/** Plain text for submit_contact error codes. */
export function contactErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'invalid_category':
      return 'Pick a category';
    case 'message_required':
      return 'Write a message';
    case 'message_too_long':
      return `Keep the message under ${CONTACT_MESSAGE_MAX} characters`;
    case 'invalid_contact':
      return 'Enter an email address or phone number';
    case 'too_many_images':
      return `Up to ${CONTACT_IMAGE_MAX} images`;
    case 'rate_limited':
      return 'Too many messages from this device in the last hour. Try again later.';
    default:
      return 'Could not send your message. Try again.';
  }
}

/** Storage path of image i of a submission: '<id>/<i>-<rand>.jpg' (matches the upload rule). */
export function contactImagePath(submissionId: string, index: number, rand: string): string {
  const safe = rand.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'x';
  return `${submissionId}/${index}-${safe}.jpg`;
}

/** Random per-device id for the server's rate limit (8-64 of [A-Za-z0-9_-]). */
export function newDeviceId(random: () => number = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'd';
  for (let i = 0; i < 23; i++) s += abc[Math.floor(random() * abc.length) % abc.length];
  return s;
}

export function isDeviceId(v: string | null | undefined): v is string {
  return !!v && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

/** Who sent it, for the admin list: account name/phone, else the guest's contact. */
export function contactSender(item: {
  user_id?: string | null;
  user_name?: string | null;
  user_phone?: string | null;
  contact?: string | null;
}): string {
  if (item.user_id) {
    const who = [item.user_name, item.user_phone].filter(Boolean).join(' · ');
    return who ? `Account: ${who}` : 'Account';
  }
  return item.contact ? `Guest: ${item.contact}` : 'Guest (no contact)';
}
