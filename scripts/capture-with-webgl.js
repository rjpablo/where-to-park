const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const DIR = '/opt/cursor/artifacts/screenshots';
const BASE = 'http://localhost:19006';
const W = 390, H = 844;
const delay = ms => new Promise(r => setTimeout(r, ms));

async function cap(browser, file, url, desc, waitExtra = 0) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  Browser error: ${msg.text()}`);
  });
  
  page.on('requestfailed', req => console.log(`  Failed: ${req.url()}`));
  
  console.log(`\n${desc}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5000 + waitExtra);
    
    const fullPath = path.join(DIR, file);
    await page.screenshot({ path: fullPath });
    const sz = fs.statSync(fullPath).size;
    console.log(`  ✓ ${file} (${(sz/1024).toFixed(1)}KB)`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
  await page.close();
}

async function main() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  console.log('Launching browser with WebGL...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  await cap(browser, '01_search_default.png', `${BASE}/search`, '1. Search (default)', 3000);

  const page2 = await browser.newPage();
  await page2.setViewport({ width: W, height: H });
  page2.on('console', msg => { if (msg.type() === 'error') console.log(`  Error: ${msg.text()}`); });
  
  console.log('\n2. Search (expanded)');
  await page2.goto(`${BASE}/search`, { waitUntil: 'domcontentloaded' });
  await delay(5000);
  
  try {
    const handle = await page2.$('[class*="sheetHandle"]');
    if (handle) {
      const box = await handle.boundingBox();
      if (box) {
        await page2.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page2.mouse.down();
        await delay(100);
        for (let y = box.y; y > 100; y -= 50) {
          await page2.mouse.move(box.x + box.width / 2, y);
          await delay(50);
        }
        await page2.mouse.up();
        await delay(500);
      }
    }
  } catch (e) {
    console.log(`  Sheet drag failed: ${e.message}`);
  }
  
  await page2.screenshot({ path: path.join(DIR, '02_search_expanded.png') });
  console.log(`  ✓ 02_search_expanded.png (${(fs.statSync(path.join(DIR, '02_search_expanded.png')).size/1024).toFixed(1)}KB)`);
  await page2.close();

  await cap(browser, '03_listing_details.png', `${BASE}/location/30000000-0000-0000-0000-000000000001`, '3. Listing details', 2000);
  await cap(browser, '04_operator_onboarding.png', `${BASE}/operator/onboarding`, '4. Onboarding');
  await cap(browser, '05_availability_console.png', `${BASE}/operator/availability`, '5. Availability', 2000);
  await cap(browser, '06_walkin_checkin.png', `${BASE}/staff/checkin`, '6. Check-in');
  await cap(browser, '07_session_board.png', `${BASE}/staff/sessions`, '7. Sessions');
  await cap(browser, '08_admin_verification.png', `${BASE}/admin/verify`, '8. Admin');

  await browser.close();
  console.log('\n✓ Done!');
  
  console.log('\n=== Sizes ===');
  fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort().forEach(f => {
    console.log(`${f}: ${fs.statSync(path.join(DIR, f)).size} bytes`);
  });
}

main().catch(console.error);
