import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avatarObjectName,
  avatarPublicUrl,
  avatarStoragePath,
  squareCrop,
  staleAvatarFiles,
} from './avatar.ts';

const BASE = 'https://abc.supabase.co';

test('avatarPublicUrl: storage path, Google URL, nothing', () => {
  assert.equal(
    avatarPublicUrl('avatars/u1/1-a.jpg', BASE),
    'https://abc.supabase.co/storage/v1/object/public/avatars/u1/1-a.jpg'
  );
  assert.equal(
    avatarPublicUrl('https://lh3.googleusercontent.com/a/x', BASE),
    'https://lh3.googleusercontent.com/a/x'
  );
  assert.equal(avatarPublicUrl(null, BASE), null);
  assert.equal(avatarPublicUrl('', BASE), null);
  assert.equal(avatarPublicUrl('http://insecure/x.jpg', BASE), null);
  assert.equal(avatarPublicUrl('chat-images/x.jpg', BASE), null);
  assert.equal(avatarPublicUrl('avatars/../chat-images/x', BASE), null);
  assert.equal(avatarPublicUrl('avatars/u1/x.jpg', ''), null);
});

test('avatarStoragePath / avatarObjectName', () => {
  assert.equal(avatarStoragePath('u1', 1700, 'ab/c!'), 'u1/1700-abc.jpg');
  assert.equal(avatarObjectName('avatars/u1/1700-abc.jpg'), 'u1/1700-abc.jpg');
  assert.equal(avatarObjectName('https://lh3.googleusercontent.com/a/x'), null);
});

test('squareCrop centers the square', () => {
  assert.deepEqual(squareCrop(1000, 600), { originX: 200, originY: 0, width: 600, height: 600 });
  assert.deepEqual(squareCrop(600, 1000), { originX: 0, originY: 200, width: 600, height: 600 });
  assert.deepEqual(squareCrop(512, 512), { originX: 0, originY: 0, width: 512, height: 512 });
});

test('staleAvatarFiles keeps only the current one', () => {
  assert.deepEqual(
    staleAvatarFiles('u1', ['1-a.jpg', '2-b.jpg', '.emptyFolderPlaceholder'], 'u1/2-b.jpg'),
    ['u1/1-a.jpg']
  );
  assert.deepEqual(staleAvatarFiles('u1', ['1-a.jpg'], null), ['u1/1-a.jpg']);
});
