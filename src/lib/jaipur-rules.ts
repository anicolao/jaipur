import { reduceLobby, type GameEvent, type LobbyState } from './game-events';

export type Good = 'diamond' | 'gold' | 'silver' | 'cloth' | 'spice' | 'leather';
export type CardKind = Good | 'camel';

export interface Card {
  id: string;
  kind: CardKind;
}

export interface Token {
  id: string;
  kind: Good | 'bonus-3' | 'bonus-4' | 'bonus-5' | 'camel';
  value: number;
}

export interface RoundState {
  number: number;
  seed: string;
  activeUid: string;
  deck: Card[];
  market: Card[];
  hands: Record<string, Card[]>;
  herds: Record<string, Card[]>;
  discard: Card[];
  goodsTokens: Record<Good, Token[]>;
  bonusTokens: Record<'3' | '4' | '5', Token[]>;
}

export interface GameState extends LobbyState {
  round: RoundState | null;
}

const CARD_COUNTS: Record<CardKind, number> = {
  diamond: 6,
  gold: 6,
  silver: 6,
  cloth: 8,
  spice: 8,
  leather: 10,
  camel: 11
};

const GOODS_VALUES: Record<Good, number[]> = {
  diamond: [7, 7, 5, 5, 5],
  gold: [6, 6, 5, 5, 5],
  silver: [5, 5, 5, 5, 5],
  cloth: [5, 3, 3, 2, 2, 1, 1],
  spice: [5, 3, 3, 2, 2, 1, 1],
  leather: [4, 3, 2, 1, 1, 1, 1, 1, 1]
};

const BONUS_VALUES = {
  '3': [1, 1, 2, 2, 2, 3, 3],
  '4': [4, 4, 5, 5, 6, 6],
  '5': [8, 8, 9, 10, 10]
} as const;

export function createDeck(): Card[] {
  return (Object.entries(CARD_COUNTS) as [CardKind, number][]).flatMap(([kind, count]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${kind}-${String(index + 1).padStart(2, '0')}`,
      kind
    }))
  );
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomSource(seed: string): () => number {
  let value = hashSeed(seed);
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(values: T[], seed: string): T[] {
  const result = [...values];
  const random = randomSource(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function setupRound(playerUids: string[], seed: string, activeUid: string): RoundState {
  if (playerUids.length !== 2 || !playerUids.includes(activeUid)) {
    throw new Error('A round requires two seated players and a valid starter');
  }

  const fullDeck = createDeck();
  const fixedCamels = fullDeck.filter(({ kind }) => kind === 'camel').slice(0, 3);
  const deck = shuffle(
    fullDeck.filter(({ id }) => !fixedCamels.some((camel) => camel.id === id)),
    `${seed}:cards`
  );
  const hands: Record<string, Card[]> = Object.fromEntries(playerUids.map((uid) => [uid, []]));
  for (let deal = 0; deal < 5; deal += 1) {
    for (const uid of playerUids) hands[uid].push(deck.shift()!);
  }
  const market = [...fixedCamels, deck.shift()!, deck.shift()!];
  const herds: Record<string, Card[]> = {};
  for (const uid of playerUids) {
    herds[uid] = hands[uid].filter(({ kind }) => kind === 'camel');
    hands[uid] = hands[uid].filter(({ kind }) => kind !== 'camel');
  }

  const goodsTokens = Object.fromEntries(
    (Object.entries(GOODS_VALUES) as [Good, number[]][]).map(([kind, values]) => [
      kind,
      values.map((value, index) => ({ id: `${kind}-token-${index + 1}`, kind, value }))
    ])
  ) as Record<Good, Token[]>;
  const bonusTokens = Object.fromEntries(
    (Object.entries(BONUS_VALUES) as [keyof typeof BONUS_VALUES, readonly number[]][]).map(
      ([size, values]) => [
        size,
        shuffle(
          values.map((value, index) => ({
            id: `bonus-${size}-${index + 1}`,
            kind: `bonus-${size}` as Token['kind'],
            value
          })),
          `${seed}:bonus:${size}`
        )
      ]
    )
  ) as RoundState['bonusTokens'];

  return {
    number: 1,
    seed,
    activeUid,
    deck,
    market,
    hands,
    herds,
    discard: [],
    goodsTokens,
    bonusTokens
  };
}

export function reduceGame(events: GameEvent[]): GameState {
  const lobby = reduceLobby(events);
  let round: RoundState | null = null;
  for (const event of events) {
    if (event.type !== 'round/started' || round) continue;
    const seed = event.payload.seed;
    const starterUid = event.payload.starterUid;
    if (
      event.actorUid !== lobby.hostUid ||
      lobby.players.length !== 2 ||
      !lobby.players.every(({ ready }) => ready) ||
      typeof seed !== 'string' ||
      typeof starterUid !== 'string'
    ) {
      lobby.diagnostics.push(`${event.id}: invalid round start`);
      continue;
    }
    round = setupRound(
      lobby.players.map(({ uid }) => uid),
      seed,
      starterUid
    );
  }
  return { ...lobby, round };
}

export function cardCount(round: RoundState): number {
  return (
    round.deck.length +
    round.market.length +
    round.discard.length +
    Object.values(round.hands).flat().length +
    Object.values(round.herds).flat().length
  );
}
