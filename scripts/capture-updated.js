const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const DIR = '/opt/cursor/artifacts/screenshots';
const BASE = 'http://localhost:19006';
const W = 390, H = 844;
const delay = ms => new Promise(r => setTimeout(r, ms));

async function cap(browser, file, url, desc, extraWait = 0) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  
  console.log(`\n${desc}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5000 + extraWait);
    
    await page.screenshot({ path: path.join(DIR, file) });
    const sz = fs.statSync(path.join(DIR, file)).size;
    console.log(`  ✓ ${file} (${(sz/1024).toFixed(1)}KB)`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
  await page.close();
}

async function main() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // 1. Search default
  await cap(browser, '01_search_default.png', `${BASE}/search`, '1. Search (default sheet)');

  // 2. Search expanded (manipulate DOM)
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.goto(`${BASE}/search`, { waitUntil: 'domcontentloaded' });
  await delay(5000);
  await page.evaluate(() => {
    const sheet = document.querySelector('[class*="sheet"]');
    if (sheet) sheet.style.height = '85%';
  });
  await delay(1000);
  await page.screenshot({ path: path.join(DIR, '02_search_expanded.png') });
  console.log('\n2. Search (expanded sheet)');
  console.log(`  ✓ 02_search_expanded.png (${(fs.statSync(path.join(DIR, '02_search_expanded.png')).size/1024).toFixed(1)}KB)`);
  await page.close();

  // 3-8. Other screens
  await cap(browser, '03_listing_details.png', `${BASE}/location/30000000-0000-0000-0000-000000000001`, '3. Listing details', 2000);
  await cap(browser, '04_operator_onboarding.png', `${BASE}/operator/onboarding`, '4. Operator onboarding');
  await cap(browser, '05_availability_console.png', `${BASE}/operator/availability`, '5. Availability console');
  await cap(browser, '06_walkin_checkin.png', `${BASE}/staff/checkin`, '6. Walk-in check-in');
  await cap(browser, '07_session_board.png', `${BASE}/staff/sessions`, '7. Session board');
  await cap(browser, '08_admin_verification.png', `${BASE}/admin/verify`, '8. Admin verification');

  await browser.close();
  console.log('\n✓ Done!');
}

main().catch(console.error);
