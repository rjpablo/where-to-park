const { launch, newPage, shot, USERS, BASE } = require('./capture-lib');

async function main() {
  const browser = await launch();
  const page = await newPage(browser, USERS.sarah);
  await page.goto(`${BASE}/vehicles`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="vehicles-ready"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="vehicle-row-My Car"]', { timeout: 10000 });
  await shot(page, '14_saved_vehicles.png');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
