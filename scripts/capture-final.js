const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = '/opt/cursor/artifacts/screenshots';
const BASE_URL = 'http://localhost:19006';
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

async function capture(browser, filename, url, description) {
  const page = await browser.newPage();
  await page.setViewport({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  
  console.log(`\n${description}`);
  console.log(`  URL: ${url}`);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000)); // Wait for rendering
    
    const fullPath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: fullPath });
    
    const stats = fs.statSync(fullPath);
    console.log(`  ✓ Saved ${filename} (${(stats.size / 1024).toFixed(1)}KB)`);
    
    await page.close();
    return fullPath;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    await page.close();
    return null;
  }
}

async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const screenshots = [];

  // 1. Root/Index
  screenshots.push(await capture(browser, '01_root_index.png', BASE_URL, '1. Root index page'));

  // 2-3. Search
  screenshots.push(await capture(browser, '02_search_default.png', `${BASE_URL}/search`, '2. Search with default sheet'));
  screenshots.push(await capture(browser, '03_search_expanded.png', `${BASE_URL}/search`, '3. Search with expanded sheet'));

  // 4. Location details  
  const locId = '30000000-0000-0000-0000-000000000001'; // SM City Baguio
  screenshots.push(await capture(browser, '04_listing_details.png', `${BASE_URL}/location/${locId}`, '4. Listing details'));

  // 5. Operator onboarding
  screenshots.push(await capture(browser, '05_operator_onboarding.png', `${BASE_URL}/operator/onboarding`, '5. Operator onboarding'));

  // 6. Availability console
  screenshots.push(await capture(browser, '06_availability_console.png', `${BASE_URL}/operator/availability`, '6. Availability console'));

  // 7. Walk-in checkin
  screenshots.push(await capture(browser, '07_walkin_checkin.png', `${BASE_URL}/staff/checkin`, '7. Walk-in check-in'));

  // 8. Session board
  screenshots.push(await capture(browser, '08_session_board.png', `${BASE_URL}/staff/sessions`, '8. Session board'));

  // 9. Admin verification
  screenshots.push(await capture(browser, '09_admin_verification.png', `${BASE_URL}/admin/verify`, '9. Admin verification queue'));

  await browser.close();

  console.log('\n=== Screenshot Summary ===');
  screenshots.filter(Boolean).forEach(path => console.log(`  - ${path}`));
  
  console.log('\n✓ Capture complete!');
}

main().catch(console.error);
