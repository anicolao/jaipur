import { expect, test } from '@playwright/test';
import { e2eRoomCode } from '../helpers/room-code';
import { TestStepHelper } from '../helpers/test-step-helper';

test('two anonymous traders share an append-only lobby', async ({ browser, page }, testInfo) => {
  const gameId = e2eRoomCode(`room-002-${testInfo.project.name}`);
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Create and join a game',
    'Two isolated anonymous browser contexts converge on the same Jaipur room.'
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
  await page.goto('/');
  await page.getByLabel('Your trader name').fill('Asha');
  await page.getByRole('button', { name: 'Create new game' }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]gameId=${gameId}(?:&|$)`));
  await expect(page.getByText('Waiting for a rival…')).toBeVisible();

  const rivalContext = await browser.newContext();
  const rival = await rivalContext.newPage();
  await rival.goto(`/?gameId=${gameId}`);
  await rival.getByLabel('Your trader name').fill('Belen');
  await rival.getByRole('button', { name: 'Join game' }).click();

  await steps.step('two-traders', {
    description: 'Both traders occupy the shared room',
    verifications: [
      {
        spec: 'The host sees both named traders',
        check: async () => {
          await expect(page.getByLabel('Game lobby').getByText('Asha', { exact: true })).toBeVisible();
          await expect(page.getByLabel('Game lobby').getByText('Belen', { exact: true })).toBeVisible();
        }
      },
      {
        spec: 'The rival observes the same membership',
        check: async () => {
          await expect(rival.getByLabel('Game lobby').getByText('Asha', { exact: true })).toBeVisible();
          await expect(rival.getByLabel('Game lobby').getByText('Belen', { exact: true })).toBeVisible();
        }
      }
    ]
  });

  await page.reload();
  await steps.step('room-replayed', {
    description: 'Reload replays the immutable room',
    verifications: [
      {
        spec: 'Both memberships survive a host reload',
        check: async () => {
          await expect(page.getByLabel('Game lobby').getByText('Asha', { exact: true })).toBeVisible();
          await expect(page.getByLabel('Game lobby').getByText('Belen', { exact: true })).toBeVisible();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
