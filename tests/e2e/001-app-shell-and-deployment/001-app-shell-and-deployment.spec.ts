import { expect, test } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';

test('application shell reaches Firebase and renders deterministically', async ({ page }, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Application shell and Firebase readiness',
    'The static Jaipur client loads and reaches the local Firebase emulators.'
  );

  await page.goto('/');
  await steps.step('firebase-ready', {
    description: 'The bazaar is ready for its first traders',
    verifications: [
      {
        spec: 'The page exposes the stable Jaipur title',
        check: async () => expect(page).toHaveTitle('Jaipur — Live card play')
      },
      {
        spec: 'The landing heading and six goods are visible',
        check: async () => {
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(
            'The bazaar is almost ready.'
          );
          await expect(page.locator('.goods span')).toHaveCount(6);
          await expect(page.locator('.goods img')).toHaveCount(6);
          await expect(page.getByLabel('Your trader name')).toBeVisible();
          await expect(page.getByLabel('Five-letter game code')).toBeVisible();
          await expect(page.getByRole('button', { name: 'Create new game' })).toBeDisabled();
          await expect(page.getByRole('button', { name: 'Join game' })).toBeDisabled();
        }
      },
      {
        spec: 'The client reaches the Firebase emulator',
        check: async () =>
          expect(page.getByRole('status')).toHaveText('Firebase emulator ready')
      },
      {
        spec: 'The deterministic build marker is visible',
        check: async () =>
          expect(page.getByTestId('build-marker')).toHaveText('Build e2e-test-commit')
      }
    ]
  });

  steps.generateDocs();
});
