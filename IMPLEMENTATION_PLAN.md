# Jaipur implementation plan

## Objective

Build the complete browser game as a sequence of independently playable
vertical slices. The sibling `rebelprincess` project is the implementation
model: each gameplay commit begins at a real browser interaction, crosses the
real client, deterministic reducer, Firebase emulator, and rendering layers,
and ends in a user-visible result verified by Playwright.

This initial milestone is intentionally documentation-only. No technical
scaffolding should be added until the first tracer bullet can establish the
whole development and deployment contract coherently.

## Non-negotiable commit contract

Every implementation commit must contain all of the following in one reviewable
unit:

1. the smallest coherent user-facing capability;
2. any event schema and deterministic reducer changes it requires;
3. append-only stream and replay tests;
4. accessible UI for every affected state and viewport;
5. a tracer-bullet E2E step or scenario using the real UI and emulators;
6. zero-pixel screenshot baselines and a generated scenario walkthrough;
7. unit tests for pure-rule and reducer edge cases that E2E cannot cover
   exhaustively; and
8. documentation updates for changed protocol, rules, or invariants.

Do not land an unused rules layer, UI against mock state, or multiplayer logic
without its browser proof. A refactor must preserve the full E2E suite. If it
changes observable behavior, it needs a semantic assertion and reviewed
screenshot change.

The first implementation slice must add a repository-managed verifier and
Husky hook. From that point, every commit and push must run the equivalent of:

```sh
nix develop --command bun run check
nix develop --command bun run test:unit
nix develop --command bun run test:rules
nix develop --command bun run test:e2e -- <changed-scenario>
nix develop --command bun run test:e2e
nix develop --command bun run build
git diff --check
```

Do not bypass the verifier with `--no-verify`.

## Fixed technical decisions

- SvelteKit with `@sveltejs/adapter-static`, TypeScript, and Bun.
- Firebase anonymous Authentication and Cloud Firestore browser SDK.
- Canonical state is one append-only stream at
  `games/{gameId}/events/{eventId}`.
- Both authenticated players may read the complete stream. Trustworthy clients
  enforce legal interaction and selectively display private information.
- Firebase rules enforce authentication, own-UID attribution, immutable creates,
  and denial of all other paths. They do not validate action payloads or game
  legality.
- Every event contains `type`, `payload`, `actorUid`, `clientSeq`, `createdAt`,
  `schemaVersion`, and `reducerVersion`.
- Event ordering uses server timestamp with document ID as a deterministic
  tie-break.
- Event IDs use `{actorUid}-{zero-padded clientSeq}` so local retries are
  idempotent.
- Shuffle, initial player selection, and the three bonus-token supplies use a
  committed seed and versioned PRNG.
- Persisted data uses stable card, token, goods, and player IDs—never localized
  display text.
- Game state is a deterministic projection. Invalid, duplicate, stale, or
  incompatible events produce deterministic diagnostics and never partially
  mutate state.
- Original art and accessible HTML labels are separate. Generated or commissioned
  art may illustrate cards and tokens, but semantics never depend on pixels.

## Proposed event and state model

The only canonical Firestore path is:

```text
games/{gameId}/events/{eventId}
```

Lobby, membership, rounds, scores, and the result are projections of this
stream. No mutable game document is required.

The initial stable event vocabulary should be deliberately small:

| Event | Purpose |
| --- | --- |
| `game/created` | Establish room, host, protocol versions, and game ID |
| `player/joined` | Add the second named player |
| `player/ready` | Confirm a seat is ready to start |
| `round/started` | Commit round number, shuffle seed, and first-player input |
| `cards/taken-one` | Take one identified good from the market |
| `cards/taken-camels` | Take every camel currently in the market |
| `cards/exchanged` | Atomically identify all taken and returned card IDs |
| `cards/sold` | Identify the goods type and exact sold card IDs |
| `game/rematched` | Begin a fresh best-of-three epoch with the same members |

