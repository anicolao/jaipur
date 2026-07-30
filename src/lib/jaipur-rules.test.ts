import { describe, expect, it } from 'vitest';
import { cardCount, createDeck, setupRound, shuffle } from './jaipur-rules';

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
