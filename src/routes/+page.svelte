<script lang="ts">
  import '@fontsource/atkinson-hyperlegible/400.css';
  import '@fontsource/atkinson-hyperlegible/700.css';
  import '@fontsource/cormorant-garamond/700.css';
  import { replaceState } from '$app/navigation';
  import { onMount } from 'svelte';
  import { initializeFirebase } from '$lib/firebase';
  import { reduceLobby, type LobbyState } from '$lib/game-events';
  import { createGameRepository, type GameRepository } from '$lib/game-repository';

  let status = $state<'connecting' | 'synced' | 'error'>('connecting');
  let statusText = $state('Connecting to Firebase…');
  let uid = $state('');
  let requestedGameId = $state('');
  let displayName = $state('');
  let lobby = $state<LobbyState>(reduceLobby([]));
  let repository = $state<GameRepository>();
  let busy = $state(false);
  let shellOnly = $state(true);

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
        lobby = reduceLobby(events);
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
      replaceState(`?gameId=${encodeURIComponent(requestedGameId.trim())}`, {});
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
    {:else}
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
  @media (max-width: 480px) {
    main { padding: 1rem; }
    .hero { padding: 2rem 1.2rem; border-radius: 1.4rem; }
    li { grid-template-columns: auto 1fr; }
    li > :last-child { grid-column: 2; }
  }
</style>
