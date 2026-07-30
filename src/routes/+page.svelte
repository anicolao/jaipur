<script lang="ts">
  import '@fontsource/atkinson-hyperlegible/400.css';
  import '@fontsource/atkinson-hyperlegible/700.css';
  import '@fontsource/cormorant-garamond/700.css';
  import { replaceState } from '$app/navigation';
  import { assets as assetBase } from '$app/paths';
  import { onMount } from 'svelte';
  import { initializeFirebase } from '$lib/firebase';
  import {
    createGameRepository,
    gameRoomExists,
    type GameRepository
  } from '$lib/game-repository';
  import PieceArt from '$lib/PieceArt.svelte';
  import {
    isLegalExchange,
    isLegalSale,
    reduceGame,
    type Card,
    type GameState,
    type Good
  } from '$lib/jaipur-rules';
  import { generateRoomCode, isRoomCode, normalizeRoomCode } from '$lib/room-code';

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
  const componentImage = (kind: Good | 'camel' | 'seal' | 'card-back') =>
    `${assetBase}/components/${kind}.webp`;

  onMount(async () => {
    try {
      const params = new URLSearchParams(location.search);
      requestedGameId = normalizeRoomCode(params.get('gameId') ?? '');
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
          statusText = 'Offline — cached view only';
          return;
        }
        if (status === 'conflict' || status === 'incompatible') return;
        status =
          repositoryStatus === 'offline' && !requestedOffline ? 'syncing' : repositoryStatus;
        statusText =
          status === 'offline'
            ? 'Offline — cached view only'
            : status === 'syncing'
              ? 'Synchronizing game…'
              : 'Game synced';
      }
    );
    return attached;
  }

  async function connect(mode: 'create' | 'join') {
    if (!uid || !displayName.trim()) return;
    if (mode === 'join' && !isRoomCode(requestedGameId)) return;
    busy = true;
    try {
      const services = await initializeFirebase();
      if (mode === 'create' && shellOnly) {
        let attempts = 0;
        do {
          requestedGameId = generateRoomCode();
          attempts += 1;
        } while (attempts < 8 && (await gameRoomExists(services.db, requestedGameId)));
        if (await gameRoomExists(services.db, requestedGameId)) {
          throw new Error('Could not reserve a unique game code. Please try again.');
        }
      }
      if (!isRoomCode(requestedGameId)) return;
      const attached = attachRepository(services.db);
      await attached.append(mode === 'create' ? 'game/created' : 'player/joined', {
        gameId: requestedGameId.trim(),
        displayName: displayName.trim()
      });
      localStorage.setItem(`jaipur:${requestedGameId.trim()}:${uid}:name`, displayName.trim());
      shellOnly = false;
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

<a class="skip-link" href="#game-content">Skip to game</a>
<main id="game-content" data-e2e-layout>
  <section
    class="hero"
    class:compact={!shellOnly}
    class:game-shell={Boolean(lobby.round && lobby.round.status !== 'complete')}
    class:score-shell={lobby.round?.status === 'complete'}
    class:lobby-shell={Boolean(lobby.gameId && !lobby.round)}
    aria-labelledby="title"
  >
    <p class="eyebrow">A market for two</p>
    <h1 id="title">{shellOnly ? 'The bazaar is almost ready.' : 'Enter the bazaar.'}</h1>
    <p class="lede">
      Gather rare goods, trade with camels, and earn two Seals of Excellence before your rival.
    </p>

    {#if shellOnly}
      <div class="goods" aria-label="Goods in the Jaipur market">
        {#each goods as kind}
          <span class={kind}>
            <img src={componentImage(kind)} alt="" />
            {cardLabel(kind)}
          </span>
        {/each}
      </div>
    {/if}

    {#if !lobby.gameId}
      <form class="join-card" onsubmit={(event) => event.preventDefault()}>
        <label>
          Your trader name
          <input maxlength="32" autocomplete="name" bind:value={displayName} />
        </label>
        <div class="create-room">
          <button
            type="button"
            disabled={busy || !displayName.trim()}
            onclick={() => connect('create')}
          >
            Create new game
          </button>
          <span>A five-letter code is generated automatically.</span>
        </div>
        <div class="join-room">
          <label>
            Five-letter game code
            <input
              maxlength="5"
              minlength="5"
              pattern="[A-Za-z]{5}"
              autocomplete="off"
              autocapitalize="characters"
              value={requestedGameId}
              oninput={(event) =>
                (requestedGameId = normalizeRoomCode(event.currentTarget.value))}
            />
          </label>
          <button
            class="secondary"
            type="button"
            disabled={busy || !displayName.trim() || !isRoomCode(requestedGameId)}
            onclick={() => connect('join')}>Join game</button
          >
        </div>
      </form>
    {:else if !lobby.round}
      <section class="lobby" aria-label="Game lobby">
        <img class="lobby-art" src={componentImage('card-back')} alt="" />
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
        <button type="button" disabled={busy || status === 'offline'} onclick={toggleReady}>
          {lobby.players.find((player) => player.uid === uid)?.ready ? 'Not ready' : 'Ready to trade'}
        </button>
        {#if lobby.hostUid === uid && lobby.players.length === 2 && lobby.players.every((player) => player.ready)}
          <button class="secondary" type="button" disabled={busy || status === 'offline'} onclick={startRound}>
            Open the market
          </button>
        {/if}
      </section>
    {:else if lobby.round.status === 'complete'}
      <section class="score-review" aria-labelledby="round-result">
        <img class="result-seal" src={componentImage('seal')} alt="" />
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
              <div class="score-components">
                <span class="bonus-stack">
                  <span class="component-caption">Bonus tokens:</span>
                  {#each lobby.round.ownedBonusTokens[player.uid] ?? [] as token}
                    <span class="bonus-token">
                      <img src={componentImage('card-back')} alt="" />
                      <strong>{token.value}</strong>
                    </span>
                  {:else}
                    <span>none</span>
                  {/each}
                </span>
                <span class="camel-total">
                  <img src={componentImage('camel')} alt="" />
                  Herd: {lobby.round.herds[player.uid]?.length ?? 0} camels
                </span>
                <span class="score-seals">
                  {#each Array(2) as _, sealIndex}
                    <img
                      class:earned={sealIndex < (lobby.seals[player.uid] ?? 0)}
                      src={componentImage('seal')}
                      alt=""
                    />
                  {/each}
                  <strong>{lobby.seals[player.uid] ?? 0} / 2 seals</strong>
                </span>
              </div>
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
            <button type="button" disabled={busy || status === 'offline'} onclick={startRematch}>Start rematch</button>
          {:else}
            <p>Waiting for the host to start a rematch…</p>
          {/if}
        {:else if lobby.hostUid === uid}
          <button type="button" disabled={busy || status === 'offline'} onclick={startRound}>
            Open round {lobby.round.number + 1}
          </button>
        {:else}
          <p>Waiting for the host to open the next market…</p>
        {/if}
      </section>
    {:else}
      <section class="table" aria-label="Jaipur market">
        <header aria-live="polite" aria-atomic="true">
          <div>
            <span>Round {lobby.round.number}</span>
            <strong>{lobby.players.find((player) => player.uid === lobby.round?.activeUid)?.displayName}'s turn</strong>
          </div>
          <div class="deck-count">
            <img src={componentImage('card-back')} alt="" />
            <span>Deck</span>
            <strong>{lobby.round.deck.length}</strong>
          </div>
        </header>
        <div class="seal-track" aria-label="Seal track">
          {#each lobby.players as player}
            <span class="player-seals">
              <span>{player.displayName}:</span>
              <span class="seal-pips" aria-hidden="true">
                {#each Array(2) as _, sealIndex}
                  <img
                    class:earned={sealIndex < (lobby.seals[player.uid] ?? 0)}
                    src={componentImage('seal')}
                    alt=""
                  />
                {/each}
              </span>
              <strong>{lobby.seals[player.uid] ?? 0} / 2 seals</strong>
            </span>
          {/each}
        </div>
        <section
          class="market-zone"
          aria-labelledby="market-heading"
          style={`--zone-art: url("${componentImage('card-back')}")`}
        >
          <h2 id="market-heading">Market</h2>
          {#if lobby.round.activeUid === uid}
            <div class="turn-actions">
              <button
                class="secondary"
                type="button"
                disabled={status === 'offline'}
                aria-pressed={exchangeMode}
                onclick={() => (exchangeMode ? cancelExchange() : beginExchange())}
              >
                {exchangeMode ? 'Cancel exchange' : 'Exchange goods'}
              </button>
              <button
                class="secondary"
                type="button"
                disabled={status === 'offline'}
                aria-pressed={saleMode}
                onclick={() => (saleMode ? cancelSale() : beginSale())}
              >
                {saleMode ? 'Cancel sale' : 'Sell goods'}
              </button>
              {#if exchangeMode}
                <button
                  type="button"
                  disabled={!isLegalExchange(lobby.round, uid, selectedMarket, selectedReturn) || busy || status === 'offline'}
                  onclick={confirmExchange}
                >
                  Confirm {selectedMarket.length} for {selectedReturn.length} · hand {projectedHandSize()} / 7
                </button>
              {:else if saleMode}
                <button
                  type="button"
                  disabled={!saleKind || !isLegalSale(lobby.round, uid, saleKind, selectedSale) || busy || status === 'offline'}
                  onclick={confirmSale}
                >
                  Sell {selectedSale.length} {saleKind ? cardLabel(saleKind) : 'goods'}
                </button>
              {/if}
            </div>
            {#if exchangeMode}
              <p class="action-guidance" id="exchange-guidance">
                Select at least two market goods, then return the same number of hand goods or
                camels. Selected cards are marked with a gold outline and announced as selected.
              </p>
            {:else if saleMode}
              <p class="action-guidance" id="sale-guidance">
                Select one goods family from your hand. Diamonds, gold, and silver require at
                least two cards. Selected cards are marked with a gold outline and announced as
                selected.
              </p>
            {/if}
          {/if}
          {#if !exchangeMode && !saleMode && lobby.round.activeUid === uid && lobby.round.market.some((card) => card.kind === 'camel')}
            <button class="take-camels" type="button" disabled={busy || status === 'offline'} onclick={takeCamels}>
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
                  disabled={busy || status === 'offline'}
                  aria-label={`${exchangeMode ? 'Select' : 'Take'} ${cardLabel(card.kind)} ${card.id}`}
                  aria-pressed={exchangeMode ? selectedMarket.includes(card.id) : undefined}
                  aria-describedby={exchangeMode ? 'exchange-guidance' : undefined}
                  data-card-id={card.id}
                  onclick={() =>
                    exchangeMode
                      ? (selectedMarket = toggleSelection(selectedMarket, card.id))
                      : takeOne(card.id)}
                >
                  <PieceArt kind={card.kind} label={cardLabel(card.kind)} detail={card.id} />
                </button>
              {:else}
                <article class:camel={card.kind === 'camel'} data-card-id={card.id}>
                  <PieceArt kind={card.kind} label={cardLabel(card.kind)} detail={card.id} />
                </article>
              {/if}
            {/each}
          </div>
        </section>
        <div class="opponent">
          <img class="opponent-cards" src={componentImage('card-back')} alt="" />
          <span>{lobby.players.find((player) => player.uid !== uid)?.displayName}</span>
          <strong>{lobby.round.hands[lobby.players.find((player) => player.uid !== uid)?.uid ?? '']?.length ?? 0} cards</strong>
          <span>Herd hidden</span>
          <span>
            {(lobby.round.ownedGoodsTokens[lobby.players.find((player) => player.uid !== uid)?.uid ?? '']?.length ?? 0) +
              (lobby.round.ownedBonusTokens[lobby.players.find((player) => player.uid !== uid)?.uid ?? '']?.length ?? 0)}
            tokens · values hidden
          </span>
        </div>
        <section
          class="hand-zone"
          aria-labelledby="hand-heading"
          style={`--zone-art: url("${componentImage('card-back')}")`}
        >
          <h2 id="hand-heading">Your hand</h2>
          <div class="cards hand">
          {#each lobby.round.hands[uid] ?? [] as card}
            {#if exchangeMode}
              <button
                class="card-action return-card"
                class:selected={selectedReturn.includes(card.id)}
                type="button"
                disabled={status === 'offline'}
                aria-label={`Return ${cardLabel(card.kind)} ${card.id}`}
                aria-pressed={selectedReturn.includes(card.id)}
                aria-describedby="exchange-guidance"
                data-card-id={card.id}
                onclick={() => (selectedReturn = toggleSelection(selectedReturn, card.id))}
              >
                <PieceArt kind={card.kind} label={cardLabel(card.kind)} detail={card.id} />
              </button>
            {:else if saleMode}
              <button
                class="card-action sale-card"
                class:selected={selectedSale.includes(card.id)}
                type="button"
                disabled={status === 'offline' || Boolean(saleKind && saleKind !== card.kind)}
                aria-label={`Select ${cardLabel(card.kind)} ${card.id} for sale`}
                aria-pressed={selectedSale.includes(card.id)}
                aria-describedby="sale-guidance"
                data-card-id={card.id}
                onclick={() => toggleSale(card)}
              >
                <PieceArt kind={card.kind} label={cardLabel(card.kind)} detail={card.id} />
              </button>
            {:else}
              <article data-card-id={card.id}>
                <PieceArt kind={card.kind} label={cardLabel(card.kind)} detail={card.id} />
              </article>
            {/if}
          {/each}
          </div>
          <p class="herd-total">
            <img src={componentImage('camel')} alt="" />
            Your herd: <strong>{lobby.round.herds[uid]?.length ?? 0} camels</strong>
          </p>
          {#if exchangeMode && (lobby.round.herds[uid]?.length ?? 0) > 0}
            <div class="herd-returns">
              {#each lobby.round.herds[uid] ?? [] as camel, index}
                <button
                  class="secondary"
                  class:selected={selectedReturn.includes(camel.id)}
                  type="button"
                  disabled={status === 'offline'}
                  aria-pressed={selectedReturn.includes(camel.id)}
                  aria-describedby="exchange-guidance"
                  onclick={() => (selectedReturn = toggleSelection(selectedReturn, camel.id))}
                >
                  <img src={componentImage('camel')} alt="" />
                  {selectedReturn.includes(camel.id) ? 'Keep' : 'Return'} camel {index + 1}
                </button>
              {/each}
            </div>
          {/if}
        </section>
        <section class="token-area" aria-label="Token supplies">
          <h2>Token supplies</h2>
          <div class="tokens">
            {#each goods as kind}
              <article class={`token ${kind}`}>
                <img src={componentImage(kind)} alt="" />
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
          <button
            class="secondary"
            type="button"
            aria-describedby="offline-help"
            title="Pause Firestore updates and inspect the cached game"
            onclick={goOffline}>Work offline</button
          >
          <span class="visually-hidden" id="offline-help">
            Pause Firestore updates and show a read-only cached view until reconnecting.
          </span>
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
  .skip-link {
    position: fixed;
    z-index: 10;
    top: 0.5rem;
    left: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: #183a37;
    color: white;
    font-weight: 700;
    transform: translateY(-150%);
  }
  .skip-link:focus { transform: translateY(0); }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding:
      max(2rem, env(safe-area-inset-top))
      max(2rem, env(safe-area-inset-right))
      max(2rem, env(safe-area-inset-bottom))
      max(2rem, env(safe-area-inset-left));
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
    min-height: 44px;
    padding: 0.75rem;
    border: 1px solid #778b80;
    border-radius: 0.65rem;
    background: white;
    color: inherit;
    font: inherit;
  }
  button {
    min-width: 44px;
    min-height: 44px;
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
  :global(:focus-visible) {
    outline: 4px solid #145ca8;
    outline-offset: 3px;
  }
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
  .action-guidance {
    margin: -0.15rem 0 0.8rem;
    padding: 0.65rem 0.8rem;
    border-left: 4px solid #a23e2a;
    background: #f6e5c7;
    color: #274d47;
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
  .cards .card-action {
    transition:
      transform 120ms ease,
      box-shadow 120ms ease;
  }
  .cards .card-action:hover {
    transform: translateY(-2px);
    box-shadow: 0 0.4rem 0.8rem rgb(49 95 88 / 18%);
  }
  .cards .selected, button.selected { outline: 4px solid #d38b21; outline-offset: -4px; }
  .cards article.camel { border-color: #a23e2a; background: #f7d69f; }
  :global(.cards small) { color: #66746e; font-size: 0.7rem; }
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
  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      scroll-behavior: auto !important;
      transition-duration: 0s !important;
      animation-duration: 0s !important;
      animation-iteration-count: 1 !important;
    }
  }
  @media (forced-colors: active) {
    .cards .selected,
    button.selected {
      outline: 4px solid Highlight;
    }
    button,
    .cards article,
    .token {
      border: 2px solid ButtonText;
    }
  }
  @media (max-width: 480px) {
    main {
      padding:
        max(1rem, env(safe-area-inset-top))
        max(1rem, env(safe-area-inset-right))
        max(1rem, env(safe-area-inset-bottom))
        max(1rem, env(safe-area-inset-left));
    }
    .hero { padding: 2rem 1.2rem; border-radius: 1.4rem; }
    li { grid-template-columns: auto 1fr; }
    li > :last-child { grid-column: 2; }
    .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .cards article, .cards .card-action { min-height: 5.5rem; padding: 0.45rem; }
    .opponent { flex-wrap: wrap; }
    .tokens { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .scorecards { grid-template-columns: 1fr; }
  }

  /* Viewport-fitted component table. Every state stays inside one screen. */
  :global(html),
  :global(body) {
    width: 100%;
    height: 100%;
    overflow: hidden;
    overscroll-behavior: none;
  }
  main {
    width: 100%;
    height: 100dvh;
    min-height: 0;
    padding:
      max(0.4rem, env(safe-area-inset-top))
      max(0.4rem, env(safe-area-inset-right))
      max(0.4rem, env(safe-area-inset-bottom))
      max(0.4rem, env(safe-area-inset-left));
    overflow: hidden;
  }
  .hero {
    position: relative;
    display: flex;
    width: min(80rem, 100%);
    height: 100%;
    min-height: 0;
    flex-direction: column;
    justify-content: center;
    padding: clamp(0.8rem, 2.5vmin, 2rem);
    overflow: hidden;
    border-radius: clamp(1rem, 3vmin, 2rem);
  }
  .hero.compact {
    max-width: 80rem;
    justify-content: flex-start;
    padding: 0.55rem 0.7rem 3.35rem;
  }
  .compact > .eyebrow,
  .compact > h1,
  .compact > .lede {
    display: none;
  }
  h1 {
    margin: 0.25rem auto 0.45rem;
    font-size: clamp(2.4rem, min(8vw, 9vh), 5.5rem);
  }
  .lede {
    margin-bottom: clamp(0.5rem, 2vh, 1.25rem);
    font-size: clamp(0.95rem, 2vmin, 1.25rem);
  }
  .goods {
    gap: 0.4rem;
    margin-bottom: clamp(0.5rem, 2vh, 1rem);
  }
  .goods span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.55rem 0.25rem 0.25rem;
  }
  .goods img {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    object-fit: cover;
  }
  .join-card {
    width: min(44rem, 100%);
    max-width: 44rem;
    grid-template-columns: minmax(10rem, 1fr) minmax(10rem, 1fr);
    gap: 0.65rem 1rem;
    margin-bottom: 0.45rem;
  }
  .join-card > label {
    grid-column: 1 / -1;
  }
  .create-room,
  .join-room {
    display: grid;
    min-width: 0;
    gap: 0.35rem;
    align-content: end;
  }
  .create-room span {
    color: #5f6f69;
    font-size: 0.8rem;
  }
  .join-room {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }
  .join-room label {
    min-width: 0;
  }
  input {
    min-height: 44px;
    padding: 0.45rem 0.65rem;
  }
  .lobby {
    position: relative;
    width: min(35rem, 100%);
    flex: 1;
    min-height: 0;
    margin: 0 auto;
    align-content: center;
  }
  .lobby-art {
    width: clamp(3.5rem, 12vmin, 6.5rem);
    aspect-ratio: 1;
    margin-bottom: 0.4rem;
    border-radius: 1rem;
    object-fit: cover;
    box-shadow: 0 0.45rem 1rem rgb(24 58 55 / 18%);
  }
  .lobby ol {
    margin: 0.5rem 0;
  }
  .lobby li {
    padding: 0.55rem 0.7rem;
  }

  .table {
    --card-height: clamp(4.6rem, 19vh, 9rem);
    display: grid;
    width: 100%;
    flex: 1;
    min-height: 0;
    grid-template:
      'meta seals' auto
      'market hand' minmax(0, 1fr)
      'opponent tokens' auto /
      minmax(0, 1.08fr) minmax(0, 0.92fr);
    gap: 0.4rem 0.65rem;
    text-align: left;
  }
  .table > header {
    grid-area: meta;
    align-items: center;
    min-height: 44px;
    padding: 0 0.5rem;
    border: 0;
    border-radius: 0.7rem;
    background: #e9dcc1;
  }
  .deck-count {
    display: grid !important;
    grid-template-columns: 1.8rem auto;
    align-items: center;
    column-gap: 0.35rem;
  }
  .deck-count img {
    width: 1.8rem;
    height: 2.25rem;
    grid-row: 1 / 3;
    border-radius: 0.25rem;
    object-fit: cover;
  }
  .seal-track {
    grid-area: seals;
    min-height: 44px;
    align-items: center;
    margin: 0;
    padding: 0.25rem 0.5rem;
    border-radius: 0.7rem;
    background: #e9dcc1;
    color: inherit;
    gap: 0.25rem;
  }
  .player-seals {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: 0 0.35rem;
  }
  .player-seals > strong {
    grid-column: 1 / -1;
    font-size: 0.68rem;
  }
  .seal-pips {
    display: flex;
    gap: 0.15rem;
  }
  .seal-pips img,
  .score-seals img {
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
    filter: grayscale(1);
    opacity: 0.25;
    object-fit: cover;
  }
  .seal-pips img.earned,
  .score-seals img.earned {
    filter: none;
    opacity: 1;
  }
  .market-zone,
  .hand-zone {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    padding: 0.35rem;
    border: 1px solid #c8b995;
    border-radius: 0.8rem;
    background:
      linear-gradient(rgb(255 250 238 / 88%), rgb(255 250 238 / 88%)),
      var(--zone-art) center / min(55%, 24rem) auto no-repeat;
  }
  .market-zone { grid-area: market; }
  .hand-zone { grid-area: hand; }
  .table h2 {
    margin: 0 0 0.2rem;
    font-size: clamp(1.05rem, 3vmin, 1.55rem);
    line-height: 1;
  }
  .turn-actions,
  .herd-returns {
    flex-wrap: nowrap;
    gap: 0.3rem;
    margin: 0 0 0.3rem;
  }
  .turn-actions button {
    min-width: 0;
    padding: 0.35rem 0.65rem;
    font-size: clamp(0.7rem, 1.6vmin, 0.9rem);
    white-space: nowrap;
  }
  .turn-actions button:last-child {
    flex: 1;
  }
  .action-guidance {
    min-height: 0;
    margin: 0 0 0.3rem;
    padding: 0.3rem 0.45rem;
    font-size: clamp(0.65rem, 1.45vmin, 0.8rem);
    line-height: 1.15;
  }
  .take-camels {
    align-self: flex-start;
    margin: 0 0 0.3rem;
    padding: 0.35rem 0.7rem;
  }
  .cards {
    min-width: 0;
    gap: clamp(0.15rem, 0.7vmin, 0.35rem);
  }
  .cards.market { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .cards.hand { grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .cards article,
  .cards .card-action {
    position: relative;
    display: grid;
    height: var(--card-height);
    min-width: 0;
    min-height: 44px;
    grid-template-rows: minmax(0, 1fr) auto;
    padding: 0.18rem;
    overflow: hidden;
    border-width: 2px;
    border-radius: 0.55rem;
    background: #183a37;
    color: white;
  }
  .cards article.camel {
    background: #a23e2a;
  }
  :global(.piece-image) {
    width: 100%;
    height: 100%;
    min-height: 0;
    border-radius: 0.35rem;
    object-fit: cover;
  }
  :global(.piece-label) {
    position: absolute;
    right: 0.18rem;
    bottom: 0.18rem;
    left: 0.18rem;
    padding: 0.15rem 0.2rem;
    overflow: hidden;
    border-radius: 0 0 0.3rem 0.3rem;
    background: rgb(10 32 30 / 82%);
    color: white;
    font-size: clamp(0.56rem, 1.35vmin, 0.78rem);
    line-height: 1;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.cards small) {
    display: none;
  }
  .opponent {
    grid-area: opponent;
    min-height: 44px;
    align-items: center;
    margin: 0;
    padding: 0.3rem 0.5rem;
    font-size: clamp(0.65rem, 1.5vmin, 0.82rem);
  }
  .opponent-cards {
    width: 1.7rem;
    height: 2rem;
    border-radius: 0.25rem;
    object-fit: cover;
  }
  .herd-total {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: 0.8rem;
  }
  .herd-total img,
  .herd-returns img {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    object-fit: cover;
  }
  .herd-returns {
    overflow: hidden;
  }
  .herd-returns button {
    min-width: 44px;
    flex: 1;
    padding: 0.2rem;
    overflow: hidden;
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .token-area {
    display: grid;
    min-width: 0;
    grid-area: tokens;
    grid-template-rows: auto 1fr auto;
    margin: 0;
    padding: 0.3rem;
    border-radius: 0.8rem;
    background: #e9dcc1;
  }
  .tokens {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.2rem;
  }
  .token {
    position: relative;
    min-width: 0;
    min-height: 3.5rem;
    align-content: end;
    padding: 0.2rem;
    overflow: hidden;
    border-radius: 0.5rem;
    background: #183a37;
    isolation: isolate;
  }
  .token img {
    position: absolute;
    z-index: -1;
    width: 100%;
    height: 100%;
    inset: 0;
    opacity: 0.56;
    object-fit: cover;
  }
  .token strong,
  .token span {
    overflow: hidden;
    font-size: clamp(0.54rem, 1.2vmin, 0.7rem);
    line-height: 1.05;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px #000;
    white-space: nowrap;
  }
  .token-area > p {
    margin: 0.25rem 0 0;
    font-size: 0.7rem;
  }
  .game-shell > .connection-actions,
  .lobby-shell > .connection-actions,
  .score-shell > .connection-actions {
    position: absolute;
    bottom: 0.35rem;
    left: 0.7rem;
    margin: 0;
  }
  .compact > [role='status'] {
    position: absolute;
    right: 0.7rem;
    bottom: 1.35rem;
    margin: 0;
    font-size: 0.75rem;
  }
  .compact > .build {
    position: absolute;
    right: 0.7rem;
    bottom: 0.35rem;
    margin: 0;
    font-size: 0.65rem;
  }
  .compact > .diagnostics {
    position: absolute;
    z-index: 3;
    right: 0.7rem;
    bottom: 3rem;
    max-width: min(32rem, 80%);
    padding: 0.4rem;
    background: #fffaf0;
  }

  .score-review {
    display: grid;
    width: min(54rem, 100%);
    flex: 1;
    min-height: 0;
    grid-template-columns: auto 1fr;
    grid-auto-rows: min-content;
    align-content: center;
    margin: auto;
    column-gap: 0.65rem;
  }
  .result-seal {
    width: clamp(3.2rem, 9vmin, 5.5rem);
    height: clamp(3.2rem, 9vmin, 5.5rem);
    grid-row: 1 / 4;
    border-radius: 50%;
    object-fit: cover;
  }
  .score-review > .eyebrow,
  .score-review > h2,
  .score-review > p {
    grid-column: 2;
    margin: 0.1rem 0;
  }
  .score-review > h2 {
    font-size: clamp(1.5rem, 4vmin, 2.4rem);
  }
  .scorecards {
    grid-column: 1 / -1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    margin: 0.55rem 0;
  }
  .scorecards article {
    padding: 0.55rem;
  }
  .scorecards h3 {
    margin-bottom: 0.25rem;
  }
  .scorecards dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 0.8rem;
    font-size: 0.78rem;
  }
  .score-components {
    display: flex;
    min-height: 2.25rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    margin-top: 0.3rem;
    font-size: 0.7rem;
  }
  .bonus-stack,
  .camel-total,
  .score-seals {
    display: flex;
    align-items: center;
    gap: 0.18rem;
  }
  .component-caption {
    font-size: 0.65rem;
  }
  .bonus-token {
    position: relative;
    display: grid;
    width: 1.7rem;
    height: 1.7rem;
    place-items: center;
    overflow: hidden;
    border-radius: 50%;
    color: white;
  }
  .bonus-token img {
    position: absolute;
    z-index: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .bonus-token strong {
    z-index: 1;
    text-shadow: 0 1px 2px #000;
  }
  .camel-total img {
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 50%;
    object-fit: cover;
  }
  .match-history {
    grid-column: 1 / -1;
    margin: 0 0 0.45rem;
    padding: 0.35rem;
    font-size: 0.7rem;
  }
  .score-review > button,
  .score-review > section + button,
  .score-review > section + p {
    grid-column: 1 / -1;
    justify-self: center;
  }

  @media (max-width: 600px) and (min-height: 600px) {
    .hero {
      padding: 0.65rem;
    }
    .hero.compact {
      padding: 0.35rem 0.35rem 3.2rem;
    }
    .join-card {
      grid-template-columns: 1fr;
      gap: 0.55rem;
    }
    .join-card > label {
      grid-column: auto;
    }
    .goods span {
      font-size: 0.75rem;
    }
    .goods img {
      width: 1.65rem;
      height: 1.65rem;
    }
    .table {
      --card-height: 5.2rem;
      grid-template:
        'meta seals' auto
        'market market' minmax(0, auto)
        'opponent opponent' auto
        'hand hand' minmax(0, auto)
        'tokens tokens' auto /
        minmax(0, 1fr) minmax(0, 1fr);
      gap: 0.25rem;
    }
    .market-zone,
    .hand-zone {
      padding: 0.2rem;
    }
    .cards {
      gap: 0.15rem;
    }
    .cards article,
    .cards .card-action {
      min-height: 44px;
      padding: 0.12rem;
    }
    .seal-track {
      gap: 0.1rem;
    }
    .player-seals {
      min-width: 0;
      gap: 0 0.12rem;
      font-size: 0.72rem;
    }
    .seal-pips img {
      width: 1.05rem;
      height: 1.05rem;
    }
    .opponent {
      flex-wrap: nowrap;
      gap: 0.35rem;
    }
    .token {
      min-height: 3.35rem;
    }
    .token-area {
      padding: 0.2rem;
    }
    .score-review {
      align-content: center;
      padding-top: 0.3rem;
    }
    .result-seal {
      width: 3.2rem;
      height: 3.2rem;
    }
    .scorecards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .score-components {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (max-height: 599px) {
    .hero {
      justify-content: flex-start;
      padding: 0.35rem 0.65rem;
    }
    .hero:not(.compact) {
      display: grid;
      grid-template-columns: minmax(12rem, 0.8fr) minmax(25rem, 1.2fr);
      grid-template-rows: auto auto 1fr auto;
      align-items: center;
      gap: 0.1rem 1rem;
    }
    .hero:not(.compact) > .eyebrow,
    .hero:not(.compact) > h1,
    .hero:not(.compact) > .lede,
    .hero:not(.compact) > .goods {
      grid-column: 1;
    }
    .hero:not(.compact) > .join-card {
      grid-column: 2;
      grid-row: 1 / 4;
      margin: 0;
    }
    .hero:not(.compact) > [role='status'],
    .hero:not(.compact) > .build {
      grid-column: 1;
      margin: 0;
    }
    h1 {
      margin: 0.05rem auto 0.2rem;
      font-size: clamp(2rem, 8vh, 2.8rem);
    }
    .lede {
      margin-bottom: 0.25rem;
      font-size: 0.82rem;
    }
    .goods {
      margin: 0;
    }
    .goods span {
      padding: 0.15rem 0.35rem 0.15rem 0.15rem;
      font-size: 0.68rem;
    }
    .goods img {
      width: 1.45rem;
      height: 1.45rem;
    }
    .join-card {
      grid-template-columns: minmax(8rem, 1fr) minmax(9rem, 1fr);
      gap: 0.35rem 0.6rem;
    }
    .join-card > label {
      grid-column: 1 / -1;
    }
    .create-room span {
      display: none;
    }
    .hero.compact {
      padding: 0.25rem 0.4rem 3rem;
    }
    .table {
      --card-height: clamp(4.2rem, 20vh, 4.8rem);
      gap: 0.2rem 0.4rem;
    }
    .seal-track {
      position: absolute;
      top: 0.2rem;
      right: 0.4rem;
      width: 13rem;
      gap: 0.2rem;
      background: transparent;
    }
    .market-zone,
    .hand-zone {
      padding: 0.18rem;
    }
    .table h2 {
      font-size: 1rem;
    }
    .turn-actions {
      position: absolute;
      z-index: 2;
      top: 0.2rem;
      left: 50%;
      max-width: calc(42% - 0.8rem);
      transform: translateX(-50%);
    }
    .action-guidance {
      max-height: 2.1rem;
      overflow: hidden;
    }
    .token {
      min-height: 3rem;
    }
    .token-area > p {
      display: none;
    }
    .herd-total {
      min-height: 34px;
    }
    .score-review {
      align-content: start;
    }
    .result-seal {
      width: 2.8rem;
      height: 2.8rem;
    }
    .scorecards {
      margin: 0.25rem 0;
    }
    .scorecards article {
      padding: 0.35rem;
    }
    .score-components {
      min-height: 1.8rem;
      margin-top: 0.15rem;
    }
  }
</style>
