/// <reference lib="webworker" />

import type { BotObservation, JaipurAction } from './jaipur-bot';
import { searchMaharajaAction } from './jaipur-bot-search';

export interface StrongBotRequest {
  key: string;
  observation: BotObservation;
}

export interface StrongBotResponse {
  key: string;
  action: JaipurAction | null;
  simulations: number;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<StrongBotRequest>) => {
  const result = searchMaharajaAction(event.data.observation, {
    samples: 32,
    candidateLimit: 16,
    rolloutTurns: 70,
    timeLimitMs: Number.POSITIVE_INFINITY
  });
  worker.postMessage({
    key: event.data.key,
    action: result.action,
    simulations: result.simulations
  } satisfies StrongBotResponse);
};

export {};
