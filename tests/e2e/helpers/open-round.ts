import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { ExpectNextGameLogEntry } from './game-log-oracle';
import { e2eRoomCode } from './room-code';

export interface OpenRound {
  gameId: string;
  rivalContext: BrowserContext;
  rival: Page;
}

export async function openRound(
  browser: Browser,
  host: Page,
  gameId: string,
  seed: string,
  expectNextGameLogEntry?: ExpectNextGameLogEntry
): Promise<OpenRound> {
  const roomCode = e2eRoomCode(gameId);
  const url = `/?gameId=${roomCode}&seed=${seed}`;
  await host.goto(url);
  await host.getByLabel('Your trader name').fill('Asha');
  await host.getByRole('button', { name: 'Create new game' }).click();
  await expectNextGameLogEntry?.(host);

  const rivalContext = await browser.newContext();
  const rival = await rivalContext.newPage();
  await rival.goto(url);
  await rival.getByLabel('Your trader name').fill('Belen');
  await rival.getByRole('button', { name: 'Join game' }).click();
  await expectNextGameLogEntry?.(host, rival);
  await expect(host.getByLabel('Game lobby').getByText('Belen', { exact: true })).toBeVisible();
  await host.getByRole('button', { name: 'Ready to trade' }).click();
  await expectNextGameLogEntry?.(host, rival);
  await rival.getByRole('button', { name: 'Ready to trade' }).click();
  await expectNextGameLogEntry?.(host, rival);
  await host.getByRole('button', { name: 'Open the market' }).click();
  await expectNextGameLogEntry?.(host, rival);
  await expect(host.locator('.market')).toBeVisible();
  await expect(rival.locator('.market')).toBeVisible();
  return { gameId: roomCode, rivalContext, rival };
}
