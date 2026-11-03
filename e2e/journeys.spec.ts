import { test, expect, type Browser, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

/** Open a fresh browser context signed in as one of the demo people. */
async function as(browser: Browser, name: string, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name: 'What do you need to borrow?' })).toBeVisible();
  return page;
}

/** A tiny valid PNG (solid colour), so photo uploads go through the real pipeline. */
function png(): Buffer {
  const w = 8, h = 8;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([196, 85, 58]).flat())])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Pick the first fully free run of `days` days on the visible calendar. */
async function pickDates(page: Page, days: number) {
  const free = page.locator('button.calendar-day:not([aria-disabled]):not(.is-past)');
  const first = free.first();
  const firstDay = await first.getAttribute('data-day');
  await first.click();
  if (days > 1) {
    const d = new Date(firstDay + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days - 1);
    await page.locator(`button.calendar-day[data-day="${d.toISOString().slice(0, 10)}"]`).click();
  }
}

test('borrow → approve → ready → pickup → return → owner confirms with a differing account', async ({ browser }) => {
  const sam = await as(browser, 'Sam');
  const priya = await as(browser, 'Priya');

  // Sam finds the telescope through search and requests dates with a note.
  await sam.getByRole('searchbox').fill('telescope');
  await sam.getByRole('link', { name: /Tabletop telescope/ }).click();
  await expect(sam.getByText('Up to 7 days at a time')).toBeVisible();
  await pickDates(sam, 3);
  await sam.getByLabel(/Note to Priya/).fill('Meteor shower this weekend!');
  await sam.getByRole('button', { name: 'Ask Priya to borrow it' }).click();
  await expect(sam.getByRole('heading', { name: 'Request sent to Priya' })).toBeVisible();
  const loanUrl = sam.url();

  // Pending state survives a refresh.
  await sam.reload();
  await expect(sam.getByRole('heading', { name: 'Request sent to Priya' })).toBeVisible();
  await expect(sam.getByText('Waiting for Priya').first()).toBeVisible();

  // Priya sees it in Lending and approves.
  await priya.getByRole('link', { name: /Lending/ }).first().click();
  await priya.getByRole('link', { name: /Tabletop telescope/ }).first().click();
  await expect(priya.getByRole('heading', { name: /Sam would like to borrow your tabletop telescope/ })).toBeVisible();
  await expect(priya.getByText('“Meteor shower this weekend!”').first()).toBeVisible();
  await priya.getByRole('button', { name: 'Approve' }).click();
  await expect(priya.getByRole('heading', { name: 'Reserved for Sam' })).toBeVisible();

  // Priya marks it ready, recording its condition first.
  await priya.getByRole('button', { name: 'Mark ready for pickup' }).click();
  await priya.getByLabel(/Pickup details/).fill('On my porch, in the black case.');
  await priya.getByText('Like new', { exact: true }).click();
  await priya.getByLabel(/^Notes/).fill('Lens cleaned, all caps on.');
  await priya.getByRole('button', { name: 'Mark ready', exact: true }).click();
  await expect(priya.getByRole('heading', { name: 'Waiting for Sam to collect it' })).toBeVisible();

  // Sam confirms pickup (his page refreshes on focus; reload to be explicit).
  await sam.goto(loanUrl);
  await expect(sam.getByRole('heading', { name: 'Ready for pickup' })).toBeVisible();
  await sam.getByRole('button', { name: 'I’ve picked it up' }).click();
  await sam.getByRole('button', { name: 'Yes, I have it' }).click();
  await expect(sam.getByRole('heading', { name: /Enjoy! Due back/ })).toBeVisible();

  // Sam starts the return with notes and a photo.
  await sam.getByRole('button', { name: 'Start return' }).click();
  await sam.getByText('Good, normal use', { exact: true }).click();
  await sam.getByLabel(/^Notes/).fill('Worked perfectly, packed back in the case.');
  await sam.locator('input[type=file]').setInputFiles({ name: 'return.png', mimeType: 'image/png', buffer: png() });
  await expect(sam.getByRole('img', { name: 'Photo 1' })).toBeVisible();
  await sam.getByRole('button', { name: 'Start return', exact: true }).last().click();
  await expect(sam.getByRole('heading', { name: 'Thanks for bringing it back' })).toBeVisible();

  // Priya confirms but sees it differently — her account sits beside Sam's.
  await priya.goto(loanUrl);
  await priya.getByRole('button', { name: 'Confirm it’s back' }).click();
  await priya.getByText('I see it differently').click();
  await priya.getByText('Something’s damaged', { exact: true }).click();
  await priya.getByLabel('What’s different?').fill('Finder scope bracket is bent.');
  await priya.getByRole('button', { name: 'Confirm it’s back' }).last().click();
  await expect(priya.getByRole('heading', { name: 'Back home — with differing notes' })).toBeVisible();

  await sam.reload();
  await expect(sam.getByText('Worked perfectly, packed back in the case.')).toBeVisible();
  await expect(sam.getByText('Finder scope bracket is bent.')).toBeVisible();
  await expect(sam.getByText('Sees it differently')).toBeVisible();
  await expect(sam.getByRole('img', { name: /Condition photo 1 from Sam/ })).toBeVisible();
  const history = sam.locator('.timeline');
  for (const text of ['You asked to borrow it', 'Priya approved the request', 'Priya marked it ready for pickup', 'You picked it up', 'You started the return', 'Priya confirmed it’s back'])
    await expect(history.getByText(text)).toBeVisible();
});

