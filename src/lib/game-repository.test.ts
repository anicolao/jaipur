import { describe, expect, it } from 'vitest';
import type { GameEvent } from './game-events';
import { orderEventStream } from './game-repository';

const event = (
  id: string,
  type: GameEvent['type'],
  clientSeq: number,
  createdAtMillis: number
): GameEvent => ({
  id,
  type,
  actorUid: 'a',
  payload: {},
  clientSeq,
  createdAtMillis,
  schemaVersion: 1,
  reducerVersion: 1
});

describe('optimistic event ordering', () => {
  it('places pending events after acknowledged history despite a slow client clock', () => {
    const roundStarted = event('a-00000003', 'round/started', 3, 2_000);
    const drawInitiated = event('a-00000004', 'cards/draw-initiated', 4, 1);

    expect(orderEventStream([roundStarted], [drawInitiated]).map(({ id }) => id)).toEqual([
      roundStarted.id,
      drawInitiated.id
    ]);
  });

  it('orders multiple pending events by client sequence and removes acknowledged duplicates', () => {
    const initiated = event('a-00000004', 'cards/draw-initiated', 4, 1);
    const confirmed = event('a-00000005', 'cards/taken-one', 5, 2);

    expect(orderEventStream([initiated], [confirmed, initiated]).map(({ id }) => id)).toEqual([
      initiated.id,
      confirmed.id
    ]);
  });
});
