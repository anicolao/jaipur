# Jaipur

This repository is the documentation-first starting point for a realtime,
browser-based implementation of Jaipur, the two-player trading card game by
Sébastien Pauchon.

No application code exists yet. The intended first implementation follows the
same approach as the sibling `rebelprincess` project: a static SvelteKit client,
anonymous Firebase rooms, an append-only Firestore event stream, deterministic
replay, and browser-level tracer bullets verified with Playwright.

See [RULES.md](RULES.md) for the implementation-oriented rules summary and
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the proposed architecture,
commit contract, and vertical-slice sequence.

## Intended product

- Exactly two players per game.
- Private hands and bonus values in the trustworthy UI.
- A shared five-card market, visible goods supplies, and visible turn history.
- Complete best-of-three play: the first trader to earn two Seals of Excellence
  wins.
- Reconnect and replay from the complete immutable event history.
- Keyboard-, touch-, phone-, tablet-, and desktop-friendly play.

## Planned technical foundation

- SvelteKit, TypeScript, Bun, and `@sveltejs/adapter-static`.
- Firebase anonymous Authentication and Cloud Firestore.
- One append-only event stream at `games/{gameId}/events/{eventId}`.
- Deterministic, versioned shuffle and reducer logic.
- Vitest for pure rules and reducer tests.
- Playwright against Firebase emulators for real two-browser E2E scenarios.
- Zero-pixel screenshot comparisons and generated scenario walkthroughs.
- GitHub Pages production and retained pull-request previews.

The Firestore design is intentionally trusted-client multiplayer. Auth and
Security Rules will provide attribution and immutable history, not server-side
move validation or cheating prevention. All game events—including hands, deck
order, herds, and bonus-token order—will be readable by both authenticated
clients. The normal client will enforce legal actions and reveal only the
information appropriate to its player.

## Development status

The initial milestone is documentation-only. The first implementation slice
will add the application shell, Nix/Bun environment, Firebase emulator setup,
test harness, verification script, and deployment workflow together.

Once that slice exists, the expected local contract will be:

```sh
nix develop --command bun install
nix develop --command bun run verify:change
```

The Firebase project, web app, production configuration, and GitHub repository
settings still need to be created. Never commit service-account credentials,
private keys, Firebase CLI tokens, or production data.

## License

Copyright (C) 2026 Alex Nicolaou. Licensed under the GNU General Public
License, version 3 only. See [LICENSE](LICENSE).

## Rules source and artwork

The rules target the current Space Cowboys edition. The publisher's
[Jaipur page](https://www.spacecowboys-games.com/game/jaipur/) links the
[English rulebook](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/11/Rules-JAIPUR-12x17-Version-EN_BD.pdf).
`RULES.md` is an implementation summary, not a replacement for that rulebook.

Published illustrations, logos, card layouts, and trade dress are reference
material only. Browser assets must be original or appropriately licensed while
preserving the game's necessary information hierarchy and component
distinctions.
