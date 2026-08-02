import { expect, test } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { TestStepHelper } from '../helpers/test-step-helper';

test('the active trader takes every camel as one action', async ({ browser, page }, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Take all camels',
    'Asha takes the complete camel group into her herd and the deck refills every vacancy.'
  );
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-camels-005-${testInfo.project.name}`,
    'fixed-round-005'
  );

  const camelCount = await page.locator('.market .camel').count();
  const herdBefore = await page.locator('.own-herd .own-camel-card').count();
  const deckBefore = Number(await page.getByText('Deck').locator('..').locator('strong').textContent());
  const marketBefore = await page.locator('.market-slot [data-card-id]').evaluateAll(
    (cards) => cards.map((card) => card.getAttribute('data-card-id'))
  );
  const camelSlots = await page.locator('.market-slot:has(.camel)').evaluateAll(
    (slots) => slots.map((slot) => Number(slot.getAttribute('data-market-slot-index')))
  );
  await page
    .getByRole('button', { name: new RegExp(`Take all ${camelCount} camels`) })
    .first()
    .click();

  await expect(page.locator('[data-pending-draw="camels"]')).toBeVisible();
  await expect(page.locator('[data-pending-draw-card]')).toHaveCount(camelCount);
  await expect(page.locator('[data-pending-draw-card] .piece-label')).toHaveText(
    Array.from({ length: camelCount }, () => 'Draw Camels')
  );
  await expect(rival.locator('[data-pending-draw-card]')).toHaveCount(camelCount);
  await expect(rival.locator('[data-confirm-draw], [data-abandon-draw]')).toHaveCount(0);
  await expect(page.locator('.own-herd .own-camel-card')).toHaveCount(herdBefore);
  await expect(page.getByText('Deck').locator('..')).toContainText(String(deckBefore));
  await expect(page.getByText("Asha's turn")).toBeVisible();
  await expect(rival.locator('.action-card-flight')).toHaveCount(0);

  await page.locator('[data-confirm-draw]').click();

  const observerFlights = rival.locator('.action-card-flight');
  await expect(observerFlights).toHaveCount(camelCount * 2);
  await observerFlights.evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.pause();
  });
  await expect(
    observerFlights.filter({ has: rival.locator('[src*="camel"]') })
  ).toHaveCount(camelCount);
  await expect(rival.locator('.action-notice')).toContainText(
    `Asha took all ${camelCount} camels`
  );
  await observerFlights.evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.finish();
  });
  await expect(observerFlights).toHaveCount(0);

  await steps.step('camels-taken', {
    description: 'Every camel joins Asha’s herd',
    verifications: [
      {
        spec: 'The local herd stack grows by the complete visible camel group',
        check: async () => {
          await expect(page.locator('.own-herd .own-camel-card')).toHaveCount(
            herdBefore + camelCount
          );
          await expect(page.locator('.own-herd-label')).toHaveText('Your herd');
          await expect(page.locator('.own-herd-label')).not.toContainText(/\d+ camels?/);
          await expect(rival.locator('.opponent-herd .camel-pile img')).toHaveCount(
            herdBefore + camelCount
          );
        }
      },
      {
        spec: 'The market returns to five cards and the deck pays every replacement',
        check: async () => {
          await expect(page.locator('.market .market-slot')).toHaveCount(5);
          await expect(page.getByText('Deck').locator('..')).toContainText(
            String(deckBefore - camelCount)
          );
          const marketAfter = await page.locator('.market-slot [data-card-id]').evaluateAll(
            (cards) => cards.map((card) => card.getAttribute('data-card-id'))
          );
          for (const index of marketBefore.keys()) {
            if (camelSlots.includes(index)) {
              expect(marketAfter[index]).not.toBe(marketBefore[index]);
            } else {
              expect(marketAfter[index]).toBe(marketBefore[index]);
            }
          }
        }
      },
      {
        spec: 'Both clients advance the turn to Belen',
        check: async () => {
          await expect(page.getByText("Belen's turn")).toBeVisible();
          await expect(rival.getByText("Belen's turn")).toBeVisible();
        }
      },
      {
        spec: 'Belen sees every camel and refill card move as one shared action',
        check: async () => {
          await expect(rival.locator('.game-log [data-activity-type="cards/taken-camels"]'))
            .not.toBeVisible();
          await rival.locator('.game-log summary').click();
          await expect(rival.locator('[data-activity-type="cards/taken-camels"]'))
            .toContainText(`took all ${camelCount} camels`);
          await rival.locator('.game-log summary').click();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
