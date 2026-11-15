import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIVACY_POLICY } from './privacyPolicy.ts';
import { backFallback } from './backFallback.ts';

const text = PRIVACY_POLICY.map((b) => b.segments.map((s) => s.text).join('')).join('\n');

test('privacy policy carries the source content', () => {
  assert.equal(PRIVACY_POLICY[0].type, 'h1');
  assert.match(text, /Last updated: November 15, 2026/);
  assert.match(text, /Children's and Minors' Privacy/);
  assert.match(text, /By email: rjpablo\.dev@gmail\.com/);
  assert.ok(!/email protected/.test(text), 'obfuscated email decoded');
  assert.ok(PRIVACY_POLICY.every((b) => b.segments.length > 0));
});

test('privacy policy discloses AdMob ads and the advertising ID', () => {
  assert.ok(PRIVACY_POLICY.some((b) => b.type === 'h3' && b.segments[0].text === 'Advertising'));
  assert.match(text, /Google AdMob/);
  assert.match(text, /advertising ID/);
  assert.match(text, /To show advertising:/);
  const links = PRIVACY_POLICY.flatMap((b) => b.segments.map((s) => s.href).filter(Boolean));
  assert.ok(links.includes('https://policies.google.com/technologies/partner-sites'));
  assert.ok(links.includes('https://policies.google.com/technologies/ads'));
});

test('Privacy Policy Back without history goes to Search', () => {
  assert.equal(backFallback('privacy'), '/search');
});
