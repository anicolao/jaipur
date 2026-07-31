import {
  REDUCER_VERSION,
  SCHEMA_VERSION,
  reduceLobby,
  type GameEvent,
  type GameActivity,
  type LobbyState
} from './game-events';

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
  turnNumber: number;
  seed: string;
  starterUid: string;
  activeUid: string;
  status: 'active' | 'complete';
  endReason: 'three-empty-supplies' | 'deck-exhausted' | null;
  camelBonusUid: string | null;
  scores: Record<string, ScoreBreakdown> | null;
  winnerUid: string | null;
  loserUid: string | null;
  deck: Card[];
  market: Card[];
  hands: Record<string, Card[]>;
  herds: Record<string, Card[]>;
  discard: Card[];
  goodsTokens: Record<Good, Token[]>;
  bonusTokens: Record<'3' | '4' | '5', Token[]>;
  ownedGoodsTokens: Record<string, Token[]>;
  ownedBonusTokens: Record<string, Token[]>;
}

export interface ScoreBreakdown {
  goods: number;
  bonus: number;
  camel: number;
  total: number;
  goodsTokenCount: number;
  bonusTokenCount: number;
}

export interface RoundResolution {
  camelBonusUid: string | null;
  scores: Record<string, ScoreBreakdown>;
  winnerUid: string;
  loserUid: string;
  tieBreak: 'score' | 'bonus-tokens' | 'goods-tokens' | 'non-starter';
}

export interface GameState extends LobbyState {
  round: RoundState | null;
  rounds: RoundState[];
  seals: Record<string, number>;
  winnerUid: string | null;
  epoch: number;
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
    turnNumber: 1,
    seed,
    starterUid: activeUid,
    activeUid,
    status: 'active',
    endReason: null,
    camelBonusUid: null,
    scores: null,
    winnerUid: null,
    loserUid: null,
    deck,
    market,
    hands,
    herds,
    discard: [],
    goodsTokens,
    bonusTokens,
    ownedGoodsTokens: Object.fromEntries(playerUids.map((uid) => [uid, []])),
    ownedBonusTokens: Object.fromEntries(playerUids.map((uid) => [uid, []]))
  };
}

export function roundEndReason(
  round: RoundState
): RoundState['endReason'] {
  if (Object.values(round.goodsTokens).filter((tokens) => tokens.length === 0).length >= 3) {
    return 'three-empty-supplies';
  }
  if (round.market.length < 5) return 'deck-exhausted';
  return null;
}

export function resolveRound(round: RoundState, playerUids: string[]): RoundResolution {
  if (playerUids.length !== 2) throw new Error('Round scoring requires exactly two players');
  const [firstUid, secondUid] = playerUids;
  const firstHerd = round.herds[firstUid]?.length ?? 0;
  const secondHerd = round.herds[secondUid]?.length ?? 0;
  const camelBonusUid =
    firstHerd === secondHerd ? null : firstHerd > secondHerd ? firstUid : secondUid;
  const scores = Object.fromEntries(
    playerUids.map((uid) => {
      const goodsTokens = round.ownedGoodsTokens[uid] ?? [];
      const bonusTokens = round.ownedBonusTokens[uid] ?? [];
      const goods = goodsTokens.reduce((total, token) => total + token.value, 0);
      const bonus = bonusTokens.reduce((total, token) => total + token.value, 0);
      const camel = camelBonusUid === uid ? 5 : 0;
      return [
        uid,
        {
          goods,
          bonus,
          camel,
          total: goods + bonus + camel,
          goodsTokenCount: goodsTokens.length,
          bonusTokenCount: bonusTokens.length
        }
      ];
    })
  ) as Record<string, ScoreBreakdown>;

  const first = scores[firstUid];
  const second = scores[secondUid];
  let winnerUid: string;
  let tieBreak: RoundResolution['tieBreak'];
  if (first.total !== second.total) {
    winnerUid = first.total > second.total ? firstUid : secondUid;
    tieBreak = 'score';
  } else if (first.bonusTokenCount !== second.bonusTokenCount) {
    winnerUid = first.bonusTokenCount > second.bonusTokenCount ? firstUid : secondUid;
    tieBreak = 'bonus-tokens';
  } else if (first.goodsTokenCount !== second.goodsTokenCount) {
    winnerUid = first.goodsTokenCount > second.goodsTokenCount ? firstUid : secondUid;
    tieBreak = 'goods-tokens';
  } else {
    winnerUid = playerUids.find((uid) => uid !== round.starterUid)!;
    tieBreak = 'non-starter';
  }
  return {
    camelBonusUid,
    scores,
    winnerUid,
    loserUid: playerUids.find((uid) => uid !== winnerUid)!,
    tieBreak
  };
}

