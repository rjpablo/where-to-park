import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIVACY_POLICY } from './privacyPolicy.ts';
import { backFallback } from './backFallback.ts';

const text = PRIVACY_POLICY.map((b) => b.segments.map((s) => s.text).join('')).join('\n');

test('privacy policy carries the source content', () => {
  assert.equal(PRIVACY_POLICY[0].type, 'h1');
  assert.match(text, /Last updated: November 02, 2026/);
  assert.match(text, /Children's and Minors' Privacy/);
  assert.match(text, /By email: rjpablo\.dev@gmail\.com/);
  assert.ok(!/email protected/.test(text), 'obfuscated email decoded');
  assert.ok(PRIVACY_POLICY.every((b) => b.segments.length > 0));
});

test('Privacy Policy Back without history goes to Search', () => {
  assert.equal(backFallback('privacy'), '/search');
});