Setup, refills, token awards, round termination, camel majority, scoring, seals,
and the terminal winner are derived by replay. Do not append redundant
“resolved” events whose values can disagree with the action that caused them.

`round/started` commits a seed, not an arbitrary deal. The reducer derives:

- the ordered 55-card component deck;
- the three fixed market camels;
- both initial five-card deals;
- initial camels moved from hands to herds;
- the two extra market cards;
- all remaining deck order; and
- the independent 3-, 4-, and 5+-bonus-token orders.

Later-round first player is derived from the previous round loser. The
round-start payload may repeat that UID as an assertion, but replay must reject
a mismatch.

The reducer owns all legality:

- current actor and one-action-per-turn sequencing;
- hand limit;
- single-good, all-camels, and exchange constraints;
- simultaneous exchange conservation;
- one goods type per sale and expensive-goods minimums;
- descending goods-token awards and size-bonus awards;
- partial market refill followed by immediate round end;
- camel-majority scoring and score tie-breaks; and
- first-to-two game termination.

Selectors derive separate full and trustworthy-player views. The full state is
used for validation and tests. A player view includes only that player's hand,
owned bonus values, and exact herd count; opponent selectors expose the public
counts described in `RULES.md`.

## Trust, privacy, and conflict boundaries

- Anonymous Auth provides stable UID attribution, not identity assurance.
- Both clients can technically inspect all hands, seed-derived deck order,
  bonus values, and herd counts.
- The ordinary UI must not expose opponent-private state.
- The stream is immutable, but a malicious client can still append illegal
  actions. The deterministic reducer ignores them and surfaces diagnostics.
- Two valid-looking concurrent actions are ordered canonically. The first event
  valid at its replay position applies; later stale events do not.
- Events may carry `expectedEventId`, `roundNumber`, and `turnNumber` so a
  trustworthy client can explain conflicts promptly.
- A reducer or schema version mismatch is a compatibility error, not proof of
  cheating.

This trust model matches the sibling game and keeps the first implementation
entirely static. Server-authoritative hidden information would require a
different architecture—such as callable functions or a game server—and is out
of scope unless the trust requirement changes.

## E2E policy

Playwright scenarios are the primary proof of every user-visible flow. They run
the real built client against local Firebase Auth and Firestore emulators and
never touch production data.

- Use one isolated browser context per player.
- Assert an action from the actor's view and the opponent's converged view.
- Give every scenario fixed UIDs, names, game ID, seed, locale, timezone,
  viewport, clock, fonts, and rendering flags.
- Use Playwright observable-state auto-waiting; never sleep or poll by elapsed
  time.
- Configure no retries and a global 2-second action/expectation ceiling.
- Every documented step combines semantic assertions, clipping/overlap checks,
  and `toHaveScreenshot` with `maxDiffPixels: 0`.
- Never mask screenshots, loosen tolerances, add explicit timeout overrides,
  manually capture images, or commit skipped/focused tests.
- Block service workers and external network requests in E2E.
- Generate each scenario's `README.md` from the shared step helper; never
  hand-edit walkthroughs.

Each scenario owns:

```text
tests/e2e/
  001-app-shell-and-deployment/
    001-app-shell-and-deployment.spec.ts
    README.md
    screenshots/
```

## E2E scenario map

```text
001-app-shell-and-deployment
002-create-and-join-game
003-round-setup-and-private-hands
004-take-one-good
005-take-all-camels
006-exchange-goods
007-sell-and-earn-tokens
008-round-end-and-scoring
009-complete-best-of-three-game
010-reconnect-replay-and-conflicts
011-responsive-accessible-complete-game
```

Extend a scenario when a slice naturally continues its narrative. Otherwise,
add the next number. Seed important edge cases as unit tests and then prove at
least one representative real-browser path.

## Implementation sequence

