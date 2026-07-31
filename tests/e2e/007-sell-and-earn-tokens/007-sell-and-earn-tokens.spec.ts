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
  await expect(initialSpiceTokens.locator('.token-chip-center')).toHaveText([
    '5', '3', '3', '2', '2', '1', '1'
  ]);
  await expect(initialSpiceTokens.locator('.token-chip-rim')).toHaveText([
    '5', '3', '3', '2', '2', '1', '1'
  ]);
  const visibleEdgeValues = spiceSupply.locator('.supply-edge-value');
  await expect(visibleEdgeValues).toHaveText(['5', '3', '3', '2', '2', '1', '1']);
  await expect(visibleEdgeValues).toHaveCount(7);
  expect(parseFloat(await visibleEdgeValues.first().evaluate(
    (value) => getComputedStyle(value).fontSize
  ))).toBeGreaterThanOrEqual(11.5);
  const tokenBox = await initialSpiceTokens.first().boundingBox();
  expect(tokenBox?.width).toBeGreaterThanOrEqual(48);
  const centerValueStyle = await initialSpiceTokens.first().locator('.token-chip-center').evaluate(
    (value) => {
      const style = getComputedStyle(value);
      return {
        backgroundColor: style.backgroundColor,
        fontSize: parseFloat(style.fontSize),
        strokeWidth: parseFloat(style.webkitTextStrokeWidth)
      };
    }
  );
  expect(centerValueStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(centerValueStyle.fontSize).toBeGreaterThanOrEqual(38);
  expect(centerValueStyle.strokeWidth).toBeGreaterThan(0);
  const firstSpiceId = await initialSpiceTokens.first().getAttribute('data-supply-token-id');
  const firstSpiceBox = await initialSpiceTokens.first().boundingBox();
  const firstZ = Number(await initialSpiceTokens.first().evaluate(
    (token) => getComputedStyle(token).zIndex
  ));
  const lastZ = Number(await initialSpiceTokens.last().evaluate(
    (token) => getComputedStyle(token).zIndex
  ));
  expect(firstZ).toBeGreaterThan(lastZ);

  await page.getByRole('button', {
    name: 'Sell all 3 Spice to the Spice token stack'
  }).click();

  const firstFlight = page.locator(`[data-token-flight-id="${firstSpiceId}"]`);
  await expect(firstFlight).toHaveCount(1);
  await firstFlight.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
  });
  const awardedFlights = page.locator('.token-flight');
  await expect(awardedFlights).toHaveCount(4);
  await expect(awardedFlights.filter({ has: page.locator('[data-chip-kind="spice"]') }))
    .toHaveCount(3);
  const flightStartBox = await firstFlight.boundingBox();
  await firstFlight.evaluate((element) => {
    element.getAnimations()[0].currentTime = 599;
  });
  const flightEndBox = await firstFlight.boundingBox();
  const ownDestinationBox = await page.locator('.own-token-tray').boundingBox();
  expect(firstSpiceBox).not.toBeNull();
  expect(flightStartBox).not.toBeNull();
  expect(flightEndBox).not.toBeNull();
  expect(ownDestinationBox).not.toBeNull();
  expect(Math.hypot(
    center(flightStartBox!).x - center(firstSpiceBox!).x,
    center(flightStartBox!).y - center(firstSpiceBox!).y
  )).toBeLessThanOrEqual(2);
  expect(Math.hypot(
    center(flightEndBox!).x - center(ownDestinationBox!).x,
    center(flightEndBox!).y - center(ownDestinationBox!).y
  )).toBeLessThanOrEqual(2);
  await finishTokenFlights(page);
  await finishTokenFlights(rival);

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
          await expect(spiceSupply.locator('.supply-token .token-chip-center')).toHaveText([
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
  const opponentDestination = page.locator('.opponent-private');
  const opponentUid = await opponentDestination.getAttribute('data-token-destination');
  await expect(observerFlight).toHaveCount(1);
  await observerFlight.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
  });
  await expect(observerFlight).toHaveAttribute('data-token-recipient', opponentUid ?? '');
  const observerStartBox = await observerFlight.boundingBox();
  await observerFlight.evaluate((element) => {
    element.getAnimations()[0].currentTime = 599;
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
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
