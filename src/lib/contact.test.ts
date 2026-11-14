import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryLabel,
  contactDeleteErrorMessage,
  contactErrorMessage,
  contactFormError,
  contactImagePath,
  contactSender,
  isDeviceId,
  isValidReplyContact,
  newDeviceId,
} from './contact.ts';

test('contact form: category and message required, limits', () => {
  assert.equal(contactFormError({ category: null, message: 'hi' }), 'Pick a category');
  assert.equal(contactFormError({ category: 'bug', message: 'hi' }), 'Pick a category');
  assert.equal(contactFormError({ category: 'issue', message: '   ' }), 'Write a message');
  assert.match(contactFormError({ category: 'issue', message: 'a'.repeat(2001) }) || '', /2000/);
  assert.equal(contactFormError({ category: 'issue', message: 'a'.repeat(2000) }), null);
  assert.equal(
    contactFormError({ category: 'feedback', message: 'ok', contact: 'nope' }),
    'Enter an email address or phone number'
  );
  assert.equal(
    contactFormError({ category: 'suggestion', message: 'ok', images: 6 }),
    'Up to 5 images'
  );
  assert.equal(
    contactFormError({ category: 'suggestion', message: 'ok', contact: '', images: 5 }),
    null
  );
});

test('reply contact: email or phone', () => {
  assert.ok(isValidReplyContact('a@b.co'));
  assert.ok(isValidReplyContact('+63 917 000 0009'));
  assert.ok(isValidReplyContact('(02) 8123-4567'));
  assert.ok(isValidReplyContact(''));
  assert.ok(!isValidReplyContact('hello'));
  assert.ok(!isValidReplyContact('123'));
  assert.ok(!isValidReplyContact(`${'a'.repeat(200)}@b.co`));
});

test('labels, errors, paths, device ids, sender', () => {
  assert.equal(categoryLabel('issue'), 'Issue');
  assert.equal(categoryLabel('x'), 'Other');
  assert.match(contactErrorMessage('rate_limited'), /Too many/);
  assert.match(contactErrorMessage(undefined), /Could not send/);
  assert.equal(contactImagePath('abc', 2, 'r/4n.d'), 'abc/2-r4nd.jpg');
  assert.equal(contactImagePath('abc', 0, '!!'), 'abc/0-x.jpg');
  const id = newDeviceId(() => 0.5);
  assert.ok(isDeviceId(id) && id.length === 24);
  assert.ok(!isDeviceId('bad id!'));
  assert.ok(!isDeviceId(null));
  assert.equal(
    contactSender({ user_id: 'u', user_name: 'Sarah', user_phone: '+63' }),
    'Account: Sarah · +63'
  );
  assert.equal(contactSender({ contact: 'a@b.co' }), 'Guest: a@b.co');
  assert.equal(contactSender({}), 'Guest (no contact)');
});

test('contactDeleteErrorMessage', () => {
  assert.equal(contactDeleteErrorMessage('not_found'), 'This message was already deleted.');
  assert.match(contactDeleteErrorMessage('images_remaining'), /Nothing was deleted/);
  assert.equal(contactDeleteErrorMessage('Permission denied'), 'Only admins can delete messages.');
  assert.equal(contactDeleteErrorMessage('boom'), "Couldn't delete: boom");
  assert.equal(contactDeleteErrorMessage(null), "Couldn't delete. Try again.");
});
