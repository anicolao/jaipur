import type { BotDifficulty, GameEventType } from './game-events';
import type { Card, CardKind, GameState, Good, Token } from './jaipur-rules';

export type JaipurAction =
  | { type: 'take-one'; cardId: string }
  | { type: 'take-camels' }
  | { type: 'exchange'; takenIds: string[]; returnedIds: string[] }
  | { type: 'sell'; kind: Good; cardIds: string[] };

export interface BotObservation {
  botUid: string;
  opponentUid: string;
  roundNumber: number;
  turnNumber: number;
  activeUid: string;
  status: 'active' | 'complete';
  starterUid: string;
  market: Card[];
  deckCount: number;
  hand: Card[];
  herd: Card[];
  opponentHandCount: number;
  opponentHerdCount: number;
  goodsTokens: Record<Good, Token[]>;
  bonusTokenCounts: Record<'3' | '4' | '5', number>;
  ownedGoodsTokens: Token[];
  ownedBonusTokens: Token[];
  opponentGoodsTokens: Token[];
  opponentBonusTokenCount: number;
  opponentBonusTokenKinds: Record<'3' | '4' | '5', number>;
  discardCounts: Record<Good, number>;
  seals: { bot: number; opponent: number };
}

const goods: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];
const cardKinds: CardKind[] = [...goods, 'camel'];
const expensiveGoods = new Set<Good>(['diamond', 'gold', 'silver']);

export function createBotObservation(
  state: GameState,
  botUid = state.bot?.uid
): BotObservation | null {
  const round = state.round;
  if (!botUid || !round) return null;
  const opponentUid = state.players.find(({ uid }) => uid !== botUid)?.uid;
  if (!opponentUid) return null;

  return {
    botUid,
    opponentUid,
    roundNumber: round.number,
    turnNumber: round.turnNumber,
    activeUid: round.activeUid,
    status: round.status,
    starterUid: round.starterUid,
    market: round.market.map((card) => ({ ...card })),
    deckCount: round.deck.length,
    hand: (round.hands[botUid] ?? []).map((card) => ({ ...card })),
    herd: (round.herds[botUid] ?? []).map((card) => ({ ...card })),
    opponentHandCount: round.hands[opponentUid]?.length ?? 0,
    opponentHerdCount: round.herds[opponentUid]?.length ?? 0,
    goodsTokens: Object.fromEntries(
      goods.map((kind) => [kind, round.goodsTokens[kind].map((token) => ({ ...token }))])
    ) as Record<Good, Token[]>,
    bonusTokenCounts: {
      '3': round.bonusTokens['3'].length,
      '4': round.bonusTokens['4'].length,
      '5': round.bonusTokens['5'].length
    },
    ownedGoodsTokens: (round.ownedGoodsTokens[botUid] ?? []).map((token) => ({ ...token })),
    ownedBonusTokens: (round.ownedBonusTokens[botUid] ?? []).map((token) => ({ ...token })),
    opponentGoodsTokens: (round.ownedGoodsTokens[opponentUid] ?? []).map((token) => ({ ...token })),
    opponentBonusTokenCount: round.ownedBonusTokens[opponentUid]?.length ?? 0,
    opponentBonusTokenKinds: {
      '3': round.ownedBonusTokens[opponentUid]?.filter(({ kind }) => kind === 'bonus-3').length ?? 0,
      '4': round.ownedBonusTokens[opponentUid]?.filter(({ kind }) => kind === 'bonus-4').length ?? 0,
      '5': round.ownedBonusTokens[opponentUid]?.filter(({ kind }) => kind === 'bonus-5').length ?? 0
    },
    discardCounts: Object.fromEntries(
      goods.map((kind) => [kind, round.discard.filter((card) => card.kind === kind).length])
    ) as Record<Good, number>,
    seals: {
      bot: state.seals[botUid] ?? 0,
      opponent: state.seals[opponentUid] ?? 0
    }
  };
}

