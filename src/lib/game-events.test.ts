import { describe, expect, it } from 'vitest';
import {
  REDUCER_VERSION,
  SCHEMA_VERSION,
  reduceLobby,
  type GameEvent
} from './game-events';

function event(
  id: string,
  type: GameEvent['type'],
  actorUid: string,
  payload: Record<string, unknown>
): GameEvent {
  return {
    id,
    type,
    actorUid,
    payload,
    clientSeq: 1,
    createdAtMillis: 1,
    schemaVersion: SCHEMA_VERSION,
    reducerVersion: REDUCER_VERSION
  };
}

describe('lobby reducer', () => {
  it('creates, joins, and readies exactly two players', () => {
    const state = reduceLobby([
      event('a-1', 'game/created', 'a', { gameId: 'market', displayName: 'Asha' }),
      event('b-1', 'player/joined', 'b', { displayName: 'Belen' }),
      event('a-2', 'player/ready', 'a', { ready: true })
    ]);

    expect(state.gameId).toBe('market');
    expect(state.players).toEqual([
      { uid: 'a', displayName: 'Asha', ready: true },
      { uid: 'b', displayName: 'Belen', ready: false }
    ]);
  });

  it('deterministically ignores a third seat and duplicate creation', () => {
    const state = reduceLobby([
      event('a-1', 'game/created', 'a', { gameId: 'market', displayName: 'Asha' }),
      event('b-1', 'player/joined', 'b', { displayName: 'Belen' }),
      event('c-1', 'player/joined', 'c', { displayName: 'Chandra' }),
      event('d-1', 'game/created', 'd', { gameId: 'other', displayName: 'Dara' })
    ]);

    expect(state.players).toHaveLength(2);
    expect(state.diagnostics).toHaveLength(2);
  });
});
