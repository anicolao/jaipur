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
    page.getByRole('button', { name: /^Exchange Camel .* for a camel/ })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: /^Exchange Diamond .* for a camel/ })
    .click();
  await expect(page.getByRole('button', { name: 'Trade 1 for 1' })).toBeDisabled();
  await page
    .getByRole('button', { name: /^Exchange Gold .* for a camel/ })
    .click();
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
          await expect(page.getByText('Your herd:').locator('..')).toContainText('0 camels');
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
