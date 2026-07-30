import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
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

  return {
    async append(type, payload) {
      const clientSeq = Number(localStorage.getItem(sequenceKey) ?? '0') + 1;
      const eventId = `${actorUid}-${String(clientSeq).padStart(8, '0')}`;
      await setDoc(doc(stream, eventId), {
        type,
        payload,
        actorUid,
        clientSeq,
        createdAt: serverTimestamp(),
        schemaVersion: SCHEMA_VERSION,
        reducerVersion: REDUCER_VERSION
      });
      localStorage.setItem(sequenceKey, String(clientSeq));
    },

    subscribe(onEvents, onError) {
      return onSnapshot(
        query(stream, orderBy('createdAt')),
        (snapshot) => {
          const events = snapshot.docs
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
            })
            .sort(
              (left, right) =>
                left.createdAtMillis - right.createdAtMillis || left.id.localeCompare(right.id)
            );
          onEvents(events);
        },
        (error) => onError(error)
      );
    }
  };
}
