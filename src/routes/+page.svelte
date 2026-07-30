<script lang="ts">
  import '@fontsource/atkinson-hyperlegible/400.css';
  import '@fontsource/atkinson-hyperlegible/700.css';
  import '@fontsource/cormorant-garamond/700.css';
  import { replaceState } from '$app/navigation';
  import { onMount } from 'svelte';
  import { initializeFirebase } from '$lib/firebase';
  import { createGameRepository, type GameRepository } from '$lib/game-repository';
  import { isLegalExchange, reduceGame, type GameState } from '$lib/jaipur-rules';

  let status = $state<'connecting' | 'synced' | 'error'>('connecting');
  let statusText = $state('Connecting to Firebase…');
  let uid = $state('');
  let requestedGameId = $state('');
  let displayName = $state('');
  let lobby = $state<GameState>(reduceGame([]));
  let repository = $state<GameRepository>();
  let busy = $state(false);
  let shellOnly = $state(true);
  let exchangeMode = $state(false);
  let selectedMarket = $state<string[]>([]);
  let selectedReturn = $state<string[]>([]);

  onMount(async () => {
    try {
      const params = new URLSearchParams(location.search);
      requestedGameId = params.get('gameId') ?? '';
      shellOnly = !requestedGameId;
      const services = await initializeFirebase();
      uid = services.auth.currentUser?.uid ?? '';
      const savedName = localStorage.getItem(`jaipur:${requestedGameId}:${uid}:name`);
      if (requestedGameId && savedName) {
        displayName = savedName;
        attachRepository(services.db);
      }
      status = 'synced';
      if (!savedName) {
        statusText =
          import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
            ? 'Firebase emulator ready'
            : 'Firebase ready';
      }
    } catch (error) {
      showError(error);
    }
  });

  function showError(error: unknown) {
    status = 'error';
    statusText = error instanceof Error ? error.message : 'Firebase unavailable';
  }

  function attachRepository(db: Awaited<ReturnType<typeof initializeFirebase>>['db']) {
    const attached = createGameRepository(db, requestedGameId.trim(), uid);
    repository = attached;
    attached.subscribe(
      (events) => {
        lobby = reduceGame(events);
        status = 'synced';
        statusText = 'Game synced';
      },
      showError
    );
    return attached;
  }

  async function connect(mode: 'create' | 'join') {
    if (!uid || !requestedGameId.trim() || !displayName.trim()) return;
    busy = true;
    try {
      const services = await initializeFirebase();
      const attached = attachRepository(services.db);
      await attached.append(mode === 'create' ? 'game/created' : 'player/joined', {
        gameId: requestedGameId.trim(),
        displayName: displayName.trim()
      });
      localStorage.setItem(`jaipur:${requestedGameId.trim()}:${uid}:name`, displayName.trim());
      const params = new URLSearchParams(location.search);
      params.set('gameId', requestedGameId.trim());
      replaceState(`?${params.toString()}`, {});
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function toggleReady() {
    const player = lobby.players.find((candidate) => candidate.uid === uid);
    if (!repository || !player) return;
    busy = true;
    try {
      await repository.append('player/ready', { ready: !player.ready });
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function startRound() {
    if (!repository || uid !== lobby.hostUid || lobby.players.length !== 2) return;
    busy = true;
    try {
      await repository.append('round/started', {
        seed: new URLSearchParams(location.search).get('seed') ?? crypto.randomUUID(),
        starterUid: lobby.players[0].uid
      });
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function takeOne(cardId: string) {
    if (!repository || lobby.round?.activeUid !== uid) return;
    busy = true;
    try {
      await repository.append('cards/taken-one', {
        cardId,
        roundNumber: lobby.round.number,
        turnNumber: lobby.round.turnNumber
      });
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function takeCamels() {
    if (!repository || lobby.round?.activeUid !== uid) return;
    busy = true;
    try {
      await repository.append('cards/taken-camels', {
        roundNumber: lobby.round.number,
        turnNumber: lobby.round.turnNumber
      });
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  function toggleSelection(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
  }

  function cancelExchange() {
    exchangeMode = false;
    selectedMarket = [];
    selectedReturn = [];
  }

  function projectedHandSize() {
    if (!lobby.round) return 0;
    const handReturns = selectedReturn.filter((id) =>
      lobby.round?.hands[uid]?.some((card) => card.id === id)
    ).length;
    return (lobby.round.hands[uid]?.length ?? 0) - handReturns + selectedMarket.length;
  }

  async function confirmExchange() {
    if (
      !repository ||
      !lobby.round ||
      !isLegalExchange(lobby.round, uid, selectedMarket, selectedReturn)
    ) {
      return;
    }
    busy = true;
    try {
      await repository.append('cards/exchanged', {
        takenCardIds: selectedMarket,
        returnedCardIds: selectedReturn,
        roundNumber: lobby.round.number,
        turnNumber: lobby.round.turnNumber
      });
      cancelExchange();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  const cardLabel = (kind: string) => kind[0].toUpperCase() + kind.slice(1);
</script>

<svelte:head>
  <title>Jaipur — Live card play</title>
</svelte:head>

<main data-e2e-layout>
  <section class="hero" class:compact={!shellOnly} aria-labelledby="title">
    <p class="eyebrow">A market for two</p>
    <h1 id="title">{shellOnly ? 'The bazaar is almost ready.' : 'Enter the bazaar.'}</h1>
    <p class="lede">
      Gather rare goods, trade with camels, and earn two Seals of Excellence before your rival.
    </p>

    {#if shellOnly}
      <div class="goods" aria-label="Goods in the Jaipur market">
        <span class="diamond">Diamonds</span>
        <span class="gold">Gold</span>
        <span class="silver">Silver</span>
        <span class="cloth">Cloth</span>
        <span class="spice">Spice</span>
        <span class="leather">Leather</span>
      </div>
    {:else if !lobby.gameId}
      <form class="join-card" onsubmit={(event) => event.preventDefault()}>
        <label>
          Your trader name
          <input maxlength="32" autocomplete="name" bind:value={displayName} />
        </label>
        <label>
          Game code
          <input maxlength="48" autocomplete="off" bind:value={requestedGameId} />
        </label>
        <div class="actions">
          <button type="button" disabled={busy || !displayName.trim()} onclick={() => connect('create')}>
            Create game
          </button>
          <button
            class="secondary"
            type="button"
            disabled={busy || !displayName.trim()}
            onclick={() => connect('join')}>Join game</button
          >
        </div>
      </form>
    {:else if !lobby.round}
      <section class="lobby" aria-label="Game lobby">
        <div class="room-code">
          <span>Game code</span>
          <strong>{lobby.gameId}</strong>
        </div>
        <ol>
          {#each lobby.players as player, index}
            <li class:local={player.uid === uid}>
              <span class="seat">{index + 1}</span>
              <strong>{player.displayName}</strong>
              <span>{player.ready ? 'Ready' : 'Choosing wares'}</span>
            </li>
          {/each}
          {#if lobby.players.length < 2}
            <li class="waiting">
              <span class="seat">2</span>
              <strong>Waiting for a rival…</strong>
            </li>
          {/if}
        </ol>
        <button type="button" disabled={busy} onclick={toggleReady}>
          {lobby.players.find((player) => player.uid === uid)?.ready ? 'Not ready' : 'Ready to trade'}
        </button>
        {#if lobby.hostUid === uid && lobby.players.length === 2 && lobby.players.every((player) => player.ready)}
          <button class="secondary" type="button" disabled={busy} onclick={startRound}>
            Open the market
          </button>
        {/if}
      </section>
    {:else}
      <section class="table" aria-label="Jaipur market">
        <header>
          <div>
            <span>Round {lobby.round.number}</span>
            <strong>{lobby.players.find((player) => player.uid === lobby.round?.activeUid)?.displayName}'s turn</strong>
          </div>
          <div><span>Deck</span><strong>{lobby.round.deck.length}</strong></div>
        </header>
        <h2>Market</h2>
        {#if lobby.round.activeUid === uid}
          <div class="turn-actions">
            <button
              class="secondary"
              type="button"
              aria-pressed={exchangeMode}
              onclick={() => (exchangeMode ? cancelExchange() : (exchangeMode = true))}
            >
              {exchangeMode ? 'Cancel exchange' : 'Exchange goods'}
            </button>
            {#if exchangeMode}
              <button
                type="button"
                disabled={!isLegalExchange(lobby.round, uid, selectedMarket, selectedReturn) || busy}
                onclick={confirmExchange}
              >
                Confirm {selectedMarket.length} for {selectedReturn.length} · hand {projectedHandSize()} / 7
              </button>
            {/if}
          </div>
        {/if}
        {#if !exchangeMode && lobby.round.activeUid === uid && lobby.round.market.some((card) => card.kind === 'camel')}
          <button class="take-camels" type="button" disabled={busy} onclick={takeCamels}>
            Take all {lobby.round.market.filter((card) => card.kind === 'camel').length} camels
          </button>
        {/if}
        <div class="cards market">
          {#each lobby.round.market as card}
            {#if card.kind !== 'camel' && lobby.round.activeUid === uid && (exchangeMode || (lobby.round.hands[uid]?.length ?? 0) < 7)}
              <button
                class="card-action"
                class:selected={selectedMarket.includes(card.id)}
                type="button"
                disabled={busy}
                aria-label={`${exchangeMode ? 'Select' : 'Take'} ${cardLabel(card.kind)} ${card.id}`}
                aria-pressed={exchangeMode ? selectedMarket.includes(card.id) : undefined}
                data-card-id={card.id}
                onclick={() =>
                  exchangeMode
                    ? (selectedMarket = toggleSelection(selectedMarket, card.id))
                    : takeOne(card.id)}
              >
                <span>{cardLabel(card.kind)}</span>
                <small>{card.id}</small>
              </button>
            {:else}
              <article class:camel={card.kind === 'camel'} data-card-id={card.id}>
                <span>{cardLabel(card.kind)}</span>
                <small>{card.id}</small>
              </article>
            {/if}
          {/each}
        </div>
        <div class="opponent">
          <span>{lobby.players.find((player) => player.uid !== uid)?.displayName}</span>
          <strong>{lobby.round.hands[lobby.players.find((player) => player.uid !== uid)?.uid ?? '']?.length ?? 0} cards</strong>
          <span>Herd hidden</span>
        </div>
        <h2>Your hand</h2>
        <div class="cards hand">
          {#each lobby.round.hands[uid] ?? [] as card}
            {#if exchangeMode}
              <button
                class="card-action return-card"
                class:selected={selectedReturn.includes(card.id)}
                type="button"
                aria-label={`Return ${cardLabel(card.kind)} ${card.id}`}
                aria-pressed={selectedReturn.includes(card.id)}
                data-card-id={card.id}
                onclick={() => (selectedReturn = toggleSelection(selectedReturn, card.id))}
              >
                <span>{cardLabel(card.kind)}</span>
                <small>{card.id}</small>
              </button>
            {:else}
              <article data-card-id={card.id}>
                <span>{cardLabel(card.kind)}</span>
                <small>{card.id}</small>
              </article>
            {/if}
          {/each}
        </div>
        <p>Your herd: <strong>{lobby.round.herds[uid]?.length ?? 0} camels</strong></p>
        {#if exchangeMode && (lobby.round.herds[uid]?.length ?? 0) > 0}
          <div class="herd-returns">
            {#each lobby.round.herds[uid] ?? [] as camel, index}
              <button
                class="secondary"
                class:selected={selectedReturn.includes(camel.id)}
                type="button"
                aria-pressed={selectedReturn.includes(camel.id)}
                onclick={() => (selectedReturn = toggleSelection(selectedReturn, camel.id))}
              >
                {selectedReturn.includes(camel.id) ? 'Keep' : 'Return'} camel {index + 1}
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <p role="status" data-status={status}>{statusText}</p>
    <p class="build" data-testid="build-marker">Build {import.meta.env.VITE_GIT_HASH ?? 'local'}</p>
  </section>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) {
    background: #f5e7c6;
    color: #183a37;
    font-family: 'Atkinson Hyperlegible', sans-serif;
  }
  :global(body) { margin: 0; }
  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem;
    background:
      radial-gradient(circle at 50% 18%, rgb(255 255 255 / 75%), transparent 31rem),
      linear-gradient(145deg, #f8efd9, #e7c98d);
  }
  .hero {
    width: min(62rem, 100%);
    padding: clamp(2rem, 6vw, 5rem);
    text-align: center;
    border: 1px solid rgb(24 58 55 / 25%);
    border-radius: 2rem;
    background: rgb(255 250 238 / 88%);
    box-shadow: 0 1.5rem 4rem rgb(80 46 20 / 16%);
  }
  .hero.compact { max-width: 46rem; }
  .eyebrow {
    margin: 0;
    color: #a23e2a;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0.5rem auto 1rem;
    max-width: 13ch;
    font: 700 clamp(3rem, 8vw, 6.5rem) / 0.9 'Cormorant Garamond', serif;
  }
  .compact h1 { font-size: clamp(2.8rem, 7vw, 5rem); }
  .lede {
    max-width: 42rem;
    margin: 0 auto 2rem;
    font-size: clamp(1.1rem, 2vw, 1.35rem);
  }
  .goods, .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.55rem;
    margin-bottom: 2rem;
  }
  .goods span {
    padding: 0.5rem 0.8rem;
    border-radius: 99rem;
    color: white;
    font-weight: 700;
  }
  .diamond { background: #a9323a; }
  .gold { background: #b17900; }
  .silver { background: #60727c; }
  .cloth { background: #72539a; }
  .spice { background: #3e7b51; }
  .leather { background: #8a552f; }
  .join-card {
    display: grid;
    gap: 1rem;
    max-width: 28rem;
    margin: 0 auto 1.5rem;
    text-align: left;
  }
  label { display: grid; gap: 0.35rem; font-weight: 700; }
  input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #778b80;
    border-radius: 0.65rem;
    background: white;
    color: inherit;
    font: inherit;
  }
  button {
    padding: 0.75rem 1.1rem;
    border: 0;
    border-radius: 99rem;
    background: #a23e2a;
    color: white;
    font: 700 1rem inherit;
    cursor: pointer;
  }
  button.secondary { background: #315f58; }
  button:disabled { cursor: not-allowed; opacity: 0.45; }
  .lobby { margin: 0 auto 1.5rem; }
  .lobby button + button { margin-left: 0.5rem; }
  .room-code { display: grid; margin-bottom: 1rem; }
  .room-code span { color: #66746e; font-size: 0.85rem; text-transform: uppercase; }
  .room-code strong { font-size: 1.35rem; letter-spacing: 0.08em; }
  ol { display: grid; gap: 0.65rem; padding: 0; list-style: none; }
  li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem;
    border: 1px solid #b7aa8d;
    border-radius: 0.8rem;
    text-align: left;
  }
  li.local { border-color: #a23e2a; background: #fff4e4; }
  li.waiting { color: #66746e; }
  .seat {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 50%;
    background: #183a37;
    color: white;
  }
  [role='status'] { margin: 0; font-weight: 700; }
  [data-status='synced'] { color: #236142; }
  [data-status='error'] { color: #a3212a; }
  .build { margin: 0.55rem 0 0; color: #5f6f69; font-size: 0.875rem; }
  .table { text-align: left; }
  .table header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid #b7aa8d;
  }
  .table header div { display: grid; }
  .table h2 { margin: 1rem 0 0.5rem; font: 700 1.8rem 'Cormorant Garamond', serif; }
  .take-camels { margin: 0 0 0.65rem; }
  .turn-actions, .herd-returns {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.65rem;
  }
  .cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0.55rem; }
  .cards article, .cards .card-action {
    min-height: 7.5rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0.65rem;
    border: 2px solid #315f58;
    border-radius: 0.75rem;
    background: #fffaf0;
    color: #183a37;
    font-weight: 700;
    text-align: left;
  }
  .cards .card-action { cursor: pointer; }
  .cards .card-action:hover { transform: translateY(-2px); box-shadow: 0 0.4rem 0.8rem rgb(49 95 88 / 18%); }
  .cards .selected, button.selected { outline: 4px solid #d38b21; outline-offset: -4px; }
  .cards article.camel { border-color: #a23e2a; background: #f7d69f; }
  .cards small { color: #66746e; font-size: 0.7rem; }
  .opponent {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 1rem;
    padding: 0.65rem;
    border-radius: 0.65rem;
    background: #e9dcc1;
  }
  @media (max-width: 480px) {
    main { padding: 1rem; }
    .hero { padding: 2rem 1.2rem; border-radius: 1.4rem; }
    li { grid-template-columns: auto 1fr; }
    li > :last-child { grid-column: 2; }
    .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .cards article, .cards .card-action { min-height: 5.5rem; padding: 0.45rem; }
    .opponent { flex-wrap: wrap; }
  }
</style>
