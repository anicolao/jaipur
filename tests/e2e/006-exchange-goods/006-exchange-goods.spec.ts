import { expect, test } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { TestStepHelper } from '../helpers/test-step-helper';

test('the active trader exchanges market goods for herd camels', async ({ browser, page }, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Exchange goods',
    'Asha selects two market goods and atomically returns the same number of camels.'
  );
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-exchange-006-${testInfo.project.name}`,
    'fixed-round-006-0'
  );
  const deckBefore = await page.getByText('Deck').locator('..').locator('strong').textContent();

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
  expect(handFlightEndBox).not.toBeNull();
  expect(
    Math.hypot(
      center(handFlightStartBox!).x - center(handSourceBox!).x,
      center(handFlightStartBox!).y - center(handSourceBox!).y
    )
  ).toBeLessThanOrEqual(2);
  expect(
    Math.hypot(
      center(handFlightEndBox!).x - center(handDestinationBox!).x,
      center(handFlightEndBox!).y - center(handDestinationBox!).y
    )
  ).toBeLessThanOrEqual(2);
  await expect(page.locator(`[data-return-source="${handCardId}"]`)).toHaveCount(0);
  await handFlight.evaluate((element) => element.getAnimations()[0].finish());
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator(`[data-return-source="${handCardId}"]`)).toHaveCount(1);

  await herdStack.click();
  await expect(herdStack).toHaveAttribute('aria-pressed', 'true');
  const camelSourceBox = await herdStack.locator('.own-camel-card').first().boundingBox();
  const diamondDropBox = await diamondDrop.boundingBox();
  await diamondDrop.click();
  const camelFlight = page.locator('.return-flight-card');
  await expect(camelFlight).toBeVisible();
  await expect(camelFlight).toHaveAttribute('data-flight-target-id', /.+/);
  await expect(camelFlight).toHaveCSS('animation-name', /return-card-flight$/);
  expect(camelSourceBox).not.toBeNull();
  expect(diamondDropBox).not.toBeNull();
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
  const destinationCenter = center(diamondDropBox!);
  const endCenter = center(flightEndBox!);
  expect(Math.hypot(startCenter.x - sourceCenter.x, startCenter.y - sourceCenter.y))
    .toBeLessThanOrEqual(2);
  expect(middleCenter.y).toBeLessThan(Math.min(startCenter.y, endCenter.y));
  expect(Math.hypot(endCenter.x - destinationCenter.x, endCenter.y - destinationCenter.y))
    .toBeLessThanOrEqual(2);
  await camelFlight.evaluate((element) => element.getAnimations()[0].finish());
  await expect(diamondDrop).toHaveAccessibleName(/^Remove Camel /);
  await expect(page.locator('.own-herd .own-camel-card')).toHaveCount(herdBefore - 1);
  await expect(camelFlight).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trade 1 for 1' })).toBeDisabled();
  await goldDrop.click();
  await expect(page.locator('.interaction-tray p')).toContainText(
    'Choose or drag a hand card or camel'
  );
  await herdStack.click();
  await expect(goldDrop).toHaveAccessibleName(/^Remove Camel /);
  await page.getByRole('button', { name: 'Trade 2 for 2' }).click();

  await steps.step('exchange-complete', {
    description: 'Two goods and two camels change zones together',
    verifications: [
      {
        spec: 'Diamond and gold enter Asha’s private hand',
        check: async () => {
          await expect(page.locator('.hand')).toContainText('Diamond');
          await expect(page.locator('.hand')).toContainText('Gold');
        }
      },
      {
        spec: 'The returned camels leave the herd and fill the market',
        check: async () => {
          await expect(page.locator('.own-herd .own-camel-card')).toHaveCount(0);
          await expect(page.locator('.own-herd-label strong')).toHaveText('0 camels');
          await expect(rival.locator('.opponent-herd .camel-pile img')).toHaveCount(0);
          await expect(page.locator('.market .camel')).toHaveCount(5);
        }
      },
      {
        spec: 'An exchange does not draw from the deck and both clients advance the turn',
        check: async () => {
          await expect(page.getByText('Deck').locator('..')).toContainText(deckBefore ?? '');
          await expect(page.getByText("Belen's turn")).toBeVisible();
          await expect(rival.getByText("Belen's turn")).toBeVisible();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
