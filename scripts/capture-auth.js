const { launch, newPage, shot, BASE, delay } = require('./capture-lib');

async function main() {
  const browser = await launch();
  const page = await newPage(browser, null);
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="auth-ready"]', { timeout: 20000 });
  await page.click('[data-testid="auth-send-otp"]');
  await delay(400);
  await page.waitForSelector('[data-testid="auth-otp"]', { timeout: 10000 });
  await page.type('[data-testid="auth-otp"]', '123456');
  await shot(page, '13_phone_otp.png');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
