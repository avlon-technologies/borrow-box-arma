import { test, expect, type Browser, type Page } from '@playwright/test';

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

async function search(page: Page, text: string) {
  await page.goto('/');
  await page.getByRole('searchbox').fill(text);
  await expect(page).toHaveURL(new RegExp(`q=${text}`));
}

test('friends start a circle, keep something just for members, and outsiders can’t see it', async ({ browser }) => {
  const sam = await as(browser, 'Sam');
  const theo = await as(browser, 'Theo');
  const priya = await as(browser, 'Priya');

  // Sam starts a circle and invites Theo.
  await sam.getByRole('link', { name: /Circles/ }).first().click();
  await sam.getByRole('link', { name: 'Start a circle' }).click();
  await sam.getByLabel('Name').fill('Elm Street Tool Library');
  await sam.getByLabel(/What’s it for/).fill('Gear we lend each other on Elm Street.');
  await sam.getByRole('checkbox', { name: /Theo Martin/ }).check();
  await sam.getByRole('button', { name: 'Start the circle' }).click();
  await expect(sam.getByRole('heading', { name: 'Elm Street Tool Library', exact: true })).toBeVisible();
  await expect(sam.getByRole('heading', { name: 'Invited' })).toBeVisible();

  // Sam puts the hiking backpack on the shelf, for circle members only.
  // (Priya already has it reserved — that must not change.)
  await sam.getByRole('button', { name: 'Share something you own' }).click();
  await sam.getByLabel('Which of your things?').selectOption({ label: '65 L hiking backpack' });
  await sam.getByRole('radio', { name: /Circle members only/ }).check();
  await sam.getByRole('button', { name: 'Put it on the shelf' }).click();
  await expect(sam.getByText('Elm Street Tool Library only')).toBeVisible();

  // Priya isn't in the circle: the backpack is gone from her catalog, but her booking stands.
  await search(priya, 'backpack');
  await expect(priya.getByRole('link', { name: /Inflatable paddleboard/ })).toBeVisible(); // results have loaded
  await expect(priya.getByRole('link', { name: /65 L hiking backpack/ })).toHaveCount(0);
  await priya.getByRole('link', { name: /Borrowing/ }).first().click();
  await priya.getByRole('link', { name: /65 L hiking backpack/ }).first().click();
  await expect(priya.getByText('Reserved').first()).toBeVisible();

  // Theo sees the invitation (with a badge), joins, and can now find and ask for it.
  await theo.reload();
  await expect(theo.getByRole('link', { name: /Circles/ }).first().getByLabel('1 invitations')).toBeVisible();
  await theo.getByRole('link', { name: /Circles/ }).first().click();
  await expect(theo.getByText('Sam invited you')).toBeVisible();
  await theo.getByRole('button', { name: 'Join the circle' }).click();
  await expect(theo.getByRole('heading', { name: 'Elm Street Tool Library', exact: true })).toBeVisible();
  await search(theo, 'backpack');
  await theo.getByRole('link', { name: /65 L hiking backpack/ }).click();
  await expect(theo.getByText(/you can ask because you’re in Elm Street Tool Library/)).toBeVisible();
  await expect(theo.getByRole('button', { name: 'Choose dates first' })).toBeVisible();
});

test('removing a member keeps their booking but stops new circle-only requests', async ({ browser }) => {
  const maya = await as(browser, 'Maya');
  const priya = await as(browser, 'Priya');

  // Before removing anyone, Maya sees exactly what will and won't change.
  await maya.getByRole('link', { name: /Circles/ }).first().click();
  await maya.getByRole('link', { name: /Riverside Makers/ }).click();
  await maya.getByRole('button', { name: 'Remove Priya' }).click();
  const panel = maya.getByRole('group', { name: 'Remove Priya' });
  await expect(panel.getByText('What stays the same')).toBeVisible();
  await expect(panel.getByText(/Priya’s booking of Maya’s Sewing machine .* still goes ahead/)).toBeVisible();
  await expect(panel.getByText(/Board game night box leaves this shelf/)).toBeVisible();
  await panel.getByRole('button', { name: 'Remove Priya' }).click();
  await expect(maya.getByText(/Priya is no longer in Riverside Makers/)).toBeVisible();
  await expect(maya.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(maya.locator('.member-list').getByText('Priya Natarajan')).toHaveCount(0);

  // Priya's reservation is untouched and explains itself.
  await priya.getByRole('link', { name: /Borrowing/ }).first().click();
  await priya.getByRole('link', { name: /Sewing machine/ }).first().click();
  await expect(priya.getByText('Reserved').first()).toBeVisible();
  await expect(priya.getByText(/stopped being a member .* so it carries on as agreed/)).toBeVisible();

  // But she can't ask for it again, and the circle is closed to her.
  await priya.getByRole('link', { name: 'Sewing machine', exact: true }).click();
  await expect(priya.getByText(/not part of right now. Anything you’ve already arranged still goes ahead/)).toBeVisible();
  await expect(priya.getByRole('button', { name: /Ask Maya/ })).toHaveCount(0);
  await priya.goto('/circles');
  await expect(priya.getByRole('link', { name: /Riverside Makers/ })).toHaveCount(0);

  // Maya still has the booking in Lending.
  await maya.getByRole('link', { name: /Lending/ }).first().click();
  await expect(maya.getByRole('link', { name: /Sewing machine/ }).first()).toBeVisible();

  // People can be invited back: Priya rejoins and puts her game box back on the shelf.
  await maya.goBack();
  await maya.getByRole('button', { name: 'Invite a friend' }).click();
  await maya.getByLabel('Invite someone').selectOption({ label: 'Priya Natarajan · Maple Court' });
  await maya.getByRole('button', { name: 'Send invitation' }).click();
  await expect(maya.getByText('Invitation sent to Priya')).toBeVisible();
  await priya.reload();
  await priya.getByRole('button', { name: 'Join the circle' }).click();
  await expect(priya.getByRole('heading', { name: 'Riverside Makers', exact: true })).toBeVisible();
  await priya.getByRole('button', { name: 'Share something you own' }).click();
  await priya.getByLabel('Which of your things?').selectOption({ label: 'Board game night box' });
  await expect(priya.getByRole('radio', { name: /Circle members only/ })).toBeChecked(); // keeps its setting
  await priya.getByRole('button', { name: 'Put it on the shelf' }).click();
  await expect(priya.getByText(/Board game night box is on the Riverside Makers shelf/)).toBeVisible();
});

test('circles work on a phone without sideways scrolling', async ({ browser }) => {
  const page = await as(browser, 'Sam', { width: 390, height: 844 });
  const nav = page.getByRole('navigation', { name: 'Main' }).last();
  await nav.getByRole('link', { name: /Circles/ }).click();
  await expect(page.getByRole('heading', { name: 'Circles', exact: true })).toBeVisible();
  const circle = page.locator('a.circle-card').first();
  const href = await circle.getAttribute('href');
  for (const path of ['/circles', href!, '/circles/new', '/items/new']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
