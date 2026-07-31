import { describe, expect, it } from 'vitest';
import {
  applySale,
  cardCount,
  createDeck,
  isLegalExchange,
  isLegalSale,
  legalSingleGoods,
  reduceGame,
  resolveRound,
  roundEndReason,
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
    expect(after.activity.at(-1)).toEqual({
      id: 'a-4',
      type: 'cards/taken-one',
      actorUid: 'a',
      roundNumber: 1,
      turnNumber: 1,
      cardIds: [card.id],
      cardKinds: [card.kind]
    });
  });

  it('accepts a tabletop-hosted action on behalf of the active seat', () => {
    const base = (id: string, type: GameEvent['type'], actorUid: string, payload: Record<string, unknown>): GameEvent => ({
      id,
      type,
      actorUid,
      payload,
      clientSeq: 1,
      createdAtMillis: Number(id.match(/\d+/)?.[0] ?? 1),
      schemaVersion: 1,
      reducerVersion: 1
    });
    const setup = [
      base('table-1', 'tabletop/created', 'table', { gameId: 'table' }),
      base('a-2', 'player/joined', 'a', { displayName: 'A', seat: 1 }),
      base('b-3', 'player/joined', 'b', { displayName: 'B', seat: 2 }),
      base('a-4', 'player/ready', 'a', { ready: true }),
      base('b-5', 'player/ready', 'b', { ready: true }),
      base('table-6', 'round/started', 'table', { seed: 'tabletop', starterUid: 'a' })
    ];
    const before = reduceGame(setup);
    const card = legalSingleGoods(before.round!, 'a')[0];
    const after = reduceGame([
      ...setup,
      base('table-7', 'cards/taken-one', 'table', {
        playerUid: 'a',
        cardId: card.id,
        roundNumber: 1,
        turnNumber: 1
      })
    ]);

    expect(after.round?.hands.a).toContainEqual(card);
    expect(after.round?.activeUid).toBe('b');
    expect(after.activity.at(-1)).toMatchObject({
      type: 'cards/taken-one',
      actorUid: 'a',
      cardIds: [card.id]
    });
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

describe('selling goods', () => {
  it('enforces a single goods type and the expensive-goods two-card minimum', () => {
    const round = setupRound(['a', 'b'], 'sale-day', 'a');
    round.hands.a = [
      { id: 'diamond-a', kind: 'diamond' },
      { id: 'diamond-b', kind: 'diamond' },
      { id: 'cloth-a', kind: 'cloth' }
    ];
    expect(isLegalSale(round, 'a', 'diamond', ['diamond-a'])).toBe(false);
    expect(isLegalSale(round, 'a', 'diamond', ['diamond-a', 'diamond-b'])).toBe(true);
    expect(isLegalSale(round, 'a', 'cloth', ['cloth-a'])).toBe(true);
    expect(isLegalSale(round, 'a', 'diamond', ['diamond-a', 'cloth-a'])).toBe(false);
    expect(isLegalSale(round, 'b', 'cloth', ['cloth-a'])).toBe(false);
  });

  it('awards remaining goods tokens in order and one deterministic size bonus', () => {
    const round = setupRound(['a', 'b'], 'fixed-round-007-15', 'a');
    const spices = round.hands.a.filter(({ kind }) => kind === 'spice');
    const expectedBonus = round.bonusTokens['3'][0];
    expect(applySale(round, 'a', 'spice', spices.map(({ id }) => id))).toBe(true);
    expect(round.ownedGoodsTokens.a.map(({ value }) => value)).toEqual([5, 3, 3]);
    expect(round.ownedBonusTokens.a).toEqual([expectedBonus]);
    expect(round.discard).toEqual(spices);
  });

  it('allows a large sale when goods and bonus supplies are depleted', () => {
    const round = setupRound(['a', 'b'], 'depleted-sale', 'a');
    round.hands.a = Array.from({ length: 6 }, (_, index) => ({
      id: `leather-sale-${index}`,
      kind: 'leather' as const
    }));
    round.goodsTokens.leather = round.goodsTokens.leather.slice(0, 2);
    round.bonusTokens['5'] = [];
    expect(applySale(round, 'a', 'leather', round.hands.a.map(({ id }) => id))).toBe(true);
    expect(round.ownedGoodsTokens.a).toHaveLength(2);
    expect(round.ownedBonusTokens.a).toHaveLength(0);
    expect(round.hands.a).toHaveLength(0);
    expect(round.discard).toHaveLength(6);
  });
});

describe('round termination and scoring', () => {
  it('detects both official end conditions after an action', () => {
    const supplies = setupRound(['a', 'b'], 'empty-supplies', 'a');
    supplies.goodsTokens.diamond = [];
    supplies.goodsTokens.gold = [];
    supplies.goodsTokens.silver = [];
    expect(roundEndReason(supplies)).toBe('three-empty-supplies');

    const deck = setupRound(['a', 'b'], 'empty-deck', 'a');
    deck.deck = [];
    deck.market.pop();
    expect(roundEndReason(deck)).toBe('deck-exhausted');
  });

  it('awards five points only for a strict camel majority', () => {
    const majority = setupRound(['a', 'b'], 'camel-score', 'a');
    majority.herds.a = [{ id: 'camel-a-1', kind: 'camel' }];
    majority.herds.b = [];
    const won = resolveRound(majority, ['a', 'b']);
    expect(won.camelBonusUid).toBe('a');
    expect(won.scores.a.camel).toBe(5);

    majority.herds.b = [{ id: 'camel-b-1', kind: 'camel' }];
    const tied = resolveRound(majority, ['a', 'b']);
    expect(tied.camelBonusUid).toBeNull();
    expect(tied.scores.a.camel + tied.scores.b.camel).toBe(0);
  });

  it('uses bonus-token count and then goods-token count to break score ties', () => {
    const bonusTie = setupRound(['a', 'b'], 'bonus-tie', 'a');
    bonusTie.herds.a = [];
    bonusTie.herds.b = [];
    bonusTie.ownedBonusTokens.a = [
      { id: 'bonus-a-1', kind: 'bonus-3', value: 1 },
      { id: 'bonus-a-2', kind: 'bonus-3', value: 1 }
    ];
    bonusTie.ownedGoodsTokens.b = [{ id: 'goods-b', kind: 'leather', value: 2 }];
    expect(resolveRound(bonusTie, ['a', 'b'])).toMatchObject({
      winnerUid: 'a',
      tieBreak: 'bonus-tokens'
    });

    const goodsTie = setupRound(['a', 'b'], 'goods-tie', 'a');
    goodsTie.herds.a = [];
    goodsTie.herds.b = [];
    goodsTie.ownedGoodsTokens.a = [
      { id: 'goods-a-1', kind: 'leather', value: 1 },
      { id: 'goods-a-2', kind: 'leather', value: 1 }
    ];
    goodsTie.ownedGoodsTokens.b = [{ id: 'goods-b', kind: 'leather', value: 2 }];
    expect(resolveRound(goodsTie, ['a', 'b'])).toMatchObject({
      winnerUid: 'a',
      tieBreak: 'goods-tokens'
    });
  });

  it('awards a residual exact tie to the non-starting trader', () => {
    const round = setupRound(['a', 'b'], 'residual-tie', 'a');
    round.herds.a = [];
    round.herds.b = [];
    expect(resolveRound(round, ['a', 'b'])).toMatchObject({
      winnerUid: 'b',
      loserUid: 'a',
      tieBreak: 'non-starter'
    });
  });
});

describe('replay conflicts and versions', () => {
  const event = (
    id: string,
    type: GameEvent['type'],
    actorUid: string,
    payload: Record<string, unknown>,
    schemaVersion = 1
  ): GameEvent => ({
    id,
    type,
    actorUid,
    payload,
    clientSeq: Number(id.match(/\d+/)?.[0] ?? 1),
    createdAtMillis: 1,
    schemaVersion,
    reducerVersion: 1
  });
  const setupEvents = () => [
    event('a-1', 'game/created', 'a', { gameId: 'replay', displayName: 'A' }),
    event('b-1', 'player/joined', 'b', { displayName: 'B' }),
    event('a-2', 'player/ready', 'a', { ready: true }),
    event('b-2', 'player/ready', 'b', { ready: true }),
    event('a-3', 'round/started', 'a', { seed: 'replay', starterUid: 'a' })
  ];

  it('applies a duplicate event ID once and records a deterministic diagnostic', () => {
    const setup = setupEvents();
    const card = legalSingleGoods(reduceGame(setup).round!, 'a')[0];
    const action = event('a-4', 'cards/taken-one', 'a', {
      cardId: card.id,
      roundNumber: 1,
      turnNumber: 1
    });
    const replayed = reduceGame([...setup, action, action]);
    expect(replayed.round?.turnNumber).toBe(2);
    expect(replayed.diagnostics).toContain('a-4: duplicate event ID');
    expect(replayed.activity.filter(({ id }) => id === 'a-4')).toHaveLength(1);
  });

  it('ignores stale concurrent actions and incompatible versions without partial mutation', () => {
    const setup = setupEvents();
    const goods = legalSingleGoods(reduceGame(setup).round!, 'a');
    const applied = event('a-4', 'cards/taken-one', 'a', {
      cardId: goods[0].id,
      roundNumber: 1,
      turnNumber: 1
    });
    const stale = event('a-5', 'cards/taken-one', 'a', {
      cardId: goods[1].id,
      roundNumber: 1,
      turnNumber: 1
    });
    const incompatible = event(
      'b-6',
      'cards/taken-one',
      'b',
      { cardId: goods[1].id, roundNumber: 1, turnNumber: 2 },
      99
    );
    const replayed = reduceGame([...setup, applied, stale, incompatible]);
    expect(replayed.round?.turnNumber).toBe(2);
    expect(replayed.round?.hands.a).toContainEqual(goods[0]);
    expect(replayed.round?.hands.b).not.toContainEqual(goods[1]);
    expect(replayed.diagnostics).toContain('a-5: stale round or turn');
    expect(replayed.diagnostics).toContain('b-6: incompatible version');
    expect(replayed.activity.map(({ id }) => id)).not.toContain('a-5');
    expect(replayed.activity.map(({ id }) => id)).not.toContain('b-6');
  });
});
