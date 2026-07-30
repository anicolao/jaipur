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

  const handCards = page.locator('.hand .hand-card');
  const draggedCard = handCards.first();
  const diamondReturn = page.getByRole('button', {
    name: /^Choose a hand card to exchange for Diamond/
  });
  await diamondReturn.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.interaction-tray p')).toContainText(
    'Choose or drag a hand card'
  );
  await handCards.first().focus();
  await page.keyboard.press('Space');
  await expect(diamondReturn).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear' }).click();

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await draggedCard.dispatchEvent('dragstart', { dataTransfer });
  await diamondReturn.dispatchEvent('dragover', { dataTransfer });
  await diamondReturn.dispatchEvent('drop', { dataTransfer });

  const keyboardCard = handCards.nth(1);
  await keyboardCard.focus();
  await page.keyboard.press('Space');
  const goldReturn = page.getByRole('button', {
    name: /^Choose a hand card to exchange for Gold/
  });
  await goldReturn.focus();
  await page.keyboard.press('Enter');
  const confirmExchange = page.getByRole('button', { name: 'Trade 2 for 2' });
  await confirmExchange.focus();

  await steps.step('keyboard-exchange', {
    description: 'A direct exchange is composed by drag and drop plus keyboard routing',
    verifications: [
      {
        spec: 'Both card-back destinations expose their loaded pressed state',
        check: async () => {
          await expect(diamondReturn).toHaveAttribute('aria-pressed', 'true');
          await expect(goldReturn).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('.interaction-tray p')).toContainText('2 market cards loaded');
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
            .poll(() => draggedCard.evaluate((element) => getComputedStyle(element).transitionDuration))
            .toMatch(/^0s/);
        }
      }
    ]
  });

  await page.keyboard.press('Enter');
  await expect(rival.getByText("Belen's turn")).toBeVisible();
  for (const cardId of ['leather-03', 'leather-06']) {
    const card = rival.getByRole('button', {
      name: `Select Leather ${cardId}`
    });
    await card.focus();
    await rival.keyboard.press('Space');
  }
  const confirmSale = rival.getByRole('button', {
    name: 'Sell 2 selected Leather to the Leather token stack'
  });
  await confirmSale.focus();
  await rival.keyboard.press('Enter');
  await expect(page.getByText("Asha's turn")).toBeVisible();

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
        spec: 'Connection state remains announced without an offline-mode control',
        check: async () => {
          await expect(page.locator('[data-status]')).toContainText('Game synced');
          await expect(page.getByRole('button', { name: 'Work offline' })).toHaveCount(0);
          await expect(page.getByTestId('build-marker')).toHaveText('Build e2e-tes');
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