function subsetsOfSize<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]) => {
    if (selected.length === size) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= values.length - (size - selected.length); index += 1) {
      selected.push(values[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

function canonicalReturns(
  observation: BotObservation,
  taken: Card[],
  size: number
): Card[][] {
  const takenKinds = new Set(taken.map(({ kind }) => kind));
  const available = [...observation.hand, ...observation.herd]
    .filter(({ kind }) => kind === 'camel' || !takenKinds.has(kind));
  const groups = cardKinds
    .map((kind) => available.filter((card) => card.kind === kind).sort((a, b) => a.id.localeCompare(b.id)))
    .filter((cards) => cards.length > 0);
  const results: Card[][] = [];

  const visit = (groupIndex: number, remaining: number, selected: Card[]) => {
    if (remaining === 0) {
      const returnedFromHand = selected.filter((card) =>
        observation.hand.some(({ id }) => id === card.id)
      ).length;
      if (observation.hand.length - returnedFromHand + taken.length <= 7) {
        results.push([...selected]);
      }
      return;
    }
    if (groupIndex >= groups.length) return;
    const group = groups[groupIndex];
    for (let count = 0; count <= Math.min(group.length, remaining); count += 1) {
      selected.push(...group.slice(0, count));
      visit(groupIndex + 1, remaining - count, selected);
      selected.splice(selected.length - count, count);
    }
  };

  visit(0, size, []);
  return results;
}

export function listLegalActions(observation: BotObservation): JaipurAction[] {
  if (observation.status !== 'active' || observation.activeUid !== observation.botUid) return [];
  const actions: JaipurAction[] = [];

  if (observation.hand.length < 7) {
    for (const card of observation.market) {
      if (card.kind !== 'camel') actions.push({ type: 'take-one', cardId: card.id });
    }
  }
  if (observation.market.some(({ kind }) => kind === 'camel')) {
    actions.push({ type: 'take-camels' });
  }

  for (const kind of goods) {
    const matching = observation.hand
      .filter((card) => card.kind === kind)
      .sort((left, right) => left.id.localeCompare(right.id));
    const minimum = expensiveGoods.has(kind) ? 2 : 1;
    for (let count = minimum; count <= matching.length; count += 1) {
      actions.push({ type: 'sell', kind, cardIds: matching.slice(0, count).map(({ id }) => id) });
    }
  }

  const marketGoods = observation.market.filter(({ kind }) => kind !== 'camel');
  for (let size = 2; size <= marketGoods.length; size += 1) {
    for (const taken of subsetsOfSize(marketGoods, size)) {
      for (const returned of canonicalReturns(observation, taken, size)) {
        actions.push({
          type: 'exchange',
          takenIds: taken.map(({ id }) => id),
          returnedIds: returned.map(({ id }) => id)
        });
      }
    }
  }

  return actions;
}

const expectedBonus = (count: number) => count >= 5 ? 9 : count === 4 ? 5 : count === 3 ? 2 : 0;

function topGoodsValue(observation: BotObservation, kind: Good, offset = 0): number {
  return observation.goodsTokens[kind][offset]?.value ?? 0;
}

export function botActionKey(action: JaipurAction): string {
  switch (action.type) {
    case 'take-one': return `1:${action.cardId}`;
    case 'take-camels': return '2:camels';
    case 'exchange': return `3:${action.takenIds.join(',')}:${action.returnedIds.join(',')}`;
    case 'sell': return `0:${action.kind}:${action.cardIds.length}`;
  }
}

export function scoreBotAction(observation: BotObservation, action: JaipurAction): number {
  const handCounts = Object.fromEntries(
    goods.map((kind) => [kind, observation.hand.filter((card) => card.kind === kind).length])
  ) as Record<Good, number>;

  if (action.type === 'sell') {
    const tokenValue = action.cardIds.reduce(
      (total, _, index) => total + topGoodsValue(observation, action.kind, index),
      0
    );
    const bonus = observation.bonusTokenCounts[String(Math.min(action.cardIds.length, 5)) as '3' | '4' | '5'] > 0
      ? expectedBonus(action.cardIds.length)
      : 0;
    const emptiesSupply = action.cardIds.length >= observation.goodsTokens[action.kind].length;
    const emptySupplies = goods.filter((kind) => observation.goodsTokens[kind].length === 0).length;
    return tokenValue * 4 + bonus * 3 + action.cardIds.length * 1.5 +
      (emptiesSupply && emptySupplies >= 2 ? 8 : 0);
  }

  if (action.type === 'take-camels') {
    const count = observation.market.filter(({ kind }) => kind === 'camel').length;
    const majorityGain = observation.herd.length <= observation.opponentHerdCount ? 4 : 1;
    return count * 2.2 + majorityGain - Math.max(0, count - 3) * 0.6;
  }

  if (action.type === 'take-one') {
    const card = observation.market.find(({ id }) => id === action.cardId);
    if (!card || card.kind === 'camel') return Number.NEGATIVE_INFINITY;
    const kind = card.kind;
    const concentration = handCounts[kind] * 2.4;
    const premium = expensiveGoods.has(kind) ? 2.5 : 0;
    const handPressure = observation.hand.length >= 6 && handCounts[kind] === 0 ? -3 : 0;
    return topGoodsValue(observation, kind, handCounts[kind]) * 1.8 + concentration + premium + handPressure;
  }

  const taken = action.takenIds
    .map((id) => observation.market.find((card) => card.id === id))
    .filter((card): card is Card => Boolean(card));
  const returned = action.returnedIds
    .map((id) => [...observation.hand, ...observation.herd].find((card) => card.id === id))
    .filter((card): card is Card => Boolean(card));
  const takenValue = taken.reduce((total, card) => {
    const kind = card.kind as Good;
    return total + topGoodsValue(observation, kind, handCounts[kind]) * 1.7 + handCounts[kind] * 1.4;
  }, 0);
  const returnedCost = returned.reduce((total, card) => {
    if (card.kind === 'camel') return total + 0.8;
    return total + topGoodsValue(observation, card.kind, Math.max(0, handCounts[card.kind] - 1));
  }, 0);
  const camelReturns = returned.filter(({ kind }) => kind === 'camel').length;
  return takenValue - returnedCost + camelReturns * 0.7 + taken.length;
}

export function chooseBotAction(observation: BotObservation): JaipurAction | null {
  const actions = listLegalActions(observation);
  return actions
    .map((action) => ({ action, score: scoreBotAction(observation, action), key: botActionKey(action) }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))[0]?.action ?? null;
}

export function botEngineVersion(difficulty: BotDifficulty): number {
  return difficulty === 'maharaja' ? 2 : 1;
}

export function botActionEvent(
  observation: BotObservation,
  action: JaipurAction
): { type: GameEventType; payload: Record<string, unknown> } {
  const common = {
    playerUid: observation.botUid,
    roundNumber: observation.roundNumber,
    turnNumber: observation.turnNumber
  };
  switch (action.type) {
    case 'take-one':
      return { type: 'cards/taken-one', payload: { ...common, cardId: action.cardId } };
    case 'take-camels':
      return { type: 'cards/taken-camels', payload: common };
    case 'exchange':
      return {
        type: 'cards/exchanged',
        payload: { ...common, takenCardIds: action.takenIds, returnedCardIds: action.returnedIds }
      };
    case 'sell':
      return { type: 'cards/sold', payload: { ...common, kind: action.kind, cardIds: action.cardIds } };
  }
}
