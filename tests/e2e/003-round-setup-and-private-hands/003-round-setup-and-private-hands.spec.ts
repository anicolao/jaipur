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
  await expect(page.getByLabel('Game lobby').getByText('Belen', { exact: true })).toBeVisible();

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
          await expect(page.locator('.token-area .supply-token')).toHaveCount(38);
          await expect(page.locator('.token-area .bonus-supply-token')).toHaveCount(18);
          expect(await page.locator('.market .market-slot > :first-child').allTextContents()).toEqual(
            await rival.locator('.market .market-slot > :first-child').allTextContents()
          );
        }
      },
      {
        spec: 'The local hand is exact while the opponent has one concealed card back per card',
        check: async () => {
          await expect(page.locator('.hand [data-card-id]')).toHaveCount(4);
          await expect(page.locator('.opponent')).toContainText('Belen');
          await expect(page.locator('.opponent')).toContainText('4 / 7 cards');
          await expect(page.locator('.opponent-hand .opponent-card-back')).toHaveCount(4);
          await expect(page.locator('.opponent-hand')).toHaveAttribute(
            'aria-label',
            'Belen has 4 of 7 cards'
          );
          const rivalHerdCount = await rival.locator('.own-herd .own-camel-card').count();
          await expect(page.locator('.opponent-herd .camel-pile img')).toHaveCount(
            rivalHerdCount
          );
          await expect(page.locator('.opponent-herd')).toHaveAttribute(
            'aria-label',
            `Belen has ${rivalHerdCount} ${rivalHerdCount === 1 ? 'camel' : 'camels'} in their herd`
          );
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

  const confirm = async (view: typeof page) => {
    const buttons = view.locator('[data-confirm-reveal]');
    for (let index = 0; index < 8 && await buttons.count(); index += 1) {
      await buttons.first().click();
      await view.waitForTimeout(250);
    }
  };
  for (let draw = 0; draw < 2; draw += 1) {
    await confirm(page);
    await page.locator('.market button.card-action:not(.camel):not(:disabled)').first().click();
    await expect(rival.getByText("Belen's turn")).toBeVisible();
    await confirm(rival);
    await rival.locator('.market button.card-action:not(.camel):not(:disabled)').first().click();
    await expect(page.getByText("Asha's turn")).toBeVisible();
  }
  await page.getByRole('button', { name: 'Take all 5 camels' }).first().click();
  await expect(rival.getByText("Belen's turn")).toBeVisible();
  await confirm(rival);
  await rival.locator('.market button.card-action:not(.camel):not(:disabled)').first().click();
  await expect(page.getByText("Asha's turn")).toBeVisible();
  await confirm(page);
  await page.locator('.market button.card-action:not(.camel):not(:disabled)').first().click();
  await expect(rival.getByText("Belen's turn")).toBeVisible();

  await steps.step('opponent-at-card-limit', {
    description: 'The concealed opponent hand visibly reaches its seven-card limit',
    verifications: [
      {
        spec: 'Seven overlapping square card backs make the full opponent hand visible',
        check: async () => {
          await expect(page.locator('.opponent')).toContainText('7 / 7 cards');
          await expect(page.locator('.opponent-hand .opponent-card-back')).toHaveCount(7);
          await expect(page.locator('.opponent-hand')).toHaveAttribute(
            'aria-label',
            'Belen has 7 of 7 cards'
          );
          const cardBoxes = await page
            .locator('.opponent-hand .opponent-card-back')
            .evaluateAll((cards) =>
              cards.map((card) => {
                const style = getComputedStyle(card);
                return { width: parseFloat(style.width), height: parseFloat(style.height) };
              })
            );
          for (const box of cardBoxes) {
            expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
            expect(Math.abs(box.width - cardBoxes[0].width)).toBeLessThanOrEqual(1);
          }
        }
      },
      {
        spec: 'A full hand prevents taking another single good',
        check: async () => {
          await expect(page.locator('.hand [data-card-id]')).toHaveCount(7);
          await expect(
            rival.locator('.market button.card-action:not(.camel)').first()
          ).toBeDisabled();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