Every numbered item should end in at least one commit satisfying the complete
commit contract. Split an item if needed, but never split behavior from its E2E
proof.

### 1. Application shell, verification, CI, and deploy preview

- Scaffold SvelteKit static output, strict TypeScript, Firebase browser
  initialization, CSS reset, local fonts, accessible landing page, and build
  marker.
- Add the Nix flake, Bun package, Firebase emulator files, Vitest, Playwright,
  common `TestStepHelper`, deterministic Chromium configuration, verification
  script, and Husky hooks.
- Add closed-by-default Firestore Rules and an emulator boundary test before
  production access is opened.
- Add `001-app-shell-and-deployment`: prove the app and Firebase emulators are
  visibly ready at phone and desktop sizes.
- Add CI and the retained GitHub Pages preview workflow. The tracer ends at the
  deployed PR URL, not only at `build/`.

### 2. Anonymous identity and append-only room membership

- Sign in anonymously and provide fixed emulator UIDs in E2E mode.
- Implement the event repository, subscription ordering, idempotent append,
  envelope validation, replay cache key, and reducer diagnostics.
- Allow authenticated full-stream reads and own-UID immutable event creation.
  Continue denying update, delete, and all unrelated paths.
- Add room creation, stable invite URLs, exactly two seats, display names,
  readiness, and a clear full-room state.
- Add `002-create-and-join-game`: two contexts create/join, converge on seats,
  reload, and recover from the same immutable stream.

### 3. Deterministic round setup and selective views

- Add the exact component manifest from `RULES.md`, including stable instance
  IDs and complete token values.
- Implement the versioned PRNG, fixed seed contract, setup shuffle, deals,
  market, deck, herds, goods supplies, and independent bonus-supply shuffles.
- Render the five-card market, local hand, both traders, supplies, deck count,
  seal track, and current-turn indicator.
- Verify conservation: every card is in exactly one zone and every token is
  either available or owned.
- Add `003-round-setup-and-private-hands` with an exact fixed deal. Inspect the
  full state while proving that trustworthy player views hide the opponent's
  hand, bonus values, and exact herd count.

### 4. Take one good

- Derive legal single-good targets, enforce the seven-card limit, remove the
  selected market card, draw one replacement, and advance the turn.
- Disable camel selection in this action and explain why an unavailable action
  is illegal.
- Add `004-take-one-good`: both clients observe the exact market refill, hand
  count, private card change, deck count, and turn transition.

### 5. Take all camels

- Treat market camels as one action target, take every one into the herd, and
  refill each vacancy from the deck in order.
- Preserve the hand count and allow an unlimited herd.
- Add `005-take-all-camels`: use multiple market camels, verify every exact
  zone and owner/opponent visibility, and prove partial selection is impossible.

### 6. Exchange goods

- Add multi-select interaction for at least two market goods and an equal
  number of returned hand goods and herd camels.
- Preview resulting hand size and make every illegal state accessible: unequal
  counts, taking camels, a one-for-one exchange, overlapping goods types, or
  exceeding seven hand cards.
- Apply the exchange atomically without drawing from the deck.
- Add `006-exchange-goods`: exercise a mixed goods/camels return, exact
  conservation, observer convergence, and representative disabled choices.
- Unit-test the complete exchange legality matrix.

### 7. Sell goods and award tokens

- Render legal sale groups and an explicit confirmation showing count and
  public goods-token awards.
- Enforce the two-card minimum for diamonds, gold, and silver.
- Award goods tokens in order and draw one deterministic hidden bonus for sales
  of 3, 4, or 5+ cards.
- Show the bonus value only to its owner until round scoring.
- Add `007-sell-and-earn-tokens`: cover an ordinary sale and a large sale from
  both players' views.
- Unit-test depleted goods supplies, depleted bonus supplies, expensive-goods
  minimums, and a sale larger than the remaining token pile.

### 8. Round termination, scoring, and transition

- After every completed action, check both end conditions and allow partial
  refill before deck exhaustion ends the round.