export function reduceGame(events: GameEvent[]): GameState {
  const lobby = reduceLobby(events);
  const playerUids = lobby.players.map(({ uid }) => uid);
  const seals: Record<string, number> = Object.fromEntries(playerUids.map((uid) => [uid, 0]));
  const rounds: RoundState[] = [];
  let round: RoundState | null = null;
  let winnerUid: string | null = null;
  let epoch = 1;

  const actionActorUid = (event: GameEvent): string => {
    const requestedPlayerUid = event.payload.playerUid;
    if (
      lobby.mode === 'tabletop' &&
      event.actorUid === lobby.hostUid &&
      typeof requestedPlayerUid === 'string' &&
      playerUids.includes(requestedPlayerUid)
    ) {
      return requestedPlayerUid;
    }
    return event.actorUid;
  };

  const finishAction = (actorUid: string): Pick<GameActivity, 'roundWinnerUid' | 'gameWinnerUid'> => {
    if (!round) return {};
    round.activeUid = playerUids.find((uid) => uid !== actorUid) ?? round.activeUid;
    round.turnNumber += 1;
    const endReason = roundEndReason(round);
    if (!endReason) return {};
    const resolution = resolveRound(round, playerUids);
    round.status = 'complete';
    round.endReason = endReason;
    round.camelBonusUid = resolution.camelBonusUid;
    round.scores = resolution.scores;
    round.winnerUid = resolution.winnerUid;
    round.loserUid = resolution.loserUid;
    seals[resolution.winnerUid] += 1;
    if (seals[resolution.winnerUid] >= 2) winnerUid = resolution.winnerUid;
    return {
      roundWinnerUid: resolution.winnerUid,
      gameWinnerUid: winnerUid ?? undefined
    };
  };

  const seenIds = new Set<string>();
  for (const event of events) {
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    if (
      event.schemaVersion !== SCHEMA_VERSION ||
      event.reducerVersion !== REDUCER_VERSION
    ) {
      continue;
    }
    if (event.type === 'game/rematched') {
      if (event.actorUid !== lobby.hostUid || !winnerUid) {
        lobby.diagnostics.push(`${event.id}: invalid rematch`);
        continue;
      }
      round = null;
      rounds.length = 0;
      for (const uid of playerUids) seals[uid] = 0;
      winnerUid = null;
      epoch += 1;
      lobby.activity.push({
        id: event.id,
        type: event.type,
        actorUid: event.actorUid
      });
      continue;
    }

    if (event.type === 'round/started') {
      const seed = event.payload.seed;
      const starterUid = event.payload.starterUid;
      const expectedStarter = round?.loserUid;
      if (
        event.actorUid !== lobby.hostUid ||
        lobby.players.length !== 2 ||
        !lobby.players.every(({ ready }) => ready) ||
        typeof seed !== 'string' ||
        typeof starterUid !== 'string' ||
        winnerUid ||
        (round?.status === 'active') ||
        (round?.status === 'complete' && starterUid !== expectedStarter)
      ) {
        lobby.diagnostics.push(`${event.id}: invalid round start`);
        continue;
      }
      round = setupRound(
        playerUids,
        seed,
        starterUid
      );
      round.number = rounds.length + 1;
      rounds.push(round);
      lobby.activity.push({
        id: event.id,
        type: event.type,
        actorUid: event.actorUid,
        roundNumber: round.number,
        starterUid
      });
      continue;
    }

    if (!round) continue;
    if (round.status !== 'active') {
      if (event.type.startsWith('cards/')) {
        lobby.diagnostics.push(`${event.id}: action after round end`);
      }
      continue;
    }
    if (
      event.type.startsWith('cards/') &&
      ((event.payload.roundNumber !== undefined &&
        event.payload.roundNumber !== round.number) ||
        (event.payload.turnNumber !== undefined &&
          event.payload.turnNumber !== round.turnNumber))
    ) {
      lobby.diagnostics.push(`${event.id}: stale round or turn`);
      continue;
    }
    if (event.type === 'cards/taken-one') {
      const actorUid = actionActorUid(event);
      const cardId = event.payload.cardId;
      const hand = round.hands[actorUid];
      const marketIndex = round.market.findIndex(({ id }) => id === cardId);
      if (
        actorUid !== round.activeUid ||
        typeof cardId !== 'string' ||
        marketIndex < 0 ||
        round.market[marketIndex].kind === 'camel' ||
        !hand ||
        hand.length >= 7
      ) {
        lobby.diagnostics.push(`${event.id}: invalid single-good take`);
        continue;
      }
      const [card] = round.market.splice(marketIndex, 1);
      hand.push(card);
      const replacement = round.deck.shift();
      if (replacement) round.market.splice(marketIndex, 0, replacement);
      const result = finishAction(actorUid);
      lobby.activity.push({
        id: event.id,
        type: event.type,
        actorUid,
        roundNumber: round.number,
        turnNumber: round.turnNumber - 1,
        cardIds: [card.id],
        cardKinds: [card.kind],
        ...result
      });
      continue;
    }

    if (event.type === 'cards/taken-camels') {
      const actorUid = actionActorUid(event);
      const camels = round.market.filter(({ kind }) => kind === 'camel');
      if (actorUid !== round.activeUid || camels.length === 0) {
        lobby.diagnostics.push(`${event.id}: invalid camel take`);
        continue;
      }
      round.market = round.market.filter(({ kind }) => kind !== 'camel');
      round.herds[actorUid].push(...camels);
      while (round.market.length < 5 && round.deck.length > 0) {
        round.market.push(round.deck.shift()!);
      }
      const result = finishAction(actorUid);
      lobby.activity.push({
        id: event.id,
        type: event.type,
        actorUid,
        roundNumber: round.number,
        turnNumber: round.turnNumber - 1,
        cardIds: camels.map(({ id }) => id),
        cardKinds: camels.map(({ kind }) => kind),
        ...result
      });
      continue;
    }

    if (event.type === 'cards/exchanged') {
      const actorUid = actionActorUid(event);
      const takenIds = event.payload.takenCardIds;
      const returnedIds = event.payload.returnedCardIds;
      const hand = round.hands[actorUid];
      const herd = round.herds[actorUid];
      if (
        !Array.isArray(takenIds) ||
        !Array.isArray(returnedIds) ||
        !hand ||
        !herd ||
        actorUid !== round.activeUid ||
        !isLegalExchange(round, actorUid, takenIds, returnedIds)
      ) {
        lobby.diagnostics.push(`${event.id}: invalid exchange`);
        continue;
      }
      const taken = round.market.filter(({ id }) => takenIds.includes(id));
      const returned = [...hand, ...herd].filter(({ id }) => returnedIds.includes(id));
      round.market = [
        ...round.market.filter(({ id }) => !takenIds.includes(id)),
        ...returned
      ];
      round.hands[actorUid] = [
        ...hand.filter(({ id }) => !returnedIds.includes(id)),
        ...taken
      ];
      round.herds[actorUid] = herd.filter(({ id }) => !returnedIds.includes(id));
      const result = finishAction(actorUid);
      lobby.activity.push({
        id: event.id,
        type: event.type,
        actorUid,
        roundNumber: round.number,
        turnNumber: round.turnNumber - 1,
        cardIds: taken.map(({ id }) => id),
        cardKinds: taken.map(({ kind }) => kind),
        returnedCardIds: returned.map(({ id }) => id),
        returnedCardKinds: returned.map(({ kind }) => kind),
        ...result
      });
      continue;
    }

    if (event.type === 'cards/sold') {
      const actorUid = actionActorUid(event);
      const kind = event.payload.kind;
      const cardIds = event.payload.cardIds;
      const previousTokenCount = actorUid in round.ownedGoodsTokens
        ? (round.ownedGoodsTokens[actorUid]?.length ?? 0) +
          (round.ownedBonusTokens[actorUid]?.length ?? 0)
        : 0;
      if (
        typeof kind !== 'string' ||
        !Array.isArray(cardIds) ||
        !isGood(kind) ||
        !applySale(round, actorUid, kind, cardIds)
      ) {
        lobby.diagnostics.push(`${event.id}: invalid sale`);
        continue;
      }
      const result = finishAction(actorUid);
      const nextTokenCount = (round.ownedGoodsTokens[actorUid]?.length ?? 0) +
        (round.ownedBonusTokens[actorUid]?.length ?? 0);
      lobby.activity.push({
        id: event.id,
        type: event.type,
        actorUid,
        roundNumber: round.number,
        turnNumber: round.turnNumber - 1,
        cardIds: [...cardIds] as string[],
        cardKinds: Array.from({ length: cardIds.length }, () => kind),
        tokenCount: nextTokenCount - previousTokenCount,
        ...result
      });
    }
  }
  const eventOrder = new Map<string, number>();
  events.forEach((event, index) => {
    if (!eventOrder.has(event.id)) eventOrder.set(event.id, index);
  });
  lobby.activity.sort(
    (left, right) => (eventOrder.get(left.id) ?? 0) - (eventOrder.get(right.id) ?? 0)
  );
  return { ...lobby, round, rounds, seals, winnerUid, epoch };
}

