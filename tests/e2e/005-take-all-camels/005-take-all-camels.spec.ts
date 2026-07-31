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
  await page
    .getByRole('button', { name: new RegExp(`Take all ${camelCount} camels`) })
    .first()
    .click();

  await steps.step('camels-taken', {
    description: 'Every camel joins Asha’s herd',
    verifications: [
      {
        spec: 'The local herd stack grows by the complete visible camel group',
        check: async () => {
          await expect(page.locator('.own-herd .own-camel-card')).toHaveCount(
            herdBefore + camelCount
          );
          await expect(page.locator('.own-herd-label strong')).toHaveText(
            `${herdBefore + camelCount} camels`
          );
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
        }
      },
      {
        spec: 'Both clients advance the turn to Belen',
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
