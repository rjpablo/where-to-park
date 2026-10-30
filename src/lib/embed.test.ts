import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedOne } from './embed.ts';

test('embeddedOne reads an embedded row from an object or an array', () => {
  assert.deepEqual(embeddedOne([{ display_name: 'Sarah' }]), { display_name: 'Sarah' });
  assert.deepEqual(embeddedOne({ display_name: 'Sarah' }), { display_name: 'Sarah' });
  assert.equal(embeddedOne([]), null);
  assert.equal(embeddedOne(null), null);
  assert.equal(embeddedOne(undefined), null);
});
