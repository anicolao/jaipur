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
  const diamondDrop = page
    .locator('.market-slot')
    .filter({ hasText: 'Diamond' })
    .locator('.exchange-drop-target');
  const goldDrop = page
    .locator('.market-slot')
    .filter({ hasText: 'Gold' })
    .locator('.exchange-drop-target');

  await herdStack.click();
  await expect(herdStack).toHaveAttribute('aria-pressed', 'true');
  await diamondDrop.click();
  await expect(diamondDrop).toHaveAccessibleName(/^Remove Camel /);
  await expect(diamondDrop.locator('.loaded-return-card')).toHaveClass(/click-loaded/);
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
          await expect(page.locator('.own-herd .camel-pile img')).toHaveCount(0);
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
