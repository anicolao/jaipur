<script lang="ts">
  import '@fontsource/atkinson-hyperlegible/400.css';
  import '@fontsource/atkinson-hyperlegible/700.css';
  import '@fontsource/cormorant-garamond/700.css';
  import { replaceState } from '$app/navigation';
  import { onMount } from 'svelte';
  import { initializeFirebase } from '$lib/firebase';
  import { createGameRepository, type GameRepository } from '$lib/game-repository';
  import {
    isLegalExchange,
    isLegalSale,
    reduceGame,
    type Card,
    type GameState,
    type Good
  } from '$lib/jaipur-rules';

  let status = $state<
    'connecting' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'incompatible' | 'error'
  >('connecting');
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
  let saleMode = $state(false);
  let saleKind = $state<Good | null>(null);
  let selectedSale = $state<string[]>([]);
  let requestedOffline = $state(false);
  const goods: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];

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
        if (lobby.diagnostics.some((diagnostic) => diagnostic.includes('incompatible version'))) {
          status = 'incompatible';
          statusText = 'This game contains an incompatible protocol version';
        } else if (lobby.diagnostics.length > 0) {
          status = 'conflict';
          statusText = `${lobby.diagnostics.length} conflicting event${lobby.diagnostics.length === 1 ? '' : 's'} ignored`;
        } else if (status === 'conflict' || status === 'incompatible') {
          status = 'syncing';
          statusText = 'Synchronizing game…';
        }
      },
      showError,
      (repositoryStatus) => {
        if (repositoryStatus === 'offline' && requestedOffline) {
          status = 'offline';
          statusText = 'Offline — showing cached game';
          return;
        }
        if (status === 'conflict' || status === 'incompatible') return;
        status =
          repositoryStatus === 'offline' && !requestedOffline ? 'syncing' : repositoryStatus;
        statusText =
          status === 'offline'
            ? 'Offline — showing cached game'
            : status === 'syncing'
              ? 'Synchronizing game…'
              : 'Game synced';
      }
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
      const roundNumber = (lobby.round?.number ?? 0) + 1;
      const fixedSeed = new URLSearchParams(location.search).get('seed');
      await repository.append('round/started', {
        seed: fixedSeed
          ? roundNumber === 1
            ? fixedSeed
            : `${fixedSeed}:round:${roundNumber}`
          : crypto.randomUUID(),
        starterUid: lobby.round?.loserUid ?? lobby.players[0].uid,
        roundNumber
      });
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function startRematch() {
    if (!repository || uid !== lobby.hostUid || !lobby.winnerUid) return;
    busy = true;
    try {
      const fixedSeed = new URLSearchParams(location.search).get('seed');
      await repository.append('game/rematched', { epoch: lobby.epoch + 1 });
      await repository.append('round/started', {
        seed: fixedSeed ? `${fixedSeed}:rematch:${lobby.epoch + 1}` : crypto.randomUUID(),
        starterUid: lobby.players[0].uid,
        roundNumber: 1
      });
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  async function goOffline() {
    if (!repository) return;
    requestedOffline = true;
    await repository.disconnect();
  }

  async function reconnect() {
    if (!repository) return;
    requestedOffline = false;
    status = 'syncing';
    statusText = 'Synchronizing game…';
    await repository.reconnect();
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

  function cancelSale() {
    saleMode = false;
    saleKind = null;
    selectedSale = [];
  }

  function beginExchange() {
    cancelSale();
    exchangeMode = true;
  }

  function beginSale() {
    cancelExchange();
    saleMode = true;
  }

  function toggleSale(card: Card) {
    if (selectedSale.includes(card.id)) {
      selectedSale = selectedSale.filter((id) => id !== card.id);
      if (selectedSale.length === 0) saleKind = null;
      return;
    }
    if (saleKind && saleKind !== card.kind) return;
    saleKind = card.kind as Good;
    selectedSale = [...selectedSale, card.id];
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

  async function confirmSale() {
    if (
      !repository ||
      !lobby.round ||
      !saleKind ||
      !isLegalSale(lobby.round, uid, saleKind, selectedSale)
    ) {
      return;
    }
    busy = true;
    try {
      await repository.append('cards/sold', {
        kind: saleKind,
        cardIds: selectedSale,
        roundNumber: lobby.round.number,
        turnNumber: lobby.round.turnNumber
      });
      cancelSale();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  function ownedTokenValue() {
    if (!lobby.round) return 0;
    return [
      ...(lobby.round.ownedGoodsTokens[uid] ?? []),
      ...(lobby.round.ownedBonusTokens[uid] ?? [])
    ].reduce((total, token) => total + token.value, 0);
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
    {:else if lobby.round.status === 'complete'}
      <section class="score-review" aria-labelledby="round-result">
        {#if lobby.winnerUid}
          <p class="eyebrow">Match complete</p>
          <h2 id="round-result" class="match-winner">
            {lobby.players.find((player) => player.uid === lobby.winnerUid)?.displayName}
            wins Jaipur
          </h2>
          <p>Two Seals of Excellence decide the match.</p>
        {:else}
          <p class="eyebrow">Round {lobby.round.number} complete</p>
          <h2 id="round-result">
            {lobby.players.find((player) => player.uid === lobby.round?.winnerUid)?.displayName}
            earns a Seal of Excellence
          </h2>
          <p>
            {lobby.round.endReason === 'three-empty-supplies'
              ? 'Three goods supplies are empty.'
              : 'The deck could not completely refill the market.'}
          </p>
        {/if}
        <div class="scorecards">
          {#each lobby.players as player}
            <article class:winner={player.uid === lobby.round.winnerUid}>
              <h3>{player.displayName}</h3>
              <dl>
                <div><dt>Goods</dt><dd>{lobby.round.scores?.[player.uid]?.goods ?? 0}</dd></div>
                <div><dt>Bonuses</dt><dd>{lobby.round.scores?.[player.uid]?.bonus ?? 0}</dd></div>
                <div><dt>Camels</dt><dd>{lobby.round.scores?.[player.uid]?.camel ?? 0}</dd></div>
                <div><dt>Total</dt><dd>{lobby.round.scores?.[player.uid]?.total ?? 0}</dd></div>
              </dl>
              <p>
                Bonus tokens:
                {(lobby.round.ownedBonusTokens[player.uid] ?? []).map(({ value }) => value).join(', ') || 'none'}
              </p>
              <p>Herd: {lobby.round.herds[player.uid]?.length ?? 0} camels</p>
              <strong>{lobby.seals[player.uid] ?? 0} / 2 seals</strong>
            </article>
          {/each}
        </div>
        {#if lobby.winnerUid}
          <section class="match-history" aria-label="Round history">
            <h3>Round history</h3>
            {#each lobby.rounds as completedRound}
              <p>
                Round {completedRound.number}:
                <strong>
                  {lobby.players.find((player) => player.uid === completedRound.winnerUid)?.displayName}
                </strong>
                {lobby.players
                  .map(
                    (player) =>
                      `${player.displayName} ${completedRound.scores?.[player.uid]?.total ?? 0}`
                  )
                  .join(' · ')}
              </p>
            {/each}
          </section>
          {#if lobby.hostUid === uid}
            <button type="button" disabled={busy} onclick={startRematch}>Start rematch</button>
          {:else}
            <p>Waiting for the host to start a rematch…</p>
          {/if}
        {:else if lobby.hostUid === uid}
          <button type="button" disabled={busy} onclick={startRound}>
            Open round {lobby.round.number + 1}
          </button>
        {:else}
          <p>Waiting for the host to open the next market…</p>
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
        <div class="seal-track" aria-label="Seal track">
          {#each lobby.players as player}
            <span>{player.displayName}: <strong>{lobby.seals[player.uid] ?? 0} / 2 seals</strong></span>
          {/each}
        </div>
        <h2>Market</h2>
        {#if lobby.round.activeUid === uid}
          <div class="turn-actions">
            <button
              class="secondary"
              type="button"
              aria-pressed={exchangeMode}
              onclick={() => (exchangeMode ? cancelExchange() : beginExchange())}
            >
              {exchangeMode ? 'Cancel exchange' : 'Exchange goods'}
            </button>
            <button
              class="secondary"
              type="button"
              aria-pressed={saleMode}
              onclick={() => (saleMode ? cancelSale() : beginSale())}
            >
              {saleMode ? 'Cancel sale' : 'Sell goods'}
            </button>
            {#if exchangeMode}
              <button
                type="button"
                disabled={!isLegalExchange(lobby.round, uid, selectedMarket, selectedReturn) || busy}
                onclick={confirmExchange}
              >
                Confirm {selectedMarket.length} for {selectedReturn.length} · hand {projectedHandSize()} / 7
              </button>
            {:else if saleMode}
              <button
                type="button"
                disabled={!saleKind || !isLegalSale(lobby.round, uid, saleKind, selectedSale) || busy}
                onclick={confirmSale}
              >
                Sell {selectedSale.length} {saleKind ? cardLabel(saleKind) : 'goods'}
              </button>
            {/if}
          </div>
        {/if}
        {#if !exchangeMode && !saleMode && lobby.round.activeUid === uid && lobby.round.market.some((card) => card.kind === 'camel')}
          <button class="take-camels" type="button" disabled={busy} onclick={takeCamels}>
            Take all {lobby.round.market.filter((card) => card.kind === 'camel').length} camels
          </button>
        {/if}
        <div class="cards market">
          {#each lobby.round.market as card}
            {#if card.kind !== 'camel' && lobby.round.activeUid === uid && !saleMode && (exchangeMode || (lobby.round.hands[uid]?.length ?? 0) < 7)}
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
          <span>
            {(lobby.round.ownedGoodsTokens[lobby.players.find((player) => player.uid !== uid)?.uid ?? '']?.length ?? 0) +
              (lobby.round.ownedBonusTokens[lobby.players.find((player) => player.uid !== uid)?.uid ?? '']?.length ?? 0)}
            tokens · values hidden
          </span>
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
            {:else if saleMode}
              <button
                class="card-action sale-card"
                class:selected={selectedSale.includes(card.id)}
                type="button"
                disabled={Boolean(saleKind && saleKind !== card.kind)}
                aria-label={`Select ${cardLabel(card.kind)} ${card.id} for sale`}
                aria-pressed={selectedSale.includes(card.id)}
                data-card-id={card.id}
                onclick={() => toggleSale(card)}
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
        <section class="token-area" aria-label="Token supplies">
          <h2>Token supplies</h2>
          <div class="tokens">
            {#each goods as kind}
              <article class={`token ${kind}`}>
                <strong>{cardLabel(kind)}</strong>
                <span>{lobby.round.goodsTokens[kind].length} left</span>
                <span>Next {lobby.round.goodsTokens[kind][0]?.value ?? '—'}</span>
              </article>
            {/each}
          </div>
          <p>
            Your tokens:
            <strong>
              {(lobby.round.ownedGoodsTokens[uid]?.length ?? 0) +
                (lobby.round.ownedBonusTokens[uid]?.length ?? 0)}
              worth {ownedTokenValue()}
            </strong>
            · Bonus values are private.
          </p>
        </section>
      </section>
    {/if}

    {#if repository}
      <div class="connection-actions">
        {#if status === 'offline'}
          <button class="secondary" type="button" onclick={reconnect}>Reconnect</button>
        {:else}
          <button class="secondary" type="button" onclick={goOffline}>Work offline</button>
        {/if}
      </div>
    {/if}
    <p role={status === 'incompatible' ? 'alert' : 'status'} data-status={status}>{statusText}</p>
    {#if lobby.diagnostics.length > 0}
      <details class="diagnostics">
        <summary>Replay diagnostics ({lobby.diagnostics.length})</summary>
        <ul>
          {#each lobby.diagnostics as diagnostic}
            <li>{diagnostic}</li>
          {/each}
        </ul>
      </details>
    {/if}
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
  [data-status='offline'], [data-status='syncing'] { color: #725217; }
  [data-status='conflict'], [data-status='incompatible'], [data-status='error'] { color: #a3212a; }
  .connection-actions { margin: 1rem 0 0.5rem; }
  .diagnostics {
    max-width: 36rem;
    margin: 0.5rem auto;
    color: #7d2525;
    text-align: left;
  }
  .diagnostics ul { margin: 0.4rem 0; padding-left: 1.2rem; }
  .diagnostics li {
    display: list-item;
    padding: 0.15rem;
    border: 0;
    list-style: disc;
  }
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
  .seal-track {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.65rem;
    color: #5f6f69;
    font-size: 0.875rem;
  }
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
  .token-area { margin-top: 1rem; }
  .tokens {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.35rem;
  }
  .token {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
    padding: 0.45rem 0.25rem;
    border-radius: 0.55rem;
    color: white;
    text-align: center;
  }
  .token span { font-size: 0.72rem; }
  .token-area > p { margin: 0.65rem 0 0; }
  .score-review > h2 {
    margin: 0.5rem auto 1rem;
    font: 700 2.4rem 'Cormorant Garamond', serif;
  }
  .scorecards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    margin: 1.25rem 0;
    text-align: left;
  }
  .scorecards article {
    padding: 1rem;
    border: 2px solid #b7aa8d;
    border-radius: 0.8rem;
    background: #fffaf0;
  }
  .scorecards article.winner { border-color: #a23e2a; background: #fff0dd; }
  .scorecards h3 { margin: 0 0 0.65rem; font-size: 1.25rem; }
  .scorecards dl { margin: 0; }
  .scorecards dl div { display: flex; justify-content: space-between; }
  .scorecards dd { margin: 0; font-weight: 700; }
  .match-history {
    margin: 0 0 1.25rem;
    padding: 0.8rem;
    border-radius: 0.8rem;
    background: #e9dcc1;
  }
  .match-history h3, .match-history p { margin: 0.25rem; }
  @media (max-width: 480px) {
    main { padding: 1rem; }
    .hero { padding: 2rem 1.2rem; border-radius: 1.4rem; }
    li { grid-template-columns: auto 1fr; }
    li > :last-child { grid-column: 2; }
    .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .cards article, .cards .card-action { min-height: 5.5rem; padding: 0.45rem; }
    .opponent { flex-wrap: wrap; }
    .tokens { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .scorecards { grid-template-columns: 1fr; }
  }
</style>
