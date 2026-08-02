import { expect, test } from '@playwright/test';
import { e2eRoomCode } from '../helpers/room-code';
import { TestStepHelper } from '../helpers/test-step-helper';

test('one client creates and plays against the strongest computer opponent', async ({ page }, testInfo) => {
  const gameId = e2eRoomCode(`bot-013-${testInfo.project.name}`);
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Client-controlled computer opponent',
    'A single browser connection runs private-state-safe Maharaja search and drives the logical computer seat.'
  );

  await page.addInitScript((roomCode) => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((array: ArrayBufferView) => {
      if (array instanceof Uint8Array && array.length === roomCode.length) {
        array.set([...roomCode].map((letter) => letter.charCodeAt(0) - 65));
        return array;
      }
      return original(array);
    }) as typeof crypto.getRandomValues;
  }, gameId);
  await page.goto('/?seed=fixed-bot-013');
  await page.getByLabel('Your trader name').fill('Asha');
  await expect(page.getByLabel('Computer difficulty').locator('option')).toHaveCount(2);
  await page.getByLabel('Computer difficulty').selectOption('maharaja');
  await page.getByRole('button', { name: 'Play vs computer' }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]gameId=${gameId}(?:&|$)`));

  await steps.step('computer-seated', {
    description: 'The computer occupies the ready second seat',
    verifications: [
      {
        spec: 'The generated room contains only Asha and the Maharaja computer',
        check: async () => {
          await expect(page.getByLabel('Game lobby').getByText('Asha', { exact: true })).toBeVisible();
          await expect(page.getByLabel('Game lobby').getByText('Maharaja', { exact: true })).toBeVisible();
          await expect(page.getByLabel('Game lobby')).toContainText('Computer · Maharaja · Ready');
        }
      },
      {
        spec: 'Only the human needs to ready before opening the market',
        check: async () => {
          await expect(page.getByRole('button', { name: 'Ready to trade' })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Open the market' })).toHaveCount(0);
        }
      }
    ]
  });

  await page.getByRole('button', { name: 'Ready to trade' }).click();
  await page.getByRole('button', { name: 'Open the market' }).click();
  await expect(page.getByText("Asha's turn")).toBeVisible();
  await page.locator('.market button.card-action:not(.camel):not(:disabled)').first().click();
  await page.locator('[data-confirm-draw]').click();
  const humanActivity = page.locator('.game-log [data-activity-type^="cards/"]', {
    hasText: /^Asha/
  }).first();
  const humanActivityId = await humanActivity.getAttribute('data-activity-id');
  expect(humanActivityId).toBeTruthy();
  const humanFlights = page.locator(`[data-action-flight-id="${humanActivityId}"]`);
  await expect(humanFlights.first()).toBeVisible();
  await humanFlights.evaluateAll((flights) => {
    for (const flight of flights) {
      for (const animation of flight.getAnimations()) animation.finish();
    }
  });

  const computerActivity = page.locator('.game-log [data-activity-type^="cards/"]', {
    hasText: /^Maharaja/
  }).first();
  await expect(computerActivity).toContainText(/Maharaja.*(took|traded|sold)/);
  const computerActivityId = await computerActivity.getAttribute('data-activity-id');
  expect(computerActivityId).toBeTruthy();
  const computerFlights = page.locator(`[data-action-flight-id="${computerActivityId}"]`);
  await expect(computerFlights.first()).toBeVisible();
  await computerFlights.evaluateAll((flights) => {
    for (const flight of flights) {
      for (const animation of flight.getAnimations()) animation.pause();
    }
  });
  await expect(page.locator('[data-latest-action]')).toContainText(
    /Latest\s+Maharaja.*(took|traded|sold)/
  );
  await expect(page.locator('[data-latest-action]')).toHaveAttribute(
    'data-latest-activity-id',
    computerActivityId!
  );
  await expect(page.getByText("Asha's turn")).toBeVisible();
  await page.locator('.action-card-flight, .token-flight').evaluateAll((flights) => {
    for (const flight of flights) {
      for (const animation of flight.getAnimations()) animation.finish();
    }
  });
  await expect(page.locator('.action-card-flight, .token-flight')).toHaveCount(0);

  await steps.step('computer-moved', {
    description: 'The computer chooses and records a legal reply',
    verifications: [
      {
        spec: 'Play returns to Asha after the local computer completes one turn',
        check: async () => {
          await expect(page.getByText("Asha's turn")).toBeVisible();
          await expect(page.getByText('Considering the market…')).toHaveCount(0);
        }
      },
      {
        spec: 'The shared append-only game log attributes the reply to Maharaja',
        check: async () => {
          await expect(page.locator('.game-log')).toContainText(/Maharaja.*(took|traded|sold)/);
        }
      },
      {
        spec: 'The opponent remains a normal concealed hand and exact public herd',
        check: async () => {
          await expect(page.locator('.opponent')).toContainText('Maharaja');
          const opponentCards = await page.locator('.opponent-hand .opponent-card-back').count();
          await expect(page.locator('.opponent')).toContainText(`${opponentCards} / 7 cards`);
          await expect(page.locator('.opponent-herd')).toHaveAttribute(
            'aria-label',
            /Maharaja has \d+ camels? in their herd/
          );
        }
      }
    ]
  });

  steps.generateDocs();
});
