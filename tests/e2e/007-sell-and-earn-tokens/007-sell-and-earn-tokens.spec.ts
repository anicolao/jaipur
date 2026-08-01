import { expect, test, type Locator, type Page } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { TestStepHelper } from '../helpers/test-step-helper';

const center = (box: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2
});

async function finishTokenFlights(page: Page) {
  await page.locator('.token-flight').evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.finish();
  });
  await expect(page.locator('.token-flight')).toHaveCount(0);
}

async function finishActionCardFlights(page: Page) {
  await page.locator('.action-card-flight').evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.finish();
  });
  await expect(page.locator('.action-card-flight')).toHaveCount(0);
}

async function armFlightCapture(page: Page, selector: string, expectedCount: number) {
  await page.evaluate(({ selector, expectedCount }) => {
    const browserWindow = window as typeof window & { __jaipurFlightReady?: Promise<void> };
    browserWindow.__jaipurFlightReady = new Promise((resolve) => {
      const inspect = () => {
        const flights = [...document.querySelectorAll<HTMLElement>(selector)];
        if (flights.length < expectedCount) return;
        for (const flight of flights) {
          for (const animation of flight.getAnimations({ subtree: true })) animation.pause();
        }
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.body, { childList: true, subtree: true });
      inspect();
    });
  }, { selector, expectedCount });
}

async function waitForFlightCapture(page: Page) {
  await page.evaluate(async () => {
    const browserWindow = window as typeof window & { __jaipurFlightReady?: Promise<void> };
    await browserWindow.__jaipurFlightReady;
  });
}

