const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = '/opt/cursor/artifacts/screenshots';
const BASE_URL = 'http://localhost:19006';
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureScreenshots() {
  // Ensure screenshot directory exists
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

  try {
    console.log('Navigating to app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    
    // Wait a bit for any initial render
    await delay(3000);

    // Screenshot 1: Search screen with default bottom sheet
    console.log('Capturing: search_sheet_default.png');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'search_sheet_default.png'),
      fullPage: false,
    });

    // Try to expand the sheet if there's a drag handle or expand button
    // This is a placeholder - adjust selector based on actual implementation
    try {
      await page.evaluate(() => {
        // Try to find and click any expand button or drag the sheet
        const sheet = document.querySelector('[class*="sheet"]');
        if (sheet) {
          // Simulate expanding by directly setting height
          sheet.style.height = '85%';
        }
      });
      await delay(1000);

      // Screenshot 2: Search screen with expanded sheet
      console.log('Capturing: search_sheet_expanded.png');
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'search_sheet_expanded.png'),
        fullPage: false,
      });
    } catch (err) {
      console.log('Could not expand sheet:', err.message);
    }

    // Try to navigate to a listing detail
    try {
      // Look for any listing item to click
      await page.evaluate(() => {
        const items = document.querySelectorAll('[class*="listItem"]');
        if (items.length > 0) {
          items[0].click();
        }
      });
      
      await delay(2000);
      
      // Screenshot 3: Listing details
      console.log('Capturing: listing_details.png');
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'listing_details.png'),
        fullPage: false,
      });
    } catch (err) {
      console.log('Could not navigate to listing:', err.message);
    }

    console.log('\nScreenshots saved to:', SCREENSHOT_DIR);
    console.log('Files:');
    fs.readdirSync(SCREENSHOT_DIR).forEach((file) => {
      if (file.endsWith('.png')) {
        const fullPath = path.join(SCREENSHOT_DIR, file);
        const stats = fs.statSync(fullPath);
        console.log(`  - ${fullPath} (${(stats.size / 1024).toFixed(1)}KB)`);
      }
    });
  } catch (error) {
    console.error('Error capturing screenshots:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

captureScreenshots()
  .then(() => {
    console.log('\nScreenshot capture complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nFailed to capture screenshots:', error);
    process.exit(1);
  });
