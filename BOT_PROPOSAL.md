# Strong AI opponent proposal

## Objective

Add an optional computer-controlled second trader that plays a credible,
challenging game of Jaipur without reading information that a human opponent
could not know. The bot should work in the existing static GitHub Pages and
Firebase architecture, produce ordinary append-only game events, remain
responsive on phones, and be testable and replayable.

The recommended engine is an **information-set Monte Carlo tree search**
(IS-MCTS) backed by a strong heuristic policy. Jaipur has a small action space,
but it is not a perfect-information game: the opponent's hand, the deck order,
and unclaimed bonus-token values are hidden. Searching the
complete `RoundState` would make a superficially strong bot that cheats. A
language model is also the wrong core engine: legal moves, simulation, and
evaluation are compact, deterministic domain problems that can run faster and
more reliably in the browser.

## Success criteria

The first production bot should:

- make only legal moves through the same action path as a human player;
- never inspect the committed shuffle seed or hidden portions of `RoundState`;
- beat a random legal-action player at least 90% of matches;
- beat the initial heuristic bot by a statistically significant margin over
  paired seeds;
- make a normal move in under 500 ms on a representative phone, with a hard
  deadline and a legal fallback;
- preserve UI responsiveness by searching in a Web Worker;
- support reproducible tests and saved-game replay;
- expose multiple difficulty levels without making easier bots deliberately
  illegal or nonsensical; and
- complete full bot matches in Playwright against the real reducer and
  Firestore emulator.

Strength against people should be measured after those mechanical targets are
met. The initial subjective target is a bot that punishes obvious mistakes,
plans around the end of the round, and presents a meaningful challenge to an
experienced casual player.

## Architectural boundary: the bot must not cheat

`GameState` is a trusted-client projection and currently contains both hands,
the exact deck, every bonus value, and the round seed. This is useful for replay
and validation but must not be the search engine's input.

Introduce a separate `BotObservation` projection containing only:

- the bot's hand and both exact herd counts;
- the market and deck count;
- every public goods-token supply;
- the bot's collected goods and private bonus values;
- the opponent's hand-card count, collected public goods tokens, bonus-token
  count, and public seals;
- all public actions in order, including cards sold, market cards taken, and
  cards visibly returned during exchanges;
- the round number, turn number, starter, active player, and public end-state
  information; and
- public facts inferred from play, but not facts recovered from the seed or
  the opponent's private arrays.

The opponent's initial herd count is public information even though the cards
themselves are not shown: each player is dealt five cards, and every initial
camel immediately leaves the hand, so it is `5 - initial hand size`. Every
later camel taken from or returned to the public market is also visible. The
observation can therefore track both exact herd counts without reading the
opponent's private state.

The projection should omit the round seed, exact deck, opponent hand, and
opponent bonus values. It should be defined in a module that does not export an
escape hatch back to `GameState`.

Add counterfactual privacy tests: construct two full states with identical bot
observations but different hidden hands, deck orders, and bonus values. The
serialized observation and the bot's seeded decision distribution must be
identical. This is the most important correctness test in the bot project.

## Joining and acting in the existing event stream

The simplest static deployment is a **client-controlled bot seat**. The bot
runs in a Web Worker inside the same browser client the human is already using.
That client keeps its one existing Firebase authentication session and game
repository connection; it does not create a second browser context, Firebase
session, network connection, or server process for the bot. The reducer still
represents the bot as a distinct logical player so turns, scoring, seals, the
game log, and replay retain normal two-player semantics.

Proposed protocol changes:

1. Add a host-only `bot/added` event that fills the open seat with a stable
   synthetic bot UID, display name, difficulty, and bot-engine version.
2. Permit the host to append existing card-action events with a `playerUid`
   identifying that bot seat.
3. Resolve that proxy actor only when the game is in bot mode, the event actor
   is the host, and `playerUid` is the registered bot. This mirrors the bounded
   host proxy already used for tabletop actions.
4. Keep the selected move as an ordinary `cards/taken-one`,
   `cards/taken-camels`, `cards/exchanged`, or `cards/sold` event. Do not append
   derived score or state snapshots.
