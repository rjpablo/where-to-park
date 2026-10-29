const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = '/opt/cursor/artifacts/screenshots';
const BASE = process.env.EXPO_WEB_URL || 'http://localhost:19006';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

const USERS = {
  admin: { id: '00000000-0000-0000-0000-000000000001', email: 'admin@wheretopark.local' },
  maria: { id: '20000000-0000-0000-0000-000000000001', email: 'maria@wheretopark.local' },
  juan: { id: '20000000-0000-0000-0000-000000000002', email: 'juan@wheretopark.local' },
  sarah: { id: '20000000-0000-0000-0000-000000000003', email: 'sarah@wheretopark.local' },
  staff: { id: '20000000-0000-0000-0000-000000000004', email: 'staff@wheretopark.local' },
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

async function newPage(browser, user) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('console.error:', msg.text());
  });
  if (user) {
    await page.evaluateOnNewDocument((sess) => {
      localStorage.setItem('sb-wtp-auth-token', JSON.stringify(sess));
    }, mintSession(user));
  }
  return page;
}

async function dismissDevToast(page) {
  await page.addStyleTag({
    content: `
      /* Expo Metro "Refreshing…" / "Don't see your changes?" toast */
      body > div[style*="position: fixed"][style*="bottom"],
      body > div[style*="position:fixed"][style*="bottom"] {
        display: none !important;
        visibility: hidden !important;
      }
    `,
  }).catch(() => {});

  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const style = window.getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const bottomish = parseFloat(style.bottom) === 0 || el.getBoundingClientRect().bottom >= window.innerHeight - 8;
      if (
        bottomish &&
        (t.includes("Don't see your changes") || t.includes('Refreshing'))
      ) {
        el.style.setProperty('display', 'none', 'important');
      }
    }
  });

  // Wait until the copy is gone from the screenshot tree (toast auto-clears).
  for (let i = 0; i < 24; i += 1) {
    const visible = await page.evaluate(() => {
      const text = document.body.innerText || '';
      return text.includes("Don't see your changes") || /\bRefreshing\.\.\./.test(text);
    });
    if (!visible) return;
    await delay(250);
  }
}

async function shot(page, file) {
  await delay(800);
  await dismissDevToast(page);
  await delay(200);
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const full = path.join(DIR, file);
  await page.screenshot({ path: full });
  console.log(`saved ${full} (${fs.statSync(full).size} bytes)`);
  return full;
}

module.exports = {
  DIR,
  BASE,
  USERS,
  mintSession,
  delay,
  launch,
  newPage,
  dismissDevToast,
  shot,
};
