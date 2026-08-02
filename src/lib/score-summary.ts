import type { Player } from './game-events';
import type { RoundState, RoundTieBreak } from './jaipur-rules';

export interface TieBreakSummary {
  kind: Exclude<RoundTieBreak, 'score'>;
  text: string;
}

export function describeTieBreak(
  round: Pick<RoundState, 'scores' | 'tieBreak' | 'winnerUid'>,
  players: Pick<Player, 'uid' | 'displayName'>[]
): TieBreakSummary | null {
  if (!round.scores || !round.winnerUid || !round.tieBreak || round.tieBreak === 'score') {
    return null;
  }
  const winner = players.find(({ uid }) => uid === round.winnerUid);
  const loser = players.find(({ uid }) => uid !== round.winnerUid);
  const winnerScore = winner && round.scores[winner.uid];
  const loserScore = loser && round.scores[loser.uid];
  if (!winner || !loser || !winnerScore || !loserScore) return null;

  if (round.tieBreak === 'bonus-tokens') {
    return {
      kind: round.tieBreak,
      text: `Tied at ${winnerScore.total}. ${winner.displayName} won the tie-break with ${winnerScore.bonusTokenCount} bonus tokens to ${loser.displayName}'s ${loserScore.bonusTokenCount}.`
    };
  }
  if (round.tieBreak === 'goods-tokens') {
    return {
      kind: round.tieBreak,
      text: `Tied at ${winnerScore.total} with ${winnerScore.bonusTokenCount} bonus tokens each. ${winner.displayName} won the next tie-break with ${winnerScore.goodsTokenCount} goods tokens to ${loser.displayName}'s ${loserScore.goodsTokenCount}.`
    };
  }
  return {
    kind: round.tieBreak,
    text: `Tied at ${winnerScore.total}, with ${winnerScore.bonusTokenCount} bonus tokens and ${winnerScore.goodsTokenCount} goods tokens each. ${winner.displayName} won as the non-starting trader.`
  };
}
