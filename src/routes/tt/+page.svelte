<script lang="ts">
  import '@fontsource/atkinson-hyperlegible/400.css';
  import '@fontsource/atkinson-hyperlegible/700.css';
  import '@fontsource/cormorant-garamond/700.css';
  import { base } from '$app/paths';
  import { onMount, tick } from 'svelte';
  import QRCode from 'qrcode';
  import PieceArt from '$lib/PieceArt.svelte';
  import GameSummary from '$lib/GameSummary.svelte';
  import StableMarketLayout from '$lib/StableMarketLayout.svelte';
  import TabletopTokenMarket from '$lib/TabletopTokenMarket.svelte';
  import TokenChip from '$lib/TokenChip.svelte';
  import { initializeFirebase } from '$lib/firebase';
  import {
    createGameRepository,
    gameRoomExists,
    type GameRepository
  } from '$lib/game-repository';
  import type { GameActivity, GameEventType, Player } from '$lib/game-events';
  import {
    isLegalExchange,
    isLegalSale,
    reduceGame,
    type Card,
    type GameState,
    type Good,
    type PendingDraw,
    type Token
  } from '$lib/jaipur-rules';
  import { generateRoomCode } from '$lib/room-code';

  type Seat = 1 | 2;
  type SeatQr = { seat: Seat; url: string; image: string };

  const goods: Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];
  const buildHash = (import.meta.env.VITE_GIT_HASH ?? 'local').slice(0, 7);
  let status = $state('Preparing a new tabletop…');
  let statusKind = $state<'syncing' | 'synced' | 'error'>('syncing');
  let hostUid = $state('');
  let gameId = $state('');
  let repository = $state<GameRepository>();
  let lobby = $state<GameState>(reduceGame([]));
  let seatQrs = $state<SeatQr[]>([]);
  let startingRound = false;
  let repositoryReady = false;
  let knownActivityIds = new Set<string>();
  let cardFlights = $state<Array<{
    key: number;
    cardId?: string;
    image: string;
    revealImage?: string;
    concealsDestination: boolean;
    startLeft: number;
    startTop: number;
    startSize: number;
    endLeft: number;
    endTop: number;
    endSize: number;
    delay: number;
  }>>([]);
  let flightSequence = 0;
  let arrivingCardIds = $state<string[]>([]);
  let tokenFlights = $state<Array<{
    key: number;
    token: Token;
    startLeft: number;
    startTop: number;
    startSize: number;
    endLeft: number;
    endTop: number;
    endSize: number;
    delay: number;
  }>>([]);
  let busy = $state(false);
  let pendingDraw = $derived<PendingDraw | null>(lobby.pendingDraw);
  let marketFacingEnabled = $state(true);
  let marketFacingSeat = $state<Seat>(2);
  let marketRotation = $state(0);
  let marketRotationTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingMarketFacingSeat: Seat | undefined;

  const componentImage = (kind: Good | 'camel' | 'seal' | 'card-back') =>
    `${base}/components/${kind}.webp`;

  onMount(async () => {
    try {
      marketFacingEnabled = localStorage.getItem('jaipur:tabletop:turn-facing-market') !== 'off';
      const services = await initializeFirebase();
      hostUid = services.auth.currentUser?.uid ?? '';
      let attempts = 0;
      do {
        gameId = generateRoomCode();
        attempts += 1;
      } while (attempts < 8 && (await gameRoomExists(services.db, gameId)));
      if (await gameRoomExists(services.db, gameId)) {
        throw new Error('Could not reserve a tabletop. Reload to try again.');
      }

      const joinBase = `${location.origin}${base}/hand/`;
      seatQrs = await Promise.all(([1, 2] as const).map(async (seat) => {
        const url = `${joinBase}?gameId=${gameId}&seat=${seat}`;
        return {
          seat,
          url,
          image: await QRCode.toDataURL(url, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 360,
            color: { dark: '#183a37', light: '#fffaf0' }
          })
        };
      }));

      const attached = createGameRepository(services.db, gameId, hostUid);
      repository = attached;
      attached.subscribe(
        (events) => {
          const previous = lobby;
          const next = reduceGame(events);
          const newActivities = repositoryReady
            ? next.activity.filter(({ id }) => !knownActivityIds.has(id))
            : [];
          const previousActiveSeat = activeSeat(previous);
          const nextActiveSeat = activeSeat(next);
          lobby = next;
          for (const activity of next.activity) knownActivityIds.add(activity.id);
          repositoryReady = true;
          if (newActivities.length > 0) {
            void animateActivities(newActivities, previous, next);
          }
          if (nextActiveSeat && nextActiveSeat !== marketFacingSeat) {
            scheduleMarketFacing(nextActiveSeat, Boolean(previousActiveSeat && newActivities.length));
          }
          void maybeOpenFirstRound();
        },
        (error) => {
          statusKind = 'error';
          status = error.message;
        },
        (nextStatus) => {
          statusKind = nextStatus === 'synced' ? 'synced' : 'syncing';
          status = nextStatus === 'synced' ? 'Tabletop synced' : 'Synchronizing tabletop…';
        }
      );
      await attached.append('tabletop/created', { gameId });
    } catch (error) {
      statusKind = 'error';
      status = error instanceof Error ? error.message : 'Could not create tabletop';
    }
  });

  function playerForSeat(seat: Seat): Player | undefined {
    return lobby.players.find((player) => player.seat === seat);
  }

  function activeSeat(state = lobby): Seat | undefined {
    const seat = state.players.find((player) => player.uid === state.round?.activeUid)?.seat;
    return seat === 1 || seat === 2 ? seat : undefined;
  }

  function scheduleMarketFacing(seat: Seat, afterAction: boolean) {
    if (marketRotationTimer) clearTimeout(marketRotationTimer);
    if (afterAction && busy) {
      pendingMarketFacingSeat = seat;
      return;
    }
    const apply = () => {
      if (seat === marketFacingSeat) return;
      marketFacingSeat = seat;
      marketRotation += 180;
    };
    if (afterAction) marketRotationTimer = setTimeout(apply, 1050);
    else apply();
  }

  function toggleMarketFacing() {
    marketFacingEnabled = !marketFacingEnabled;
    localStorage.setItem(
      'jaipur:tabletop:turn-facing-market',
      marketFacingEnabled ? 'on' : 'off'
    );
  }

  function tokenViewSelector(uid: string): string {
    const seat = lobby.players.find((player) => player.uid === uid)?.seat;
    return `[data-token-view-seat="${seat === 1 ? 1 : 2}"]`;
  }

  function playerName(uid: string): string {
    return lobby.players.find((player) => player.uid === uid)?.displayName ?? 'Tabletop';
  }

  function label(kind: Good | 'camel'): string {
    return kind === 'camel' ? 'Camel' : kind[0].toUpperCase() + kind.slice(1);
  }

  function activityDescription(activity: GameActivity): string {
    const count = activity.cardIds?.length ?? 0;
    const kinds = activity.cardKinds?.map((kind) => label(kind as Good | 'camel')) ?? [];
    switch (activity.type) {
      case 'tabletop/created': return 'opened the tabletop';
      case 'tabletop/intent': return 'adjusted a private selection';
      case 'game/created': return 'opened the bazaar';
      case 'bot/added': return 'joined as a client-controlled computer';
      case 'player/joined': return 'joined the table';
      case 'player/ready': return activity.ready ? 'is ready' : 'is no longer ready';
      case 'round/started': return `opened round ${activity.roundNumber ?? ''}`;
      case 'cards/draw-initiated': return 'started a draw';
      case 'cards/draw-abandoned': return 'cancelled a draw';
      case 'cards/taken-one': return `took ${kinds[0] ?? 'a good'}`;
      case 'cards/taken-camels': return `took all ${count} ${count === 1 ? 'camel' : 'camels'}`;
      case 'cards/exchanged': return `traded ${count} for ${count}`;
      case 'cards/sold': return `sold ${count} ${kinds[0] ?? 'goods'}${activity.tokenCount ? ` · ${activity.tokenCount} tokens` : ''}`;
      case 'game/rematched': return 'started a rematch';
    }
  }

  async function maybeOpenFirstRound() {
    if (
      !repository ||
      startingRound ||
      lobby.mode !== 'tabletop' ||
      lobby.players.length !== 2 ||
      !lobby.players.every(({ ready }) => ready) ||
      lobby.round
    ) return;
    startingRound = true;
    try {
      await repository.append('round/started', {
        seed: new URLSearchParams(location.search).get('seed') ?? crypto.randomUUID(),
        starterUid: playerForSeat(1)?.uid,
        roundNumber: 1
      });
    } finally {
      startingRound = false;
    }
  }

  async function appendFor(
    playerUid: string,
    type: GameEventType,
    payload: Record<string, unknown>
  ) {
    if (!repository || !lobby.round || lobby.round.activeUid !== playerUid || busy) return;
    busy = true;
    try {
      await repository.append(type, {
        ...payload,
        playerUid,
        roundNumber: lobby.round.number,
        turnNumber: lobby.round.turnNumber
      });
    } finally {
      busy = false;
      if (pendingMarketFacingSeat) {
        const nextSeat = pendingMarketFacingSeat;
        pendingMarketFacingSeat = undefined;
        scheduleMarketFacing(nextSeat, true);
      }
    }
  }

  function selectedReturnIds(uid: string): string[] {
    return lobby.tabletopIntents[uid]?.selectedReturnIds ?? [];
  }

  function exchangeLoads(uid: string): Record<string, string> {
    return lobby.tabletopIntents[uid]?.exchangeLoads ?? {};
  }

  async function publishIntent(
    uid: string,
    selectedReturnIds: string[],
    loads: Record<string, string>
  ) {
    if (!lobby.round) return;
    await appendFor(uid, 'tabletop/intent', {
      selectedReturnIds,
      exchangeLoads: loads
    });
  }

  async function chooseMarket(card: Card) {
    if (!lobby.round || pendingDraw || busy) return;
    await appendFor(lobby.round.activeUid, 'cards/draw-initiated', { cardId: card.id });
  }

  async function abandonPendingDraw() {
    const draw = pendingDraw;
    if (!draw || busy) return;
    await appendFor(draw.activeUid, 'cards/draw-abandoned', {});
  }

  async function confirmPendingDraw() {
    const draw = pendingDraw;
    if (!draw) return;
    if (draw.kind === 'camels') {
      await appendFor(draw.activeUid, 'cards/taken-camels', {});
    } else {
      await appendFor(draw.activeUid, 'cards/taken-one', { cardId: draw.cardIds[0] });
    }
  }

  function isPendingDrawCard(cardId: string): boolean {
    return pendingDraw?.cardIds.includes(cardId) ?? false;
  }

  async function chooseExchangeTarget(uid: string, marketCardId: string) {
    if (!lobby.round || lobby.round.activeUid !== uid || busy || pendingDraw) return;
    const loads = exchangeLoads(uid);
    const loadedReturn = loads[marketCardId];
    if (loadedReturn) {
      const nextLoads = Object.fromEntries(
        Object.entries(loads).filter(([candidate]) => candidate !== marketCardId)
      );
      await publishIntent(uid, [...selectedReturnIds(uid), loadedReturn], nextLoads);
      return;
    }
    const returnCardId = selectedReturnIds(uid)[0];
    if (!returnCardId) return;
    startIntentFlight(uid, returnCardId, marketCardId);
    await publishIntent(
      uid,
      selectedReturnIds(uid).filter((id) => id !== returnCardId),
      { ...loads, [marketCardId]: returnCardId }
    );
  }

  async function confirmExchange(uid: string) {
    if (!lobby.round || pendingDraw) return;
    const loads = exchangeLoads(uid);
    const takenCardIds = Object.keys(loads);
    const returnedCardIds = Object.values(loads);
    if (!isLegalExchange(lobby.round, uid, takenCardIds, returnedCardIds)) return;
    await appendFor(uid, 'cards/exchanged', { takenCardIds, returnedCardIds });
  }

  function saleIds(uid: string, kind: Good): string[] {
    if (!lobby.round) return [];
    const selected = selectedReturnIds(uid);
    if (selected.length > 0) {
      return selected.every((id) => lobby.round?.hands[uid]?.find((card) => card.id === id)?.kind === kind)
        ? selected
        : [];
    }
    return lobby.round.hands[uid]?.filter((card) => card.kind === kind).map(({ id }) => id) ?? [];
  }

  function canSell(kind: Good): boolean {
    const uid = lobby.round?.activeUid;
    if (!uid || !lobby.round || busy || pendingDraw || Object.keys(exchangeLoads(uid)).length > 0) return false;
    const ids = saleIds(uid, kind);
    return isLegalSale(lobby.round, uid, kind, ids);
  }

  async function sell(kind: Good) {
    const uid = lobby.round?.activeUid;
    if (!uid) return;
    await appendFor(uid, 'cards/sold', { kind, cardIds: saleIds(uid, kind) });
  }

  function ownedTokens(uid: string): Token[] {
    if (!lobby.round) return [];
    return [
      ...(lobby.round.ownedGoodsTokens[uid] ?? []),
      ...(lobby.round.ownedBonusTokens[uid] ?? [])
    ];
  }

  async function nextRound() {
    if (!repository || !lobby.round || lobby.round.status !== 'complete' || lobby.winnerUid) return;
    await repository.append('round/started', {
      seed: crypto.randomUUID(),
      starterUid: lobby.round.loserUid,
      roundNumber: lobby.round.number + 1
    });
  }

  async function rematch() {
    if (!repository || !lobby.winnerUid) return;
    await repository.append('game/rematched', { epoch: lobby.epoch + 1 });
    await repository.append('round/started', {
      seed: crypto.randomUUID(),
      starterUid: playerForSeat(1)?.uid,
      roundNumber: 1
    });
  }

  function box(selector: string): DOMRect | undefined {
    return document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
  }

  function cardFlight(
    source: DOMRect | undefined,
    destination: DOMRect | undefined,
    image: string,
    delay = 0,
    cardId?: string,
    revealImage?: string,
    concealsDestination = false
  ) {
    if (!source || !destination) {
      if (cardId) arrivingCardIds = arrivingCardIds.filter((id) => id !== cardId);
      return;
    }
    const startSize = Math.min(source.width, source.height);
    const endSize = Math.min(destination.width, destination.height, startSize);
    const key = ++flightSequence;
    cardFlights = [...cardFlights, {
      key,
      cardId,
      image,
      revealImage,
      concealsDestination,
      startLeft: source.left + (source.width - startSize) / 2,
      startTop: source.top + (source.height - startSize) / 2,
      startSize,
      endLeft: destination.left + (destination.width - endSize) / 2,
      endTop: destination.top + (destination.height - endSize) / 2,
      endSize,
      delay
    }];
    setTimeout(() => finishCardFlight(key), 1400 + delay);
  }

  function finishCardFlight(key: number) {
    const finished = cardFlights.find((flight) => flight.key === key);
    cardFlights = cardFlights.filter((flight) => flight.key !== key);
    if (finished?.concealsDestination && finished.cardId) {
      arrivingCardIds = arrivingCardIds.filter((cardId) => cardId !== finished.cardId);
    }
  }

  function startIntentFlight(uid: string, returnCardId: string, marketCardId: string) {
    const fromHand = lobby.round?.hands[uid]?.some(({ id }) => id === returnCardId);
    const source = fromHand
      ? box(`[data-table-hand-card="${CSS.escape(returnCardId)}"]`)
      : box(`[data-table-herd="${CSS.escape(uid)}"] img:last-child`);
    const destination = box(`[data-table-exchange-target="${CSS.escape(marketCardId)}"]`);
    arrivingCardIds = [...new Set([...arrivingCardIds, returnCardId])];
    cardFlight(
      source,
      destination,
      componentImage('card-back'),
      0,
      returnCardId,
      undefined,
      true
    );
  }

  async function animateActivities(
    activities: GameActivity[],
    previous: GameState,
    next: GameState
  ) {
    const movements: Array<{
      cardId: string;
      source: DOMRect | undefined;
      destinationSelector: string;
      image: string;
      revealImage?: string;
      concealDestination: boolean;
      delay: number;
    }> = [];
    const tokenMovements: Array<{
      source: DOMRect | undefined;
      destinationSelector: string;
      token: Token;
      delay: number;
    }> = [];

    for (const activity of activities) {
      const uid = activity.actorUid;
      if (activity.type === 'cards/taken-one' || activity.type === 'cards/taken-camels') {
        activity.cardIds?.forEach((cardId, index) => {
          const kind = activity.cardKinds?.[index] as Good | 'camel' | undefined;
          movements.push({
            cardId,
            source: box(`[data-market-card-id="${CSS.escape(cardId)}"]`),
            destinationSelector: kind === 'camel'
              ? `[data-table-herd="${CSS.escape(uid)}"]`
              : `[data-table-hand="${CSS.escape(uid)}"]`,
            image: componentImage(kind ?? 'card-back'),
            concealDestination: true,
            delay: index * 70
          });
        });
      }
      if (activity.type === 'cards/exchanged') {
        activity.cardIds?.forEach((cardId, index) => movements.push({
          cardId,
          source: box(`[data-market-card-id="${CSS.escape(cardId)}"]`),
          destinationSelector: `[data-table-hand="${CSS.escape(uid)}"]`,
          image: componentImage((activity.cardKinds?.[index] as Good) ?? 'card-back'),
          concealDestination: true,
          delay: index * 70
        }));
        const previousLoads = previous.tabletopIntents[uid]?.exchangeLoads ?? {};
        activity.returnedCardIds?.forEach((cardId, index) => {
          const targetId = Object.entries(previousLoads).find(([, returnId]) => returnId === cardId)?.[0];
          movements.push({
            cardId,
            source: targetId ? box(`[data-table-exchange-target="${CSS.escape(targetId)}"]`) : undefined,
            destinationSelector: `[data-market-card-id="${CSS.escape(cardId)}"]`,
            image: componentImage('card-back'),
            revealImage: componentImage(
              (activity.returnedCardKinds?.[index] as Good | 'camel' | undefined) ?? 'card-back'
            ),
            concealDestination: true,
            delay: index * 70
          });
        });
      }
      if (activity.type === 'cards/sold') {
        const tokenView = tokenViewSelector(uid);
        activity.cardIds?.forEach((cardId, index) => movements.push({
          cardId,
          source: box(`[data-table-hand-card="${CSS.escape(cardId)}"]`),
          destinationSelector: `${tokenView} [data-token-kind="${CSS.escape(
            (activity.cardKinds?.[index] as Good | undefined) ?? 'leather'
          )}"]`,
          image: componentImage('card-back'),
          concealDestination: false,
          delay: index * 55
        }));
        const oldTokens = new Set([
          ...(previous.round?.ownedGoodsTokens[uid] ?? []),
          ...(previous.round?.ownedBonusTokens[uid] ?? [])
        ].map(({ id }) => id));
        const awards = [
          ...(next.round?.ownedGoodsTokens[uid] ?? []),
          ...(next.round?.ownedBonusTokens[uid] ?? [])
        ].filter(({ id }) => !oldTokens.has(id));
        awards.forEach((token, index) => tokenMovements.push({
          source: token.kind.startsWith('bonus-')
            ? box(`${tokenView} .bonus-row`)
            : box(`${tokenView} [data-token-kind="${CSS.escape(token.kind)}"] .rail-chip`),
          destinationSelector: `[data-table-tokens="${CSS.escape(uid)}"]`,
          token,
          delay: 180 + index * 80
        }));
      }
    }

    const previousMarketIds = new Set(previous.round?.market.map(({ id }) => id) ?? []);
    const returnedIds = new Set(activities.flatMap(({ returnedCardIds }) => returnedCardIds ?? []));
    const refills = next.round?.market.filter(
      ({ id }) => !previousMarketIds.has(id) && !returnedIds.has(id)
    ) ?? [];
    refills.forEach((card, index) => movements.push({
      cardId: card.id,
      source: box('.deck-card'),
      destinationSelector: `[data-market-card-id="${CSS.escape(card.id)}"]`,
      image: componentImage('card-back'),
      revealImage: componentImage(card.kind),
      concealDestination: true,
      delay: 120 + index * 70
    }));

    arrivingCardIds = [...new Set([
      ...arrivingCardIds,
      ...movements.filter(({ concealDestination }) => concealDestination).map(({ cardId }) => cardId)
    ])];
    await tick();
    movements.forEach(({ cardId, source, destinationSelector, image, revealImage, concealDestination, delay }) =>
      cardFlight(
        source,
        box(destinationSelector),
        image,
        delay,
        cardId,
        revealImage,
        concealDestination
      )
    );
    tokenMovements.forEach(({ source, destinationSelector, token, delay }) => {
      const destination = box(destinationSelector);
      if (!source || !destination) return;
      const startSize = Math.min(source.width, source.height, 64);
      const endSize = Math.min(destination.width, destination.height, startSize);
      const key = ++flightSequence;
      tokenFlights = [...tokenFlights, {
        key,
        token,
        startLeft: source.left + (source.width - startSize) / 2,
        startTop: source.top + (source.height - startSize) / 2,
        startSize,
        endLeft: destination.left + (destination.width - endSize) / 2,
        endTop: destination.top + (destination.height - endSize) / 2,
        endSize,
        delay
      }];
      setTimeout(() => tokenFlights = tokenFlights.filter((flight) => flight.key !== key), 1000 + delay);
    });
  }
