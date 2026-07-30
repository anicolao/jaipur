import { expect, test } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';

test('two anonymous traders share an append-only lobby', async ({ browser, page }, testInfo) => {
  const gameId = `e2e-room-002-${testInfo.project.name}`;
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Create and join a game',
    'Two isolated anonymous browser contexts converge on the same Jaipur room.'
  );

  await page.goto('/');
  await page.getByLabel('Your trader name').fill('Asha');
  await page.getByLabel('Game code — choose one or paste an invite').fill(gameId);
  await page.getByRole('button', { name: 'Create game' }).click();
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
          await expect(page.getByText('Asha')).toBeVisible();
          await expect(page.getByText('Belen')).toBeVisible();
        }
      },
      {
        spec: 'The rival observes the same membership',
        check: async () => {
          await expect(rival.getByText('Asha')).toBeVisible();
          await expect(rival.getByText('Belen')).toBeVisible();
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
          await expect(page.getByText('Asha')).toBeVisible();
          await expect(page.getByText('Belen')).toBeVisible();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
