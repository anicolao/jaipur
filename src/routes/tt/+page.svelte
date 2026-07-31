<script lang="ts">
  import '@fontsource/atkinson-hyperlegible/400.css';
  import '@fontsource/atkinson-hyperlegible/700.css';
  import '@fontsource/cormorant-garamond/700.css';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import PieceArt from '$lib/PieceArt.svelte';
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
  let notice = $state<{ key: number; text: string } | null>(null);
  let noticeKey = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let selectedHands = $state<Record<string, string[]>>({});
  let selectedCamels = $state<Record<string, string | null>>({});
  let selectedMarket = $state<Record<string, string[]>>({});
  let busy = $state(false);

  const componentImage = (kind: Good | 'camel' | 'seal' | 'card-back') =>
    `${base}/components/${kind}.webp`;

  onMount(async () => {
    try {
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

      const joinBase = `${location.origin}${base}/`;
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
          const next = reduceGame(events);
          const newActivities = repositoryReady
            ? next.activity.filter(({ id }) => !knownActivityIds.has(id))
            : [];
          lobby = next;
          for (const activity of next.activity) knownActivityIds.add(activity.id);
          repositoryReady = true;
          if (newActivities.length > 0) {
            resetSelections();
            showNotice(newActivities.at(-1)!);
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
      case 'game/created': return 'opened the bazaar';
      case 'player/joined': return 'joined the table';
      case 'player/ready': return activity.ready ? 'is ready' : 'is no longer ready';
      case 'round/started': return `opened round ${activity.roundNumber ?? ''}`;
      case 'cards/taken-one': return `took ${kinds[0] ?? 'a good'}`;
      case 'cards/taken-camels': return `took all ${count} ${count === 1 ? 'camel' : 'camels'}`;
      case 'cards/exchanged': return `traded ${count} for ${count}`;
      case 'cards/sold': return `sold ${count} ${kinds[0] ?? 'goods'}${activity.tokenCount ? ` · ${activity.tokenCount} tokens` : ''}`;
      case 'game/rematched': return 'started a rematch';
    }
  }

  function activityText(activity: GameActivity): string {
    let text = `${playerName(activity.actorUid)} ${activityDescription(activity)}`;
    if (activity.roundWinnerUid) text += ` · ${playerName(activity.roundWinnerUid)} won the round`;
    if (activity.gameWinnerUid) text += ' and the match';
    return text;
  }

  function showNotice(activity: GameActivity) {
    if (noticeTimer) clearTimeout(noticeTimer);
    notice = { key: ++noticeKey, text: activityText(activity) };
    noticeTimer = setTimeout(() => notice = null, 2800);
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
    }
  }

  function handSelection(uid: string): string[] {
    return selectedHands[uid] ?? [];
  }

  function marketSelection(uid: string): string[] {
    return selectedMarket[uid] ?? [];
  }

  function selectedCamel(uid: string): string | null {
    return selectedCamels[uid] ?? null;
  }

  function returnedIds(uid: string): string[] {
    return [...handSelection(uid), ...(selectedCamel(uid) ? [selectedCamel(uid)!] : [])];
  }

  function resetSelections() {
    selectedHands = {};
    selectedCamels = {};
    selectedMarket = {};
  }

  function toggleHand(uid: string, cardId: string) {
    if (lobby.round?.activeUid !== uid) return;
    const current = handSelection(uid);
    selectedHands = {
      ...selectedHands,
      [uid]: current.includes(cardId)
        ? current.filter((id) => id !== cardId)
        : [...current, cardId]
    };
    selectedMarket = { ...selectedMarket, [uid]: [] };
  }

  function toggleCamel(uid: string) {
    if (lobby.round?.activeUid !== uid) return;
    const camelId = lobby.round.herds[uid]?.at(-1)?.id;
    if (!camelId) return;
    selectedCamels = {
      ...selectedCamels,
      [uid]: selectedCamel(uid) === camelId ? null : camelId
    };
    selectedMarket = { ...selectedMarket, [uid]: [] };
  }

  async function chooseMarket(card: Card) {
    const uid = lobby.round?.activeUid;
    if (!uid) return;
    if (card.kind === 'camel') {
      await appendFor(uid, 'cards/taken-camels', {});
      return;
    }
    const returns = returnedIds(uid);
    if (returns.length >= 2) {
      const current = marketSelection(uid);
      selectedMarket = {
        ...selectedMarket,
        [uid]: current.includes(card.id)
          ? current.filter((id) => id !== card.id)
          : current.length < returns.length
            ? [...current, card.id]
            : current
      };
      return;
    }
    await appendFor(uid, 'cards/taken-one', { cardId: card.id });
  }

  async function confirmExchange(uid: string) {
    if (!lobby.round) return;
    const takenCardIds = marketSelection(uid);
    const returnedCardIds = returnedIds(uid);
    if (!isLegalExchange(lobby.round, uid, takenCardIds, returnedCardIds)) return;
    await appendFor(uid, 'cards/exchanged', { takenCardIds, returnedCardIds });
  }

  function saleIds(uid: string, kind: Good): string[] {
    if (!lobby.round) return [];
    const selected = handSelection(uid);
    if (selected.length > 0) {
      return selected.every((id) => lobby.round?.hands[uid]?.find((card) => card.id === id)?.kind === kind)
        ? selected
        : [];
    }
    return lobby.round.hands[uid]?.filter((card) => card.kind === kind).map(({ id }) => id) ?? [];
  }

  function canSell(kind: Good): boolean {
    const uid = lobby.round?.activeUid;
    if (!uid || !lobby.round) return false;
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

  function tokenTotal(uid: string): number {
    return ownedTokens(uid).reduce((total, token) => total + token.value, 0);
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
  {@const selectedReturns = returnedIds(player.uid)}
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
      <div class="tabletop-hand" data-hand-destination={player.uid}>
        {#each lobby.round?.hands[player.uid] ?? [] as card}
          <button
            type="button"
            class:selected={handSelection(player.uid).includes(card.id)}
            disabled={!isActive || busy}
            aria-pressed={handSelection(player.uid).includes(card.id)}
            aria-label={`${handSelection(player.uid).includes(card.id) ? 'Deselect' : 'Select'} ${label(card.kind)} ${card.id}`}
            data-card-id={card.id}
            onclick={() => toggleHand(player.uid, card.id)}
          >
            <PieceArt kind={card.kind} label={label(card.kind)} detail={card.id} />
          </button>
        {/each}
      </div>
      <button
        type="button"
        class="tabletop-herd"
        class:selected={Boolean(selectedCamel(player.uid))}
        disabled={!isActive || (lobby.round?.herds[player.uid]?.length ?? 0) === 0}
        aria-pressed={Boolean(selectedCamel(player.uid))}
        aria-label={`Select one of ${lobby.round?.herds[player.uid]?.length ?? 0} camels for exchange`}
        onclick={() => toggleCamel(player.uid)}
      >
        <span class="herd-pile" aria-hidden="true">
          {#each (lobby.round?.herds[player.uid] ?? []).slice(-5) as camel, index}
            <img src={componentImage('camel')} alt="" style={`--pile-index:${index}`} />
          {/each}
        </span>
        <span>Herd <strong>{lobby.round?.herds[player.uid]?.length ?? 0}</strong></span>
      </button>
      <div class="seat-tokens" data-token-destination={player.uid}>
        <span class="earned-chip-row" aria-hidden="true">
          {#each ownedTokens(player.uid).slice(-6) as token}
            <TokenChip {token} />
          {/each}
        </span>
        <span><strong>{ownedTokens(player.uid).length}</strong> tokens · {tokenTotal(player.uid)} points</span>
      </div>
    </div>
    <footer aria-live="polite">
      {#if isActive && selectedReturns.length >= 2}
        <span>Select {selectedReturns.length} market goods ({marketSelection(player.uid).length} selected).</span>
        <button
          type="button"
          disabled={!lobby.round || !isLegalExchange(lobby.round, player.uid, marketSelection(player.uid), selectedReturns)}
          onclick={() => confirmExchange(player.uid)}
        >Trade {marketSelection(player.uid).length} for {selectedReturns.length}</button>
        <button class="secondary" type="button" onclick={resetSelections}>Clear</button>
      {:else if isActive && handSelection(player.uid).length > 0}
        <span>{handSelection(player.uid).length} selected · tap a matching token stack to sell.</span>
        <button class="secondary" type="button" onclick={resetSelections}>Clear</button>
      {:else if isActive}
        <span>Tap a market card to take it, or select cards here to sell or trade.</span>
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

<main class="tabletop" data-e2e-tabletop>
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
    aria-label="Shared market"
    style={`--market-art: url("${componentImage('card-back')}")`}
  >
    <header>
      <span>Tabletop <strong>{gameId || '•••••'}</strong></span>
      {#if lobby.round}
        <span>Round {lobby.round.number}</span>
        <span class="deck"><img src={componentImage('card-back')} alt="" /> {lobby.round.deck.length}</span>
      {:else}
        <span>Waiting for both traders</span>
      {/if}
    </header>
    {#if lobby.round?.status === 'active'}
      <div class="market-cards">
        {#each lobby.round.market as card}
          <button
            type="button"
            class:camel={card.kind === 'camel'}
            class:selected={marketSelection(lobby.round.activeUid).includes(card.id)}
            disabled={busy || (card.kind !== 'camel' && (lobby.round.hands[lobby.round.activeUid]?.length ?? 0) >= 7 && returnedIds(lobby.round.activeUid).length < 2)}
            aria-pressed={marketSelection(lobby.round.activeUid).includes(card.id)}
            aria-label={card.kind === 'camel' ? `Take all ${lobby.round.market.filter(({ kind }) => kind === 'camel').length} camels` : `Choose ${label(card.kind)} ${card.id}`}
            data-card-id={card.id}
            onclick={() => chooseMarket(card)}
          >
            <PieceArt kind={card.kind} label={label(card.kind)} detail={card.id} />
          </button>
        {/each}
      </div>
    {:else if lobby.round?.status === 'complete'}
      <section class="round-result">
        <img src={componentImage('seal')} alt="" />
        <div>
          <span>{lobby.winnerUid ? 'Match complete' : `Round ${lobby.round.number} complete`}</span>
          <h2>{playerName(lobby.winnerUid ?? lobby.round.winnerUid ?? '')} wins</h2>
        </div>
        <button type="button" onclick={lobby.winnerUid ? rematch : nextRound}>
          {lobby.winnerUid ? 'Start rematch' : `Open round ${lobby.round.number + 1}`}
        </button>
      </section>
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

  <aside class="token-rail" aria-label="Token supplies">
    <h2>Tokens</h2>
    {#if lobby.round}
      <div class="bonus-row" aria-label="Bonus supplies">
        {#each ['3', '4', '5'] as size}
          <span>{size}+ <strong>{lobby.round.bonusTokens[size as '3' | '4' | '5'].length}</strong></span>
        {/each}
      </div>
      {#each goods as kind}
        <button
          type="button"
          class={`rail-token ${kind}`}
          disabled={!canSell(kind)}
          aria-label={`Sell to ${label(kind)} token stack, ${lobby.round.goodsTokens[kind].length} left`}
          data-token-kind={kind}
          onclick={() => sell(kind)}
        >
          <span class="rail-chip">
            {#if lobby.round.goodsTokens[kind][0]}
              <TokenChip token={lobby.round.goodsTokens[kind][0]} />
            {:else}
              <span>—</span>
            {/if}
          </span>
          <span>{label(kind)} <strong>{lobby.round.goodsTokens[kind].length}</strong></span>
        </button>
      {/each}
    {:else}
      <span class="empty-rail">Supplies appear when play begins.</span>
    {/if}
  </aside>

  <div class="top-log">{@render gameLog(true)}</div>
  <div class="bottom-log">{@render gameLog(false)}</div>
  {#if notice}
    <div class="shared-notice" data-notice-key={notice.key} aria-live="polite">
      <span class="notice-top">{notice.text}</span>
      <span>{notice.text}</span>
    </div>
  {/if}
  <p class="table-status" data-status={statusKind}>{status} · Build {buildHash}</p>
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
  .edge, .shared-market, .token-rail {
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
  .join-seat h2, .player-seat h2, .token-rail h2, .round-result h2 {
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
  .tabletop-hand button, .market-cards button {
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
  }
  .tabletop-hand button + button { margin-left: clamp(-1.1rem, -1.9vw, -0.35rem); }
  .tabletop-hand button.selected, .market-cards button.selected { z-index: 3; border-color: #d38b21; box-shadow: 0 0 0 3px #d38b21; transform: translateY(-0.25rem); }
  .tabletop-hand button:disabled { opacity: 1; }
  .tabletop-hand :global(.piece-image), .market-cards :global(.piece-image) { width: 100%; height: 100%; object-fit: cover; }
  .tabletop-herd {
    display: grid;
    min-width: 44px;
    min-height: 44px;
    grid-template-columns: 1fr;
    place-items: center;
    padding: 0.15rem;
    border: 2px solid transparent;
    border-radius: 0.55rem;
    background: transparent;
    color: inherit;
  }
  .tabletop-herd.selected { border-color: #d38b21; }
  .tabletop-herd:disabled { opacity: 1; }
  .herd-pile { position: relative; width: 4.8rem; height: 2.8rem; }
  .herd-pile img { position: absolute; left: calc(var(--pile-index) * 0.55rem); width: 2.8rem; height: 2.8rem; border: 1px solid #315f58; border-radius: 0.35rem; object-fit: cover; transform: rotate(calc((var(--pile-index) - 2) * 2deg)); }
  .seat-tokens { display: grid; min-width: 0; gap: 0.15rem; font-size: clamp(0.65rem, 1.3vmin, 0.82rem); }
  .earned-chip-row { display: flex; height: 2.5rem; align-items: center; }
  .earned-chip-row :global(.token-chip) { width: 2.4rem; height: 2.4rem; margin-right: -0.85rem; }
  .player-seat > footer { display: flex; min-height: 2rem; align-items: center; justify-content: center; gap: 0.45rem; font-size: clamp(0.62rem, 1.2vmin, 0.78rem); text-align: center; }
  .player-seat footer button, .round-result button { min-height: 36px; padding: 0.3rem 0.65rem; border: 0; border-radius: 99rem; background: #a6442d; color: white; font-weight: 700; }
  .player-seat footer button.secondary { border: 1px solid #8e826b; background: #fffaf0; color: #183a37; }
  .shared-market {
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
  .deck { display: flex; align-items: center; gap: 0.3rem; }
  .deck img { width: 1.5rem; height: 1.9rem; border-radius: 0.2rem; object-fit: cover; }
  .market-cards { display: flex; min-height: 0; align-items: center; justify-content: center; gap: clamp(0.35rem, 1.6vw, 1.4rem); }
  .market-cards button { width: clamp(4.4rem, 15vh, 8.5rem); height: clamp(4.4rem, 15vh, 8.5rem); }
  .market-cards button.camel { border-color: #a6442d; }
  .round-result { display: flex; align-items: center; justify-content: center; gap: 1rem; text-align: center; }
  .round-result > img { width: clamp(3.5rem, 10vh, 6rem); }
  .tabletop-mark { display: grid; place-content: center; place-items: center; gap: 0.25rem; }
  .tabletop-mark img { width: clamp(3rem, 9vh, 5rem); border-radius: 0.55rem; }
  .tabletop-mark strong { font-size: clamp(1.4rem, 4vmin, 2.5rem); letter-spacing: 0.2em; }
  .token-rail {
    grid-column: 2;
    grid-row: 1 / 4;
    display: grid;
    min-height: 0;
    grid-template-rows: auto auto repeat(6, minmax(0, 1fr));
    gap: clamp(0.2rem, 0.6vmin, 0.45rem);
    padding: clamp(0.4rem, 1vmin, 0.75rem) 0.45rem clamp(4.5rem, 10vh, 6rem);
  }
  .token-rail h2 { text-align: center; }
  .bonus-row { display: flex; justify-content: center; gap: 0.25rem; font-size: clamp(0.55rem, 1.1vmin, 0.72rem); }
  .bonus-row span { padding: 0.18rem 0.3rem; border-radius: 99rem; background: #e9dcc1; }
  .rail-token { display: grid; min-width: 0; min-height: 44px; grid-template-columns: clamp(2.6rem, 6.3vmin, 4rem) minmax(0, 1fr); align-items: center; gap: 0.25rem; padding: 0.15rem; border: 1px solid #b7aa8d; border-radius: 0.6rem; background: #f5ead3; color: #183a37; font-size: clamp(0.56rem, 1.1vmin, 0.76rem); text-align: left; }
  .rail-token:disabled { opacity: 0.72; }
  .rail-chip { display: grid; place-items: center; }
  .rail-chip :global(.token-chip) { width: clamp(2.5rem, 6vmin, 3.8rem); height: clamp(2.5rem, 6vmin, 3.8rem); }
  .empty-rail { align-self: center; font-size: 0.8rem; text-align: center; }
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
  .shared-notice { position: fixed; z-index: 30; top: 50%; left: 50%; display: grid; gap: 0.35rem; pointer-events: none; transform: translate(-50%, -50%); }
  .shared-notice span { width: max-content; max-width: 70vw; padding: 0.4rem 0.7rem; border: 1px solid #8e826b; border-radius: 99rem; background: #fffaf0; box-shadow: 0 0.4rem 0.8rem rgb(10 32 30 / 30%); font-size: clamp(0.7rem, 1.5vmin, 0.95rem); font-weight: 700; animation: shared-action 2800ms ease both; }
  .shared-notice .notice-top { transform: rotate(180deg); animation-name: shared-action-top; }
  @keyframes shared-action { 0% { opacity: 0; transform: translateY(0.6rem); } 12%, 82% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-0.3rem); } }
  @keyframes shared-action-top { 0% { opacity: 0; transform: rotate(180deg) translateY(0.6rem); } 12%, 82% { opacity: 1; transform: rotate(180deg); } 100% { opacity: 0; transform: rotate(180deg) translateY(-0.3rem); } }
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
