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
  
  // Log console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`  Browser error: ${msg.text()}`);
    }
  });
  
  // Log failed requests
  page.on('requestfailed', req => {
    console.log(`  Failed request: ${req.url()}`);
  });
  
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

  console.log('Launching browser with WebGL support...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist'
    ],
  });

  // 1. Search default
  await cap(browser, '01_search_default.png', `${BASE}/search`, '1. Search (default sheet)', 3000);

  // 2. Search expanded - use mouse to drag sheet
  const page2 = await browser.newPage();
  await page2.setViewport({ width: W, height: H });
  
  page2.on('console', msg => {
    if (msg.type() === 'error') console.log(`  Browser error: ${msg.text()}`);
  });
  
  console.log('\n2. Search (expanded sheet)');
  await page2.goto(`${BASE}/search`, { waitUntil: 'domcontentloaded' });
  await delay(5000);
  
  // Try to find and drag the sheet handle
  try {
    const handle = await page2.$('[class*="sheetHandle"]');
    if (handle) {
      const box = await handle.boundingBox();
      if (box) {
        // Drag from handle to near top of screen
        await page2.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page2.mouse.down();
        await delay(100);
        // Drag up in steps
        for (let y = box.y; y > 100; y -= 50) {
          await page2.mouse.move(box.x + box.width / 2, y);
          await delay(50);
        }
        await page2.mouse.up();
        await delay(500);
      }
    }
  } catch (e) {
    console.log(`  Warning: Could not drag sheet: ${e.message}`);
  }
  
  await page2.screenshot({ path: path.join(DIR, '02_search_expanded.png') });
  const sz2 = fs.statSync(path.join(DIR, '02_search_expanded.png')).size;
  console.log(`  ✓ 02_search_expanded.png (${(sz2/1024).toFixed(1)}KB)`);
  await page2.close();

  // 3-8. Other screens
  await cap(browser, '03_listing_details.png', `${BASE}/location/30000000-0000-0000-0000-000000000001`, '3. Listing details', 2000);
  await cap(browser, '04_operator_onboarding.png', `${BASE}/operator/onboarding`, '4. Operator onboarding');
  await cap(browser, '05_availability_console.png', `${BASE}/operator/availability`, '5. Availability console', 2000);
  await cap(browser, '06_walkin_checkin.png', `${BASE}/staff/checkin`, '6. Walk-in check-in');
  await cap(browser, '07_session_board.png', `${BASE}/staff/sessions`, '7. Session board');
  await cap(browser, '08_admin_verification.png', `${BASE}/admin/verify`, '8. Admin verification');

  await browser.close();
  console.log('\n✓ Capture complete!');
  
  // Show sizes
  console.log('\n=== File Sizes ===');
  fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort().forEach(f => {
    const sz = fs.statSync(path.join(DIR, f)).size;
    console.log(`${f}: ${sz} bytes (${(sz/1024).toFixed(1)}KB)`);
  });
}

main().catch(console.error);
