import {
  botActionKey,
  listLegalActions,
  scoreBotAction,
  type BotObservation,
  type JaipurAction
} from './jaipur-bot';
import type { Card, Good, Token } from './jaipur-rules';

type BonusSize = '3' | '4' | '5';
type Seat = 0 | 1;

interface SimulationState {
  uids: [string, string];
  active: Seat;
  starter: Seat;
  market: Card[];
  deck: Card[];
  hands: [Card[], Card[]];
  herds: [Card[], Card[]];
  goodsTokens: Record<Good, Token[]>;
  bonusTokens: Record<BonusSize, Token[]>;
  ownedGoodsTokens: [Token[], Token[]];
  ownedBonusTokens: [Token[], Token[]];
  discardCounts: Record<Good, number>;
  seals: [number, number];
  terminal: boolean;
}

export interface MaharajaSearchOptions {
  samples?: number;
  candidateLimit?: number;
  rolloutTurns?: number;
  timeLimitMs?: number;
  now?: () => number;
}

export interface MaharajaSearchResult {
  action: JaipurAction | null;
  completedSamples: number;
  candidates: number;
  simulations: number;
}

const goods: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];
const bonusSizes: BonusSize[] = ['3', '4', '5'];
const cardCounts: Record<Good | 'camel', number> = {
  diamond: 6,
  gold: 6,
  silver: 6,
  cloth: 8,
  spice: 8,
  leather: 10,
  camel: 11
};
const bonusValues: Record<BonusSize, number[]> = {
  '3': [1, 1, 2, 2, 2, 3, 3],
  '4': [4, 4, 5, 5, 6, 6],
  '5': [8, 8, 9, 10, 10]
};

