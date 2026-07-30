import { expect, test } from '@playwright/test';
import { e2eRoomCode } from '../helpers/room-code';
import { TestStepHelper } from '../helpers/test-step-helper';

test('ready traders receive a deterministic private deal', async ({ browser, page }, testInfo) => {
  const gameId = e2eRoomCode(`round-003-${testInfo.project.name}`);
  const url = `/?gameId=${gameId}&seed=fixed-round-003`;
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Round setup and private hands',
    'Two ready traders open a seeded market and receive trustworthy player views.'
  );

  await page.goto(url);
  await page.getByLabel('Your trader name').fill('Asha');
  await page.getByRole('button', { name: 'Create new game' }).click();

  const rivalContext = await browser.newContext();
  const rival = await rivalContext.newPage();
  await rival.goto(url);
  await rival.getByLabel('Your trader name').fill('Belen');
  await rival.getByRole('button', { name: 'Join game' }).click();
  await expect(page.getByText('Belen')).toBeVisible();

  await page.getByRole('button', { name: 'Ready to trade' }).click();
  await rival.getByRole('button', { name: 'Ready to trade' }).click();
  await page.getByRole('button', { name: 'Open the market' }).click();

  await steps.step('market-open', {
    description: 'The deterministic market opens',
    verifications: [
      {
        spec: 'Both players see the same five-card market',
        check: async () => {
          await expect(page.locator('.market .market-slot')).toHaveCount(5);
          await expect(rival.locator('.market .market-slot')).toHaveCount(5);
          await expect(page.locator('.market .piece-image')).toHaveCount(5);
          const handCount = await page.locator('.hand [data-card-id]').count();
          await expect(page.locator('.hand .piece-image')).toHaveCount(handCount);
          await expect(page.locator('.token-area img')).toHaveCount(6);
          expect(await page.locator('.market .market-slot > :first-child').allTextContents()).toEqual(
            await rival.locator('.market .market-slot > :first-child').allTextContents()
          );
        }
      },
      {
        spec: 'The local hand is exact while the opponent is represented by a count',
        check: async () => {
          await expect(page.locator('.hand [data-card-id]')).toHaveCount(4);
          await expect(page.locator('.opponent')).toContainText('Belen');
          await expect(page.getByText('Herd hidden')).toBeVisible();
        }
      },
      {
        spec: 'The deck and active trader are visible',
        check: async () => {
          await expect(page.getByText('Deck').locator('..')).toContainText('40');
          await expect(page.getByText("Asha's turn")).toBeVisible();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
