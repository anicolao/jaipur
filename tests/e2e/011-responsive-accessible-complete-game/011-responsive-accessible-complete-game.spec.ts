import { expect, test, type Page } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { TestStepHelper } from '../helpers/test-step-helper';

async function expectAccessibleTouchControls(page: Page) {
  const controls = page.locator('button:visible:not(:disabled), input:visible:not(:disabled)');
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    await expect(control).toHaveAccessibleName(/.+/);
    const box = await control.boundingBox();
    expect(box, `control ${index} has a rendered box`).not.toBeNull();
    expect(box?.width, `control ${index} is at least 44 CSS pixels wide`).toBeGreaterThanOrEqual(44);
    expect(box?.height, `control ${index} is at least 44 CSS pixels high`).toBeGreaterThanOrEqual(44);
  }
}

test('the complete table is responsive and accessible by keyboard and touch', async (
  { browser, page },
  testInfo
) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Responsive and accessible complete game',
    'The complete market remains legible and operable by keyboard and touch at phone portrait, phone landscape, tablet, and desktop sizes.'
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-accessible-011-${testInfo.project.name}`,
    'fixed-round-006-0'
  );
  await rival.emulateMedia({ reducedMotion: 'reduce' });

  const viewports: Record<string, { width: number; height: number }> = {
    phone: { width: 393, height: 852 },
    desktop: { width: 1280, height: 1000 },
    'mobile-landscape': { width: 852, height: 393 },
    tablet: { width: 820, height: 1180 }
  };
  expect(page.viewportSize()).toEqual(viewports[testInfo.project.name]);

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(new URL(manifestHref ?? '', page.url()).pathname).toBe('/manifest.webmanifest');
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(await manifestResponse.json()).toMatchObject({
    name: 'Jaipur — Live Card Play',
    display: 'standalone',
    theme_color: '#183a37'
  });

  const exchange = page.getByRole('button', { name: 'Exchange goods' });
  await exchange.focus();
  await expect(exchange).toBeFocused();
  await page.keyboard.press('Enter');
  const diamond = page.getByRole('button', { name: /^Select Diamond/ });
  await diamond.focus();
  await page.keyboard.press('Space');
  const gold = page.getByRole('button', { name: /^Select Gold/ });
  await gold.focus();
  await page.keyboard.press('Space');
  for (const camel of ['Return camel 1', 'Return camel 2']) {
    const returnButton = page.getByRole('button', { name: camel });
    await returnButton.focus();
    await page.keyboard.press('Space');
  }
  const confirmExchange = page.getByRole('button', { name: /^Confirm 2 for 2/ });
  await confirmExchange.focus();

  await steps.step('keyboard-exchange', {
    description: 'A complete exchange is composed with only the keyboard',
    verifications: [
      {
        spec: 'Every selection has a text label, pressed state, and visible instructions',
        check: async () => {
          await expect(diamond).toHaveAttribute('aria-pressed', 'true');
          await expect(gold).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByText('Select at least two market goods')).toBeVisible();
          await expect(confirmExchange).toBeEnabled();
        }
      },
      {
        spec: 'Keyboard focus is visible and turn changes are announced politely',
        check: async () => {
          await expect(confirmExchange).toBeFocused();
          await expect
            .poll(() =>
              confirmExchange.evaluate((element) => getComputedStyle(element).outlineStyle)
            )
            .not.toBe('none');
          await expect(page.locator('.table header')).toHaveAttribute('aria-live', 'polite');
        }
      },
      {
        spec: 'All available controls meet the 44-pixel touch target and have accessible names',
        check: () => expectAccessibleTouchControls(page)
      },
      {
        spec: 'Reduced-motion preference removes card transitions',
        check: async () => {
          await expect
            .poll(() => diamond.evaluate((element) => getComputedStyle(element).transitionDuration))
            .toMatch(/^0s/);
        }
      }
    ]
  });

  await page.keyboard.press('Enter');
  await expect(rival.getByText("Belen's turn")).toBeVisible();
  const sell = rival.getByRole('button', { name: 'Sell goods' });
  await sell.focus();
  await rival.keyboard.press('Enter');
  for (const cardId of ['leather-03', 'leather-06']) {
    const card = rival.getByRole('button', {
      name: `Select Leather ${cardId} for sale`
    });
    await card.focus();
    await rival.keyboard.press('Space');
  }
  const confirmSale = rival.getByRole('button', { name: 'Sell 2 Leather' });
  await confirmSale.focus();
  await rival.keyboard.press('Enter');
  await expect(page.getByText("Asha's turn")).toBeVisible();

  const offline = page.getByRole('button', { name: 'Work offline' });
  await offline.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-status]')).toHaveAttribute('data-status', 'offline');
  const reconnect = page.getByRole('button', { name: 'Reconnect' });
  await reconnect.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-status]')).toHaveAttribute('data-status', 'synced');
  await steps.step('touch-ready-table', {
    description: 'The synchronized table exposes every state without relying on colour',
    verifications: [
      {
        spec: 'Market, private hand, public supplies, and hidden rival information remain labelled',
        check: async () => {
          await expect(page.getByRole('heading', { name: 'Market' })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Your hand' })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Token supplies' })).toBeVisible();
          await expect(page.locator('.opponent')).toContainText('Herd hidden');
          await expect(page.locator('.opponent')).toContainText('values hidden');
          await expect(page.locator('.token.leather')).toContainText('Leather');
          await expect(page.locator('.token.leather')).toContainText('left');
          await expect(page.locator('.market .piece-image')).toHaveCount(5);
          await expect(page.locator('.token-area img')).toHaveCount(6);
        }
      },
      {
        spec: 'Reconnect is keyboard operable and returns to an announced synchronized state',
        check: async () => {
          await expect(page.locator('[data-status]')).toContainText('Game synced');
          await expect(page.getByRole('button', { name: 'Work offline' })).toBeVisible();
        }
      },
      {
        spec: 'All remaining controls retain accessible names and touch-sized targets',
        check: () => expectAccessibleTouchControls(page)
      },
      {
        spec: 'The complete table fits the viewport without document scrolling',
        check: async () => {
          await expect
            .poll(() =>
              page.evaluate(() => ({
                height: document.documentElement.scrollHeight,
                width: document.documentElement.scrollWidth,
                viewportHeight: window.innerHeight,
                viewportWidth: window.innerWidth,
                x: window.scrollX,
                y: window.scrollY
              }))
            )
            .toEqual({
              height: viewports[testInfo.project.name].height,
              width: viewports[testInfo.project.name].width,
              viewportHeight: viewports[testInfo.project.name].height,
              viewportWidth: viewports[testInfo.project.name].width,
              x: 0,
              y: 0
            });
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
