<script lang="ts">
  import type { GameState, Good } from '$lib/jaipur-rules';

  type SummaryAsset = Good | 'camel' | 'seal' | 'card-back';

  let {
    lobby,
    componentImage,
    busy = false,
    offline = false,
    onNextRound,
    onRematch
  }: {
    lobby: GameState;
    componentImage: (kind: SummaryAsset) => string;
    busy?: boolean;
    offline?: boolean;
    onNextRound?: () => void;
    onRematch?: () => void;
  } = $props();

  const playerName = (uid: string) => lobby.players.find((player) => player.uid === uid)?.displayName ?? 'Unknown trader';
  const isMatchComplete = () => Boolean(lobby.winnerUid);
  const actionDisabled = () => busy || offline;
</script>

{#if lobby.round}
  <section class="score-review" aria-labelledby="round-result">
    <img class="result-seal" src={componentImage('seal')} alt="" />
    {#if isMatchComplete()}
      <p class="eyebrow">Match complete</p>
      <h2 id="round-result" class="match-winner">{playerName(lobby.winnerUid!)} wins Jaipur</h2>
      <p>Two Seals of Excellence decide the match.</p>
    {:else}
      <p class="eyebrow">Round {lobby.round.number} complete</p>
      <h2 id="round-result">{playerName(lobby.round.winnerUid ?? '')} earns a Seal of Excellence</h2>
      <p>
        {lobby.round.endReason === 'three-empty-supplies'
          ? 'Three goods supplies are empty.'
          : 'The deck could not completely refill the market.'}
      </p>
    {/if}

    <div class="scorecards">
      {#each lobby.players as player}
        {@const score = lobby.round.scores?.[player.uid]}
        <article class:winner={player.uid === lobby.round.winnerUid}>
          <h3>{player.displayName}</h3>
          <dl>
            <div><dt>Goods</dt><dd>{score?.goods ?? 0}</dd></div>
            <div><dt>Bonuses</dt><dd>{score?.bonus ?? 0}</dd></div>
            <div><dt>Camels</dt><dd>{score?.camel ?? 0}</dd></div>
            <div><dt>Total</dt><dd>{score?.total ?? 0}</dd></div>
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

    {#if isMatchComplete()}
      <section class="match-history" aria-label="Round history">
        <h3>Round history</h3>
        {#each lobby.rounds as completedRound}
          <p>
            Round {completedRound.number}:
            <strong>{playerName(completedRound.winnerUid ?? '')}</strong>
            {lobby.players
              .map((player) => `${player.displayName} ${completedRound.scores?.[player.uid]?.total ?? 0}`)
              .join(' · ')}
          </p>
        {/each}
      </section>
      {#if onRematch}
        <button type="button" disabled={actionDisabled()} onclick={onRematch}>Start rematch</button>
      {:else}
        <p>Match complete.</p>
      {/if}
    {:else if onNextRound}
      <button type="button" disabled={actionDisabled()} onclick={onNextRound}>
        Open round {lobby.round.number + 1}
      </button>
    {:else}
      <p>Waiting for the host to open the next market…</p>
    {/if}
  </section>
{/if}

<style>
  .score-review {
    display: grid;
    width: min(54rem, 100%);
    height: 100%;
    min-height: 0;
    grid-template-columns: auto 1fr;
    grid-auto-rows: min-content;
    align-content: center;
    margin: auto;
    column-gap: 0.65rem;
    color: #183a37;
    text-align: left;
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
  .score-review > .eyebrow {
    color: #a6442d;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .score-review > h2 {
    margin: 0.5rem 0 0.35rem;
    font: 700 clamp(1.5rem, 4vmin, 2.4rem) 'Cormorant Garamond', serif;
    line-height: 1;
  }
  .scorecards {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(0.35rem, 1.2vmin, 1rem);
    margin: clamp(0.35rem, 1.5vmin, 1.25rem) 0;
    text-align: left;
  }
  .scorecards article {
    min-width: 0;
    padding: clamp(0.4rem, 1.4vmin, 1rem);
    border: 2px solid #b7aa8d;
    border-radius: 0.8rem;
    background: #fffaf0;
  }
  .scorecards article.winner { border-color: #a23e2a; background: #fff0dd; }
  .scorecards h3 { margin: 0 0 0.45rem; font-size: clamp(1rem, 2.2vmin, 1.25rem); }
  .scorecards dl { margin: 0; font-size: clamp(0.7rem, 1.55vmin, 0.95rem); }
  .scorecards dl div { display: flex; justify-content: space-between; }
  .scorecards dd { margin: 0; font-weight: 700; }
  .score-components {
    display: flex;
    min-height: 2.25rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    margin-top: 0.3rem;
    font-size: clamp(0.58rem, 1.3vmin, 0.7rem);
  }
  .bonus-stack, .camel-total, .score-seals { display: flex; align-items: center; gap: 0.18rem; }
  .bonus-stack { min-width: 0; flex-wrap: wrap; }
  .component-caption { font-size: 0.65rem; }
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
  .bonus-token img { position: absolute; z-index: 0; width: 100%; height: 100%; object-fit: cover; }
  .bonus-token strong { z-index: 1; text-shadow: 0 1px 2px #000; }
  .camel-total { white-space: nowrap; }
  .camel-total img { width: 1.8rem; height: 1.8rem; border-radius: 50%; object-fit: cover; }
  .score-seals { flex-wrap: wrap; justify-content: flex-end; }
  .score-seals img { width: 1.35rem; height: 1.35rem; border-radius: 50%; filter: grayscale(1); opacity: 0.25; object-fit: cover; }
  .score-seals img.earned { filter: none; opacity: 1; }
  .match-history {
    grid-column: 1 / -1;
    margin: 0 0 0.45rem;
    padding: clamp(0.35rem, 1vmin, 0.8rem);
    border-radius: 0.8rem;
    background: #e9dcc1;
    font-size: clamp(0.62rem, 1.35vmin, 0.78rem);
  }
  .match-history h3, .match-history p { margin: 0.25rem; }
  .score-review > button, .score-review > section + button, .score-review > section + p {
    grid-column: 1 / -1;
    justify-self: center;
  }
  .score-review > button {
    min-height: 36px;
    padding: 0.3rem 0.65rem;
    border: 0;
    border-radius: 99rem;
    background: #a6442d;
    color: white;
    font: inherit;
    font-weight: 700;
  }
  .score-review > button:disabled { cursor: not-allowed; opacity: 0.55; }
  @media (max-width: 600px) {
    .score-review { align-content: center; padding: 0.3rem; }
    .result-seal { width: 3.2rem; height: 3.2rem; }
    .scorecards { gap: 0.3rem; }
    .score-components { align-items: flex-start; flex-direction: column; }
  }
  @media (max-width: 480px) {
    .scorecards { grid-template-columns: 1fr; }
    .score-components { min-height: 1.8rem; }
  }
  @media (max-height: 599px) {
    .score-review { align-content: start; }
    .result-seal { width: 2.8rem; height: 2.8rem; }
    .scorecards { margin: 0.25rem 0; }
    .scorecards article { padding: 0.35rem; }
    .score-components { min-height: 1.8rem; margin-top: 0.15rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .score-review *, .score-review *::before, .score-review *::after { transition-duration: 0s !important; animation-duration: 0s !important; }
  }
</style>
