const { launch, newPage, shot, USERS, BASE } = require('./capture-lib');

const SESSION_ROAD = '30000000-0000-0000-0000-000000000002';

async function main() {
  const browser = await launch();
  const page = await newPage(browser, USERS.sarah);
  await page.goto(`${BASE}/location/${SESSION_ROAD}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="location-ready"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="booked-via-app"]', { timeout: 10000 });
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="reviews-heading"]') || {}).textContent?.includes('Reviews (1)'),
    { timeout: 10000 }
  );
  await page.waitForSelector('[data-testid="reviews-average"]', { timeout: 10000 });
  await page.$eval('[data-testid="reviews-heading"]', (el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, '16_reviews.png');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
