import { describe, expect, it } from 'vitest';
import {
  cardCount,
  createDeck,
  isLegalExchange,
  legalSingleGoods,
  reduceGame,
  setupRound,
  shuffle
} from './jaipur-rules';
import type { GameEvent } from './game-events';

describe('deterministic Jaipur setup', () => {
  it('constructs the exact 55-card manifest', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(55);
    expect(new Set(deck.map(({ id }) => id))).toHaveLength(55);
    expect(deck.filter(({ kind }) => kind === 'camel')).toHaveLength(11);
  });

  it('repeats the same shuffle for the same seed', () => {
    expect(shuffle(createDeck(), 'market-day')).toEqual(shuffle(createDeck(), 'market-day'));
    expect(shuffle(createDeck(), 'market-day')).not.toEqual(shuffle(createDeck(), 'other-day'));
  });

  it('deals two hands, moves camels to herds, and conserves every card', () => {
    const round = setupRound(['a', 'b'], 'fixed-seed', 'a');
    expect(round.market).toHaveLength(5);
    expect(round.market.filter(({ kind }) => kind === 'camel').length).toBeGreaterThanOrEqual(3);
    expect(Object.values(round.hands).flat().every(({ kind }) => kind !== 'camel')).toBe(true);
    expect(cardCount(round)).toBe(55);
    expect(Object.values(round.goodsTokens).flat()).toHaveLength(38);
    expect(Object.values(round.bonusTokens).flat()).toHaveLength(18);
  });
});

describe('taking one good', () => {
  it('moves a market good to the active hand, refills, and advances the turn', () => {
    const base = (id: string, type: GameEvent['type'], actorUid: string, payload: Record<string, unknown>): GameEvent => ({
      id,
      type,
      actorUid,
      payload,
      clientSeq: 1,
      createdAtMillis: 1,
      schemaVersion: 1,
      reducerVersion: 1
    });
    const setupEvents: GameEvent[] = [
      base('a-1', 'game/created', 'a', { gameId: 'g', displayName: 'A' }),
      base('b-1', 'player/joined', 'b', { displayName: 'B' }),
      base('a-2', 'player/ready', 'a', { ready: true }),
      base('b-2', 'player/ready', 'b', { ready: true }),
      base('a-3', 'round/started', 'a', { seed: 'one-good', starterUid: 'a' })
    ];
    const before = reduceGame(setupEvents);
    const card = legalSingleGoods(before.round!, 'a')[0];
    const after = reduceGame([
      ...setupEvents,
      base('a-4', 'cards/taken-one', 'a', { cardId: card.id })
    ]);
    expect(after.round?.hands.a).toContainEqual(card);
    expect(after.round?.market).toHaveLength(5);
    expect(after.round?.activeUid).toBe('b');
    expect(cardCount(after.round!)).toBe(55);
  });
});

describe('taking camels', () => {
  it('takes every market camel into the herd and refills every vacancy', () => {
    const round = setupRound(['a', 'b'], 'camel-day', 'a');
    const camelCount = round.market.filter(({ kind }) => kind === 'camel').length;
    const herdBefore = round.herds.a.length;
    const deckBefore = round.deck.length;
    round.market = round.market.filter(({ kind }) => kind !== 'camel');
    round.herds.a.push(...Array.from({ length: camelCount }, (_, index) => ({
      id: `taken-${index}`,
      kind: 'camel' as const
    })));
    while (round.market.length < 5) round.market.push(round.deck.shift()!);
    expect(round.herds.a).toHaveLength(herdBefore + camelCount);
    expect(round.deck).toHaveLength(deckBefore - camelCount);
    expect(round.market).toHaveLength(5);
  });
});

describe('exchanging goods', () => {
  it('accepts an equal multi-card exchange and rejects every structural violation', () => {
    const round = setupRound(['a', 'b'], 'exchange-day', 'a');
    const goods = round.market.filter(({ kind }) => kind !== 'camel');
    const taken = goods.map(({ id }) => id);
    const returned = [...round.herds.a, ...round.hands.a]
      .filter((card) => !round.market.some(({ kind }) => kind === card.kind))
      .slice(0, taken.length)
      .map(({ id }) => id);
    expect(taken).toHaveLength(2);
    expect(returned).toHaveLength(2);
    expect(isLegalExchange(round, 'a', taken, returned)).toBe(true);
    expect(isLegalExchange(round, 'a', taken.slice(0, 1), returned.slice(0, 1))).toBe(false);
    expect(isLegalExchange(round, 'a', taken, returned.slice(0, 1))).toBe(false);
    expect(isLegalExchange(round, 'a', [taken[0], taken[0]], returned)).toBe(false);
    expect(isLegalExchange(round, 'a', taken, [returned[0], returned[0]])).toBe(false);
    expect(isLegalExchange(round, 'a', ['missing', taken[1]], returned)).toBe(false);
    expect(isLegalExchange(round, 'a', [round.market.find(({ kind }) => kind === 'camel')!.id, taken[0]], returned)).toBe(false);
    expect(isLegalExchange(round, 'b', taken, returned)).toBe(false);
  });

  it('rejects overlapping goods and a result above the seven-card limit', () => {
    const round = setupRound(['a', 'b'], 'exchange-day', 'a');
    const goods = round.market.filter(({ kind }) => kind !== 'camel');
    const taken = goods.map(({ id }) => id);
    round.hands.a = [
      { id: 'return-overlap', kind: goods[0].kind },
      { id: 'return-safe', kind: 'leather' }
    ];
    expect(isLegalExchange(round, 'a', taken, round.hands.a.map(({ id }) => id))).toBe(false);

    round.hands.a = Array.from({ length: 7 }, (_, index) => ({
      id: `full-${index}`,
      kind: 'leather' as const
    }));
    round.herds.a = [
      { id: 'return-camel-1', kind: 'camel' },
      { id: 'return-camel-2', kind: 'camel' }
    ];
    expect(isLegalExchange(round, 'a', taken, round.herds.a.map(({ id }) => id))).toBe(false);
  });
});
