import { expect, test } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { TestStepHelper } from '../helpers/test-step-helper';

test('both traders sell goods and earn public and private tokens', async ({ browser, page }, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Sell goods and earn tokens',
    'Asha earns ordered goods tokens and a private size bonus before Belen completes an ordinary sale.'
  );
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-sale-007-${testInfo.project.name}`,
    'fixed-round-007-15'
  );

  await page.getByRole('button', { name: 'Sell goods' }).click();
  for (const card of ['spice-04', 'spice-02', 'spice-08']) {
    await page.getByRole('button', { name: `Select Spice ${card} for sale` }).click();
  }
  await page.getByRole('button', { name: 'Sell 3 Spice' }).click();
  await page.locator('.token-area').scrollIntoViewIfNeeded();

  await steps.step('large-sale', {
    description: 'A three-card sale awards ordered goods tokens and one hidden bonus',
    verifications: [
      {
        spec: 'Asha sees the exact four-token award and private total',
        check: async () => {
          await expect(page.locator('.token-area > p')).toContainText('4 worth 12');
          await expect(page.locator('.hand')).not.toContainText('spice-04');
        }
      },
      {
        spec: 'The public spice supply loses its three highest tokens',
        check: async () => {
          const spice = page.locator('.token.spice');
          await expect(spice).toContainText('4 left');
          await expect(spice).toContainText('Next 2');
        }
      },
      {
        spec: 'Belen sees the token count without Asha’s bonus value',
        check: async () => {
          await expect(rival.locator('.opponent')).toContainText('4 tokens');
          await expect(rival.locator('.opponent')).toContainText('values hidden');
        }
      }
    ]
  });

  await rival.getByRole('button', { name: 'Sell goods' }).click();
  await rival.getByRole('button', { name: 'Select Spice spice-03 for sale' }).click();
  await rival.getByRole('button', { name: 'Sell 1 Spice' }).click();
  await page.locator('.token-area').scrollIntoViewIfNeeded();

  await steps.step('ordinary-sale', {
    description: 'Belen completes a one-card ordinary-goods sale',
    verifications: [
      {
        spec: 'The next ordered spice token belongs to Belen',
        check: async () => {
          await expect(rival.locator('.token-area > p')).toContainText('1 worth 2');
          await expect(rival.locator('.token.spice')).toContainText('3 left');
        }
      },
      {
        spec: 'Asha sees only Belen’s public token count',
        check: async () => {
          await expect(page.locator('.opponent')).toContainText('1 tokens');
          await expect(page.getByText("Asha's turn")).toBeVisible();
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