test('both traders sell goods and earn public and private tokens', async ({ browser, page }, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Sell goods and earn tokens',
    'Physical chips leave their ordered supplies and fly to each seller before Belen completes an ordinary sale.'
  );
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-sale-007-${testInfo.project.name}`,
    'fixed-round-007-15'
  );

  const spiceSupply = page.locator('.token.spice');
  const initialSpiceTokens = spiceSupply.locator('.supply-token');
  await expect(initialSpiceTokens).toHaveCount(7);
  await expect(initialSpiceTokens.locator('.token-chip-center')).toHaveCount(0);
  await expect(initialSpiceTokens.locator('.token-chip-rim')).toHaveText([
    '5', '3', '3', '2', '2', '1', '1'
  ]);
  await expect(spiceSupply.locator('[data-token-stack]')).toHaveAttribute(
    'data-stack-direction',
    'vertical'
  );
  const tokenBox = await initialSpiceTokens.first().boundingBox();
  expect(tokenBox?.width).toBeGreaterThanOrEqual(48);
  const secondTokenBox = await initialSpiceTokens.nth(1).boundingBox();
  const firstRimBox = await initialSpiceTokens.first().locator('.token-chip-rim').boundingBox();
  const secondRimBox = await initialSpiceTokens.nth(1).locator('.token-chip-rim').boundingBox();
  expect(tokenBox).not.toBeNull();
  expect(secondTokenBox).not.toBeNull();
  expect(firstRimBox).not.toBeNull();
  expect(secondRimBox).not.toBeNull();
  expect(Math.abs(secondTokenBox!.x - tokenBox!.x)).toBeLessThanOrEqual(1);
  expect(secondRimBox!.y - firstRimBox!.y).toBeGreaterThanOrEqual(firstRimBox!.height - 1);
  const rimValueStyle = await initialSpiceTokens.first().locator('.token-chip-rim').evaluate(
    (value) => {
      const style = getComputedStyle(value);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        fontSize: parseFloat(style.fontSize),
        strokeWidth: parseFloat(style.webkitTextStrokeWidth)
      };
    }
  );
  expect(rimValueStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(rimValueStyle.color).toBe('rgb(255, 251, 234)');
  expect(rimValueStyle.fontSize).toBeGreaterThanOrEqual(11.5);
  expect(rimValueStyle.fontSize).toBeLessThan(15);
  expect(rimValueStyle.strokeWidth).toBeGreaterThan(0);
  const firstSpiceId = await initialSpiceTokens.first().getAttribute('data-supply-token-id');
  const firstSpiceBox = await initialSpiceTokens.first().boundingBox();
  const firstZ = Number(await initialSpiceTokens.first().evaluate(
    (token) => getComputedStyle(token).zIndex
  ));
  const lastZ = Number(await initialSpiceTokens.last().evaluate(
    (token) => getComputedStyle(token).zIndex
  ));
  expect(firstZ).toBeGreaterThan(lastZ);

  await armFlightCapture(page, '.token-flight', 4);
  await page.getByRole('button', {
    name: 'Sell all 3 Spice to the Spice token stack'
  }).click();
  await waitForFlightCapture(page);

  const firstFlight = page.locator(`[data-token-flight-id="${firstSpiceId}"]`);
  await expect(firstFlight).toHaveCount(1);
  const awardedFlights = page.locator('.token-flight');
  await expect(awardedFlights).toHaveCount(4);
  await expect(awardedFlights.filter({ has: page.locator('[data-chip-kind="spice"]') }))
    .toHaveCount(3);
  const flightPath = await firstFlight.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      startLeft: parseFloat(style.getPropertyValue('--token-flight-start-left')),
      startTop: parseFloat(style.getPropertyValue('--token-flight-start-top')),
      startSize: parseFloat(style.getPropertyValue('--token-flight-start-size')),
      endLeft: parseFloat(style.getPropertyValue('--token-flight-end-left')),
      endTop: parseFloat(style.getPropertyValue('--token-flight-end-top')),
      endSize: parseFloat(style.getPropertyValue('--token-flight-end-size'))
    };
  });
  const flightStartBox = {
    x: flightPath.startLeft,
    y: flightPath.startTop,
    width: flightPath.startSize,
    height: flightPath.startSize
  };
  const flightEndBox = {
    x: flightPath.endLeft,
    y: flightPath.endTop,
    width: flightPath.endSize,
    height: flightPath.endSize
  };
  const ownDestinationBox = await page.locator('.own-token-tray').boundingBox();
  expect(firstSpiceBox).not.toBeNull();
  expect(ownDestinationBox).not.toBeNull();
  expect(Math.hypot(
    center(flightStartBox).x - center(firstSpiceBox!).x,
    center(flightStartBox).y - center(firstSpiceBox!).y
  )).toBeLessThanOrEqual(2);
  expect(Math.hypot(
    center(flightEndBox).x - center(ownDestinationBox!).x,
    center(flightEndBox).y - center(ownDestinationBox!).y
  )).toBeLessThanOrEqual(2);

  const rivalSaleFlights = rival.locator('.action-card-flight');
  await expect(rivalSaleFlights).toHaveCount(3);
  await rivalSaleFlights.evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.pause();
  });
  await expect(rival.locator('.action-notice')).toContainText(
    'Asha sold 3 Spice · earned 4 tokens'
  );

  await finishTokenFlights(page);
  await finishTokenFlights(rival);
  await finishActionCardFlights(page);
  await finishActionCardFlights(rival);

  await steps.step('large-sale', {
    description: 'A three-card sale awards ordered goods tokens and one hidden bonus',
    verifications: [
      {
        spec: 'Asha sees the exact four-token award and private total',
        check: async () => {
          await expect(page.locator('.own-token-tray')).toContainText('4 worth 12');
          await expect(page.locator('.hand')).not.toContainText('spice-04');
        }
      },
      {
        spec: 'The public spice supply loses its three highest tokens',
        check: async () => {
          await expect(spiceSupply).toContainText('4 left');
          await expect(spiceSupply.locator('.supply-token .token-chip-rim')).toHaveText([
            '2', '2', '1', '1'
          ]);
        }
      },
      {
        spec: 'Belen sees the token count without Asha’s bonus value',
        check: async () => {
          await expect(rival.locator('.opponent')).toContainText('4 tokens');
          await expect(rival.locator('.opponent')).toContainText('values hidden');
          await expect(page.locator('.owned-token')).toHaveCount(4);
          await expect(rival.locator('.opponent-owned-token')).toHaveCount(4);
          expect((await page.locator('.owned-token').first().boundingBox())?.width)
            .toBeGreaterThanOrEqual(38);
          await page
            .locator('.token-area')
            .evaluate((element) => element.scrollIntoView({ block: 'center' }));
        }
      }
    ]
  });

  const observerSpiceBox = await spiceSupply.locator('.supply-token').first().boundingBox();
  await rival.getByRole('button', { name: 'Select Spice spice-03' }).click();
  await rival.getByRole('button', {
    name: 'Sell 1 selected Spice to the Spice token stack'
  }).click();

  const observerFlight = page.locator('.token-flight[data-token-kind="spice"]');
  const observerSaleCard = page.locator('.action-card-flight[data-action-flight-kind="spice"]');
  const opponentDestination = page.locator('.opponent-private');
  const opponentUid = await opponentDestination.getAttribute('data-token-destination');
  await expect(observerFlight).toHaveCount(1);
  await expect(observerSaleCard).toHaveCount(1);
  await observerSaleCard.evaluate((element) => element.getAnimations()[0]?.pause());
  await expect(page.locator('.action-notice')).toContainText(
    'Belen sold 1 Spice · earned 1 token'
  );
  await observerFlight.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
  });
  await expect(observerFlight).toHaveAttribute('data-token-recipient', opponentUid ?? '');
  const observerStartBox = await observerFlight.boundingBox();
  await observerFlight.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.currentTime = Number(animation.effect?.getComputedTiming().endTime ?? 1) - 1;
  });
  const observerEndBox = await observerFlight.boundingBox();
  const opponentDestinationBox = await opponentDestination.boundingBox();
  expect(observerSpiceBox).not.toBeNull();
  expect(observerStartBox).not.toBeNull();
  expect(observerEndBox).not.toBeNull();
  expect(opponentDestinationBox).not.toBeNull();
  expect(Math.hypot(
    center(observerStartBox!).x - center(observerSpiceBox!).x,
    center(observerStartBox!).y - center(observerSpiceBox!).y
  )).toBeLessThanOrEqual(2);
  expect(Math.hypot(
    center(observerEndBox!).x - center(opponentDestinationBox!).x,
    center(observerEndBox!).y - center(opponentDestinationBox!).y
  )).toBeLessThanOrEqual(2);
  await finishTokenFlights(page);
  await finishTokenFlights(rival);
  await finishActionCardFlights(page);
  await finishActionCardFlights(rival);

  await steps.step('ordinary-sale', {
    description: 'Belen completes a one-card ordinary-goods sale',
    verifications: [
      {
        spec: 'The next ordered spice token belongs to Belen',
        check: async () => {
          await expect(rival.locator('.own-token-tray')).toContainText('1 worth 2');
          await expect(rival.locator('.token.spice')).toContainText('3 left');
        }
      },
      {
        spec: 'Asha sees only Belen’s public token count',
        check: async () => {
          await expect(page.locator('.opponent')).toContainText('1 tokens');
          await expect(page.getByText("Asha's turn")).toBeVisible();
          await page
            .locator('.token-area')
            .evaluate((element) => element.scrollIntoView({ block: 'center' }));
        }
      },
      {
        spec: 'Each seller’s cards and awarded chips animate for the observer and remain in the log',
        check: async () => {
          await page.locator('.game-log summary').click();
          await expect(page.locator('[data-activity-type="cards/sold"]')).toContainText([
            /Belen.*sold 1 Spice.*earned 1 token/,
            /Asha.*sold 3 Spice.*earned 4 tokens/
          ]);
          await page.locator('.game-log summary').click();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
