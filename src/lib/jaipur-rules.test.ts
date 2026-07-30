import { describe, expect, it } from 'vitest';
import { cardCount, createDeck, legalSingleGoods, reduceGame, setupRound, shuffle } from './jaipur-rules';
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
