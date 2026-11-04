#!/usr/bin/env node
// Email privacy API test (rj t179u: "a user's email address should only be visible to
// him/her"). Signs in as each test account and calls every user-facing REST/RPC read that
// shows people (profiles, public_profiles, reviews, chat threads, staff, listing owner,
// admin contact). Fails if any response contains ANOTHER account's email. Your own email
// may appear (GET /auth/v1/user). Also checks /auth/v1/admin/users is refused.
//
// Usage (staging only; nothing is printed except PASS/FAIL lines):
//   SUPABASE_URL=https://<ref>.supabase.co ANON_KEY_FILE=/path/anon.key \
//   PASSWORD_FILE=/path/password node scripts/test-email-privacy.js
// Accounts: sarah@, juan@, ana@, rj.admin@wheretopark.test (override with TEST_EMAILS).
const fs = require('fs');

const URL_ = process.env.SUPABASE_URL;
const ANON = fs.readFileSync(process.env.ANON_KEY_FILE, 'utf8').trim();
const PASSWORD = fs.readFileSync(process.env.PASSWORD_FILE, 'utf8').trim();
const EMAILS = (
  process.env.TEST_EMAILS ||
  'sarah@wheretopark.test,juan@wheretopark.test,ana@wheretopark.test,rj.admin@wheretopark.test'
).split(',');
const LOCATION = process.env.TEST_LOCATION_ID || '30000000-0000-0000-0000-000000000002';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

async function call(token, path, init = {}) {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token || ANON}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return { status: res.status, text: await res.text() };
}

async function signIn(email) {
  const r = await call(null, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error(`sign-in failed for an account (HTTP ${r.status})`);
  return JSON.parse(r.text).access_token;
}

const READS = [
  ['GET', '/rest/v1/profiles?select=*'],
  ['GET', '/rest/v1/public_profiles?select=*'],
  ['GET', `/rest/v1/reviews?select=*,public_profiles(*)&location_id=eq.${LOCATION}`],
  ['GET', '/rest/v1/chat_threads?select=*,public_profiles(*)'],
  ['GET', '/rest/v1/chat_messages?select=*&limit=200'],
  ['GET', '/rest/v1/operator_members?select=*,profiles(*)'],
  ['GET', '/rest/v1/contact_submissions?select=*'],
  ['POST', '/rest/v1/rpc/listing_owner', { p_location_id: LOCATION }],
  ['POST', '/rest/v1/rpc/admin_contact_submissions', {}],
];

const others = (me) => EMAILS.filter((e) => e !== me).map((e) => e.toLowerCase());

(async () => {
  const who = [[null, null], ...(await Promise.all(EMAILS.map(async (e) => [e, await signIn(e)])))];
  for (const [email, token] of who) {
    const label = email ? email.split('@')[0] : 'anon';
    const forbidden = email ? others(email) : EMAILS.map((e) => e.toLowerCase());
    for (const [method, path, body] of READS) {
      const r = await call(token, path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      const lower = r.text.toLowerCase();
      const leaked = forbidden.filter((e) => lower.includes(e)).length;
      ok(
        leaked === 0,
        `${label} ${method} ${path.split('?')[0]} (HTTP ${r.status}): no other user's email`
      );
    }
    if (token) {
      const me = await call(token, '/auth/v1/user');
      ok(
        me.status === 200 && JSON.parse(me.text).email === email,
        `${label} GET /auth/v1/user: own email only`
      );
    }
    const admin = await call(token, '/auth/v1/admin/users');
    ok(
      admin.status === 401 || admin.status === 403,
      `${label} /auth/v1/admin/users refused (HTTP ${admin.status})`
    );
  }
  console.log(failures ? `${failures} failure(s)` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
