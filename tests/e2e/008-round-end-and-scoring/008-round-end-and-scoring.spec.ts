import { expect, test } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { playRoundToCompletion } from '../helpers/play-round';
import { TestStepHelper } from '../helpers/test-step-helper';

test('a production-size round scores and resets for its loser', async ({ browser, page }, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Round end and scoring',
    'Both traders complete an ordinary full round, reveal its exact score, and open a fresh market for the loser.'
  );
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-scoring-008-${testInfo.project.name}`,
    'fixed-round-008'
  );

  const actionCount = await playRoundToCompletion(page, rival);
  const winner = (await page.locator('.scorecards article.winner h3').textContent()) ?? '';
  const loser =
    (await page.locator('.scorecards article:not(.winner) h3').textContent()) ?? '';

  await steps.step('round-scored', {
    description: `The round ends and reveals its score after ${actionCount} ordinary actions`,
    verifications: [
      {
        spec: 'Exactly one trader earns the first seal',
        check: async () => {
          await expect(page.locator('.scorecards article.winner')).toContainText('1 / 2 seals');
          await expect(page.locator('.scorecards article:not(.winner)')).toContainText('0 / 2 seals');
        }
      },
      {
        spec: 'Goods, bonuses, camels, totals, bonus values, and herds are public',
        check: async () => {
          await expect(page.locator('.scorecards')).toContainText('Goods');
          await expect(page.locator('.scorecards')).toContainText('Bonuses');
          await expect(page.locator('.scorecards')).toContainText('Camels');
          await expect(page.locator('.scorecards')).toContainText('Total');
          await expect(page.locator('.scorecards')).toContainText('Bonus tokens:');
          await expect(page.locator('.scorecards')).toContainText('Herd:');
        }
      },
      {
        spec: 'Both clients converge on the same winner and score review',
        check: async () => {
          await expect(rival.locator('.scorecards article.winner h3')).toHaveText(winner);
          await expect(rival.getByText('Round 1 complete')).toBeVisible();
        }
      }
    ]
  });

  await page.getByRole('button', { name: 'Open round 2' }).click();

  await steps.step('next-round-open', {
    description: 'The previous loser starts with reset round components',
    verifications: [
      {
        spec: 'Round two starts with the loser as active trader on both clients',
        check: async () => {
          await expect(page.getByText('Round 2')).toBeVisible();
          await expect(page.getByText(`${loser}'s turn`)).toBeVisible();
          await expect(rival.getByText(`${loser}'s turn`)).toBeVisible();
        }
      },
      {
        spec: 'The market and all six token supplies are reset',
        check: async () => {
          await expect(page.locator('.market').locator('article, button')).toHaveCount(5);
          await expect(page.locator('.token')).toHaveCount(6);
          await expect(page.locator('.token.diamond')).toContainText('5 left');
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
