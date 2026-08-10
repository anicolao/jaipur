<script lang="ts">
  import TokenStack from '$lib/TokenStack.svelte';
  import type { Good, RoundState } from '$lib/jaipur-rules';

  let {
    seat,
    round,
    goods,
    inverted = false,
    label,
    canSell,
    onSell
  }: {
    seat: 1 | 2;
    round: RoundState | null;
    goods: Good[];
    inverted?: boolean;
    label: (kind: Good) => string;
    canSell: (kind: Good) => boolean;
    onSell: (kind: Good) => void | Promise<void>;
  } = $props();
</script>

<aside
  class="token-market"
  class:inverted
  data-token-view-seat={seat}
  aria-label={`Player ${seat} token supplies`}
>
  <div class="token-market-content">
    <h2>Tokens</h2>
    {#if round}
      <div class="bonus-row" aria-label="Bonus supplies">
        {#each ['3', '4', '5'] as size}
          <span>{size}+ <strong>{round.bonusTokens[size as '3' | '4' | '5'].length}</strong></span>
        {/each}
      </div>
      {#each goods as kind}
        <button
          type="button"
          class={`rail-token ${kind}`}
          disabled={!canSell(kind)}
          aria-label={`Sell to ${label(kind)} token stack, ${round.goodsTokens[kind].length} left`}
          data-token-kind={kind}
          onclick={() => onSell(kind)}
        >
          <span class="rail-chip">
            {#if round.goodsTokens[kind].length > 0}
              <TokenStack
                tokens={round.goodsTokens[kind]}
                direction="horizontal"
                usage="rail"
              />
            {:else}
              <span>—</span>
            {/if}
          </span>
          <span>{label(kind)} <strong>{round.goodsTokens[kind].length}</strong></span>
        </button>
      {/each}
    {:else}
      <span class="empty-rail">Supplies appear when play begins.</span>
    {/if}
  </div>
</aside>

<style>
  .token-market {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid #9e8a68;
    border-radius: clamp(0.55rem, 1.3vmin, 1rem);
    background: #fffaf0;
    box-shadow: 0 0.25rem 0.8rem rgb(10 32 30 / 16%);
  }
  .token-market-content {
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto auto repeat(6, minmax(0, 1fr));
    gap: clamp(0.15rem, 0.45vmin, 0.35rem);
    padding: clamp(0.3rem, 0.65vmin, 0.55rem) 0.35rem;
  }
  .inverted .token-market-content { transform: rotate(180deg); }
  h2 {
    margin: 0;
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(1.05rem, 2.2vmin, 1.55rem);
    text-align: center;
  }
  .bonus-row {
    display: flex;
    justify-content: center;
    gap: 0.18rem;
    font-size: clamp(0.5rem, 0.9vmin, 0.66rem);
  }
  .bonus-row span {
    padding: 0.12rem 0.22rem;
    border-radius: 99rem;
    background: #e9dcc1;
  }
  .rail-token {
    display: grid;
    min-width: 0;
    min-height: 44px;
    grid-template-rows: minmax(0, 1fr) auto;
    place-items: center;
    gap: 0.05rem;
    padding: 0.08rem;
    overflow: visible;
    border: 1px solid #b7aa8d;
    border-radius: 0.5rem;
    background: #f5ead3;
    color: #183a37;
    font: inherit;
    font-size: clamp(0.5rem, 0.9vmin, 0.66rem);
    text-align: center;
  }
  .rail-token:disabled { opacity: 1; }
  .rail-chip {
    display: grid;
    width: 100%;
    min-width: 0;
    place-items: center;
  }
  .rail-chip :global(.token-stack) {
    --token-stack-chip-size: clamp(1.55rem, 2.6vmin, 1.9rem);
    --token-stack-step: clamp(0.82rem, 1.5vmin, 0.95rem);
  }
  .empty-rail {
    align-self: center;
    grid-row: 3 / -1;
    font-size: 0.7rem;
    text-align: center;
  }
</style>
