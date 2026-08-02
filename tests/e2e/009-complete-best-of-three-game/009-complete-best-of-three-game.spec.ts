import { expect, test } from '@playwright/test';
import { GameLogOracle } from '../helpers/game-log-oracle';
import { openRound } from '../helpers/open-round';
import { playRoundToCompletion } from '../helpers/play-round';
import { TestStepHelper } from '../helpers/test-step-helper';
import { expectedGameLog } from './expected-game-log';

test('a complete best-of-three match ends at two seals and rematches', async ({ browser, page }, testInfo) => {
  test.setTimeout(300_000);
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Complete best-of-three game',
    'Asha and Belen play production-size rounds until one earns two seals, then begin a clean rematch.'
  );
  const gameLog = new GameLogOracle(expectedGameLog);
  const { rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-match-009-${testInfo.project.name}`,
    'fixed-round-009',
    gameLog.expectNext
  );

  let completedRounds = 0;
  let actionCount = 0;
  while (completedRounds < 3) {
    actionCount += await playRoundToCompletion(page, rival, 100, gameLog.expectNext);
    completedRounds += 1;
    if (await page.locator('.match-winner').count()) break;
    await page.getByRole('button', { name: `Open round ${completedRounds + 1}` }).click();
    await gameLog.expectNext(page, rival);
  }
  gameLog.expectComplete();
  await page.evaluate(() => window.scrollTo(0, 0));

  await steps.step('match-won', {
    description: `The match ends after ${completedRounds} rounds and ${actionCount} ordinary actions`,
    verifications: [
      {
        spec: 'The winner has exactly two seals and no further turn is available',
        check: async () => {
          await expect(page.locator('.scorecards article.winner')).toContainText('2 / 2 seals');
          await expect(page.locator('.turn-actions')).toHaveCount(0);
        }
      },
      {
        spec: 'Every completed round remains in the immutable visible history',
        check: async () => {
          await expect(page.locator('.match-history > p')).toHaveCount(completedRounds);
          await expect(page.locator('.match-history')).toContainText(`Round ${completedRounds}:`);
        }
      },
      {
        spec: 'Both clients converge on the final Jaipur winner',
        check: async () => {
          const winner = (await page.locator('.match-winner').textContent()) ?? '';
          await expect(rival.locator('.match-winner')).toHaveText(winner);
          await expect(rival.locator('.scorecards article.winner')).toContainText('2 / 2 seals');
        }
      }
    ]
  });

  await page.getByRole('button', { name: 'Start rematch' }).click();

  await steps.step('rematch-started', {
    description: 'The same traders begin a fresh first-to-two epoch',
    verifications: [
      {
        spec: 'The rematch starts at round one with reset seals and components',
        check: async () => {
          await expect(page.getByText('Round 1', { exact: true })).toBeVisible();
          await expect(page.locator('.seal-track')).toContainText('Asha: 0 / 2 seals');
          await expect(page.locator('.seal-track')).toContainText('Belen: 0 / 2 seals');
          await expect(page.locator('.market .market-slot')).toHaveCount(5);
        }
      },
      {
        spec: 'The rematch is live on both clients and the old result is no longer active',
        check: async () => {
          await expect(rival.getByText("Asha's turn")).toBeVisible();
          await expect(page.locator('.match-history')).toHaveCount(0);
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
