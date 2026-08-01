import type { Card, RoundState } from './jaipur-rules';

export interface PendingDraw {
  kind: 'one' | 'camels';
  cardIds: string[];
  activeUid: string;
  roundNumber: number;
  turnNumber: number;
  marketCardIds: string[];
}

export function beginPendingDraw(round: RoundState, card: Card): PendingDraw | null {
  if (round.status !== 'active' || !round.market.some(({ id }) => id === card.id)) return null;
  if (card.kind !== 'camel' && (round.hands[round.activeUid]?.length ?? 0) >= 7) return null;
  const cardIds = card.kind === 'camel'
    ? round.market.filter(({ kind }) => kind === 'camel').map(({ id }) => id)
    : [card.id];
  if (cardIds.length === 0) return null;
  return {
    kind: card.kind === 'camel' ? 'camels' : 'one',
    cardIds,
    activeUid: round.activeUid,
    roundNumber: round.number,
    turnNumber: round.turnNumber,
    marketCardIds: round.market.map(({ id }) => id)
  };
}

export function pendingDrawIsCurrent(pending: PendingDraw, round: RoundState | null): boolean {
  return Boolean(
    round &&
    round.status === 'active' &&
    round.activeUid === pending.activeUid &&
    round.number === pending.roundNumber &&
    round.turnNumber === pending.turnNumber &&
    round.market.length === pending.marketCardIds.length &&
    round.market.every(({ id }, index) => id === pending.marketCardIds[index])
  );
}
