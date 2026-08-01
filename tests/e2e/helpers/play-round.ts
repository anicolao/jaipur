import { expect, type Page } from '@playwright/test';

const commonGoods = new Set(['Cloth', 'Spice', 'Leather']);

export async function playRoundToCompletion(
  host: Page,
  rival: Page,
  limit = 100
): Promise<number> {
  const confirmReveals = async (page: Page) => {
    const controls = page.locator('[data-confirm-reveal]');
    for (let index = 0; index < 8 && await controls.count(); index += 1) {
      try {
        await controls.first().click({ timeout: 5000 });
      } catch {
        break;
      }
      await page.waitForTimeout(250);
    }
  };
  let active = await Promise.race([
    expect(host.locator('.market .card-action').first())
      .toBeVisible()
      .then(() => host),
    expect(rival.locator('.market .card-action').first())
      .toBeVisible()
      .then(() => rival)
  ]);
  for (let action = 0; action < limit; action += 1) {
    await confirmReveals(active);
    if (await active.locator('.score-review').count()) {
      await expect(host.locator('.score-review')).toBeVisible();
      return action;
    }
    const hand = await active.locator('.hand [data-card-id]').evaluateAll((cards) =>
      cards.map((card) => ({
        id: card.getAttribute('data-card-id') ?? '',
        kind: card.querySelector('.piece-label')?.textContent ?? ''
      }))
    );
    const groups = Map.groupBy(hand, ({ kind }) => kind);
    let sale: [string, { id: string; kind: string }[]] | undefined;
    for (const entry of groups.entries()) {
      const [kind, cards] = entry;
      if (
        (commonGoods.has(kind) || cards.length >= 2) &&
        (await active.locator(`.token.${kind.toLowerCase()}:not(:disabled)`).count())
      ) {
        sale = entry;
        break;
      }
    }

    if (sale) {
      const [kind, cards] = sale;
      for (const card of cards) {
        await active.locator(`.hand [data-card-id="${card.id}"]`).click();
      }
      await active.locator(`.token.${kind.toLowerCase()}`).click();
    } else {
      const camels = active.getByRole('button', { name: /^Take all \d+ camels$/ });
      if (await camels.count()) {
        await camels.first().click();
      } else {
        const marketGood = active.locator('.market .card-action:not(.camel)').first();
        if (!(await marketGood.count())) {
          throw new Error(`No legal ordinary UI action found on action ${action + 1}`);
        }
        await marketGood.click();
      }
    }
    active = active === host ? rival : host;
    await expect(
      active.locator('.market .card-action, .score-review, .action-card-flight').first()
    ).toBeVisible();
    await active.locator('.action-card-flight').evaluateAll((flights) => {
      for (const flight of flights) {
        for (const animation of flight.getAnimations()) animation.finish();
      }
    });
    await expect(active.locator('.market .card-action, .score-review').first()).toBeVisible();
  }
  throw new Error(`Round did not finish within ${limit} ordinary UI actions`);
}
