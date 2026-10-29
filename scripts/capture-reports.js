const { launch, newPage, shot, USERS, BASE, delay } = require('./capture-lib');

const SESSION_ROAD = '30000000-0000-0000-0000-000000000002';

async function main() {
  const browser = await launch();
  const sarah = await newPage(browser, USERS.sarah);
  await sarah.goto(`${BASE}/location/${SESSION_ROAD}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sarah.waitForSelector('[data-testid="location-ready"]', { timeout: 20000 });
  await sarah.click('[data-testid="report-listing"]');
  await sarah.waitForSelector('[data-testid="report-reason"]', { timeout: 10000 });
  await sarah.click('[data-testid="report-submit"]');
  await sarah.waitForFunction(
    () => (document.body.innerText || '').includes('Report sent'),
    { timeout: 10000 }
  );
  await sarah.close();

  const admin = await newPage(browser, USERS.admin);
  await admin.goto(`${BASE}/admin/reports`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await admin.waitForSelector('[data-testid="reports-ready"]', { timeout: 20000 });
  await admin.waitForSelector('[data-testid="report-location"]', { timeout: 10000 });
  await delay(400);
  await shot(admin, '17_moderation.png');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
