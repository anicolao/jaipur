import { describe, expect, it } from 'vitest';
import { beginPendingDraw, pendingDrawIsCurrent } from './pending-draw';
import { setupRound } from './jaipur-rules';

describe('pending draw preview', () => {
  it('previews one good without mutating the round', () => {
    const round = setupRound(['a', 'b'], 'pending-good', 'a');
    const before = structuredClone(round);
    const good = round.market.find(({ kind }) => kind !== 'camel')!;
    const pending = beginPendingDraw(round, good);

    expect(pending).toMatchObject({ kind: 'one', cardIds: [good.id], activeUid: 'a' });
    expect(round).toEqual(before);
    expect(pendingDrawIsCurrent(pending!, round)).toBe(true);
  });

  it('previews every camel and becomes stale when the turn or market changes', () => {
    const round = setupRound(['a', 'b'], 'pending-camels', 'a');
    const camel = round.market.find(({ kind }) => kind === 'camel')!;
    const pending = beginPendingDraw(round, camel)!;

    expect(pending.kind).toBe('camels');
    expect(pending.cardIds).toEqual(
      round.market.filter(({ kind }) => kind === 'camel').map(({ id }) => id)
    );

    const changedTurn = structuredClone(round);
    changedTurn.turnNumber += 1;
    expect(pendingDrawIsCurrent(pending, changedTurn)).toBe(false);

    const changedMarket = structuredClone(round);
    changedMarket.market.reverse();
    expect(pendingDrawIsCurrent(pending, changedMarket)).toBe(false);
  });
});
