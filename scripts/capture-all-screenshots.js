const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = '/opt/cursor/artifacts/screenshots';
const BASE_URL = 'http://localhost:19006';
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureScreenshot(page, filename, description) {
  console.log(`Capturing: ${filename} - ${description}`);
  const fullPath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({
    path: fullPath,
    fullPage: false,
  });
  
  const stats = fs.statSync(fullPath);
  console.log(`  ✓ Saved ${filename} (${(stats.size / 1024).toFixed(1)}KB)`);
  return fullPath;
}

async function captureAllScreenshots() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: PHONE_WIDTH, height: PHONE_HEIGHT });

  const screenshots = [];

  try {
    console.log('\n=== Testing root page first ===');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5000);
    
    const pageContent = await page.content();
    if (pageContent.includes('error') || pageContent.includes('Error')) {
      console.log('Warning: Page might have errors');
      console.log(pageContent.substring(0, 500));
    }
    
    console.log('\n=== Guest: Search Screen ===');
    await page.goto(`${BASE_URL}/search`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(5000);
    
    screenshots.push(await captureScreenshot(
      page,
      '01_search_sheet_default.png',
      'Search screen with default bottom sheet'
    ));

    console.log('\nExpanding bottom sheet...');
    await page.evaluate(() => {
      const sheet = document.querySelector('[class*="sheet"]');
      if (sheet) {
        sheet.style.height = '85%';
      }
    });
    await delay(1000);
    
    screenshots.push(await captureScreenshot(
      page,
      '02_search_sheet_expanded.png',
      'Search screen with expanded bottom sheet'
    ));

    console.log('\nNavigating to listing details...');
    await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="listItem"]');
      if (items.length > 0) {
        items[0].click();
      }
    });
    await delay(3000);
    
    screenshots.push(await captureScreenshot(
      page,
      '03_listing_details.png',
      'Listing details screen'
    ));

    console.log('\n=== Screenshot Summary ===');
    screenshots.forEach((filepath) => {
      console.log(`  - ${filepath}`);
    });

  } catch (error) {
    console.error('\nError capturing screenshots:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

captureAllScreenshots()
  .then(() => {
    console.log('\n✓ Screenshot capture complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Failed to capture screenshots:', error);
    process.exit(1);
  });