5. Store the bot-engine version in the game so replay remains understandable
   after the policy changes. Replay only needs the chosen action, not a repeat
   of the search.

If the host closes the page, the game pauses on the bot's turn and resumes when
the host reconnects. A continuously available bot would require a Cloud
Function or game server and should be a later deployment option, not a
prerequisite for the first version.

The UI should offer “Play vs computer” as a distinct room-creation path, show
the selected difficulty, use the normal opponent hand/herd presentation, and
briefly display that the bot is thinking. A turn-specific cancellation token
must stop obsolete searches after reconnects, conflicts, rematches, or any new
event.

## One legal-action model

Search quality and reducer correctness will drift if the bot reimplements the
rules. Extract a pure action layer from `jaipur-rules.ts`:

```ts
type JaipurAction =
  | { type: 'take-one'; cardId: string }
  | { type: 'take-camels' }
  | { type: 'exchange'; takenIds: string[]; returnedIds: string[] }
  | { type: 'sell'; kind: Good; cardIds: string[] };

function listLegalActions(round: RoundState, uid: string): JaipurAction[];
function applyAction(round: RoundState, uid: string, action: JaipurAction): ActionResult;
```

The production reducer remains the authority and translates event payloads to
this action type. The UI and bot both consume `listLegalActions`. Search uses a
compact cloned simulation state and `applyAction`, rather than constructing and
replaying an ever-growing event array at every node.

Canonicalize strategically equivalent moves to keep the tree small:

- taking one good is one move per market position;
- taking camels is one move regardless of camel count;
- selling identical cards is one move per legal quantity, using stable card
  IDs to encode the selected instances; and
- exchanges enumerate each distinct taken subset and each legal composition
  returned from hand and herd, while removing permutations and equivalent
  choices among identical cards.

Property tests should prove that every generated move is accepted by the
reducer, no rejected move is emitted, and applying any generated move preserves
all card and token conservation invariants.

## Belief state and determinization

At each decision, build a distribution over complete rounds consistent with
`BotObservation`:

1. Start from the exact component manifest.
2. Remove every card whose location the bot publicly knows, including the
   market, its own hand and herd, sold cards, publicly returned cards, and the
   known number of camel cards in the opponent's herd.
3. Track constraints implied by action history. For example, an opponent who
   sold four cloth cards had those cards immediately before the sale; market
   takes and exchanges reveal specific acquisitions and returns.
4. Allocate the remaining unknown goods cards between the opponent hand and
   deck according to their known counts and constraints.
5. Randomize the remaining deck order.
6. Randomize unobserved bonus values within the remaining token multisets.

The observation derives the opponent's initial camel count from the five-card
deal and initial hand size, then updates it from public camel takes and exchange
returns. The determinization must use that derived count rather than reading
`round.herds[opponent]`; stable camel instance IDs are interchangeable for
search once their public count and location are fixed.

Every simulation receives one sampled determinization. Hidden information
should be re-sampled across simulations, not fixed once per move. Search
statistics are keyed by the bot's information set, not by the sampled private
state, so the bot cannot condition future choices on information it does not
possess.

## Search algorithm

Use IS-MCTS with the following turn loop:

1. Generate a determinization consistent with the current observation.
2. Select tree edges with UCT, using heuristic action priors to concentrate
   early work on plausible moves.
3. Expand one unvisited legal action.
4. Simulate to the end of the round with fast heuristic policies for both
   players.
5. Back-propagate the result to information-set nodes.
6. Continue until the simulation or wall-clock budget is reached.
7. Select the most-visited root move, with deterministic tie-breaking.

Terminal utility should optimize **match win probability**, not merely points
earned on the current turn. A round win is substantially more valuable than a
larger margin, and the second seal ends the match. Simulations that continue
between rounds should include the rule that the previous loser starts.

For the first strong version, a practical schedule is:

| Difficulty | Decision policy | Target budget |
| --- | --- | ---: |
| Apprentice | Heuristic policy with mild near-best randomization | under 50 ms |
| Trader | Shallow IS-MCTS | 100–200 ms |
| Maharaja | Full IS-MCTS | 350–500 ms |

The worker should accept both a simulation cap and a deadline. Tests use the
simulation cap for deterministic results; production uses the deadline as a
safety net. If search fails or is cancelled, choose the top legal heuristic
move so the game cannot stall.

## Heuristic policy and evaluation

A useful heuristic is required both as the first playable bot and as the MCTS
rollout policy. It should score complete actions, not individual cards. Initial
features should include:

- rupees gained immediately, including the expected value of a hidden bonus;
- depletion of high-value goods tokens and the value denied to the opponent;
- progress toward three-, four-, and five-card sale bonuses;
- the diminishing value of waiting when a token stack is nearly empty;
- hand-space pressure and the number of stranded expensive singletons;
- herd flexibility for future exchanges and probability of the camel token;
- market quality left to the opponent after a take or exchange;
- the risk of taking camels and revealing several attractive cards at once;
- estimated opponent demand based only on publicly observed acquisitions and
  sales;
- deck exhaustion and the number of empty token piles;
- whether the bot is ahead and should accelerate the end, or behind and should
  preserve turns; and
- seal count, starter implications, and tie-break token counts.

Some Jaipur-specific policy rules make a strong baseline before search exists:

- usually cash expensive pairs before their top tokens disappear;
- do not hoard common goods for a large bonus when the opponent can empty the
  supply first;
- value camels as exchange liquidity, but discount large herds after a likely
  camel-majority lead is secure;
- avoid giving the opponent a premium market unless the move's immediate or
  strategic return compensates for it; and
- explicitly evaluate ending the round after every candidate action.

Start with readable hand-tuned weights. Once the tournament harness exists,
tune them by self-play using paired seeds and a derivative-free optimizer.
Keep a held-out seed set so tuning does not optimize for the development deck
orders.

## Performance and reproducibility

Run search in `src/lib/bot/bot-worker.ts`. Transfer a compact structured clone
of `BotObservation`; do not repeatedly clone Svelte state or Firebase events.
Measure simulations per second on desktop and a throttled mobile profile.

For debugging, seed the worker PRNG from a hash of the public event prefix,
bot-engine version, difficulty, and bot UID. That makes a decision reproducible
without exposing or consuming the round shuffle seed. Production may choose
among statistically equivalent top actions, but the chosen move itself remains
the only canonical event.

No network inference service should be required. This keeps play available on
the static deployment, avoids per-move cost and latency, and prevents game data
from leaving the browser.

## Testing and strength evaluation

### Rule and privacy tests

- Exhaustively enumerate actions in small constructed states.
- Verify generated-action legality against the production reducer.
- Verify card/token conservation after every simulated move.
- Verify terminal scoring, camel majority, both documented tie-breaks, and the
  residual non-starter rule.
- Verify that hidden-state counterfactuals produce identical observations and
  seeded decision distributions.
- Verify the worker deadline, cancellation, and fallback paths.

### Tournament harness

Add a headless simulator that does not involve Svelte or Firebase. Run paired
matches for every seed, swapping seats and starting players, and report:

- match and round win rates with confidence intervals;
- average score and seal differential;
- illegal move, timeout, and fallback counts;
- median and p95 decision time and simulations per second; and
- results by ending condition and difficulty.

Permanent opponents should include random legal play, the frozen heuristic
baseline, the previous released strong bot, and ablated versions of the current
search. A candidate “Maharaja” bot should not replace the previous version
unless it wins a statistically convincing majority on held-out paired seeds.

### Browser proof

Add a Playwright scenario that creates a bot game through the real UI, observes
the bot join, completes representative human and bot turns, reloads during the
bot's turn, and finishes a round. Assert that both the visible activity log and
the append-only replay attribute the exact legal bot actions. Include phone and
desktop screenshots and the normal accessibility and no-scroll checks.

## Delivery sequence

Each phase should be reviewable and playable, following the repository's
existing vertical-slice contract.

