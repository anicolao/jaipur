import { expect, test } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';

async function armFlightCapture(page: import('@playwright/test').Page, selector: string) {
  await page.evaluate((flightSelector) => {
    const browserWindow = window as typeof window & { __jaipurFlightReady?: Promise<void> };
    browserWindow.__jaipurFlightReady = new Promise((resolve) => {
      const inspect = () => {
        const flight = document.querySelector<HTMLElement>(flightSelector);
        if (!flight) return;
        for (const animation of flight.getAnimations({ subtree: true })) animation.pause();
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.body, { childList: true, subtree: true });
      inspect();
    });
  }, selector);
}

async function waitForFlightCapture(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const browserWindow = window as typeof window & { __jaipurFlightReady?: Promise<void> };
    await browserWindow.__jaipurFlightReady;
  });
}

test('a fresh tabletop seats two QR-joined players around one touch market', async (
  { browser, page },
  testInfo
) => {
  test.skip(testInfo.project.name !== 'desktop', 'Tabletop visual coverage uses a landscape-sized display.');
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Shared tabletop mode',
    'A neutral tabletop keeps public play on the shared screen while each QR-joined phone shows only its trader’s private hand and return selections.'
  );
  await page.goto('/tt?seed=tabletop-e2e');

  const tableCode = page.locator('.shared-market > header strong');
  await expect(tableCode).toHaveText(/^[A-Z]{5}$/);
  const firstCode = await tableCode.textContent();
  const playerOneJoin = page.getByRole('link', {
    name: new RegExp(`Join tabletop ${firstCode} as Player 1`)
  });
  const playerTwoJoin = page.getByRole('link', {
    name: new RegExp(`Join tabletop ${firstCode} as Player 2`)
  });
  await expect(playerOneJoin.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(playerTwoJoin.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  const playerOneUrl = await playerOneJoin.getAttribute('href');
  const playerTwoUrl = await playerTwoJoin.getAttribute('href');
  expect(playerOneUrl).toContain('/hand/');
  expect(playerTwoUrl).toContain('/hand/');
  expect(playerOneUrl).toContain(`gameId=${firstCode}&seat=1`);
  expect(playerTwoUrl).toContain(`gameId=${firstCode}&seat=2`);

  const freshPage = await page.context().newPage();
  await freshPage.goto('/tt?seed=tabletop-e2e-second');
  await expect(freshPage.locator('.shared-market > header strong')).toHaveText(/^[A-Z]{5}$/);
  expect(await freshPage.locator('.shared-market > header strong').textContent()).not.toBe(firstCode);
  await freshPage.close();

  const firstContext = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const firstPhone = await firstContext.newPage();
  await firstPhone.goto(playerOneUrl ?? '');
  await firstPhone.getByLabel('Your trader name').fill('Asha');
  await firstPhone.getByRole('button', { name: 'Take this seat' }).click();

  const secondContext = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const secondPhone = await secondContext.newPage();
  await secondPhone.goto(playerTwoUrl ?? '');
  await secondPhone.getByLabel('Your trader name').fill('Belen');
  await secondPhone.getByRole('button', { name: 'Take this seat' }).click();

  await expect(page.locator('.market-card')).toHaveCount(5, { timeout: 5000 });
  await expect(page.locator('[data-seat="1"] h2')).toHaveText('Asha');
  await expect(page.locator('[data-seat="2"] h2')).toHaveText('Belen');
  await expect(firstPhone.locator('[data-e2e-hand-controller]')).toBeVisible();
  await expect(firstPhone.locator('.private-cards')).toBeVisible();
  await expect(firstPhone.locator('.shared-market, .token-rail')).toHaveCount(0);
  const privateGoodsCount = await firstPhone.locator('.card-grid button').count() +
    await secondPhone.locator('.card-grid button').count();
  await expect(page.locator('.tabletop-hand > img')).toHaveCount(privateGoodsCount);
  await expect(page.locator('.tabletop-hand :is(.piece-image, [alt="Diamond"], [alt="Gold"])')).toHaveCount(0);
  await expect.poll(() => firstPhone.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight
  }))).toEqual({ width: 393, height: 852, viewportWidth: 393, viewportHeight: 852 });

  const topTransform = await page.locator('.inverted-content').evaluate(
    (element) => getComputedStyle(element).transform
  );
  expect(topTransform).toMatch(/^matrix\(-1, 0, 0, -1,/);
  await expect(page.locator('.top-log .corner-log')).toHaveClass(/inverted/);
  await expect(page.locator('.bottom-log .corner-log')).not.toHaveClass(/inverted/);
  await expect(page.locator('.token-rail .rail-token')).toHaveCount(6);
  const leatherStack = page.locator('.token-rail [data-token-kind="leather"] [data-token-stack]');
  await expect(leatherStack).toHaveAttribute('data-stack-direction', 'horizontal');
  await expect(leatherStack.locator('.supply-token')).toHaveCount(9);
  const firstRailRim = await leatherStack.locator('.token-chip-rim').nth(0).boundingBox();
  const secondRailRim = await leatherStack.locator('.token-chip-rim').nth(1).boundingBox();
  expect(firstRailRim).not.toBeNull();
  expect(secondRailRim).not.toBeNull();
  expect(secondRailRim!.x - firstRailRim!.x).toBeGreaterThanOrEqual(firstRailRim!.width - 1);
  expect(Math.abs(secondRailRim!.y - firstRailRim!.y)).toBeLessThanOrEqual(1);
  const deckBox = await page.locator('.deck-card').boundingBox();
  const marketCardBox = await page.locator('.market-card').first().boundingBox();
  expect(deckBox).not.toBeNull();
  expect(marketCardBox).not.toBeNull();
  expect(Math.abs(deckBox!.width - marketCardBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(deckBox!.height - marketCardBox!.height)).toBeLessThanOrEqual(1);
  const marketBeforeExchange = await page.locator('.table-market-slot .market-card').evaluateAll(
    (cards) => cards.map((card) => card.getAttribute('data-market-card-id'))
  );

  const privateCards = firstPhone.locator('.card-grid [data-private-card-id]:not(.loaded)');
  const firstReturnId = await privateCards.nth(0).getAttribute('data-private-card-id');
  const secondReturnId = await privateCards.nth(1).getAttribute('data-private-card-id');
  await privateCards.nth(0).click();
  await expect(firstPhone.locator(`[data-private-card-id="${firstReturnId}"]`)).toHaveAttribute('aria-pressed', 'true');
  await firstPhone.locator(`[data-private-card-id="${secondReturnId}"]`).click();
  await expect(firstPhone.locator('.selection-summary strong')).toHaveText('2 selected for the table');

  const targets = page.locator('.table-exchange-target:not(:disabled)');
  const firstTargetMarketId = await targets.nth(0).getAttribute('data-table-exchange-target');
  await armFlightCapture(page, '.table-card-flight');
  await targets.nth(0).click();
  await waitForFlightCapture(page);
  await expect(page.locator('.table-card-flight').first()).toBeVisible();
  await expect(page.locator('.table-exchange-target.loaded')).toHaveCount(1);
  await expect(firstPhone.locator('.selection-summary strong')).toHaveText('1 selected for the table');
  await page.locator('.table-exchange-target:not(.loaded):not(:disabled)').first().click();
  const secondTargetMarketId = await page
    .locator('.table-exchange-target.loaded')
    .nth(1)
    .getAttribute('data-table-exchange-target');
  await expect(page.locator('.table-exchange-target.loaded')).toHaveCount(2);
  await expect(firstPhone.locator('.selection-summary strong')).toHaveText('0 selected for the table');
  await expect(firstPhone.locator('.card-grid button.loaded')).toHaveCount(2);

  await page.locator('[data-seat="1"] footer button').click();
  await expect(page.locator('[data-seat="2"] .turn-state')).toHaveText('Your turn');
  await expect(page.locator('.shared-notice')).toHaveCount(0);
  await page.locator('.bottom-log summary').click();
  await expect(page.locator('.bottom-log li').first()).toContainText(/^Asha traded /);
  await page.locator('.bottom-log summary').click();
  await expect(page.locator('.table-card-flight, .table-token-flight')).toHaveCount(0, { timeout: 3000 });
  const marketAfterExchange = await page.locator('.table-market-slot .market-card').evaluateAll(
    (cards) => cards.map((card) => card.getAttribute('data-market-card-id'))
  );
  const expectedMarketAfterExchange = [...marketBeforeExchange];
  expectedMarketAfterExchange[marketBeforeExchange.indexOf(firstTargetMarketId)] = firstReturnId;
  expectedMarketAfterExchange[marketBeforeExchange.indexOf(secondTargetMarketId)] = secondReturnId;
  expect(marketAfterExchange).toEqual(expectedMarketAfterExchange);

  const publicTake = page.locator('.market-card:not(.camel):not(:disabled)').first();
  await armFlightCapture(page, '.table-card-flight.flips');
  await publicTake.click();
  await waitForFlightCapture(page);
  const refillFlight = page.locator('.table-card-flight.flips');
  await expect(refillFlight).toHaveCount(1);
  await expect(refillFlight).toBeVisible();
  await expect(refillFlight.locator('.table-card-flight-front')).toHaveCount(1);
  const refillFlightSizes = await refillFlight.evaluate((flight) => {
    const style = getComputedStyle(flight);
    return {
      start: parseFloat(style.getPropertyValue('--start-size')),
      end: parseFloat(style.getPropertyValue('--end-size'))
    };
  });
  expect(Math.abs(refillFlightSizes.start - refillFlightSizes.end)).toBeLessThanOrEqual(1);
  const arrivingTableCard = page.locator('.market-card[data-card-arriving="true"]');
  await expect(arrivingTableCard).toHaveCount(1);
  await expect(arrivingTableCard).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('[data-seat="1"] .turn-state')).toHaveText('Your turn');
  await expect(page.locator('.table-card-flight, .table-token-flight')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('.market-card[data-card-arriving="true"]')).toHaveCount(0);

  const saleCard = firstPhone.getByRole('button', {
    name: /^Select (Cloth|Spice|Leather) /
  }).first();
  await expect(saleCard).toBeVisible();
  const saleKind = (await saleCard.getAttribute('aria-label'))
    ?.match(/^Select (Cloth|Spice|Leather) /)?.[1]
    ?.toLowerCase();
  expect(saleKind).toBeTruthy();
  await saleCard.click();
  await expect(firstPhone.locator('.selection-summary strong')).toHaveText('1 selected for the table');
  await armFlightCapture(page, '.table-token-flight');
  await page.locator(`[data-token-kind="${saleKind}"]`).click();
  await waitForFlightCapture(page);
  await expect(page.locator('.table-token-flight').first()).toBeVisible();
  await expect(page.locator('[data-seat="1"] .seat-tokens')).toHaveText('1 token');
  await expect(page.locator('[data-seat="1"] .seat-tokens .token-chip')).toHaveCount(0);
  await expect(page.locator('[data-seat="1"] .seat-tokens')).not.toContainText('points');
  await expect(firstPhone.locator('[data-private-token-tray]')).toContainText(/1 worth \d+ points/);
  await expect(firstPhone.locator('[data-private-token-tray] .token-chip')).toHaveCount(1);
  const privateTokenValue = await firstPhone
    .locator('[data-private-token-tray] .token-chip-center')
    .textContent();
  await expect(firstPhone.locator('[data-private-token-tray]'))
    .toContainText(`1 worth ${privateTokenValue} points`);
  await expect.poll(() => firstPhone.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight
  }))).toEqual({ width: 393, height: 852, viewportWidth: 393, viewportHeight: 852 });
  await expect(page.locator('[data-seat="2"] .turn-state')).toHaveText('Your turn');
  await expect(page.locator('.table-card-flight, .table-token-flight')).toHaveCount(0, { timeout: 3000 });

  // Keep the visual baseline stable after separately proving that every load gets a fresh code.
  await tableCode.evaluate((element) => element.textContent = 'TABLE');

  await steps.step('two-seated-table', {
    description: 'Two opposite player edges share one market and one token rail',
    verifications: [
      {
        spec: 'The top player UI and its upper-left log are rotated exactly 180 degrees',
        check: async () => {
          expect(topTransform).toMatch(/^matrix\(-1, 0, 0, -1,/);
          const topLog = await page.locator('.top-log').boundingBox();
          expect(topLog?.x).toBeLessThan(20);
          expect(topLog?.y).toBeLessThan(20);
        }
      },
      {
        spec: 'The lower player UI and lower-right log remain upright',
        check: async () => {
          const lowerLog = await page.locator('.bottom-log').boundingBox();
          expect(lowerLog?.x).toBeGreaterThan(1000);
          expect(lowerLog?.y).toBeGreaterThan(900);
        }
      },
      {
        spec: 'Private phone selections load face-down table targets and keep exact token values private',
        check: async () => {
          await expect(page.locator('[data-seat="2"] .turn-state')).toHaveText('Your turn');
          await expect(page.locator('.market-card')).toHaveCount(5);
          await expect(page.locator('.tabletop-hand > img')).toHaveCount(privateGoodsCount);
          await expect(page.locator('[data-seat="1"] .seat-tokens')).toHaveText('1 token');
          await expect(page.locator('[data-seat="1"] .seat-tokens')).not.toContainText('points');
          await expect(firstPhone.locator('[data-private-token-tray]')).toContainText(/1 worth \d+ points/);
        }
      },
      {
        spec: 'Public actions use direct card flights instead of a text notification overlay',
        check: async () => {
          await expect(page.locator('.shared-notice, [data-notice-key]')).toHaveCount(0);
        }
      },
      {
        spec: 'The complete tabletop fits without document scrolling',
        check: async () => {
          await expect.poll(() => page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            x: scrollX,
            y: scrollY
          }))).toEqual({
            width: 1280,
            height: 1000,
            viewportWidth: 1280,
            viewportHeight: 1000,
            x: 0,
            y: 0
          });
        }
      }
    ]
  });

  steps.generateDocs();
  await firstContext.close();
  await secondContext.close();
});
