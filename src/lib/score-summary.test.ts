import { describe, expect, it } from 'vitest';
import type { ScoreBreakdown } from './jaipur-rules';
import { describeTieBreak } from './score-summary';

const players = [
  { uid: 'alex', displayName: 'Alex' },
  { uid: 'fjh', displayName: 'FJH' }
];

const score = (
  total: number,
  bonusTokenCount: number,
  goodsTokenCount: number
): ScoreBreakdown => ({
  goods: total,
  bonus: 0,
  camel: 0,
  total,
  bonusTokenCount,
  goodsTokenCount
});

describe('tie-break summary', () => {
  it('explains the bonus-token tie-break from game BPDTV', () => {
    expect(describeTieBreak({
      winnerUid: 'fjh',
      tieBreak: 'bonus-tokens',
      scores: { alex: score(71, 1, 16), fjh: score(71, 4, 19) }
    }, players)).toEqual({
      kind: 'bonus-tokens',
      text: "Tied at 71. FJH won the tie-break with 4 bonus tokens to Alex's 1."
    });
  });

  it('explains the goods-token and non-starter fallbacks', () => {
    expect(describeTieBreak({
      winnerUid: 'fjh',
      tieBreak: 'goods-tokens',
      scores: { alex: score(60, 2, 15), fjh: score(60, 2, 18) }
    }, players)?.text).toContain("18 goods tokens to Alex's 15");
    expect(describeTieBreak({
      winnerUid: 'fjh',
      tieBreak: 'non-starter',
      scores: { alex: score(60, 2, 18), fjh: score(60, 2, 18) }
    }, players)?.text).toContain('won as the non-starting trader');
  });

  it('omits a tie-break when the score itself decides the round', () => {
    expect(describeTieBreak({
      winnerUid: 'fjh',
      tieBreak: 'score',
      scores: { alex: score(60, 2, 18), fjh: score(61, 2, 18) }
    }, players)).toBeNull();
  });
});