function hashText(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomSource(seed: string): () => number {
  let value = hashText(seed);
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function removeOne(values: number[], target: number) {
  const index = values.indexOf(target);
  if (index >= 0) values.splice(index, 1);
}

function bonusSize(token: Token): BonusSize | null {
  const match = token.kind.match(/^bonus-([345])$/);
  return match?.[1] as BonusSize | undefined ?? null;
}

function sampleBonuses(
  observation: BotObservation,
  random: () => number
): { supplies: Record<BonusSize, Token[]>; opponent: Token[] } {
  const supplies = {} as Record<BonusSize, Token[]>;
  const opponent: Token[] = [];
  for (const size of bonusSizes) {
    const remaining = [...bonusValues[size]];
    for (const token of observation.ownedBonusTokens) {
      if (bonusSize(token) === size) removeOne(remaining, token.value);
    }
    const randomized = shuffled(remaining, random);
    const opponentCount = observation.opponentBonusTokenKinds[size];
    for (let index = 0; index < opponentCount; index += 1) {
      const value = randomized.shift();
      if (value === undefined) break;
      opponent.push({
        id: `belief-opponent-bonus-${size}-${index}`,
        kind: `bonus-${size}`,
        value
      });
    }
    supplies[size] = randomized
      .slice(0, observation.bonusTokenCounts[size])
      .map((value, index) => ({
        id: `belief-supply-bonus-${size}-${index}`,
        kind: `bonus-${size}` as Token['kind'],
        value
      }));
  }
  return { supplies, opponent };
}

function sampleState(observation: BotObservation, seed: string): SimulationState {
  const random = randomSource(seed);
  const remaining = { ...cardCounts };
  const removeKnown = (card: Card) => {
    remaining[card.kind] = Math.max(0, remaining[card.kind] - 1);
  };
  observation.market.forEach(removeKnown);
  observation.hand.forEach(removeKnown);
  observation.herd.forEach(removeKnown);
  remaining.camel = Math.max(0, remaining.camel - observation.opponentHerdCount);
  for (const kind of goods) {
    remaining[kind] = Math.max(0, remaining[kind] - observation.discardCounts[kind]);
  }

  const unknownGoods = shuffled(
    goods.flatMap((kind) =>
      Array.from({ length: remaining[kind] }, (_, index) => ({
        id: `belief-${kind}-${index}`,
        kind
      } as Card))
    ),
    random
  );
  const opponentHand = unknownGoods.splice(0, observation.opponentHandCount);
  const unknownDeck = shuffled([
    ...unknownGoods,
    ...Array.from({ length: remaining.camel }, (_, index) => ({
      id: `belief-camel-${index}`,
      kind: 'camel' as const
    }))
  ], random).slice(0, observation.deckCount);
  const opponentHerd = Array.from({ length: observation.opponentHerdCount }, (_, index) => ({
    id: `belief-opponent-camel-${index}`,
    kind: 'camel' as const
  }));
  const sampledBonuses = sampleBonuses(observation, random);

  return {
    uids: [observation.botUid, observation.opponentUid],
    active: observation.activeUid === observation.botUid ? 0 : 1,
    starter: observation.starterUid === observation.botUid ? 0 : 1,
    market: structuredClone(observation.market),
    deck: unknownDeck,
    hands: [structuredClone(observation.hand), opponentHand],
    herds: [structuredClone(observation.herd), opponentHerd],
    goodsTokens: structuredClone(observation.goodsTokens),
    bonusTokens: sampledBonuses.supplies,
    ownedGoodsTokens: [
      structuredClone(observation.ownedGoodsTokens),
      structuredClone(observation.opponentGoodsTokens)
    ],
    ownedBonusTokens: [
      structuredClone(observation.ownedBonusTokens),
      sampledBonuses.opponent
    ],
    discardCounts: { ...observation.discardCounts },
    seals: [observation.seals.bot, observation.seals.opponent],
    terminal: false
  };
}

function simulationObservation(state: SimulationState, seat: Seat): BotObservation {
  const opponent = seat === 0 ? 1 : 0;
  return {
    botUid: state.uids[seat],
    opponentUid: state.uids[opponent],
    roundNumber: 1,
    turnNumber: 1,
    activeUid: state.uids[seat],
    status: state.terminal ? 'complete' : 'active',
    starterUid: state.uids[state.starter],
    market: state.market,
    deckCount: state.deck.length,
    hand: state.hands[seat],
    herd: state.herds[seat],
    opponentHandCount: state.hands[opponent].length,
    opponentHerdCount: state.herds[opponent].length,
    goodsTokens: state.goodsTokens,
    bonusTokenCounts: {
      '3': state.bonusTokens['3'].length,
      '4': state.bonusTokens['4'].length,
      '5': state.bonusTokens['5'].length
    },
    ownedGoodsTokens: state.ownedGoodsTokens[seat],
    ownedBonusTokens: state.ownedBonusTokens[seat],
    opponentGoodsTokens: state.ownedGoodsTokens[opponent],
    opponentBonusTokenCount: state.ownedBonusTokens[opponent].length,
    opponentBonusTokenKinds: {
      '3': state.ownedBonusTokens[opponent].filter(({ kind }) => kind === 'bonus-3').length,
      '4': state.ownedBonusTokens[opponent].filter(({ kind }) => kind === 'bonus-4').length,
      '5': state.ownedBonusTokens[opponent].filter(({ kind }) => kind === 'bonus-5').length
    },
    discardCounts: state.discardCounts,
    seals: { bot: state.seals[seat], opponent: state.seals[opponent] }
  };
}

function roundEnded(state: SimulationState): boolean {
  return goods.filter((kind) => state.goodsTokens[kind].length === 0).length >= 3 ||
    state.market.length < 5;
}

function applyAction(state: SimulationState, action: JaipurAction): boolean {
  if (state.terminal) return false;
  const seat = state.active;
  const hand = state.hands[seat];
  const herd = state.herds[seat];

  if (action.type === 'take-one') {
    const marketIndex = state.market.findIndex(({ id }) => id === action.cardId);
    if (marketIndex < 0 || state.market[marketIndex].kind === 'camel' || hand.length >= 7) return false;
    const [card] = state.market.splice(marketIndex, 1);
    hand.push(card);
    const replacement = state.deck.shift();
    if (replacement) state.market.splice(marketIndex, 0, replacement);
  } else if (action.type === 'take-camels') {
    if (!state.market.some(({ kind }) => kind === 'camel')) return false;
    state.market = state.market.flatMap((card) => {
      if (card.kind !== 'camel') return [card];
      herd.push(card);
      const replacement = state.deck.shift();
      return replacement ? [replacement] : [];
    });
  } else if (action.type === 'exchange') {
    const taken = action.takenIds.map((id) => state.market.find((card) => card.id === id));
    const available = [...hand, ...herd];
    const returned = action.returnedIds.map((id) => available.find((card) => card.id === id));
    if (taken.some((card) => !card || card.kind === 'camel') || returned.some((card) => !card)) {
      return false;
    }
    const takenCards = taken as Card[];
    const returnedCards = returned as Card[];
    state.market = state.market.map((card) => {
      const index = action.takenIds.indexOf(card.id);
      return index >= 0 ? returnedCards[index] : card;
    });
    state.hands[seat] = [
      ...hand.filter(({ id }) => !action.returnedIds.includes(id)),
      ...takenCards
    ];
    state.herds[seat] = herd.filter(({ id }) => !action.returnedIds.includes(id));
  } else {
    const sold = hand.filter(({ id }) => action.cardIds.includes(id));
    if (sold.length !== action.cardIds.length || sold.some(({ kind }) => kind !== action.kind)) {
      return false;
    }
    state.hands[seat] = hand.filter(({ id }) => !action.cardIds.includes(id));
    state.discardCounts[action.kind] += sold.length;
    state.ownedGoodsTokens[seat].push(...state.goodsTokens[action.kind].splice(0, sold.length));
    if (sold.length >= 3) {
      const size = String(Math.min(sold.length, 5)) as BonusSize;
      const bonus = state.bonusTokens[size].shift();
      if (bonus) state.ownedBonusTokens[seat].push(bonus);
    }
  }

  state.terminal = roundEnded(state);
  state.active = seat === 0 ? 1 : 0;
  return true;
}

function tokenScore(tokens: Token[]): number {
  return tokens.reduce((total, token) => total + token.value, 0);
}

function finalScore(state: SimulationState, seat: Seat): number {
  const opponent = seat === 0 ? 1 : 0;
  const camel = state.herds[seat].length > state.herds[opponent].length ? 5 : 0;
  return tokenScore(state.ownedGoodsTokens[seat]) +
    tokenScore(state.ownedBonusTokens[seat]) + camel;
}

function terminalWinner(state: SimulationState): Seat {
  const scores = [finalScore(state, 0), finalScore(state, 1)];
  if (scores[0] !== scores[1]) return scores[0] > scores[1] ? 0 : 1;
  const bonusCounts = state.ownedBonusTokens.map((tokens) => tokens.length);
  if (bonusCounts[0] !== bonusCounts[1]) return bonusCounts[0] > bonusCounts[1] ? 0 : 1;
  const goodsCounts = state.ownedGoodsTokens.map((tokens) => tokens.length);
  if (goodsCounts[0] !== goodsCounts[1]) return goodsCounts[0] > goodsCounts[1] ? 0 : 1;
  return state.starter === 0 ? 1 : 0;
}

function handPotential(state: SimulationState, seat: Seat): number {
  return goods.reduce((total, kind) => {
    const count = state.hands[seat].filter((card) => card.kind === kind).length;
    if (count === 0) return total;
    const legalCount = ['diamond', 'gold', 'silver'].includes(kind) && count === 1 ? 0 : count;
    const goodsValue = state.goodsTokens[kind]
      .slice(0, legalCount)
      .reduce((sum, token) => sum + token.value, 0);
    const bonus = legalCount >= 5 ? 9 : legalCount === 4 ? 5 : legalCount === 3 ? 2 : 0;
    return total + goodsValue + bonus;
  }, 0);
}

function utility(state: SimulationState): number {
  const scoreDifference = finalScore(state, 0) - finalScore(state, 1);
  if (state.terminal) {
    const winner = terminalWinner(state);
    const matchWeight = winner === 0
      ? (state.seals[0] === 1 ? 1450 : 1000)
      : -(state.seals[1] === 1 ? 1450 : 1000);
    return matchWeight + scoreDifference * 2;
  }
  const camelDifference = state.herds[0].length - state.herds[1].length;
  return scoreDifference * 3 +
    (handPotential(state, 0) - handPotential(state, 1)) * 1.4 +
    Math.max(-5, Math.min(5, camelDifference)) * 0.7;
}

function rankedActions(state: SimulationState): Array<{ action: JaipurAction; score: number; key: string }> {
  const observation = simulationObservation(state, state.active);
  return listLegalActions(observation)
    .map((action) => ({
      action,
      score: scoreBotAction(observation, action),
      key: botActionKey(action)
    }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
}

function rolloutAction(state: SimulationState, random: () => number): JaipurAction | null {
  const ranked = rankedActions(state).slice(0, 4);
  if (ranked.length === 0) return null;
  const choice = random();
  const index = choice < 0.68 ? 0 : choice < 0.86 ? 1 : choice < 0.96 ? 2 : 3;
  return ranked[Math.min(index, ranked.length - 1)].action;
}

function rollout(state: SimulationState, seed: string, maxTurns: number): number {
  const random = randomSource(seed);
  for (let turn = 0; turn < maxTurns && !state.terminal; turn += 1) {
    const action = rolloutAction(state, random);
    if (!action || !applyAction(state, action)) break;
  }
  return utility(state);
}

function rootCandidates(observation: BotObservation, limit: number): JaipurAction[] {
  const ranked = listLegalActions(observation)
    .map((action) => ({ action, score: scoreBotAction(observation, action), key: botActionKey(action) }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
  const selected: typeof ranked = [];
  const selectedKeys = new Set<string>();
  const add = (candidate: typeof ranked[number] | undefined) => {
    if (!candidate || selectedKeys.has(candidate.key)) return;
    selected.push(candidate);
    selectedKeys.add(candidate.key);
  };
  for (const type of ['sell', 'take-one', 'take-camels', 'exchange'] as const) {
    add(ranked.find(({ action }) => action.type === type));
  }
  for (const kind of goods) {
    add(ranked.find(({ action }) => action.type === 'sell' && action.kind === kind));
  }
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    add(candidate);
  }
  return selected.slice(0, limit).map(({ action }) => action);
}

function observationSeed(observation: BotObservation): string {
  return JSON.stringify({
    round: observation.roundNumber,
    turn: observation.turnNumber,
    market: observation.market,
    deck: observation.deckCount,
    hand: observation.hand,
    herd: observation.herd,
    opponentHand: observation.opponentHandCount,
    opponentHerd: observation.opponentHerdCount,
    supplies: observation.goodsTokens,
    bonuses: observation.bonusTokenCounts,
    owned: observation.ownedGoodsTokens,
    opponentOwned: observation.opponentGoodsTokens,
    discard: observation.discardCounts,
    seals: observation.seals
  });
}

export function searchMaharajaAction(
  observation: BotObservation,
  options: MaharajaSearchOptions = {}
): MaharajaSearchResult {
  const now = options.now ?? (() => performance.now());
  const maximumSamples = options.samples ?? 24;
  const maximumCandidates = options.candidateLimit ?? 16;
  const rolloutTurns = options.rolloutTurns ?? 70;
  const timeLimit = options.timeLimitMs ?? 1400;
  const candidates = rootCandidates(observation, maximumCandidates);
  if (candidates.length === 0) {
    return { action: null, completedSamples: 0, candidates: 0, simulations: 0 };
  }
  const totals = candidates.map(() => 0);
  const baseSeed = observationSeed(observation);
  const startedAt = now();
  let completedSamples = 0;

  for (let sample = 0; sample < maximumSamples; sample += 1) {
    if (sample > 0 && now() - startedAt >= timeLimit) break;
    const sampleResults: number[] = [];
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const state = sampleState(observation, `${baseSeed}:belief:${sample}`);
      const action = candidates[candidateIndex];
      if (!applyAction(state, action)) {
        sampleResults.push(Number.NEGATIVE_INFINITY);
        continue;
      }
      sampleResults.push(rollout(
        state,
        `${baseSeed}:rollout:${sample}:${botActionKey(action)}`,
        rolloutTurns
      ));
    }
    sampleResults.forEach((result, index) => totals[index] += result);
    completedSamples += 1;
  }

  const ranked = candidates.map((action, index) => ({
    action,
    mean: totals[index] / Math.max(1, completedSamples),
    heuristic: scoreBotAction(observation, action),
    key: botActionKey(action)
  })).sort((left, right) =>
    right.mean - left.mean ||
    right.heuristic - left.heuristic ||
    left.key.localeCompare(right.key)
  );
  return {
    action: ranked[0]?.action ?? null,
    completedSamples,
    candidates: candidates.length,
    simulations: completedSamples * candidates.length
  };
}

export function chooseMaharajaAction(
  observation: BotObservation,
  options?: MaharajaSearchOptions
): JaipurAction | null {
  return searchMaharajaAction(observation, options).action;
}