- Award the camel token only for a strict herd majority.
- Reveal all bonus values, show an exact score breakdown, apply official
  tie-breaks, award a seal, reset components, and make the round loser start.
- Resolve and document the residual scoring tie called out in `RULES.md` before
  this slice is coded. Add the decision to reducer fixtures and the visible
  rules reference.
- Add `008-round-end-and-scoring`: drive the final action through score review
  and into the next playable round.
- Unit-test both termination paths, tied herds, both score tie-breaks, and the
  chosen residual-tie policy.

### 9. Complete first-to-two game

- End immediately when a player earns a second seal.
- Render immutable per-round score summaries, final winner, new-game/rematch
  controls, and a clean new replay epoch.
- Add `009-complete-best-of-three-game`: play complete deterministic,
  production-size rounds through ordinary UI actions until a player earns two
  seals, then start a rematch.

### 10. Reconnect, replay, conflicts, and versions

- Rehydrate from cache plus cursor and replay from scratch.
- Handle local retry, duplicate IDs, stale turn submissions, concurrent events,
  network loss, and incompatible schema/reducer versions.
- Show connection, synchronization, conflict, and incompatibility states
  accessibly.
- Add `010-reconnect-replay-and-conflicts`: disconnect one context, advance,
  reconnect, inject duplicate/conflicting actions, and prove convergence.

### 11. Responsive and accessibility completion

- Finish keyboard and touch interaction, focus order, announcements, contrast,
  reduced motion, safe areas, installable metadata, and reconnect affordances.
- Make market selection, exchange composition, sale confirmation, token
  supplies, and private hand useable without color alone.
- Add `011-responsive-accessible-complete-game` across mobile portrait, mobile
  landscape, tablet, and desktop with clipping/overlap checks at every step.
- Audit every earlier zero-pixel baseline; accept changes only after semantic
  review and an ordinary non-update run.

## GitHub Pages preview design

The first slice should add `.github/workflows/ci-and-deploy.yml`, following the
sibling game's retained-preview approach.

1. Check out the exact head SHA.
2. Install Nix and enter the locked shell.
3. Install the frozen Bun dependencies and pinned Playwright Chromium.
4. Run check, unit, Rules, full E2E, and build verification.
5. Build once with `/jaipur/pr<PR number>` for a same-repository PR or
   `/jaipur` for `main`.
6. Publish `build/` to the matching retained directory on `gh-pages`.
7. Create or update one PR comment linking the preview.
8. Use per-ref deployment concurrency with cancellation.

Production Firebase browser configuration should be supplied to the build step
through repository Actions secrets. It is public client configuration, not a
secret authorization mechanism. Never expose deployment credentials to fork or
Dependabot code and never use `pull_request_target` for the build.

The app must apply the computed base path consistently to assets, client
navigation, manifest URLs, and service-worker scope. Main deployment must not
remove retained PR directories.

## Asset plan

Create an original visual system for:

- seven card families, a common back, and distinguishable market/hand states;
- six ordered goods-token families;
- three hidden bonus-token families and revealed values;
- the camel token and three seal states; and
- market, deck, herd, hand, discard, supply, and score areas.

The official materials may guide inventory and information hierarchy, but do
not copy the Jaipur logo, illustrations, ornamental frames, card layouts, or
Vincent Dutrait's artwork. Store semantic names, values, and descriptions as
accessible HTML backed by a manifest; imagery is enhancement.

## Definition of complete

Jaipur is complete when every rule and edge case in `RULES.md` has a
deterministic reducer specification and unit coverage; all eleven tracer
scenarios pass against the real Firebase emulators with zero pixel differences;
two clients converge through reload and conflicts; production Firestore Rules
match their boundary tests; a full first-to-two game is keyboard- and
touch-playable at all target viewports; and the exact commit is playable at
both its retained PR preview and production GitHub Pages URL.
