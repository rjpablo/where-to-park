const { launch, newPage, shot, USERS, BASE } = require('./capture-lib');

async function main() {
  const browser = await launch();
  const page = await newPage(browser, USERS.juan);
  await page.goto(`${BASE}/operator/rates`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="rates-ready"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="quote-amount"]', { timeout: 15000 });
  await shot(page, '10_operator_rates.png');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
