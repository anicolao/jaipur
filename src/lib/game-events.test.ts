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
      { uid: 'a', displayName: 'Asha', ready: true, seat: 1 },
      { uid: 'b', displayName: 'Belen', ready: false, seat: 2 }
    ]);
    expect(state.activity).toEqual([
      { id: 'a-1', type: 'game/created', actorUid: 'a' },
      { id: 'b-1', type: 'player/joined', actorUid: 'b' },
      { id: 'a-2', type: 'player/ready', actorUid: 'a', ready: true }
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
    expect(state.activity.map(({ id }) => id)).toEqual(['a-1', 'b-1']);
    expect(state.diagnostics).toHaveLength(2);
  });

  it('keeps a tabletop host neutral and assigns explicit player seats', () => {
    const state = reduceLobby([
      event('table-1', 'tabletop/created', 'table', { gameId: 'table' }),
      event('b-1', 'player/joined', 'b', { displayName: 'Belen', seat: 2 }),
      event('a-1', 'player/joined', 'a', { displayName: 'Asha', seat: 1 }),
      event('table-2', 'player/ready', 'table', { playerUid: 'a', ready: true })
    ]);

    expect(state.mode).toBe('tabletop');
    expect(state.hostUid).toBe('table');
    expect(state.players).toEqual([
      { uid: 'a', displayName: 'Asha', ready: true, seat: 1 },
      { uid: 'b', displayName: 'Belen', ready: false, seat: 2 }
    ]);
    expect(state.activity.at(-1)).toMatchObject({
      type: 'player/ready',
      actorUid: 'a',
      ready: true
    });
  });
});
