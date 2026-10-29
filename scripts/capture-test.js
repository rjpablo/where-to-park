const puppeteer = require('puppeteer');

async function test() {
  console.log('Starting test...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  
  console.log('Navigating to localhost:19006...');
  await page.goto('http://localhost:19006/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  console.log('Waiting 3 seconds...');
  await new Promise(r => setTimeout(r, 3000));
  
  const content = await page.content();
  console.log('Page loaded. Content length:', content.length);
  
  if (content.includes('Uncaught')) {
    console.log('ERROR DETECTED:');
    const errors = content.match(/Uncaught[^<]*/g);
    if (errors) errors.forEach(e => console.log('  -', e));
  } else {
    console.log('No Uncaught errors found');
  }
  
  await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/test.png' });
  console.log('Screenshot saved');
  
  await browser.close();
}

test().catch(console.error);
