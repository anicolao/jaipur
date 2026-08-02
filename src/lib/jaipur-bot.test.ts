import { describe, expect, it } from 'vitest';
import type { GameEvent } from './game-events';
import {
  botActionEvent,
  chooseBotAction,
  createBotObservation,
  listLegalActions,
  type JaipurAction
} from './jaipur-bot';
import {
  isLegalExchange,
  isLegalSale,
  legalSingleGoods,
  reduceGame,
  type GameState
} from './jaipur-rules';

function event(
  id: string,
  type: GameEvent['type'],
  actorUid: string,
  payload: Record<string, unknown>
): GameEvent {
  return {
    id,
    type,
    actorUid,
    payload,
    clientSeq: Number(id.match(/\d+/)?.[0] ?? 1),
    createdAtMillis: 1,
    schemaVersion: 1,
    reducerVersion: 1
  };
}

function botGame(seed = 'bot-observation'): GameState {
  return reduceGame([
    event('a-1', 'game/created', 'human', { gameId: 'bot-room', displayName: 'Asha' }),
    event('a-2', 'bot/added', 'human', {
      botUid: 'bot-human',
      displayName: 'Maharaja',
      difficulty: 'apprentice',
      engineVersion: 1
    }),
    event('a-3', 'player/ready', 'human', { ready: true }),
    event('a-4', 'round/started', 'human', {
      seed,
      starterUid: 'bot-human',
      roundNumber: 1
    })
  ]);
}

function expectLegal(state: GameState, action: JaipurAction) {
  const round = state.round!;
  switch (action.type) {
    case 'take-one':
      expect(legalSingleGoods(round, 'bot-human').map(({ id }) => id)).toContain(action.cardId);
      break;
    case 'take-camels':
      expect(round.market.some(({ kind }) => kind === 'camel')).toBe(true);
      break;
    case 'exchange':
      expect(isLegalExchange(round, 'bot-human', action.takenIds, action.returnedIds)).toBe(true);
      break;
    case 'sell':
      expect(isLegalSale(round, 'bot-human', action.kind, action.cardIds)).toBe(true);
      break;
  }
}

describe('client-controlled Jaipur bot', () => {
  it('projects only information the bot player is entitled to observe', () => {
    const original = botGame();
    const counterfactual = structuredClone(original);
    const originalRound = counterfactual.round!;
    [originalRound.hands.human[0], originalRound.deck[0]] = [
      originalRound.deck[0],
      originalRound.hands.human[0]
    ];
    originalRound.ownedBonusTokens.human = [
      { id: 'hidden-bonus', kind: 'bonus-3', value: 1 }
    ];

    const comparison = structuredClone(original);
    comparison.round!.ownedBonusTokens.human = [
      { id: 'different-hidden-bonus', kind: 'bonus-3', value: 3 }
    ];

    const first = createBotObservation(counterfactual)!;
    const second = createBotObservation(comparison)!;

    expect(first).toEqual(second);
    expect(first).not.toHaveProperty('seed');
    expect(first).not.toHaveProperty('deck');
    expect(first).not.toHaveProperty('opponentHand');
    expect(first).not.toHaveProperty('opponentBonusTokens');
    expect(chooseBotAction(first)).toEqual(chooseBotAction(second));
  });

  it('generates only actions accepted by the production legality checks', () => {
    const state = botGame('bot-legality');
    const observation = createBotObservation(state)!;
    const actions = listLegalActions(observation);

    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions.map((action) => JSON.stringify(action))).size).toBe(actions.length);
    for (const action of actions) expectLegal(state, action);
  });

  it('chooses deterministically and maps the move to an ordinary game event', () => {
    const state = botGame('bot-choice');
    const observation = createBotObservation(state)!;
    const action = chooseBotAction(observation)!;

    expectLegal(state, action);
    expect(chooseBotAction(structuredClone(observation))).toEqual(action);
    expect(botActionEvent(observation, action).payload).toMatchObject({
      playerUid: 'bot-human',
      roundNumber: 1,
      turnNumber: 1
    });
    expect(botActionEvent(observation, action).type).toMatch(/^cards\//);
  });
});
