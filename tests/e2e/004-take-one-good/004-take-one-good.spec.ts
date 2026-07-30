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

  const handBefore = await page.locator('.hand article').count();
  const deckBefore = Number(await page.getByText('Deck').locator('..').locator('strong').textContent());
  const target = page.locator('.market .card-action').first();
  const cardId = await target.getAttribute('data-card-id');
  await target.click();

  await steps.step('good-taken', {
    description: 'One good moves into Asha’s hand',
    verifications: [
      {
        spec: 'The selected stable card ID is now in the local hand',
        check: async () => {
          await expect(page.locator(`.hand [data-card-id="${cardId}"]`)).toBeVisible();
          await expect(page.locator('.hand article')).toHaveCount(handBefore + 1);
        }
      },
      {
        spec: 'The market is refilled and the deck decreases by one',
        check: async () => {
          await expect(page.locator('.market').locator('article, button')).toHaveCount(5);
          await expect(page.getByText('Deck').locator('..')).toContainText(String(deckBefore - 1));
        }
      },
      {
        spec: 'Both clients agree that Belen now has the turn',
        check: async () => {
          await expect(page.getByText("Belen's turn")).toBeVisible();
          await expect(rival.getByText("Belen's turn")).toBeVisible();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
