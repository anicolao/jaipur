export const SCHEMA_VERSION = 1;
export const REDUCER_VERSION = 1;

export type GameEventType =
  | 'game/created'
  | 'tabletop/created'
  | 'tabletop/intent'
  | 'player/joined'
  | 'player/ready'
  | 'round/started'
  | 'cards/taken-one'
  | 'cards/taken-camels'
  | 'cards/revealed'
  | 'cards/undone'
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
  seat: 1 | 2;
}

export interface GameActivity {
  id: string;
  type: GameEventType;
  actorUid: string;
  roundNumber?: number;
  turnNumber?: number;
  ready?: boolean;
  starterUid?: string;
  cardIds?: string[];
  cardKinds?: string[];
  returnedCardIds?: string[];
  returnedCardKinds?: string[];
  tokenCount?: number;
  roundWinnerUid?: string;
  gameWinnerUid?: string;
  actionId?: string;
  refillCardIds?: string[];
  revealedCardIds?: string[];
}

export interface LobbyState {
  gameId: string | null;
  hostUid: string | null;
  mode: 'standard' | 'tabletop';
  players: Player[];
  activity: GameActivity[];
  diagnostics: string[];
}

export const EMPTY_LOBBY: LobbyState = {
  gameId: null,
  hostUid: null,
  mode: 'standard',
  players: [],
  activity: [],
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
  const seenIds = new Set<string>();

  for (const event of events) {
    if (seenIds.has(event.id)) {
      state.diagnostics.push(`${event.id}: duplicate event ID`);
      continue;
    }
    seenIds.add(event.id);
    if (
      event.schemaVersion !== SCHEMA_VERSION ||
      event.reducerVersion !== REDUCER_VERSION
    ) {
      state.diagnostics.push(`${event.id}: incompatible version`);
      continue;
    }

    if (event.type === 'game/created' || event.type === 'tabletop/created') {
      const gameId = event.payload.gameId;
      const displayName = event.type === 'game/created' ? nameFrom(event) : null;
      if (
        state.gameId ||
        typeof gameId !== 'string' ||
        (event.type === 'game/created' && !displayName)
      ) {
        state.diagnostics.push(`${event.id}: invalid game creation`);
        continue;
      }
      state.gameId = gameId;
      state.hostUid = event.actorUid;
      state.mode = event.type === 'tabletop/created' ? 'tabletop' : 'standard';
      if (displayName) {
        state.players.push({ uid: event.actorUid, displayName, ready: false, seat: 1 });
      }
      state.activity.push({
        id: event.id,
        type: event.type,
        actorUid: event.actorUid
      });
      continue;
    }

    if (!state.gameId) {
      state.diagnostics.push(`${event.id}: game does not exist`);
      continue;
    }

    if (event.type === 'player/joined') {
      const displayName = nameFrom(event);
      const requestedSeat = event.payload.seat;
      const openSeats = ([1, 2] as const).filter(
        (seat) => !state.players.some((player) => player.seat === seat)
      );
      const seat = requestedSeat === 1 || requestedSeat === 2
        ? requestedSeat
        : openSeats[0];
      if (
        !displayName ||
        !seat ||
        !openSeats.includes(seat) ||
        state.players.length >= 2 ||
        state.players.some(({ uid }) => uid === event.actorUid)
      ) {
        state.diagnostics.push(`${event.id}: invalid join`);
        continue;
      }
      state.players.push({ uid: event.actorUid, displayName, ready: false, seat });
      state.players.sort((left, right) => left.seat - right.seat);
      state.activity.push({
        id: event.id,
        type: event.type,
        actorUid: event.actorUid
      });
      continue;
    }

    if (event.type === 'player/ready') {
      const requestedPlayerUid = event.payload.playerUid;
      const targetUid = state.mode === 'tabletop' && event.actorUid === state.hostUid &&
        typeof requestedPlayerUid === 'string'
        ? requestedPlayerUid
        : event.actorUid;
      const player = state.players.find(({ uid }) => uid === targetUid);
      if (!player || typeof event.payload.ready !== 'boolean') {
        state.diagnostics.push(`${event.id}: invalid ready state`);
        continue;
      }
      player.ready = event.payload.ready;
      state.activity.push({
        id: event.id,
        type: event.type,
        actorUid: targetUid,
        ready: event.payload.ready
      });
    }
  }

  return state;
}