export function legalSingleGoods(round: RoundState, uid: string): Card[] {
  if (round.status !== 'active' || round.activeUid !== uid || round.hands[uid]?.length >= 7) {
    return [];
  }
  return round.market.filter(({ kind }) => kind !== 'camel');
}

export function isLegalExchange(
  round: RoundState,
  uid: string,
  takenIds: unknown[],
  returnedIds: unknown[]
): boolean {
  if (
    round.status !== 'active' ||
    round.activeUid !== uid ||
    takenIds.length < 2 ||
    takenIds.length !== returnedIds.length ||
    new Set(takenIds).size !== takenIds.length ||
    new Set(returnedIds).size !== returnedIds.length ||
    !takenIds.every((id): id is string => typeof id === 'string') ||
    !returnedIds.every((id): id is string => typeof id === 'string')
  ) {
    return false;
  }
  const taken = round.market.filter(({ id }) => takenIds.includes(id));
  const availableReturns = [...(round.hands[uid] ?? []), ...(round.herds[uid] ?? [])];
  const returned = availableReturns.filter(({ id }) => returnedIds.includes(id));
  if (
    taken.length !== takenIds.length ||
    returned.length !== returnedIds.length ||
    taken.some(({ kind }) => kind === 'camel')
  ) {
    return false;
  }
  const takenGoods = new Set(taken.map(({ kind }) => kind));
  if (returned.some(({ kind }) => kind !== 'camel' && takenGoods.has(kind))) return false;
  const returnedFromHand = returned.filter((card) =>
    round.hands[uid].some(({ id }) => id === card.id)
  ).length;
  return round.hands[uid].length - returnedFromHand + taken.length <= 7;
}