</script>

{#snippet joinSeat(seat: Seat)}
  {@const qr = seatQrs.find((candidate) => candidate.seat === seat)}
  <section class="join-seat" data-seat={seat} aria-label={`Player ${seat} join code`}>
    <div>
      <span class="seat-kicker">Player {seat}</span>
      <h2>Scan to sit here</h2>
      <p>Choose a name on your phone. The market opens when both seats join.</p>
    </div>
    {#if qr}
      <a href={qr.url} aria-label={`Join tabletop ${gameId} as Player ${seat}`}>
        <img src={qr.image} alt={`QR code to join as Player ${seat}`} />
      </a>
    {:else}
      <span class="qr-placeholder" aria-hidden="true"></span>
    {/if}
  </section>
{/snippet}

{#snippet playerSeat(seat: Seat, player: Player)}
  {@const isActive = lobby.round?.status === 'active' && lobby.round.activeUid === player.uid}
  {@const selectedReturns = selectedReturnIds(player.uid)}
  {@const loads = exchangeLoads(player.uid)}
  <section
    class="player-seat"
    class:active={isActive}
    data-seat={seat}
    data-player-uid={player.uid}
    aria-label={`Player ${seat}, ${player.displayName}`}
  >
    <header>
      <div>
        <span class="seat-kicker">Player {seat}</span>
        <h2>{player.displayName}</h2>
      </div>
      <strong class="turn-state">{isActive ? 'Your turn' : 'Waiting'}</strong>
      <span>{lobby.seals[player.uid] ?? 0} / 2 seals</span>
    </header>
    <div class="seat-body">
      <div
        class="tabletop-hand"
        data-table-hand={player.uid}
        role="img"
        aria-label={`${player.displayName} has ${lobby.round?.hands[player.uid]?.length ?? 0} face-down cards`}
      >
        {#each lobby.round?.hands[player.uid] ?? [] as card}
          <img
            class:arriving={arrivingCardIds.includes(card.id)}
            src={componentImage('card-back')}
            alt=""
            data-table-hand-card={card.id}
            data-card-arriving={arrivingCardIds.includes(card.id) || undefined}
            draggable="false"
          />
        {/each}
      </div>
      <div
        class="tabletop-herd"
        data-table-herd={player.uid}
        role="img"
        aria-label={`${player.displayName}'s camel herd`}
      >
        <span class="herd-pile" aria-hidden="true">
          {#each (lobby.round?.herds[player.uid] ?? []).slice(-5) as camel, index}
            <img
              class:arriving={arrivingCardIds.includes(camel.id)}
              src={componentImage('camel')}
              alt=""
              data-table-herd-card={camel.id}
              data-card-arriving={arrivingCardIds.includes(camel.id) || undefined}
              style={`--pile-index:${index}`}
            />
          {/each}
        </span>
        <span>Herd</span>
      </div>
      <div class="seat-tokens" data-table-tokens={player.uid}>
        <span><strong>{ownedTokens(player.uid).length}</strong> {ownedTokens(player.uid).length === 1 ? 'token' : 'tokens'}</span>
      </div>
    </div>
    <footer aria-live="polite">
      {#if isActive && Object.keys(loads).length >= 2}
        <span>{Object.keys(loads).length} face-down returns placed.</span>
        <button
          type="button"
          disabled={!lobby.round || !isLegalExchange(lobby.round, player.uid, Object.keys(loads), Object.values(loads))}
          onclick={() => confirmExchange(player.uid)}
        >Trade {Object.keys(loads).length} for {Object.values(loads).length}</button>
      {:else if isActive && selectedReturns.length > 0}
        <span>{selectedReturns.length} selected on the private phone · tap dashed market targets or a token stack.</span>
      {:else if isActive}
        <span>Choose private cards on the phone, then use the public market and token targets here.</span>
      {:else}
        <span>Watch the market while the other trader acts.</span>
      {/if}
    </footer>
  </section>
{/snippet}

{#snippet gameLog(inverted: boolean)}
  <details class="corner-log" class:inverted aria-label={inverted ? 'Player 1 game log' : 'Player 2 game log'}>
    <summary>Game log <span>{lobby.activity.length}</span></summary>
    <ol reversed>
      {#each [...lobby.activity].reverse().slice(0, 7) as activity}
        <li><strong>{playerName(activity.actorUid)}</strong> {activityDescription(activity)}</li>
      {/each}
    </ol>
  </details>
{/snippet}

<svelte:head>
  <title>Jaipur Tabletop</title>
  <meta name="description" content="A shared two-player Jaipur tabletop." />
</svelte:head>

<main class="tabletop" data-e2e-tabletop data-e2e-layout>
  <div class="top-edge edge">
    <div class="inverted-content">
      {#if playerForSeat(1)}
        {@render playerSeat(1, playerForSeat(1)!)}
      {:else}
        {@render joinSeat(1)}
      {/if}
    </div>
  </div>

  <section
    class="shared-market"
    class:draw-pending={Boolean(pendingDraw)}
    class:turn-facing={marketFacingEnabled}
    aria-label="Shared market"
    data-market-facing-seat={marketFacingSeat}
    data-turn-facing-enabled={marketFacingEnabled}
    style={`--market-art: url("${componentImage('card-back')}")`}
  >
    <header>
      <span>Tabletop <strong>{gameId || '•••••'}</strong></span>
      {#if lobby.round}
        <span>Round {lobby.round.number}</span>
        <span class="deck">
          <img class="deck-card" src={componentImage('card-back')} alt="" />
          <span>Deck <b>{lobby.round.deck.length}</b></span>
        </span>
        <button
          type="button"
          class="orientation-toggle"
          aria-pressed={marketFacingEnabled}
          aria-label="Face market cards toward the active trader"
          onclick={toggleMarketFacing}
        >Facing {marketFacingEnabled ? 'on' : 'off'}</button>
      {:else}
        <span>Waiting for both traders</span>
      {/if}
    </header>
    {#if lobby.round?.status === 'active'}
      {#if pendingDraw}
        <div class="draw-confirmation" role="group" aria-label="Confirm draw" data-pending-draw={pendingDraw.kind}>
          <span>{pendingDraw.kind === 'camels' ? `Take all ${pendingDraw.cardIds.length} camels?` : 'Take this card?'}</span>
          <button type="button" disabled={busy} data-confirm-draw onclick={confirmPendingDraw}>Confirm</button>
          <button type="button" disabled={busy} data-abandon-draw onclick={abandonPendingDraw}>Undo</button>
        </div>
      {/if}
      <div class="market-cards">
        <StableMarketLayout>
          {#snippet slot(marketIndex)}
          {@const round = lobby.round!}
          {@const card = round.market[marketIndex]}
          {@const activeUid = round.activeUid}
          {@const loadedReturnId = exchangeLoads(activeUid)[card.id]}
          <div
            class="table-market-slot"
            data-market-slot-index={marketIndex}
            style={`--market-rotation:${marketRotation}deg`}
          >
            {#if isPendingDrawCard(card.id)}
              <button
                type="button"
                class="market-card pending-draw-card"
                disabled={busy}
                aria-label="Confirm draw"
                data-market-card-id={card.id}
                data-pending-draw-card={card.id}
                onclick={confirmPendingDraw}
              >
                <PieceArt
                  kind="card-back"
                  label={pendingDraw?.kind === 'camels' ? 'Draw Camels' : 'Draw Single'}
                />
              </button>
            {:else}
            <button
              type="button"
              class="market-card"
              class:camel={card.kind === 'camel'}
              class:arriving={arrivingCardIds.includes(card.id)}
              disabled={busy || Boolean(pendingDraw) || (card.kind !== 'camel' && (round.hands[activeUid]?.length ?? 0) >= 7)}
              aria-label={card.kind === 'camel' ? `Take all ${round.market.filter(({ kind }) => kind === 'camel').length} camels` : `Take ${label(card.kind)} ${card.id}`}
              data-market-card-id={card.id}
              data-card-arriving={arrivingCardIds.includes(card.id) || undefined}
              onclick={() => chooseMarket(card)}
            >
              <PieceArt kind={card.kind} label={label(card.kind)} detail={card.id} />
            </button>
            {/if}
            {#if card.kind !== 'camel'}
              <button
                type="button"
                class="table-exchange-target"
                class:loaded={Boolean(loadedReturnId)}
                disabled={busy || Boolean(pendingDraw) || (!loadedReturnId && selectedReturnIds(activeUid).length === 0)}
                aria-pressed={Boolean(loadedReturnId)}
                aria-label={loadedReturnId
                  ? `Return the face-down card below ${label(card.kind)} to the phone selection`
                  : `Place a selected private card face-down below ${label(card.kind)}`}
                data-table-exchange-target={card.id}
                onclick={() => chooseExchangeTarget(activeUid, card.id)}
              >
                {#if loadedReturnId}
                  <img
                    class:arriving={arrivingCardIds.includes(loadedReturnId)}
                    src={componentImage('card-back')}
                    alt=""
                    data-loaded-return={loadedReturnId}
                    data-card-arriving={arrivingCardIds.includes(loadedReturnId) || undefined}
                  />
                {:else}
                  <span aria-hidden="true">＋</span>
                  <small>Return</small>
                {/if}
              </button>
            {:else}
              <button
                type="button"
                class="table-exchange-target target-placeholder"
                disabled
                aria-hidden="true"
                tabindex="-1"
              ></button>
            {/if}
          </div>
          {/snippet}
        </StableMarketLayout>
      </div>
    {:else if lobby.round?.status === 'complete'}
      <GameSummary
        {lobby}
        componentImage={componentImage}
        onNextRound={lobby.winnerUid ? undefined : nextRound}
        onRematch={lobby.winnerUid ? rematch : undefined}
      />
    {:else}
      <div class="tabletop-mark">
        <img src={componentImage('card-back')} alt="" />
        <strong>{gameId || 'Creating…'}</strong>
        <span>Two seats · one shared market</span>
      </div>
    {/if}
  </section>

  <div class="bottom-edge edge">
    {#if playerForSeat(2)}
      {@render playerSeat(2, playerForSeat(2)!)}
    {:else}
      {@render joinSeat(2)}
    {/if}
  </div>

  <div class="token-views" aria-label="Mirrored token supplies">
    <TabletopTokenMarket
      seat={1}
      round={lobby.round}
      {goods}
      inverted
      interactive={activeSeat() === 1}
      {label}
      {canSell}
      onSell={sell}
    />
    <TabletopTokenMarket
      seat={2}
      round={lobby.round}
      {goods}
      interactive={activeSeat() === 2}
      {label}
      {canSell}
      onSell={sell}
    />
  </div>

  <div class="top-log">{@render gameLog(true)}</div>
  <div class="bottom-log">{@render gameLog(false)}</div>
  <p class="table-status" data-status={statusKind}>{status} · Build {buildHash}</p>
  {#each cardFlights as flight (flight.key)}
    <span
      class="table-card-flight"
      class:flips={Boolean(flight.revealImage)}
      aria-hidden="true"
      style={`--start-left:${flight.startLeft}px;--start-top:${flight.startTop}px;--start-size:${flight.startSize}px;--end-left:${flight.endLeft}px;--end-top:${flight.endTop}px;--end-size:${flight.endSize}px;--flight-delay:${flight.delay}ms`}
      onanimationend={(event) => {
        if (event.currentTarget === event.target) finishCardFlight(flight.key);
      }}
    >
      <span class="table-card-flight-inner">
        <img class="table-card-flight-back" src={flight.image} alt="" />
        {#if flight.revealImage}
          <img class="table-card-flight-front" src={flight.revealImage} alt="" />
        {/if}
      </span>
    </span>
  {/each}
  {#each tokenFlights as flight (flight.key)}
    <span
      class="table-token-flight"
      aria-hidden="true"
      style={`--start-left:${flight.startLeft}px;--start-top:${flight.startTop}px;--start-size:${flight.startSize}px;--end-left:${flight.endLeft}px;--end-top:${flight.endTop}px;--end-size:${flight.endSize}px;--flight-delay:${flight.delay}ms`}
    ><TokenChip token={flight.token} hidden={flight.token.kind.startsWith('bonus-')} /></span>
  {/each}
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body) {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
  }
  :global(body) {
    background: #183a37;
    color: #183a37;
    font-family: 'Atkinson Hyperlegible', sans-serif;
  }
  .arriving { visibility: hidden !important; }
  button, summary { font: inherit; }
  button:focus-visible, summary:focus-visible { outline: 3px solid #d38b21; outline-offset: 2px; }
  .tabletop {
    --rail-width: clamp(8.5rem, 14vw, 12rem);
    --edge-size: minmax(0, 28vh);
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--rail-width);
    grid-template-rows: var(--edge-size) minmax(0, 1fr) var(--edge-size);
    gap: clamp(0.25rem, 0.7vmin, 0.55rem);
    padding: clamp(0.3rem, 0.8vmin, 0.65rem);
    overflow: hidden;
    background:
      radial-gradient(circle at center, rgb(255 250 238 / 94%), rgb(233 220 193 / 98%)),
      #e9dcc1;
  }
  .edge, .shared-market {
    min-width: 0;
    min-height: 0;
    border: 1px solid #9e8a68;
    border-radius: clamp(0.55rem, 1.3vmin, 1rem);
    background: #fffaf0;
    box-shadow: 0 0.25rem 0.8rem rgb(10 32 30 / 16%);
  }
  .top-edge { grid-column: 1; grid-row: 1; }
  .bottom-edge { grid-column: 1; grid-row: 3; }
  .inverted-content { width: 100%; height: 100%; transform: rotate(180deg); }
  .join-seat {
    display: grid;
    width: 100%;
    height: 100%;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    padding: clamp(0.7rem, 1.8vmin, 1.4rem) clamp(5rem, 11vw, 10rem);
  }
  .join-seat h2, .player-seat h2 {
    margin: 0;
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(1.2rem, 2.8vmin, 2rem);
  }
  .join-seat p { max-width: 34rem; margin: 0.25rem 0 0; font-size: clamp(0.7rem, 1.6vmin, 1rem); }
  .join-seat a { display: block; height: min(22vh, 11rem); aspect-ratio: 1; }
  .join-seat img { width: 100%; height: 100%; border: 2px solid #315f58; border-radius: 0.65rem; }
  .qr-placeholder { width: min(22vh, 11rem); aspect-ratio: 1; border-radius: 0.65rem; background: #e9dcc1; }
  .seat-kicker { color: #a6442d; font-size: clamp(0.62rem, 1.2vmin, 0.78rem); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .player-seat {
    display: grid;
    width: 100%;
    height: 100%;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 0.25rem;
    padding: clamp(0.35rem, 0.8vmin, 0.65rem) clamp(4.6rem, 9vw, 8rem);
    border: 3px solid transparent;
    border-radius: inherit;
    transition: border-color 180ms ease, background 180ms ease;
  }
  .player-seat.active { border-color: #d38b21; background: #fff4d6; }
  .player-seat > header {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: clamp(0.55rem, 1.5vw, 1.4rem);
  }
  .player-seat > header > div { display: flex; align-items: baseline; gap: 0.45rem; }
  .turn-state { padding: 0.2rem 0.55rem; border-radius: 99rem; background: #e9dcc1; }
  .active .turn-state { background: #a6442d; color: white; }
  .seat-body { display: grid; min-height: 0; grid-template-columns: minmax(0, 1fr) clamp(5rem, 10vw, 8rem) clamp(8rem, 14vw, 13rem); align-items: center; gap: 0.5rem; }
  .tabletop-hand { display: flex; min-width: 0; height: 100%; align-items: center; }
  .tabletop-hand > img, .market-card {
    position: relative;
    width: clamp(3.7rem, 9.8vh, 6rem);
    height: clamp(3.7rem, 9.8vh, 6rem);
    flex: 0 0 auto;
    padding: 0.18rem;
    overflow: hidden;
    border: 2px solid #315f58;
    border-radius: 0.55rem;
    background: #183a37;
    color: white;
    object-fit: cover;
  }
  .tabletop-hand > img + img { margin-left: clamp(-1.1rem, -1.9vw, -0.35rem); }
  .market-card :global(.piece-image) { width: 100%; height: 100%; object-fit: cover; }
  .tabletop-herd {
    display: grid;
    min-width: 44px;
    min-height: 44px;
    grid-template-columns: 1fr;
    place-items: center;
    padding: 0.15rem;
    border-radius: 0.55rem;
  }
  .herd-pile { position: relative; width: 6.8rem; height: clamp(3.7rem, 9.8vh, 6rem); }
  .herd-pile img { position: absolute; left: calc(var(--pile-index) * 0.55rem); width: clamp(3.7rem, 9.8vh, 6rem); height: clamp(3.7rem, 9.8vh, 6rem); border: 2px solid #a6442d; border-radius: 0.55rem; object-fit: cover; transform: rotate(calc((var(--pile-index) - 2) * 2deg)); }
  .seat-tokens { display: grid; min-width: 0; min-height: 2.5rem; place-items: center; border: 1px solid #b7aa8d; border-radius: 99rem; background: #f5ead3; font-size: clamp(0.65rem, 1.3vmin, 0.82rem); }
  .player-seat > footer { display: flex; min-height: 2rem; align-items: center; justify-content: center; gap: 0.45rem; font-size: clamp(0.62rem, 1.2vmin, 0.78rem); text-align: center; }
  .player-seat footer button { min-height: 36px; padding: 0.3rem 0.65rem; border: 0; border-radius: 99rem; background: #a6442d; color: white; font-weight: 700; }
  .shared-market {
    --table-market-card-size: clamp(4.4rem, 15vh, 8.5rem);
    --table-target-height: clamp(2.7rem, 6.5vh, 4rem);
    --stable-market-gap: clamp(0.35rem, 1.6vw, 1.4rem);
    position: relative;
    grid-column: 1;
    grid-row: 2;
    display: grid;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    padding: clamp(0.4rem, 1vmin, 0.75rem) clamp(4.8rem, 9vw, 8rem);
    background-image: linear-gradient(rgb(255 250 238 / 84%), rgb(255 250 238 / 84%)), var(--market-art);
    background-position: center;
    background-size: auto, min(40vh, 28rem);
  }
  .shared-market > header { display: flex; align-items: center; justify-content: center; gap: clamp(1rem, 5vw, 4rem); font-size: clamp(0.7rem, 1.5vmin, 0.95rem); }
  .shared-market > header strong { letter-spacing: 0.14em; }
  .orientation-toggle {
    min-width: 44px;
    min-height: 36px;
    padding: 0.25rem 0.55rem;
    border: 1px solid #8e826b;
    border-radius: 99rem;
    background: #fffaf0;
    color: #315f58;
    font-weight: 700;
  }
  .orientation-toggle[aria-pressed='true'] { border-color: #a6442d; background: #fff4d6; color: #a6442d; }
  .deck { display: flex; align-items: center; gap: 0.4rem; }
  .deck > span { display: grid; text-align: left; }
  .deck-card {
    width: clamp(4.4rem, 15vh, 8.5rem);
    height: clamp(4.4rem, 15vh, 8.5rem);
    border: 2px solid #315f58;
    border-radius: 0.55rem;
    box-shadow: 0 0.25rem 0.5rem rgb(10 32 30 / 22%);
    object-fit: cover;
  }
  .market-cards {
    display: grid;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    place-items: center;
    gap: var(--stable-market-gap);
  }
  .table-market-slot {
    display: grid;
    min-width: 0;
    grid-template-rows: var(--table-market-card-size) var(--table-target-height);
    place-items: center;
    gap: clamp(0.2rem, 0.7vh, 0.4rem);
  }
  .market-card {
    width: var(--table-market-card-size);
    height: var(--table-market-card-size);
    transform: rotate(0deg);
    transition: transform 420ms ease-in-out;
  }
  .turn-facing .market-card { transform: rotate(var(--market-rotation)); }
  .draw-confirmation {
    position: absolute;
    z-index: 12;
    top: clamp(0.35rem, 1vmin, 0.7rem);
    left: 50%;
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 0.45rem;
    padding: 0.3rem 0.45rem 0.3rem 0.65rem;
    border: 2px solid #d38b21;
    border-radius: 99rem;
    background: #fff4d6;
    box-shadow: 0 0.3rem 0.7rem rgb(10 32 30 / 24%);
    font-weight: 700;
    transform: translateX(-50%);
  }
  .draw-confirmation button { min-height: 36px; border-radius: 99rem; }
  .draw-pending .table-exchange-target { visibility: hidden; }
  .pending-draw-card :global(.piece-image) { animation: pending-draw-turn 220ms ease-out both; transform-origin: center; }
  @keyframes pending-draw-turn {
    from { opacity: 0.45; transform: rotateY(80deg); }
    to { opacity: 1; transform: rotateY(0); }
  }
  .market-card.camel { border-color: #a6442d; }
  .table-exchange-target { display: grid; width: var(--table-market-card-size); height: var(--table-target-height); min-height: var(--table-target-height); grid-template-columns: auto 1fr; place-items: center; gap: 0.2rem; padding: 0.2rem; border: 2px dashed #315f58; border-radius: 0.6rem; background: rgb(255 250 240 / 72%); color: #315f58; font-weight: 700; }
  .target-placeholder { visibility: hidden; }
  .table-exchange-target:disabled { opacity: 0.48; }
  .table-exchange-target.loaded { border-style: solid; border-color: #d38b21; background: #fff4d6; opacity: 1; }
  .table-exchange-target > span { font-size: 1.2rem; }
  .table-exchange-target small { font-size: clamp(0.55rem, 1.1vmin, 0.72rem); }
  .table-exchange-target img { width: clamp(2.25rem, 5.7vh, 3.4rem); height: clamp(2.25rem, 5.7vh, 3.4rem); border: 1px solid #315f58; border-radius: 0.35rem; object-fit: cover; }
  .tabletop-mark { display: grid; place-content: center; place-items: center; gap: 0.25rem; }
  .tabletop-mark img { width: clamp(3rem, 9vh, 5rem); border-radius: 0.55rem; }
  .tabletop-mark strong { font-size: clamp(1.4rem, 4vmin, 2.5rem); letter-spacing: 0.2em; }
  .token-views {
    grid-column: 2;
    grid-row: 1 / 4;
    display: grid;
    min-height: 0;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: clamp(0.25rem, 0.7vmin, 0.55rem);
  }
  .top-log, .bottom-log { position: fixed; z-index: 20; }
  .top-log { top: 0.75rem; left: 0.75rem; transform: rotate(180deg); }
  .bottom-log { right: 0.75rem; bottom: 0.75rem; }
  .corner-log { position: relative; }
  .corner-log summary { display: flex; min-width: 7rem; min-height: 44px; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.35rem 0.55rem; border: 1px solid #8e826b; border-radius: 99rem; background: #fffaf0; box-shadow: 0 0.2rem 0.5rem rgb(10 32 30 / 24%); cursor: pointer; font-size: 0.75rem; font-weight: 700; list-style: none; }
  .corner-log summary::-webkit-details-marker { display: none; }
  .corner-log summary span { display: grid; min-width: 1.4rem; min-height: 1.4rem; place-items: center; border-radius: 99rem; background: #315f58; color: white; }
  .corner-log ol { position: absolute; right: 0; bottom: calc(100% + 0.35rem); width: min(25rem, 42vw); margin: 0; padding: 0.55rem; border: 1px solid #8e826b; border-radius: 0.7rem; background: #fffaf0; box-shadow: 0 0.7rem 1.2rem rgb(10 32 30 / 24%); list-style: none; }
  .corner-log.inverted ol { top: calc(100% + 0.35rem); right: auto; bottom: auto; left: 0; }
  .corner-log li { padding: 0.22rem 0.3rem; border-radius: 0.25rem; background: #f2e8d3; font-size: 0.68rem; }
  .corner-log li + li { margin-top: 0.18rem; }
  .table-card-flight, .table-token-flight { position: fixed; z-index: 40; top: var(--start-top); left: var(--start-left); width: var(--start-size); height: var(--start-size); pointer-events: none; animation: table-flight 860ms cubic-bezier(0.2, 0.75, 0.22, 1) var(--flight-delay) both; }
  .table-card-flight { perspective: 900px; }
  .table-card-flight-inner { position: absolute; inset: 0; display: block; transform-style: preserve-3d; }
  .table-card-flight.flips .table-card-flight-inner { animation: table-card-flip 860ms ease-in-out var(--flight-delay) both; }
  .table-card-flight img { position: absolute; width: 100%; height: 100%; inset: 0; backface-visibility: hidden; border: 2px solid #315f58; border-radius: 0.55rem; box-shadow: 0 0.7rem 1rem rgb(0 0 0 / 28%); object-fit: cover; }
  .table-card-flight-front { transform: rotateY(180deg); }
  .table-token-flight :global(.token-chip) { width: 100%; height: 100%; filter: drop-shadow(0 0.5rem 0.5rem rgb(0 0 0 / 28%)); }
  @keyframes table-flight {
    0% { opacity: 0.96; transform: translate(0, 0) rotate(-3deg); }
    68% { width: var(--end-size); height: var(--end-size); opacity: 1; transform: translate(calc(var(--end-left) - var(--start-left)), calc(var(--end-top) - var(--start-top))) rotate(-2deg) scale(1.05); }
    84% { width: var(--end-size); height: var(--end-size); opacity: 1; transform: translate(calc(var(--end-left) - var(--start-left)), calc(var(--end-top) - var(--start-top))) rotate(1deg) scale(0.97); }
    100% { width: var(--end-size); height: var(--end-size); opacity: 1; transform: translate(calc(var(--end-left) - var(--start-left)), calc(var(--end-top) - var(--start-top))) rotate(0) scale(1); }
  }
  @keyframes table-card-flip {
    0%, 52% { transform: rotateY(0deg); }
    78%, 100% { transform: rotateY(180deg); }
  }
  .table-status { position: fixed; z-index: 15; right: calc(var(--rail-width) + 1rem); bottom: 0.4rem; margin: 0; color: #315f58; font-size: 0.65rem; font-weight: 700; }
  .table-status[data-status='error'] { color: #a3212a; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  }
  @media (max-aspect-ratio: 1/1) {
    .tabletop { --rail-width: clamp(6.5rem, 19vw, 8rem); }
    .join-seat, .player-seat { padding-right: 3.4rem; padding-left: 3.4rem; }
    .seat-body { grid-template-columns: minmax(0, 1fr) 5rem; }
    .seat-tokens { display: none; }
    .shared-market { padding-right: 3.4rem; padding-left: 3.4rem; }
  }
</style>
