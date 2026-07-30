import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
  type Timestamp,
  type Unsubscribe
} from 'firebase/firestore';
import {
  REDUCER_VERSION,
  SCHEMA_VERSION,
  type GameEvent,
  type GameEventType
} from './game-events';

interface StoredEvent {
  type: GameEventType;
  payload: Record<string, unknown>;
  actorUid: string;
  clientSeq: number;
  createdAt?: Timestamp;
  schemaVersion: number;
  reducerVersion: number;
}

export interface GameRepository {
  append: (type: GameEventType, payload: Record<string, unknown>) => Promise<void>;
  subscribe: (
    onEvents: (events: GameEvent[]) => void,
    onError: (error: Error) => void
  ) => Unsubscribe;
}

export function createGameRepository(
  db: Firestore,
  gameId: string,
  actorUid: string
): GameRepository {
  const stream = collection(db, 'games', gameId, 'events');
  const sequenceKey = `jaipur:${gameId}:${actorUid}:client-seq`;
  let pending: GameEvent[] = [];
  let remote: GameEvent[] = [];
  let notify: ((events: GameEvent[]) => void) | undefined;

  const ordered = () =>
    [...remote, ...pending].sort(
      (left, right) =>
        left.createdAtMillis - right.createdAtMillis || left.id.localeCompare(right.id)
    );

  return {
    async append(type, payload) {
      const clientSeq = Number(localStorage.getItem(sequenceKey) ?? '0') + 1;
      const eventId = `${actorUid}-${String(clientSeq).padStart(8, '0')}`;
      localStorage.setItem(sequenceKey, String(clientSeq));
      pending.push({
        id: eventId,
        type,
        payload,
        actorUid,
        clientSeq,
        createdAtMillis: Date.now(),
        schemaVersion: SCHEMA_VERSION,
        reducerVersion: REDUCER_VERSION
      });
      notify?.(ordered());
      try {
        await setDoc(doc(stream, eventId), {
          type,
          payload,
          actorUid,
          clientSeq,
          createdAt: serverTimestamp(),
          schemaVersion: SCHEMA_VERSION,
          reducerVersion: REDUCER_VERSION
        });
      } catch (error) {
        pending = pending.filter(({ id }) => id !== eventId);
        notify?.(ordered());
        throw error;
      }
    },

    subscribe(onEvents, onError) {
      notify = onEvents;
      return onSnapshot(
        stream,
        (snapshot) => {
          remote = snapshot.docs
            .map((snapshotDocument): GameEvent => {
              const value = snapshotDocument.data() as StoredEvent;
              return {
                id: snapshotDocument.id,
                type: value.type,
                payload: value.payload,
                actorUid: value.actorUid,
                clientSeq: value.clientSeq,
                createdAtMillis: value.createdAt?.toMillis() ?? 0,
                schemaVersion: value.schemaVersion,
                reducerVersion: value.reducerVersion
              };
            });
          const remoteIds = new Set(remote.map(({ id }) => id));
          pending = pending.filter(({ id }) => !remoteIds.has(id));
          onEvents(ordered());
        },
        (error) => onError(error)
      );
    }
  };
}
