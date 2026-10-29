const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const DIR = '/opt/cursor/artifacts/screenshots';
const BASE = process.env.EXPO_WEB_URL || 'http://localhost:19006';
const API = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54400';
const ANON =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const W = 390;
const H = 844;

const USERS = {
  juan: { id: '20000000-0000-0000-0000-000000000002', email: 'juan@wheretopark.local' },
  admin: { id: '00000000-0000-0000-0000-000000000001', email: 'admin@wheretopark.local' },
};

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
  const access_token = `${header}.${payload}.${sig}`;
  return {
    access_token,
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

async function launch() {
  return puppeteer.launch({
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
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  console.error:', msg.text());
  });
  page.on('requestfailed', (req) => console.log('  failed:', req.url(), req.failure()?.errorText));
  return page;
}

async function injectSession(page, user) {
  const session = mintSession(user);
  await page.evaluateOnNewDocument((sess) => {
    localStorage.setItem('sb-wtp-auth-token', JSON.stringify(sess));
  }, session);
}

async function waitReady(page, testId, timeout = 20000) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
}

async function shot(page, file) {
  const full = path.join(DIR, file);
  await page.screenshot({ path: full });
  const sz = fs.statSync(full).size;
  console.log(`  ✓ ${file} (${sz} bytes)`);
  return full;
}

async function main() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.png'))) {
    fs.unlinkSync(path.join(DIR, f));
  }

  const browser = await launch();

  // 1. Search default — wait for map idle + results
  {
    console.log('\n1. Search default');
    const page = await newPage(browser);
    await page.goto(`${BASE}/search`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitReady(page, 'search-ready');
    await page.waitForFunction(
      () =>
        window.__WTP_MAP_IDLE === true ||
        (window.__WTP_PIN_COUNT || 0) > 0 ||
        document.querySelectorAll('canvas').length > 0,
      { timeout: 30000 }
    );
    await delay(8000);
    await shot(page, '01_search_default.png');
    await page.close();
  }

  // 2. Expanded sheet via testID tap
  {
    console.log('\n2. Search expanded');
    const page = await newPage(browser);
    await page.goto(`${BASE}/search`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitReady(page, 'search-ready');
    await delay(4000);
    const toggle = await page.waitForSelector('[data-testid="sheet-expand-toggle"]');
    await toggle.click();
    await delay(400);
    await shot(page, '02_search_expanded.png');
    await page.close();
  }

  // 3. Listing details
  {
    console.log('\n3. Listing details');
    const page = await newPage(browser);
    await page.goto(`${BASE}/location/30000000-0000-0000-0000-000000000001`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await waitReady(page, 'location-ready');
    await delay(300);
    await shot(page, '03_listing_details.png');
    await page.close();
  }

  // 4. Operator onboarding (no auth required)
  {
    console.log('\n4. Operator onboarding');
    const page = await newPage(browser);
    await page.goto(`${BASE}/operator/onboarding`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(1500);
    await shot(page, '04_operator_onboarding.png');
    await page.close();
  }

  // 5. Availability as Juan
  {
    console.log('\n5. Availability');
    const page = await newPage(browser);
    await injectSession(page, USERS.juan);
    await page.goto(`${BASE}/operator/availability`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitReady(page, 'availability-ready');
    await delay(300);
    await shot(page, '05_availability_console.png');
    await page.close();
  }

  // 6. Walk-in check-in as Juan, then capture
  {
    console.log('\n6. Walk-in check-in');
    const page = await newPage(browser);
    await injectSession(page, USERS.juan);
    await page.goto(`${BASE}/staff/checkin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitReady(page, 'checkin-ready');
    await page.click('[data-testid="checkin-plate"]');
    await page.type('[data-testid="checkin-plate"]', 'WTP 1001', { delay: 20 });
    await page.click('[data-testid="checkin-submit"]');
    await waitReady(page, 'checkin-success', 15000);
    await shot(page, '06_walkin_checkin.png');
    await page.close();
  }

  // 7. Session board after check-in
  {
    console.log('\n7. Session board');
    const page = await newPage(browser);
    await injectSession(page, USERS.juan);
    await page.goto(`${BASE}/staff/sessions`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitReady(page, 'sessions-ready');
    await page.waitForSelector('[data-testid="session-row-WTP 1001"]', { timeout: 15000 });
    await shot(page, '07_session_board.png');

    console.log('\n7b. Close with partial cash (waiver alert)');
    const endButtons = await page.$$('text/End Session');
    // RN web may not support text/. Click the last small button in the WTP card.
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="session-row-WTP 1001"]');
      const buttons = card ? Array.from(card.querySelectorAll('div,button,a')) : [];
      const end = buttons.find((el) => (el.textContent || '').trim() === 'End Session');
      if (end) end.click();
    });
    await waitReady(page, 'session-close-form');
    await page.click('[data-testid="session-close-form"] >> xpath=..');
    const cash = await page.waitForSelector('[data-testid="session-cash-amount"]');
    await cash.click({ clickCount: 3 });
    await page.type('[data-testid="session-cash-amount"]', '20');
    await page.evaluate(() => {
      const form = document.querySelector('[data-testid="session-close-form"]');
      const buttons = form ? Array.from(form.querySelectorAll('div,button,a')) : [];
      const close = buttons.find((el) => (el.textContent || '').trim() === 'Close with payment');
      if (close) close.click();
    });
    await waitReady(page, 'waiver-alert', 15000);
    await shot(page, '07b_waiver_alert.png');

    console.log('\n7c. Complete with waiver note');
    await page.type('[data-testid="session-waiver-note"]', 'Partial cash, remainder waived for demo');
    await page.evaluate(() => {
      const form = document.querySelector('[data-testid="session-close-form"]');
      const buttons = form ? Array.from(form.querySelectorAll('div,button,a')) : [];
      const close = buttons.find((el) => (el.textContent || '').trim() === 'Close with payment');
      if (close) close.click();
    });
    await waitReady(page, 'session-closed', 15000);
    await shot(page, '07c_session_closed.png');
    await page.close();
  }

  // 8. Admin queue
  {
    console.log('\n8. Admin verification');
    const page = await newPage(browser);
    await injectSession(page, USERS.admin);
    await page.goto(`${BASE}/admin/verify`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitReady(page, 'admin-ready');
    await delay(300);
    await shot(page, '08_admin_verification.png');
    await page.close();
  }

  await browser.close();

  // Sanity: seed a walk-in via API if capture check-in failed silently
  console.log('\n=== sizes ===');
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.png')).sort()) {
    console.log(`${f}: ${fs.statSync(path.join(DIR, f)).size}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
