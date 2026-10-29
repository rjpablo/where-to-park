const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = '/opt/cursor/artifacts/screenshots';
const BASE = process.env.EXPO_WEB_URL || 'http://localhost:19006';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const W = 390;
const H = 844;
const JUAN = { id: '20000000-0000-0000-0000-000000000002', email: 'juan@wheretopark.local' };

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

async function main() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
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
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((sess) => {
    localStorage.setItem('sb-wtp-auth-token', JSON.stringify(sess));
  }, mintSession(JUAN));

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('console.error:', msg.text());
  });
  await page.goto(`${BASE}/operator/onboarding`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="onboarding-ready"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="onboarding-name"]', { timeout: 10000 });
  await page.click('[data-testid="onboarding-name"]');
  await page.type('[data-testid="onboarding-name"]', 'Wright Park Overflow', { delay: 15 });
  await page.click('[data-testid="onboarding-address"]');
  await page.type('[data-testid="onboarding-address"]', 'Wright Park, Baguio', { delay: 15 });
  const filled = await page.evaluate(() => ({
    name: document.querySelector('[data-testid="onboarding-name"]')?.value,
    address: document.querySelector('[data-testid="onboarding-address"]')?.value,
    step: document.querySelector('[data-testid="onboarding-step"]')?.textContent,
  }));
  console.log('filled', filled);
  const next = await page.waitForSelector('[data-testid="onboarding-next"]', { timeout: 10000 });
  await next.click();
  await delay(500);
  const html = await page.content();
  if (!html.includes('map-pin-picker')) {
    console.log('step after next:', await page.$eval('body', (el) => el.innerText.slice(0, 500)));
  }
  await page.waitForSelector('[data-testid="map-pin-picker"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="map-pin-selected"]', { timeout: 15000 }).catch(() => {});
  await delay(4000);
  const file = path.join(DIR, '09_operator_onboarding_pin.png');
  await page.screenshot({ path: file });
  console.log(`saved ${file} (${fs.statSync(file).size} bytes)`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
