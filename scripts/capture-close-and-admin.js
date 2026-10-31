const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = '/opt/cursor/artifacts/screenshots';
const BASE = 'http://localhost:19006';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const W = 390;
const H = 844;

function mintSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'supabase-local-dev',
      aud: 'authenticated',
      role: 'authenticated',
      exp: now + 3600,
      iat: now,
      sub: user.id,
      email: user.email,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return {
    access_token: `${header}.${payload}.${sig}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `local-dev-${user.id}`,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
    },
  };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on('console', (m) => m.type() === 'error' && console.log('err', m.text()));

  await page.evaluateOnNewDocument((sess) => {
    localStorage.setItem('sb-wtp-auth-token', JSON.stringify(sess));
    localStorage.setItem('sb-127-auth-token', JSON.stringify(sess));
  }, mintSession({ id: '20000000-0000-0000-0000-000000000002', email: 'juan@wheretopark.local' }));

  console.log('session board + close');
  await page.goto(`${BASE}/staff/sessions`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="sessions-ready"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="session-row-WVE 8888"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(DIR, '07_session_board.png') });
  await page.click('[data-testid="end-session-WVE 8888"]');
  await page.waitForSelector('[data-testid="session-close-form"]', { timeout: 10000 });
  await page.type('[data-testid="session-cash-amount"]', '20');
  await page.click('[data-testid="session-close-submit"]');
  await page.waitForSelector('[data-testid="waiver-alert"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(DIR, '07b_waiver_alert.png') });
  console.log('07b', fs.statSync(path.join(DIR, '07b_waiver_alert.png')).size);

  await page.type('[data-testid="session-waiver-note"]', 'Partial cash, remainder waived for demo');
  await page.click('[data-testid="session-close-submit"]');
  await page.waitForSelector('[data-testid="session-closed"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(DIR, '07c_session_closed.png') });
  console.log('07c', fs.statSync(path.join(DIR, '07c_session_closed.png')).size);
  await page.close();

  const admin = await browser.newPage();
  await admin.setViewport({ width: W, height: H });
  await admin.evaluateOnNewDocument((sess) => {
    localStorage.setItem('sb-wtp-auth-token', JSON.stringify(sess));
    localStorage.setItem('sb-127-auth-token', JSON.stringify(sess));
  }, mintSession({ id: '00000000-0000-0000-0000-000000000001', email: 'admin@wheretopark.local' }));
  await admin.goto(`${BASE}/admin/verify`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await admin.waitForSelector('[data-testid="admin-ready"]', { timeout: 20000 });
  await delay(500);
  await admin.screenshot({ path: path.join(DIR, '08_admin_verification.png') });
  console.log('08', fs.statSync(path.join(DIR, '08_admin_verification.png')).size);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
