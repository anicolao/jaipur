export const SCHEMA_VERSION = 1;
export const REDUCER_VERSION = 1;

export type GameEventType =
  | 'game/created'
  | 'player/joined'
  | 'player/ready'
  | 'round/started'
  | 'cards/taken-one'
  | 'cards/taken-camels'
  | 'cards/exchanged'
  | 'cards/sold'
  | 'game/rematched';

export interface GameEvent {
  id: string;
  type: GameEventType;
  payload: Record<string, unknown>;
  actorUid: string;
  clientSeq: number;
  createdAtMillis: number;
  schemaVersion: number;
  reducerVersion: number;
}

export interface Player {
  uid: string;
  displayName: string;
  ready: boolean;
}

export interface LobbyState {
  gameId: string | null;
  hostUid: string | null;
  players: Player[];
  diagnostics: string[];
}

export const EMPTY_LOBBY: LobbyState = {
  gameId: null,
  hostUid: null,
  players: [],
  diagnostics: []
};

function nameFrom(event: GameEvent): string | null {
  const value = event.payload.displayName;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 32 ? trimmed : null;
}

export function reduceLobby(events: GameEvent[]): LobbyState {
  const state: LobbyState = structuredClone(EMPTY_LOBBY);

  for (const event of events) {
    if (
      event.schemaVersion !== SCHEMA_VERSION ||
      event.reducerVersion !== REDUCER_VERSION
    ) {
      state.diagnostics.push(`${event.id}: incompatible version`);
      continue;
    }

    if (event.type === 'game/created') {
      const gameId = event.payload.gameId;
      const displayName = nameFrom(event);
      if (state.gameId || typeof gameId !== 'string' || !displayName) {
        state.diagnostics.push(`${event.id}: invalid game creation`);
        continue;
      }
      state.gameId = gameId;
      state.hostUid = event.actorUid;
      state.players.push({ uid: event.actorUid, displayName, ready: false });
      continue;
    }

    if (!state.gameId) {
      state.diagnostics.push(`${event.id}: game does not exist`);
      continue;
    }

    if (event.type === 'player/joined') {
      const displayName = nameFrom(event);
      if (
        !displayName ||
        state.players.length >= 2 ||
        state.players.some(({ uid }) => uid === event.actorUid)
      ) {
        state.diagnostics.push(`${event.id}: invalid join`);
        continue;
      }
      state.players.push({ uid: event.actorUid, displayName, ready: false });
      continue;
    }

    if (event.type === 'player/ready') {
      const player = state.players.find(({ uid }) => uid === event.actorUid);
      if (!player || typeof event.payload.ready !== 'boolean') {
        state.diagnostics.push(`${event.id}: invalid ready state`);
        continue;
      }
      player.ready = event.payload.ready;
    }
  }

  return state;
}
