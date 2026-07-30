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
  let exchangeLoads = $state<Record<string, string>>({});
  let activeExchangeTarget = $state<string | null>(null);
  let selectedHand = $state<string[]>([]);
  let draggedHandCardId = $state<string | null>(null);
  let pointerHandDrag = $state<{
    cardId: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  let suppressHandClickId = $state<string | null>(null);
  const goods: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];
  const componentImage = (kind: Good | 'camel' | 'seal' | 'card-back') =>
    `${assetBase}/components/${kind}.webp`;
  const opponentPlayer = () => lobby.players.find((player) => player.uid !== uid);
  const opponentUid = () => opponentPlayer()?.uid ?? '';
  const opponentHandCount = () => lobby.round?.hands[opponentUid()]?.length ?? 0;
  const opponentTokenCount = () =>
    (lobby.round?.ownedGoodsTokens[opponentUid()]?.length ?? 0) +
    (lobby.round?.ownedBonusTokens[opponentUid()]?.length ?? 0);
  const buildHash = (import.meta.env.VITE_GIT_HASH ?? 'local').slice(0, 7);

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
        if (status === 'conflict' || status === 'incompatible') return;
        status = repositoryStatus === 'offline' ? 'syncing' : repositoryStatus;
        statusText =
          status === 'syncing' ? 'Synchronizing game…' : 'Game synced';
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

  async function takeOne(cardId: string) {
    if (!repository || lobby.round?.activeUid !== uid) return;
    busy = true;
    try {
      await repository.append('cards/taken-one', {
        cardId,
        roundNumber: lobby.round.number,
        turnNumber: lobby.round.turnNumber
      });
      resetInteractions();
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
      resetInteractions();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  function toggleSelection(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
  }

  function resetInteractions() {
    exchangeLoads = {};
    activeExchangeTarget = null;
    selectedHand = [];
    draggedHandCardId = null;
  }

  function exchangeMarketIds(): string[] {
    return Object.keys(exchangeLoads);
  }

  function exchangeReturnIds(): string[] {
    return Object.values(exchangeLoads);
  }

  function handCard(cardId: string): Card | undefined {
    return lobby.round?.hands[uid]?.find(({ id }) => id === cardId);
  }

  function herdCamel(cardId: string): Card | undefined {
    return lobby.round?.herds[uid]?.find(({ id }) => id === cardId);
  }

  function marketGood(cardId: string): Card | undefined {
    return lobby.round?.market.find(({ id, kind }) => id === cardId && kind !== 'camel');
  }

  function returnKind(marketCardId: string): 'camel' | 'card' | null {
    const returnId = exchangeLoads[marketCardId];
    if (!returnId) return null;
    return herdCamel(returnId) ? 'camel' : 'card';
  }

  function availableCamel(marketCardId: string): Card | undefined {
    const currentReturn = exchangeLoads[marketCardId];
    const usedReturns = new Set(
      Object.entries(exchangeLoads)
        .filter(([targetId]) => targetId !== marketCardId)
        .map(([, returnId]) => returnId)
    );
    return lobby.round?.herds[uid]?.find(
      ({ id }) => id === currentReturn || !usedReturns.has(id)
    );
  }

  function assignExchangeReturn(marketCardId: string, returnCardId: string) {
    if (
      !marketGood(marketCardId) ||
      (!handCard(returnCardId) && !herdCamel(returnCardId))
    ) {
      return;
    }
    const nextLoads = Object.fromEntries(
      Object.entries(exchangeLoads).filter(
        ([targetId, loadedReturnId]) =>
          targetId !== marketCardId && loadedReturnId !== returnCardId
      )
    );
    exchangeLoads = { ...nextLoads, [marketCardId]: returnCardId };
    selectedHand = selectedHand.filter((id) => id !== returnCardId);
    activeExchangeTarget = null;
  }

  function unloadExchange(marketCardId: string) {
    exchangeLoads = Object.fromEntries(
      Object.entries(exchangeLoads).filter(([targetId]) => targetId !== marketCardId)
    );
    if (activeExchangeTarget === marketCardId) activeExchangeTarget = null;
  }

  function loadCamelExchange(marketCardId: string) {
    if (returnKind(marketCardId) === 'camel') {
      unloadExchange(marketCardId);
      return;
    }
    const camel = availableCamel(marketCardId);
    if (camel) assignExchangeReturn(marketCardId, camel.id);
  }

  function chooseCardExchange(marketCardId: string) {
    if (returnKind(marketCardId) === 'card' && selectedHand.length === 0) {
      unloadExchange(marketCardId);
      activeExchangeTarget = marketCardId;
      return;
    }
    const selectedReturn = selectedHand.find(
      (cardId) => !exchangeReturnIds().includes(cardId) && handCard(cardId)
    );
    if (selectedReturn) {
      assignExchangeReturn(marketCardId, selectedReturn);
      return;
    }
    activeExchangeTarget =
      activeExchangeTarget === marketCardId ? null : marketCardId;
  }

  function chooseHandCard(card: Card) {
    if (suppressHandClickId === card.id) {
      suppressHandClickId = null;
      return;
    }
    const loadedTarget = Object.entries(exchangeLoads).find(
      ([, returnId]) => returnId === card.id
    )?.[0];
    if (loadedTarget) {
      unloadExchange(loadedTarget);
      selectedHand = [...selectedHand, card.id];
      return;
    }
    if (activeExchangeTarget) {
      assignExchangeReturn(activeExchangeTarget, card.id);
      return;
    }
    selectedHand = toggleSelection(selectedHand, card.id);
  }

  function beginHandPointer(event: PointerEvent, cardId: string) {
    if (!event.isPrimary || event.button !== 0 || busy || status === 'offline') return;
    pointerHandDrag = {
      cardId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
  }

  function moveHandPointer(event: PointerEvent) {
    if (!pointerHandDrag || event.pointerId !== pointerHandDrag.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pointerHandDrag.startX,
      event.clientY - pointerHandDrag.startY
    );
    if (!pointerHandDrag.moved && distance < 7) return;
    if (!pointerHandDrag.moved) {
      pointerHandDrag = { ...pointerHandDrag, moved: true };
      draggedHandCardId = pointerHandDrag.cardId;
    }
    event.preventDefault();
  }

  function finishHandPointer(event: PointerEvent) {
    if (!pointerHandDrag || event.pointerId !== pointerHandDrag.pointerId) return;
    const { cardId, moved } = pointerHandDrag;
    if (moved) {
      const dropTarget = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-exchange-target]');
      const marketCardId = dropTarget?.dataset.exchangeTarget;
      if (marketCardId && !dropTarget.matches(':disabled')) {
        assignExchangeReturn(marketCardId, cardId);
      }
      suppressHandClickId = cardId;
      setTimeout(() => {
        if (suppressHandClickId === cardId) suppressHandClickId = null;
      });
      event.preventDefault();
    }
    pointerHandDrag = null;
    draggedHandCardId = null;
  }

  function cancelHandPointer(event: PointerEvent) {
    if (!pointerHandDrag || event.pointerId !== pointerHandDrag.pointerId) return;
    pointerHandDrag = null;
    draggedHandCardId = null;
  }

  function projectedHandSize() {
    if (!lobby.round) return 0;
    const handReturns = exchangeReturnIds().filter((id) =>
      lobby.round?.hands[uid]?.some((card) => card.id === id)
    ).length;
    return (lobby.round.hands[uid]?.length ?? 0) - handReturns + exchangeMarketIds().length;
  }

  async function confirmExchange() {
    const selectedMarket = exchangeMarketIds();
    const selectedReturn = exchangeReturnIds();
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
      resetInteractions();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
    }
  }

  function saleCardsFor(kind: Good): string[] {
    if (selectedHand.length > 0) return selectedHand;
    return (lobby.round?.hands[uid] ?? [])
      .filter((card) => card.kind === kind)
      .map(({ id }) => id);
  }

  function canSellTo(kind: Good): boolean {
    if (
      busy ||
      status === 'offline' ||
      lobby.round?.activeUid !== uid ||
      exchangeMarketIds().length > 0 ||
      Boolean(activeExchangeTarget) ||
      lobby.round.goodsTokens[kind].length === 0
    ) {
      return false;
    }
    const cardIds = saleCardsFor(kind);
    return (
      cardIds.length > 0 &&
      cardIds.every((cardId) => handCard(cardId)?.kind === kind) &&
      isLegalSale(lobby.round, uid, kind, cardIds)
    );
  }

  function saleActionLabel(kind: Good): string {
    const cardIds = saleCardsFor(kind);
    const selection = selectedHand.length > 0 ? `${cardIds.length} selected` : `all ${cardIds.length}`;
    return `Sell ${selection} ${cardLabel(kind)} to the ${cardLabel(kind)} token stack`;
  }

  async function sellToStack(kind: Good) {
    const cardIds = saleCardsFor(kind);
    if (
      !repository ||
      !lobby.round ||
      !cardIds.every((cardId) => handCard(cardId)?.kind === kind) ||
      !isLegalSale(lobby.round, uid, kind, cardIds)
    ) {
      return;
    }
    busy = true;
    try {
      await repository.append('cards/sold', {
        kind,
        cardIds,
        roundNumber: lobby.round.number,
        turnNumber: lobby.round.turnNumber
      });
      resetInteractions();
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

<svelte:window
  onpointermove={moveHandPointer}
  onpointerup={finishHandPointer}
  onpointercancel={cancelHandPointer}
/>

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
          {#if lobby.round.activeUid === uid && (exchangeMarketIds().length > 0 || activeExchangeTarget || selectedHand.length > 0)}
            <div class="interaction-tray" aria-live="polite">
              <p>
                {#if activeExchangeTarget}
                  Choose or drag a hand card to the highlighted card-back arrow.
                {:else if exchangeMarketIds().length > 0}
                  {exchangeMarketIds().length} market
                  {exchangeMarketIds().length === 1 ? 'card' : 'cards'} loaded ·
                  hand {projectedHandSize()} / 7
                {:else}
                  {selectedHand.length} hand {selectedHand.length === 1 ? 'card' : 'cards'} selected ·
                  choose a matching token stack or a card-back arrow.
                {/if}
              </p>
              {#if exchangeMarketIds().length > 0}
                <button
                  type="button"
                  disabled={!isLegalExchange(lobby.round, uid, exchangeMarketIds(), exchangeReturnIds()) || busy || status === 'offline'}
                  onclick={confirmExchange}
                >
                  Trade {exchangeMarketIds().length} for {exchangeReturnIds().length}
                </button>
              {/if}
              <button class="secondary" type="button" onclick={resetInteractions}>Clear</button>
            </div>
          {/if}
          <div class="cards market">
            {#each lobby.round.market as card}
              <div
                class="market-slot"
                class:loaded={Boolean(exchangeLoads[card.id])}
                class:awaiting={activeExchangeTarget === card.id}
              >
                {#if lobby.round.activeUid === uid}
                  <button
                    class="card-action"
                    class:camel={card.kind === 'camel'}
                    type="button"
                    disabled={busy || status === 'offline' || (card.kind !== 'camel' && (lobby.round.hands[uid]?.length ?? 0) >= 7)}
                    aria-label={card.kind === 'camel'
                      ? `Take all ${lobby.round.market.filter(({ kind }) => kind === 'camel').length} camels`
                      : `Take ${cardLabel(card.kind)} ${card.id}`}
                    data-card-id={card.id}
                    onclick={() => card.kind === 'camel' ? takeCamels() : takeOne(card.id)}
                  >
                    <PieceArt kind={card.kind} label={cardLabel(card.kind)} detail={card.id} />
                  </button>
                {:else}
                  <article class:camel={card.kind === 'camel'} data-card-id={card.id}>
                    <PieceArt kind={card.kind} label={cardLabel(card.kind)} detail={card.id} />
                  </article>
                {/if}
                {#if card.kind !== 'camel' && lobby.round.activeUid === uid}
                  <div class="exchange-arrows" aria-label={`Exchange destinations for ${cardLabel(card.kind)} ${card.id}`}>
                    <button
                      class="exchange-arrow"
                      class:loaded={returnKind(card.id) === 'camel'}
                      type="button"
                      disabled={busy || status === 'offline' || (!availableCamel(card.id) && returnKind(card.id) !== 'camel')}
                      aria-label={`Exchange ${cardLabel(card.kind)} ${card.id} for a camel`}
                      aria-pressed={returnKind(card.id) === 'camel'}
                      onclick={() => loadCamelExchange(card.id)}
                    >
                      <span aria-hidden="true">↑</span>
                      <img src={componentImage('camel')} alt="" />
                    </button>
                    <button
                      class="exchange-arrow card-return"
                      class:loaded={returnKind(card.id) === 'card'}
                      class:awaiting={activeExchangeTarget === card.id}
                      class:drop-ready={Boolean(draggedHandCardId)}
                      type="button"
                      disabled={busy || status === 'offline' || (lobby.round.hands[uid]?.length ?? 0) === 0}
                      data-exchange-target={card.id}
                      aria-label={`Choose a hand card to exchange for ${cardLabel(card.kind)} ${card.id}`}
                      aria-pressed={returnKind(card.id) === 'card' || activeExchangeTarget === card.id}
                      onclick={() => chooseCardExchange(card.id)}
                    >
                      <span aria-hidden="true">↑</span>
                      <img src={componentImage('card-back')} alt="" />
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
        <div class="opponent">
          <div class="opponent-identity">
            <strong>{opponentPlayer()?.displayName}</strong>
            <span>{opponentHandCount()} / 7 cards</span>
          </div>
          <div
            class="opponent-hand"
            role="img"
            aria-label={`${opponentPlayer()?.displayName ?? 'Opponent'} has ${opponentHandCount()} of 7 cards`}
          >
            {#each Array(opponentHandCount()) as _, index}
              <img
                class="opponent-card-back"
                src={componentImage('card-back')}
                alt=""
                draggable="false"
                style={`--fan-offset: ${index - (opponentHandCount() - 1) / 2}`}
              />
            {/each}
            {#if opponentHandCount() === 0}
              <span class="opponent-hand-empty">No cards</span>
            {/if}
          </div>
          <div class="opponent-private">
            <span>Herd hidden</span>
            <span>{opponentTokenCount()} tokens · values hidden</span>
          </div>
        </div>
        <section
          class="hand-zone"
          aria-labelledby="hand-heading"
          style={`--zone-art: url("${componentImage('card-back')}")`}
        >
          <h2 id="hand-heading">Your hand</h2>
          <div
            class="cards hand"
            style={`grid-template-columns: repeat(${Math.max(lobby.round.hands[uid]?.length ?? 0, 1)}, minmax(0, var(--card-size)));`}
          >
          {#each lobby.round.hands[uid] ?? [] as card}
            {#if lobby.round.activeUid === uid}
              <button
                class="card-action hand-card"
                class:selected={selectedHand.includes(card.id) || exchangeReturnIds().includes(card.id)}
                class:dragging={draggedHandCardId === card.id}
                type="button"
                disabled={status === 'offline'}
                aria-label={exchangeReturnIds().includes(card.id)
                  ? `${cardLabel(card.kind)} ${card.id} loaded for exchange`
                  : activeExchangeTarget
                    ? `Use ${cardLabel(card.kind)} ${card.id} for exchange`
                    : `${selectedHand.includes(card.id) ? 'Deselect' : 'Select'} ${cardLabel(card.kind)} ${card.id}`}
                aria-pressed={selectedHand.includes(card.id) || exchangeReturnIds().includes(card.id)}
                data-card-id={card.id}
                onpointerdown={(event) => beginHandPointer(event, card.id)}
                onclick={() => chooseHandCard(card)}
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
        </section>
        <section class="token-area" aria-label="Token supplies">
          <h2>Token supplies</h2>
          <div class="tokens">
            {#each goods as kind}
              <button
                class={`token ${kind}`}
                type="button"
                disabled={!canSellTo(kind)}
                aria-label={saleActionLabel(kind)}
                onclick={() => sellToStack(kind)}
              >
                <img src={componentImage(kind)} alt="" />
                <strong>{cardLabel(kind)}</strong>
                <span>{lobby.round.goodsTokens[kind].length} left</span>
                <span>Next {lobby.round.goodsTokens[kind][0]?.value ?? '—'}</span>
              </button>
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
    <p class="build" data-testid="build-marker">Build {buildHash}</p>
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
  [data-status='syncing'] { color: #725217; }
  [data-status='conflict'], [data-status='incompatible'], [data-status='error'] { color: #a3212a; }
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
  .interaction-tray {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.65rem;
  }
  .interaction-tray p {
    flex: 1;
    margin: 0;
    padding: 0.45rem 0.65rem;
    border-left: 3px solid #a23e2a;
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
  .market-slot {
    display: grid;
    min-width: 0;
    gap: 0.2rem;
  }
  .exchange-arrows {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.2rem;
  }
  .exchange-arrow {
    display: flex;
    min-width: 0;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 0.08rem;
    padding: 0.15rem;
    border: 2px solid #b7aa8d;
    border-radius: 0.45rem;
    background: #f2e8d3;
    color: #315f58;
  }
  .exchange-arrow img {
    width: 1.65rem;
    height: 1.65rem;
    border-radius: 0.25rem;
    object-fit: cover;
  }
  .exchange-arrow span {
    font-size: 1.15rem;
    line-height: 1;
  }
  .exchange-arrow.loaded,
  .exchange-arrow.awaiting {
    border-color: #d38b21;
    background: #fff0ce;
    box-shadow: inset 0 0 0 2px #d38b21;
  }
  .exchange-arrow.drop-ready {
    border-color: #315f58;
    background: #dce8df;
    box-shadow: inset 0 0 0 2px #315f58;
  }
  .market-slot.loaded > .card-action,
  .market-slot.awaiting > .card-action {
    outline: 3px solid #d38b21;
    outline-offset: -3px;
  }
  .hand-card.dragging {
    opacity: 0.55;
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
    min-height: 44px;
    padding: 0.45rem 0.25rem;
    border: 0;
    border-radius: 0.55rem;
    color: white;
    cursor: pointer;
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
    --card-size: clamp(5.75rem, min(14vw, 18vh), 7.25rem);
    --card-gap: clamp(0.15rem, 0.7vmin, 0.35rem);
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
  .interaction-tray {
    min-height: 44px;
    gap: 0.3rem;
    margin: 0 0 0.3rem;
  }
  .interaction-tray p {
    min-width: 0;
    overflow: hidden;
    padding: 0.25rem 0.4rem;
    font-size: clamp(0.62rem, 1.4vmin, 0.78rem);
    line-height: 1.1;
    text-overflow: ellipsis;
  }
  .interaction-tray button {
    min-width: 44px;
    padding: 0.35rem 0.65rem;
    font-size: clamp(0.7rem, 1.6vmin, 0.9rem);
    white-space: nowrap;
  }
  .cards {
    min-width: 0;
    gap: var(--card-gap);
  }
  .cards.market {
    grid-template-columns: repeat(5, var(--card-size));
    justify-content: space-between;
  }
  .cards.hand {
    align-items: start;
    justify-content: start;
  }
  .cards.hand > * {
    justify-self: center;
  }
  .cards.hand > :first-child {
    justify-self: start;
  }
  .cards.hand > :last-child {
    justify-self: end;
  }
  .cards article,
  .cards .card-action {
    position: relative;
    display: grid;
    width: var(--card-size);
    height: var(--card-size);
    min-width: var(--card-size);
    min-height: var(--card-size);
    aspect-ratio: 1;
    flex: 0 0 var(--card-size);
    grid-template-rows: minmax(0, 1fr) auto;
    padding: 0.18rem;
    overflow: hidden;
    border-width: 2px;
    border-radius: 0.55rem;
    background: #183a37;
    color: white;
  }
  .market-slot,
  .exchange-arrows {
    width: var(--card-size);
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
  .hand-card {
    touch-action: none;
    user-select: none;
  }
  .hand-card.dragging {
    z-index: 20;
    opacity: 0.55;
    transform: scale(0.98);
  }
  .hand-card:focus-visible,
  .hand-card.selected {
    z-index: 10;
  }
  :global(.cards.hand .piece-label) {
    padding-left: 0.35rem;
    text-align: left;
  }
  :global(.cards small) {
    display: none;
  }
  .opponent {
    grid-area: opponent;
    min-height: 44px;
    display: grid;
    grid-template-columns: minmax(3.5rem, auto) minmax(0, 1fr) minmax(5.5rem, auto);
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    padding: 0.3rem 0.5rem;
    font-size: clamp(0.65rem, 1.5vmin, 0.82rem);
  }
  .opponent-identity,
  .opponent-private {
    display: grid;
    min-width: 0;
    line-height: 1.1;
  }
  .opponent-identity span,
  .opponent-private span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opponent-private {
    text-align: right;
  }
  .opponent-hand {
    display: flex;
    min-width: 0;
    min-height: 2rem;
    align-items: center;
    justify-content: center;
    padding: 0.1rem 0.35rem;
  }
  .opponent-card-back {
    width: 1.75rem;
    height: 1.75rem;
    flex: 0 0 1.75rem;
    border-radius: 0.25rem;
    box-shadow: 0 0.12rem 0.22rem rgb(24 58 55 / 28%);
    object-fit: cover;
    transform: rotate(calc(var(--fan-offset) * 2deg));
    transform-origin: 50% 90%;
  }
  .opponent-card-back + .opponent-card-back {
    margin-left: -0.65rem;
  }
  .opponent-hand-empty {
    color: #5f6f69;
    font-size: 0.65rem;
    font-style: italic;
  }
  .herd-total {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: 0.8rem;
  }
  .herd-total img {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    object-fit: cover;
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
    .cards.market {
      grid-template-columns: repeat(3, var(--card-size));
      justify-content: space-around;
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
      grid-template-columns: minmax(3rem, auto) minmax(0, 1fr) minmax(5rem, auto);
      gap: 0.35rem;
      padding-inline: 0.35rem;
    }
    .opponent-card-back {
      width: 1.6rem;
      height: 1.6rem;
      flex-basis: 1.6rem;
    }
    .opponent-card-back + .opponent-card-back {
      margin-left: -0.65rem;
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

  @media (min-width: 601px) and (max-width: 900px) and (min-height: 600px) {
    .table {
      grid-template:
        'meta seals' auto
        'market market' auto
        'opponent opponent' auto
        'hand hand' auto
        'tokens tokens' auto /
        minmax(0, 1fr) minmax(0, 1fr);
    }
    .cards.market {
      grid-template-columns: repeat(5, var(--card-size));
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
      padding: 0.25rem 0.4rem 2.5rem;
    }
    .table {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
      gap: 0.2rem 0.4rem;
    }
    .cards.market {
      grid-template-columns: repeat(5, var(--card-size));
    }
    .cards.hand {
      gap: 0;
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
    .interaction-tray {
      min-height: 40px;
    }
    .interaction-tray button {
      min-height: 44px;
      padding: 0.2rem 0.45rem;
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
