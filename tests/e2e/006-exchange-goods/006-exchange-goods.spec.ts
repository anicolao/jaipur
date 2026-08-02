import { expect, test } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { TestStepHelper } from '../helpers/test-step-helper';

test('the active trader exchanges market goods for herd camels', async ({ browser, page }, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Exchange goods',
    'Asha selects two market goods and atomically returns one hand card and one camel.'
  );
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-exchange-006-${testInfo.project.name}`,
    'fixed-round-006-0'
  );
  const deckBefore = await page.getByText('Deck').locator('..').locator('strong').textContent();
  const marketBefore = await page.locator('.market-slot [data-card-id]').evaluateAll(
    (cards) => cards.map((card) => card.getAttribute('data-card-id'))
  );

  await expect(
    page
      .locator('.market-slot')
      .filter({ has: page.locator('.camel') })
      .locator('.exchange-drop-target')
  ).toHaveCount(0);
  const herdStack = page.getByRole('button', {
    name: 'Select or drag a camel from your herd for exchange'
  });
  const herdBefore = await page.locator('.own-herd .own-camel-card').count();
  const diamondDrop = page
    .locator('.market-slot')
    .filter({ hasText: 'Diamond' })
    .locator('.exchange-drop-target');
  const goldDrop = page
    .locator('.market-slot')
    .filter({ hasText: 'Gold' })
    .locator('.exchange-drop-target');
  const diamondSlot = Number(await diamondDrop.locator('..').getAttribute('data-market-slot-index'));
  const goldSlot = Number(await goldDrop.locator('..').getAttribute('data-market-slot-index'));

  await diamondDrop.click();
  const handSource = page.locator('.hand .hand-card').first();
  const handCardId = await handSource.getAttribute('data-card-id');
  const handSourceBox = await handSource.boundingBox();
  const handDestinationBox = await diamondDrop.boundingBox();
  await handSource.click();
  const handFlight = page.locator('.return-flight-card');
  await expect(handFlight).toHaveAttribute('data-flight-card-id', handCardId ?? '');
  await handFlight.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
  });
  const handFlightStartBox = await handFlight.boundingBox();
  await handFlight.evaluate((element) => {
    element.getAnimations()[0].currentTime = 260;
  });
  const handFlightMiddleBox = await handFlight.boundingBox();
  await handFlight.evaluate((element) => {
    element.getAnimations()[0].currentTime = 519;
  });
  const handFlightEndBox = await handFlight.boundingBox();
  const center = (box: NonNullable<typeof handFlightStartBox>) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  });
  expect(handSourceBox).not.toBeNull();
  expect(handDestinationBox).not.toBeNull();
  expect(handFlightStartBox).not.toBeNull();
  expect(handFlightMiddleBox).not.toBeNull();
  expect(handFlightEndBox).not.toBeNull();
  const distanceFromLine = (
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number }
  ) => Math.abs(
    (end.y - start.y) * point.x -
    (end.x - start.x) * point.y +
    end.x * start.y -
    end.y * start.x
  ) / Math.hypot(end.y - start.y, end.x - start.x);
  const handStartCenter = center(handFlightStartBox!);
  const handMiddleCenter = center(handFlightMiddleBox!);
  const handEndCenter = center(handFlightEndBox!);
  expect(
    Math.hypot(
      handStartCenter.x - center(handSourceBox!).x,
      handStartCenter.y - center(handSourceBox!).y
    )
  ).toBeLessThanOrEqual(2);
  expect(distanceFromLine(handMiddleCenter, handStartCenter, handEndCenter))
    .toBeLessThanOrEqual(2);
  expect(
    Math.hypot(
      handEndCenter.x - center(handDestinationBox!).x,
      handEndCenter.y - center(handDestinationBox!).y
    )
  ).toBeLessThanOrEqual(2);
  await expect(page.locator(`[data-return-source="${handCardId}"]`)).toHaveCount(0);
  await handFlight.evaluate((element) => element.getAnimations()[0].finish());
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator(`[data-return-source="${handCardId}"]`)).toHaveCount(1);

  const topCamel = herdStack.locator('.own-camel-card').last();
  const topCamelId = await topCamel.getAttribute('data-return-source');
  await herdStack.click();
  await expect(herdStack).toHaveAttribute('aria-pressed', 'true');
  await expect(topCamel).toHaveClass(/selected/);
  await expect(topCamel).toHaveCSS('border-color', 'rgb(211, 139, 33)');
  await expect(herdStack).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');

  await handSource.click();
  await expect(handSource).toHaveAttribute('aria-pressed', 'true');
  await expect(herdStack).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.interaction-tray p')).toContainText(
    '1 hand card and 1 camel selected'
  );

  await diamondDrop.click();
  const mixedHandFlight = page.locator('.return-flight-card');
  await expect(mixedHandFlight).toHaveAttribute('data-flight-card-id', handCardId ?? '');
  await mixedHandFlight.evaluate((element) => element.getAnimations()[0].finish());
  await expect(diamondDrop).toHaveAccessibleName(/^Remove .+ from the exchange/);
  await expect(herdStack).toHaveAttribute('aria-pressed', 'true');

  const camelSourceBox = await topCamel.boundingBox();
  const goldDropBox = await goldDrop.boundingBox();
  await goldDrop.click();
  const camelFlight = page.locator('.return-flight-card');
  await expect(camelFlight).toBeVisible();
  await expect(camelFlight).toHaveAttribute('data-flight-card-id', topCamelId ?? '');
  await expect(camelFlight).toHaveAttribute('data-flight-target-id', /.+/);
  await expect(camelFlight).toHaveCSS('animation-name', /return-card-flight$/);
  expect(camelSourceBox).not.toBeNull();
  expect(goldDropBox).not.toBeNull();
  await camelFlight.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
  });
  const flightStartBox = await camelFlight.boundingBox();
  await camelFlight.evaluate((element) => {
    element.getAnimations()[0].currentTime = 260;
  });
  const flightMiddleBox = await camelFlight.boundingBox();
  await camelFlight.evaluate((element) => {
    element.getAnimations()[0].currentTime = 519;
  });
  const flightEndBox = await camelFlight.boundingBox();
  expect(flightStartBox).not.toBeNull();
  expect(flightMiddleBox).not.toBeNull();
  expect(flightEndBox).not.toBeNull();
  const sourceCenter = center(camelSourceBox!);
  const startCenter = center(flightStartBox!);
  const middleCenter = center(flightMiddleBox!);
  const destinationCenter = center(goldDropBox!);
  const endCenter = center(flightEndBox!);
  expect(Math.hypot(startCenter.x - sourceCenter.x, startCenter.y - sourceCenter.y))
    .toBeLessThanOrEqual(2);
  expect(distanceFromLine(middleCenter, startCenter, endCenter)).toBeLessThanOrEqual(2);
  expect(Math.hypot(endCenter.x - destinationCenter.x, endCenter.y - destinationCenter.y))
    .toBeLessThanOrEqual(2);
  await camelFlight.evaluate((element) => element.getAnimations()[0].finish());
  await expect(goldDrop).toHaveAccessibleName(/^Remove Camel /);
  await expect(page.locator('.own-herd .own-camel-card')).toHaveCount(herdBefore - 1);
  await expect(camelFlight).toHaveCount(0);
  await page.getByRole('button', { name: 'Trade 2 for 2' }).click();

  const observerFlights = rival.locator('.action-card-flight');
  await expect(observerFlights).toHaveCount(4);
  await observerFlights.evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.pause();
  });
  await expect(rival.locator('.action-notice')).toContainText(/^Asha traded /);
  await rival.locator('.game-log summary').click();
  await expect(rival.locator('[data-activity-type="cards/exchanged"]')).toContainText(
    /^Asha.*traded /
  );
  await rival.locator('.game-log summary').click();
  await observerFlights.evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.finish();
  });
  await expect(observerFlights).toHaveCount(0);

  await steps.step('exchange-complete', {
    description: 'Two goods change zones for one hand card and one camel',
    verifications: [
      {
        spec: 'Diamond and gold enter Asha’s private hand',
        check: async () => {
          await expect(page.locator('.hand')).toContainText('Diamond');
          await expect(page.locator('.hand')).toContainText('Gold');
        }
      },
      {
        spec: 'The mixed hand-and-herd return fills the market',
        check: async () => {
          await expect(page.locator('.own-herd .own-camel-card')).toHaveCount(1);
          await expect(page.locator('.own-herd-label')).toHaveText('Your herd');
          await expect(page.locator('.own-herd-label')).not.toContainText(/\d+ camels?/);
          await expect(rival.locator('.opponent-herd .camel-pile img')).toHaveCount(1);
          await expect(page.locator('.market .camel')).toHaveCount(4);
          const marketAfter = await page.locator('.market-slot [data-card-id]').evaluateAll(
            (cards) => cards.map((card) => card.getAttribute('data-card-id'))
          );
          const expectedMarket = [...marketBefore];
          expectedMarket[diamondSlot] = handCardId;
          expectedMarket[goldSlot] = topCamelId;
          expect(marketAfter).toEqual(expectedMarket);
        }
      },
      {
        spec: 'An exchange does not draw from the deck and both clients advance the turn',
        check: async () => {
          await expect(page.getByText('Deck').locator('..')).toContainText(deckBefore ?? '');
          await expect(page.getByText("Belen's turn")).toBeVisible();
          await expect(rival.getByText("Belen's turn")).toBeVisible();
        }
      },
      {
        spec: 'Belen sees all four committed card movements and the accepted trade in the log',
        check: async () => {
          await expect(rival.locator('.game-log summary')).toContainText('Game log 6');
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
