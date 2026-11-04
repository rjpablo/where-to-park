const fs = require('fs');
const path = require('path');
const { launch, newPage, shot, USERS, BASE, delay } = require('./capture-lib');

const SESSION_ROAD = '30000000-0000-0000-0000-000000000002';
const SM = '30000000-0000-0000-0000-000000000001';

async function expandSheet(page) {
  const toggle = await page.$('[data-testid="sheet-expand-toggle"]');
  if (toggle) await toggle.click();
  await delay(400);
}

async function main() {
  const browser = await launch();

  const guest = await newPage(browser);
  await guest.goto(`${BASE}/search`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await guest.waitForSelector('[data-testid="search-ready"]', { timeout: 20000 });
  await expandSheet(guest);
  await guest.waitForSelector('[data-testid="unverified-badge-Burnham Park Street Parking"]', {
    timeout: 15000,
  });
  await guest.$eval('[data-testid="unverified-badge-Burnham Park Street Parking"]', (el) =>
    el.scrollIntoView({ block: 'center' })
  );
  await shot(guest, '24_unverified_guest_search.png');

  await guest.click('[data-testid="sheet-expand-toggle"]');
  await delay(600);
  await guest.evaluate(() => {
    const map = window.__WTP_MAP;
    if (map) {
      map.easeTo({ center: [120.595, 16.413], zoom: 13, duration: 0 });
    }
  });
  await delay(3500);
  await shot(guest, '25_web_pin_clusters.png');
  await guest.close();

  const avail = await newPage(browser, USERS.maria);
  await avail.goto(`${BASE}/operator/availability`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await avail.waitForSelector('[data-testid="availability-ready"]', { timeout: 20000 });
  await avail.click('[data-testid="mode-open-full"]');
  await delay(600);
  await avail.waitForSelector('[data-testid="toggle-full"]', { timeout: 10000 });
  await avail.click('[data-testid="toggle-full"]');
  await delay(600);
  await avail.waitForFunction(
    () =>
      (document.querySelector('[data-testid="availability-status"]') || {}).textContent?.trim() ===
      'Full',
    { timeout: 10000 }
  );
  await shot(avail, '26_open_full_console.png');
  await avail.click('[data-testid="toggle-open"]');
  await delay(400);
  await avail.click('[data-testid="mode-count"]');
  await delay(400);
  await avail.close();

  const sessions = await newPage(browser, USERS.juan);
  await sessions.goto(`${BASE}/staff/sessions`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sessions.waitForSelector('[data-testid="sessions-ready"]', { timeout: 20000 });
  await sessions.waitForSelector('[data-testid="session-row-ABC 1234"]', { timeout: 15000 });
  await sessions.click('[data-testid="session-adjust-toggle-ABC 1234"]');
  await sessions.waitForSelector('[data-testid="session-adjust-ABC 1234"]', { timeout: 10000 });
  await sessions.waitForSelector('[data-testid="override-start-ABC 1234-label"]', {
    timeout: 10000,
  });
  await sessions.$eval('[data-testid="session-adjust-ABC 1234"]', (el) =>
    el.scrollIntoView({ block: 'center' })
  );
  await shot(sessions, '27_local_time_picker.png');

  await sessions.$eval('[data-testid="extend-session-ABC 1234"]', (el) =>
    el.scrollIntoView({ block: 'center' })
  );
  await sessions.click('[data-testid="extend-session-ABC 1234"]');
  await sessions.waitForFunction(
    () => (document.body.innerText || '').includes('Session extended'),
    { timeout: 10000 }
  );
  await shot(sessions, '28_extend_session.png');
  await sessions.close();

  const inbox = await newPage(browser, USERS.juan);
  await inbox.goto(`${BASE}/notifications`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await inbox.waitForSelector('[data-testid="notifications-ready"]', { timeout: 20000 });
  await inbox.waitForSelector('[data-testid="notification-scheduled_end"]', { timeout: 15000 });
  await inbox.waitForSelector('[data-testid="notification-session_extended"]', { timeout: 15000 });
  await shot(inbox, '29_notifications_inbox.png');
  await inbox.close();

  const chat = await newPage(browser, USERS.sarah);
  await chat.goto(`${BASE}/chat/${SM}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await chat.waitForSelector('[data-testid="chat-ready"]', { timeout: 20000 });
  const jpegPath = '/tmp/wtp-chat-photo.jpg';
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'chat-photo.jpg'), jpegPath);
  const fileInput = await chat.waitForSelector('[data-testid="chat-photo-file"]', {
    timeout: 10000,
  });
  await fileInput.uploadFile(jpegPath);
  await chat.waitForSelector('[data-testid="chat-photo-thumb"]', { timeout: 15000 });
  await shot(chat, '30_chat_processed_photo.png');
  await chat.close();

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
