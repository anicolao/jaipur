import { describe, expect, it } from 'vitest';
import type { GameEvent } from './game-events';
import {
  botActionEvent,
  chooseBotAction,
  createBotObservation
} from './jaipur-bot';
import { chooseMaharajaAction } from './jaipur-bot-search';
import { reduceGame } from './jaipur-rules';

const humanUid = 'tournament-human';
const computerUid = 'tournament-computer';

function tournamentEvent(
  sequence: number,
  type: GameEvent['type'],
  actorUid: string,
  payload: Record<string, unknown>
): GameEvent {
  return {
    id: `tournament-${String(sequence).padStart(4, '0')}`,
    type,
    actorUid,
    payload,
    clientSeq: sequence,
    createdAtMillis: sequence,
    schemaVersion: 1,
    reducerVersion: 1
  };
}

function playPairedRound(seed: string, maharajaUid: string, starterUid: string): string {
  const events: GameEvent[] = [
    tournamentEvent(1, 'game/created', humanUid, {
      gameId: 'bot-tournament',
      displayName: 'Asha'
    }),
    tournamentEvent(2, 'bot/added', humanUid, {
      botUid: computerUid,
      displayName: 'Maharaja',
      difficulty: 'apprentice',
      engineVersion: 1
    }),
    tournamentEvent(3, 'player/ready', humanUid, { ready: true }),
    tournamentEvent(4, 'round/started', humanUid, {
      seed,
      starterUid,
      roundNumber: 1
    })
  ];
  let state = reduceGame(events);

  for (let turn = 0; turn < 160 && state.round?.status === 'active'; turn += 1) {
    const activeUid = state.round.activeUid;
    const observation = createBotObservation(state, activeUid)!;
    const action = activeUid === maharajaUid
      ? chooseMaharajaAction(observation, {
          samples: 8,
          candidateLimit: 14,
          rolloutTurns: 60,
          timeLimitMs: Number.POSITIVE_INFINITY,
          now: () => 0
        })
      : chooseBotAction(observation);
    if (!action) throw new Error(`No legal action on turn ${turn + 1}`);
    const mapped = botActionEvent(observation, action);
    events.push(tournamentEvent(events.length + 1, mapped.type, activeUid, mapped.payload));
    state = reduceGame(events);
  }

  if (state.round?.status !== 'complete' || !state.round.winnerUid) {
    throw new Error('Tournament round did not finish');
  }
  return state.round.winnerUid;
}

describe('Maharaja strength baseline', () => {
  it('wins a majority of paired held-out rounds against the frozen Apprentice', () => {
    const seeds = Array.from({ length: 4 }, (_, index) => `maharaja-held-out-${index + 1}`);
    let wins = 0;
    let games = 0;
    for (const seed of seeds) {
      for (const maharajaUid of [humanUid, computerUid]) {
        const starterUid = games % 2 === 0 ? humanUid : computerUid;
        const won = playPairedRound(seed, maharajaUid, starterUid) === maharajaUid;
        if (won) wins += 1;
        games += 1;
      }
    }

    expect({ wins, games }).toEqual({ wins: 7, games: 8 });
    expect(wins).toBeGreaterThan(games / 2);
  }, 45_000);
});
