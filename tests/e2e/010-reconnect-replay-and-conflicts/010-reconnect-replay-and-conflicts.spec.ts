import { expect, test, type APIRequestContext } from '@playwright/test';
import { openRound } from '../helpers/open-round';
import { TestStepHelper } from '../helpers/test-step-helper';

interface InjectedEvent {
  actorUid: string;
  cardId: string;
  clientSeq: number;
  timestamp: string;
  schemaVersion?: number;
  turnNumber: number;
}

async function injectTake(
  request: APIRequestContext,
  gameId: string,
  eventId: string,
  value: InjectedEvent
) {
  return request.patch(
    `http://127.0.0.1:8186/v1/projects/jaipur-e2e/databases/(default)/documents/games/${gameId}/events/${eventId}?currentDocument.exists=false`,
    {
      headers: { authorization: 'Bearer owner' },
      data: {
        fields: {
          type: { stringValue: 'cards/taken-one' },
          payload: {
            mapValue: {
              fields: {
                cardId: { stringValue: value.cardId },
                roundNumber: { integerValue: '1' },
                turnNumber: { integerValue: String(value.turnNumber) }
              }
            }
          },
          actorUid: { stringValue: value.actorUid },
          clientSeq: { integerValue: String(value.clientSeq) },
          createdAt: { timestampValue: value.timestamp },
          schemaVersion: { integerValue: String(value.schemaVersion ?? 1) },
          reducerVersion: { integerValue: '1' }
        }
      }
    }
  );
}

test('offline replay converges and malformed stream entries stay deterministic', async ({
  browser,
  page,
  request
}, testInfo) => {
  const steps = new TestStepHelper(page, testInfo);
  steps.setMetadata(
    'Reconnect, replay, and conflicts',
    'Belen replays a cached game after a browser-network interruption; concurrent, duplicate, and incompatible events remain visible but harmless.'
  );
  const { gameId, rivalContext, rival } = await openRound(
    browser,
    page,
    `e2e-replay-010-${testInfo.project.name}`,
    'fixed-round-010'
  );

  await rivalContext.setOffline(true);
  await page.locator('.market button').first().click();
  await expect(page.getByText("Belen's turn")).toBeVisible();
  await expect(rival.getByText("Asha's turn")).toBeVisible();

  await steps.step('offline-cache', {
    description: 'A trader with an interrupted browser network keeps a stable cached projection',
    verifications: [
      {
        spec: 'Belen remains on the cached turn while Asha continues the canonical game',
        check: async () => {
          await expect(rival.getByText("Asha's turn")).toBeVisible();
          await expect(page.getByText("Belen's turn")).toBeVisible();
        }
      }
    ]
  });

  await rivalContext.setOffline(false);
  await rival.reload();
  await expect(rival.getByText("Belen's turn")).toBeVisible();
  await expect(rival.getByText('Game synced')).toBeVisible();

  await steps.step('replayed-after-reload', {
    description: 'Reconnect and reload replay the same canonical state',
    verifications: [
      {
        spec: 'Both clients converge without rejoining or losing private state',
        check: async () => {
          await expect(rival.locator('.hand')).toBeVisible();
          await expect(page.getByText("Belen's turn")).toBeVisible();
        }
      }
    ]
  });

  const rivalUid = await rival.evaluate((id) => {
    const prefix = `jaipur:${id}:`;
    return (
      Object.keys(localStorage)
        .find((key) => key.startsWith(prefix) && key.endsWith(':client-seq'))
        ?.slice(prefix.length, -':client-seq'.length) ?? ''
    );
  }, gameId);
  const goods = await rival.locator('.market button').evaluateAll((cards) =>
    cards.slice(0, 1).map((card) => card.getAttribute('data-card-id') ?? '')
  );
  expect(rivalUid).not.toBe('');
  expect(goods).toHaveLength(1);

  const first = await injectTake(request, gameId, 'fault-concurrent-1', {
    actorUid: rivalUid,
    cardId: goods[0],
    clientSeq: 9001,
    timestamp: '2030-01-01T00:00:01Z',
    turnNumber: 2
  });
  const stale = await injectTake(request, gameId, 'fault-concurrent-2', {
    actorUid: rivalUid,
    cardId: goods[0],
    clientSeq: 9002,
    timestamp: '2030-01-01T00:00:02Z',
    turnNumber: 2
  });
  expect(first.ok()).toBe(true);
  expect(stale.ok()).toBe(true);
  await expect(page.getByText("Asha's turn")).toBeVisible();
  await expect(page.getByText(/conflicting event ignored/)).toBeVisible();

  const duplicate = await injectTake(request, gameId, 'fault-concurrent-1', {
    actorUid: rivalUid,
    cardId: goods[0],
    clientSeq: 9001,
    timestamp: '2030-01-01T00:00:03Z',
    turnNumber: 2
  });
  expect(duplicate.ok()).toBe(false);

  const incompatible = await injectTake(request, gameId, 'fault-incompatible', {
    actorUid: rivalUid,
    cardId: goods[0],
    clientSeq: 9003,
    timestamp: '2030-01-01T00:00:04Z',
    schemaVersion: 99,
    turnNumber: 3
  });
  expect(incompatible.ok()).toBe(true);

  await steps.step('conflicts-contained', {
    description: 'Invalid concurrent and incompatible entries cannot corrupt replay',
    status: 'incompatible',
    verifications: [
      {
        spec: 'The first canonical action applies and the stale concurrent action is ignored',
        check: async () => {
          await expect(page.getByText("Asha's turn")).toBeVisible();
          await expect(rival.getByText("Asha's turn")).toBeVisible();
          await expect(page.locator('.diagnostics')).toContainText('stale round or turn');
        }
      },
      {
        spec: 'An incompatible version produces a blocking accessible alert',
        check: async () => {
          await expect(page.getByRole('alert')).toHaveText(
            'This game contains an incompatible protocol version'
          );
          await expect(page.locator('.diagnostics')).toContainText('incompatible version');
        }
      }
    ]
  });

  steps.generateDocs();
  await rivalContext.close();
});
