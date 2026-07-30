import { expect, type Page } from '@playwright/test';

const commonGoods = new Set(['Cloth', 'Spice', 'Leather']);

export async function playRoundToCompletion(
  host: Page,
  rival: Page,
  limit = 100
): Promise<number> {
  let active = host;
  for (let action = 0; action < limit; action += 1) {
    if (await active.locator('.score-review').count()) {
      await expect(host.locator('.score-review')).toBeVisible();
      return action;
    }
    const hand = await active.locator('.hand article').evaluateAll((cards) =>
      cards.map((card) => ({
        id: card.getAttribute('data-card-id') ?? '',
        kind: card.querySelector('span')?.textContent ?? ''
      }))
    );
    const groups = Map.groupBy(hand, ({ kind }) => kind);
    const sale = [...groups.entries()].find(
      ([kind, cards]) => commonGoods.has(kind) || cards.length >= 2
    );

    if (sale) {
      const [kind, cards] = sale;
      await active.getByRole('button', { name: 'Sell goods' }).click();
      for (const card of cards) {
        await active
          .getByRole('button', { name: `Select ${kind} ${card.id} for sale` })
          .click();
      }
      await active.getByRole('button', { name: `Sell ${cards.length} ${kind}` }).click();
    } else {
      const camels = active.getByRole('button', { name: /^Take all \d+ camels$/ });
      if (await camels.count()) {
        await camels.click();
      } else {
        const marketGood = active.locator('.market button').first();
        if (!(await marketGood.count())) {
          throw new Error(`No legal ordinary UI action found on action ${action + 1}`);
        }
        await marketGood.click();
      }
    }
    active = active === host ? rival : host;
    await expect(active.locator('.turn-actions, .score-review').first()).toBeVisible();
  }
  throw new Error(`Round did not finish within ${limit} ordinary UI actions`);
}
