const { launch, newPage, shot, USERS, BASE, delay } = require('./capture-lib');

const SESSION_ROAD = '30000000-0000-0000-0000-000000000002';

async function expandSheet(page) {
  const toggle = await page.$('[data-testid="sheet-expand-toggle"]');
  if (toggle) await toggle.click();
  await delay(400);
}

async function main() {
  const browser = await launch();

  const search = await newPage(browser, USERS.sarah);
  await search.goto(`${BASE}/search`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await search.waitForSelector('[data-testid="search-ready"]', { timeout: 20000 });
  await expandSheet(search);
  await search.waitForSelector('[data-testid="availability-stale"]', { timeout: 15000 });
  await search.$eval('[data-testid="availability-stale"]', (el) => el.scrollIntoView({ block: 'center' }));
  await shot(search, '18_stale_availability.png');

  await search.click('[data-testid="filter-monthly"]');
  await delay(1200);
  await search.waitForFunction(
    () => (document.body.innerText || '').includes('Monthly') && (document.body.innerText || '').includes('SM City'),
    { timeout: 15000 }
  );
  await shot(search, '19_monthly_filter.png');
  await search.close();

  const loc = await newPage(browser, USERS.sarah);
  await loc.goto(`${BASE}/location/${SESSION_ROAD}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await loc.waitForSelector('[data-testid="location-ready"]', { timeout: 20000 });
  await loc.waitForSelector('[data-testid="navigate-google"]', { timeout: 10000 });
  await loc.waitForSelector('[data-testid="reviews-heading"]', { timeout: 10000 });
  await loc.waitForFunction(
    () => (document.querySelector('[data-testid="reviews-heading"]') || {}).textContent?.includes('Reviews (1)'),
    { timeout: 10000 }
  );
  await loc.waitForSelector('[data-testid="reviews-average"]', { timeout: 10000 });
  await shot(loc, '20_navigate.png');
  await loc.$eval('[data-testid="reviews-heading"]', (el) => el.scrollIntoView({ block: 'center' }));
  await shot(loc, '16_reviews.png');
  await loc.close();

  const avail = await newPage(browser, USERS.maria);
  await avail.goto(`${BASE}/operator/availability`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await avail.waitForSelector('[data-testid="availability-ready"]', { timeout: 20000 });
  await avail.click('[data-testid="reserved-plus"]');
  await delay(400);
  await avail.click('[data-testid="reserved-plus"]');
  await delay(400);
  await avail.click('[data-testid="unavailable-plus"]');
  await delay(600);
  await avail.waitForFunction(
    () => (document.querySelector('[data-testid="reserved-value"]') || {}).textContent?.trim() === '2',
    { timeout: 10000 }
  );
  await shot(avail, '21_availability_reserved.png');
  await avail.close();

  const sessions = await newPage(browser, USERS.juan);
  await sessions.goto(`${BASE}/staff/sessions`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sessions.waitForSelector('[data-testid="sessions-ready"]', { timeout: 20000 });
  await sessions.waitForSelector('[data-testid="session-row-ABC 1234"]', { timeout: 15000 });
  await sessions.waitForSelector('[data-testid="parking-so-far-ABC 1234"]', { timeout: 10000 });
  await sessions.waitForSelector('[data-testid="overdue-badge-ABC 1234"]', { timeout: 10000 });
  const applyLost = await sessions.$('[data-testid="session-apply-Lost Ticket"]');
  if (applyLost) {
    await applyLost.click();
    await sessions.waitForSelector('[data-testid="extra-fees-ABC 1234"]', { timeout: 10000 });
  }
  await sessions.$eval('[data-testid="session-row-ABC 1234"]', (el) =>
    el.scrollIntoView({ block: 'start' })
  );
  await shot(sessions, '17_session_live_balance.png');
  await sessions.click('[data-testid="session-adjust-toggle-ABC 1234"]');
  await sessions.waitForSelector('[data-testid="session-adjust-ABC 1234"]', { timeout: 10000 });
  await sessions.$eval('[data-testid="session-adjust-ABC 1234"]', (el) =>
    el.scrollIntoView({ block: 'center' })
  );
  await shot(sessions, '22_overdue_overrides.png');
  await sessions.click('[data-testid="end-session-ABC 1234"]');
  await sessions.waitForSelector('[data-testid="session-close-form"]', { timeout: 10000 });
  await sessions.$eval('[data-testid="session-close-form"]', (el) =>
    el.scrollIntoView({ block: 'center' })
  );
  await shot(sessions, '17b_session_close.png');
  await sessions.close();

  const profile = await newPage(browser, USERS.sarah);
  await profile.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await profile.waitForSelector('[data-testid="profile-ready"]', { timeout: 20000 });
  await profile.waitForSelector('[data-testid="pref-nav-google"]', { timeout: 10000 });
  await shot(profile, '23_nav_preference.png');
  await profile.close();

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