export function isGood(value: string): value is Good {
  return value !== 'camel' && value in GOODS_VALUES;
}

export function isLegalSale(
  round: RoundState,
  uid: string,
  kind: Good,
  cardIds: unknown[]
): boolean {
  if (
    round.status !== 'active' ||
    round.activeUid !== uid ||
    cardIds.length === 0 ||
    new Set(cardIds).size !== cardIds.length ||
    !cardIds.every((id): id is string => typeof id === 'string')
  ) {
    return false;
  }
  const sold = (round.hands[uid] ?? []).filter(({ id }) => cardIds.includes(id));
  return (
    sold.length === cardIds.length &&
    sold.every((card) => card.kind === kind) &&
    (!['diamond', 'gold', 'silver'].includes(kind) || sold.length >= 2)
  );
}

export function applySale(
  round: RoundState,
  uid: string,
  kind: Good,
  cardIds: unknown[]
): boolean {
  if (!isLegalSale(round, uid, kind, cardIds)) return false;
  const sold = round.hands[uid].filter(({ id }) => cardIds.includes(id));
  round.hands[uid] = round.hands[uid].filter(({ id }) => !cardIds.includes(id));
  round.discard.push(...sold);
  round.ownedGoodsTokens[uid].push(...round.goodsTokens[kind].splice(0, sold.length));
  if (sold.length >= 3) {
    const bonusSize = String(Math.min(sold.length, 5)) as '3' | '4' | '5';
    const bonus = round.bonusTokens[bonusSize].shift();
    if (bonus) round.ownedBonusTokens[uid].push(bonus);
  }
  return true;
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
