import { expect, test } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { TestStepHelper } from '../helpers/test-step-helper';

test('the active trader takes one good and refills the market', async ({ browser, page }, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Take one good',
    'Asha takes one non-camel card, the deck refills its market position, and play passes.'
  );
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-take-004-${testInfo.project.name}`,
    'fixed-round-004'
  );

  const handBefore = await page.locator('.hand [data-card-id]').count();
  const deckBefore = Number(await page.getByText('Deck').locator('..').locator('strong').textContent());
  const target = page.locator('.market .card-action:not(.camel)').first();
  const cardId = await target.getAttribute('data-card-id');
  await target.click();

  const observerFlights = rival.locator('.action-card-flight');
  await expect(observerFlights).toHaveCount(2);
  await observerFlights.evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.pause();
  });
  await expect(rival.locator('.action-notice')).toContainText(/^Asha took /);

  const observerLog = rival.locator('.game-log');
  await observerLog.locator('summary').click();
  await expect(observerLog.locator('[data-activity-type="cards/taken-one"]')).toContainText(
    /^Asha.*took /
  );
  await expect(observerLog.getByText('Page 1 / 2')).toBeVisible();
  await observerLog.getByRole('button', { name: 'Older' }).click();
  await expect(observerLog.locator('[data-activity-type="game/created"]')).toContainText(
    'Asha opened the bazaar'
  );
  await observerLog.locator('summary').click();
  await observerFlights.evaluateAll((flights) => {
    for (const flight of flights) flight.getAnimations()[0]?.finish();
  });
  await expect(observerFlights).toHaveCount(0);

  await steps.step('good-taken', {
    description: 'One good moves into Asha’s hand',
    verifications: [
      {
        spec: 'The selected stable card ID is now in the local hand',
        check: async () => {
          await expect(page.locator(`.hand [data-card-id="${cardId}"]`)).toBeVisible();
          await expect(page.locator('.hand [data-card-id]')).toHaveCount(handBefore + 1);
        }
      },
      {
        spec: 'The market is refilled and the deck decreases by one',
        check: async () => {
          await expect(page.locator('.market .market-slot')).toHaveCount(5);
          await expect(page.getByText('Deck').locator('..')).toContainText(String(deckBefore - 1));
        }
      },
      {
        spec: 'Both clients agree that Belen now has the turn',
        check: async () => {
          await expect(page.getByText("Belen's turn")).toBeVisible();
          await expect(rival.getByText("Belen's turn")).toBeVisible();
        }
      },
      {
        spec: 'The observer sees the shared action and can review older log pages',
        check: async () => {
          await expect(rival.locator('.game-log summary')).toContainText('Game log 6');
          await expect(rival.locator('.game-log')).not.toHaveAttribute('open', '');
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
