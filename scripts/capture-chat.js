const { launch, newPage, shot, USERS, BASE, delay } = require('./capture-lib');

const SESSION_ROAD = '30000000-0000-0000-0000-000000000002';

async function main() {
  const browser = await launch();
  const page = await newPage(browser, USERS.sarah);
  await page.goto(`${BASE}/chat/${SESSION_ROAD}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-testid="chat-ready"]', { timeout: 20000 });
  await page.waitForFunction(
    () => (document.body.innerText || '').includes('Session started'),
    { timeout: 15000 }
  );
  await page.click('[data-testid="chat-draft"]');
  await page.type('[data-testid="chat-draft"]', 'Is there covered parking?');
  await page.click('[data-testid="chat-send"]');
  await delay(800);
  await page.waitForFunction(
    () => (document.body.innerText || '').includes('Is there covered parking?'),
    { timeout: 10000 }
  );
  await page.click('[data-testid="chat-photo"]');
  await page.waitForSelector('[data-testid="chat-photo-thumb"]', { timeout: 15000 });
  await shot(page, '15_chat.png');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
