import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface OpenRound {
  rivalContext: BrowserContext;
  rival: Page;
}

export async function openRound(
  browser: Browser,
  host: Page,
  gameId: string,
  seed: string
): Promise<OpenRound> {
  const url = `/?gameId=${gameId}&seed=${seed}`;
  await host.goto(url);
  await host.getByLabel('Your trader name').fill('Asha');
  await host.getByRole('button', { name: 'Create game' }).click();

  const rivalContext = await browser.newContext();
  const rival = await rivalContext.newPage();
  await rival.goto(url);
  await rival.getByLabel('Your trader name').fill('Belen');
  await rival.getByRole('button', { name: 'Join game' }).click();
  await expect(host.getByText('Belen')).toBeVisible();
  await host.getByRole('button', { name: 'Ready to trade' }).click();
  await rival.getByRole('button', { name: 'Ready to trade' }).click();
  await host.getByRole('button', { name: 'Open the market' }).click();
  await expect(host.locator('.market')).toBeVisible();
  await expect(rival.locator('.market')).toBeVisible();
  return { rivalContext, rival };
}