test('overlapping requests: approving one blocks the other, with an explanation', async ({ browser }) => {
  const sam = await as(browser, 'Sam');
  await sam.getByRole('link', { name: /Lending/ }).first().click();
  await sam.getByRole('link', { name: /Four-person camping tent.*Priya/ }).click();
  await expect(sam.getByText('Other people want overlapping dates')).toBeVisible();
  await sam.getByRole('button', { name: 'Approve' }).click();
  await expect(sam.getByRole('heading', { name: 'Reserved for Priya' })).toBeVisible();

  await sam.getByRole('link', { name: /Maya ·/ }).click();
  await expect(sam.getByText(/Overlaps Priya’s booking/)).toBeVisible();
  await expect(sam.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await sam.getByRole('button', { name: 'Decline…' }).click();
  await sam.getByLabel(/A note for Maya/).fill('Sorry Maya — already lent that weekend!');
  await sam.getByRole('button', { name: 'Decline request' }).click();
  await expect(sam.getByRole('heading', { name: 'You declined this request' })).toBeVisible();

  const maya = await as(browser, 'Maya');
  await maya.getByRole('link', { name: /Borrowing/ }).first().click();
  await expect(maya.getByText('Not this time')).toBeVisible();
});

test('extension: conflict suggestion, then owner accepts and the due date moves', async ({ browser }) => {
  const maya = await as(browser, 'Maya');
  await maya.getByRole('link', { name: /Borrowing/ }).first().click();
  await maya.getByRole('link', { name: /Portable movie projector/ }).first().click();
  await maya.getByRole('button', { name: 'Ask for more time' }).click();
  // Theo is booked from today+4 in the seed; asking for +5 days collides.
  const due = await maya.locator('input[type=date]').getAttribute('min');
  const plus = (n: number) => {
    const d = new Date(due + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  await maya.locator('input[type=date]').fill(plus(3));
  await maya.getByRole('button', { name: 'Ask Priya' }).click();
  await expect(maya.getByText(/The latest you could ask for is/)).toBeVisible();
  await maya.getByRole('button', { name: /instead$/ }).click();
  await maya.getByRole('button', { name: 'Ask Priya' }).click();
  await expect(maya.locator('.ext-title')).toContainText('You asked to keep it until');

  const priya = await as(browser, 'Priya');
  await priya.goto(maya.url());
  await expect(priya.locator('.ext-title')).toContainText('Maya asked to keep it until');
  await priya.getByRole('button', { name: 'Yes, extend it' }).click();
  await expect(priya.getByText(/extended from/)).toBeVisible();
  await expect(priya.locator('.timeline').getByText(/You agreed — new due date/)).toBeVisible();
});

test('overdue loans show a gentle indicator and stay returnable', async ({ browser }) => {
  const sam = await as(browser, 'Sam');
  await sam.getByRole('link', { name: /Borrowing/ }).first().click();
  await expect(sam.getByText('2 days late')).toBeVisible();
  await sam.getByRole('link', { name: /Cordless drill/ }).click();
  await expect(sam.getByText(/Overdue · was due/)).toBeVisible();
  await sam.getByRole('button', { name: 'Start return' }).click();
  await sam.locator('.condition-option', { hasText: 'Good, normal use' }).click();
  await sam.getByRole('button', { name: 'Start return', exact: true }).last().click();
  await expect(sam.getByRole('heading', { name: 'Thanks for bringing it back' })).toBeVisible();
});

test('hiding an item stops new requests but keeps the existing reservation', async ({ browser }) => {
  const sam = await as(browser, 'Sam');
  await expect(sam.getByRole('link', { name: /Pressure washer/ })).toHaveCount(0);
  await sam.goto('/items/item-washer');
  await expect(sam.getByRole('heading', { name: 'This item is resting' })).toBeVisible();

  const priya = await as(browser, 'Priya');
  await priya.getByRole('link', { name: /Borrowing/ }).first().click();
  await expect(priya.getByRole('link', { name: /Pressure washer.*Reserved/ })).toBeVisible();

  // The owner can hide and show items from the item page.
  const theo = await as(browser, 'Theo');
  await theo.goto('/items/item-tables');
  await theo.getByRole('button', { name: 'Hide from catalog' }).click();
  await expect(theo.getByText('Hidden from the catalog').first()).toBeVisible();
  await sam.goto('/');
  await expect(sam.getByRole('link', { name: /Garden party set/ })).toHaveCount(0);
  await theo.getByRole('button', { name: 'Show in catalog' }).click();
  await sam.reload();
  await expect(sam.getByRole('link', { name: /Garden party set/ })).toBeVisible();
});

test('owners list a new item with a photo, and can edit it', async ({ browser }) => {
  const theo = await as(browser, 'Theo');
  await theo.getByRole('link', { name: 'Share something' }).click();
  await theo.locator('input[type=file]').setInputFiles({ name: 'saw.png', mimeType: 'image/png', buffer: png() });
  await theo.getByLabel('What is it?').fill('Tile saw');
  await theo.getByLabel('Category').selectOption('Tools');
  await theo.getByLabel('Longest loan').fill('3');
  await theo.getByLabel(/Pickup & return/).fill('Harbour Lane garage');
  await theo.getByRole('button', { name: 'Add to my shelf' }).click();
  await expect(theo.getByRole('heading', { name: 'Tile saw' })).toBeVisible();
  await expect(theo.getByRole('img', { name: 'Tile saw' })).toBeVisible();
  await theo.getByRole('link', { name: 'Edit', exact: true }).click();
  await theo.getByLabel('What is it?').fill('Wet tile saw');
  await theo.getByRole('button', { name: 'Save changes' }).click();
  await expect(theo.getByRole('heading', { name: 'Wet tile saw' })).toBeVisible();
  // It's not possible to borrow your own item.
  await expect(theo.getByRole('button', { name: /Ask .* to borrow it/ })).toHaveCount(0);
});

test('keyboard only: sign in, pick dates with arrow keys, send a request', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  const maya = page.getByRole('button', { name: /Maya Okafor/ });
  await expect(maya).toBeVisible();
  for (let i = 0; i < 8 && !(await maya.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(maya).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'What do you need to borrow?' })).toBeVisible();
  await page.goto('/items/item-games');
  const today = page.locator('button.calendar-day[tabindex="0"]');
  await today.focus();
  await page.keyboard.press('ArrowDown'); // a week from today
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.summary-dates')).toBeVisible();
  await expect(page.getByText('3 days', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Ask Priya to borrow it' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Request sent to Priya' })).toBeVisible();
});

test('phone layout: bottom navigation and no sideways scrolling', async ({ browser }) => {
  const page = await as(browser, 'Maya', { width: 390, height: 844 });
  const nav = page.getByRole('navigation', { name: 'Main' }).last();
  await expect(nav).toBeVisible();
  for (const path of ['/', '/borrowing', '/lending', '/items/item-tent']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
  await nav.getByRole('link', { name: /Lending/ }).click();
  await expect(page.getByRole('heading', { name: 'Lending' })).toBeVisible();
});

test('two tabs can be two different people', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await a.goto('/');
  await a.getByRole('button', { name: /Sam Whitfield/ }).click();
  await expect(a.locator('.hero .eyebrow')).toBeVisible();
  const b = await ctx.newPage();
  await b.goto('/');
  // New tab starts as the most recent person, then switches independently.
  await b.getByRole('button', { name: /Sam/ }).first().click();
  await b.getByRole('menuitem', { name: /Theo Martin/ }).click();
  await expect(b.locator('.hero .eyebrow')).toContainText('Theo');
  await a.reload();
  await expect(a.locator('.hero .eyebrow')).toContainText('Sam');
});