1. **Pure action engine.** Add `JaipurAction`, exhaustive legal-action
   generation, fast simulation application, and equivalence tests against the
   reducer. No bot UI yet.
2. **Bot observation and privacy.** Add the restricted projection, public
   history tracker, hidden-state counterfactual tests, and determinization
   sampler.
3. **Playable heuristic bot.** Add `bot/added`, client-controlled proxy actions,
   the Web Worker boundary, Apprentice difficulty, UI, and an end-to-end bot
   round.
4. **Information-set search.** Add IS-MCTS, cancellation/deadline handling,
   Trader and Maharaja budgets, and deterministic search tests.
5. **Tournament and tuning.** Add paired-seed benchmarks, freeze the baseline,
   tune heuristic weights, and publish benchmark results with the bot-engine
   version.
6. **Polish and operations.** Add difficulty selection, thinking/paused states,
   reconnect recovery, action animation parity, accessible log language, and
   performance telemetry confined to local development tests.

## Deferred alternatives

- **Perfect-information minimax:** easier, but invalid because it exploits the
  opponent hand, deck order, and bonus values.
- **Pure rule-based play:** suitable as a fallback and easy difficulty, but too
  brittle to be the strongest opponent.
- **A trained neural policy:** potentially useful later for MCTS priors, but it
  requires a large self-play pipeline, model versioning, and browser inference
  work before it offers an advantage over this game's compact search space.
- **A hosted LLM:** slower, more expensive, less reproducible, and worse at
  exhaustive legality than the local rules engine.
- **A server-resident bot:** useful if games must continue without the host,
  but it expands deployment and security scope and is unnecessary for a first
  strong opponent.

## Recommended first milestone

Implement phases 1 and 2 before adding any visible “Play vs computer” control.
The legal-action engine and non-cheating observation boundary are the durable
parts of the design. Once those are proven, a heuristic bot becomes a small,
honest vertical slice, and stronger search can improve it without changing the
game protocol or UI again.

## Initial implementation in this branch

This branch includes that first playable vertical slice: the host adds a
logical bot seat, projects a deliberately restricted `BotObservation`,
enumerates canonical legal actions, and selects an action with a deterministic
Apprentice heuristic. The chosen action is appended through the human client's
existing repository connection and appears in the ordinary log and replay as
a Maharaja action.

The privacy counterfactual and production-legality tests are included now.
That initial milestone deliberately stopped before simulation, determinization,
search, tournament measurement, and a Web Worker boundary. The bounded
Apprentice heuristic remains synchronous and frozen as the baseline described
there; the stronger follow-up below adds computation without changing it.

## Strong difficulty added in this branch

The branch now also offers **Maharaja** as an alternative to the frozen
Apprentice policy. Maharaja keeps the same restricted `BotObservation` and
never receives the opponent's hand, deck order, or hidden bonus values. For
each decision it reconstructs the remaining component multiset, samples
opponent hands, deck orders, and bonus values consistent with public
information, and evaluates a diverse shortlist of legal moves against paired
determinizations. Each candidate receives the same sampled hidden position and
a full-round heuristic rollout for both traders, so comparisons are less noisy
than independent rollouts.

Search runs in a dedicated Web Worker with a fixed simulation cap and a
wall-clock safety limit. Obsolete searches are terminated when the turn,
connection, round, or replay changes; a deterministic Apprentice choice is the
fallback if the worker fails or exceeds its outer timeout. The selected
difficulty and engine version are persisted in `bot/added`, while only the
ordinary chosen card action enters replay.

The sampler seed is derived from action-relevant observable state rather than
the anonymous Firebase UID, so replaying the same position produces the same
search and move on different clients and test runs.

This is an information-set Monte Carlo rollout policy, not yet the deeper
shared-tree IS-MCTS described above. A deterministic paired-seed regression
tournament currently has Maharaja winning 7 of 8 held-out rounds against the
frozen Apprentice at the reduced CI search budget. A shared information-set
tree and broader tournament tuning remain the next avenues for increasing
strength without expanding the bot's information privileges.
