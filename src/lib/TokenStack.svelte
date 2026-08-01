<script lang="ts">
  import type { Token } from '$lib/jaipur-rules';
  import TokenChip from '$lib/TokenChip.svelte';

  let {
    tokens,
    direction,
    hidden = false,
    usage = 'supply',
    stepRem
  }: {
    tokens: Token[];
    direction: 'vertical' | 'horizontal';
    hidden?: boolean;
    usage?: 'supply' | 'owned' | 'opponent' | 'private' | 'rail';
    stepRem?: number;
  } = $props();
</script>

<span
  class={`token-stack ${direction}`}
  class:empty={tokens.length === 0}
  data-token-stack
  data-stack-direction={direction}
  style={`--token-stack-count: ${tokens.length}${stepRem === undefined ? '' : `; --token-stack-step: ${stepRem}rem`}`}
  aria-hidden="true"
>
  {#each tokens as token, index (token.id)}
    <span
      class="stacked-token"
      class:supply-token={usage === 'supply' || usage === 'rail'}
      class:owned-token={usage === 'owned'}
      class:opponent-owned-token={usage === 'opponent'}
      class:private-earned-token={usage === 'private'}
      data-supply-token-id={(usage === 'supply' || usage === 'rail') ? token.id : undefined}
      data-owned-token-id={usage === 'owned' ? token.id : undefined}
      data-stack-position={index}
      style={`--token-stack-index: ${index}; --token-stack-z: ${tokens.length - index}`}
    >
      <TokenChip {token} {hidden} sideRim={direction === 'horizontal'} />
    </span>
  {/each}
</span>

<style>
  .token-stack {
    --token-stack-chip-size: 3rem;
    --token-stack-step: 1.05rem;
    position: relative;
    display: block;
    flex: 0 0 auto;
  }
  .token-stack.empty { display: none; }
  .token-stack.vertical {
    width: var(--token-stack-chip-size);
    height: calc(
      var(--token-stack-chip-size) +
      (var(--token-stack-count) - 1) * var(--token-stack-step)
    );
  }
  .token-stack.horizontal {
    width: calc(
      var(--token-stack-chip-size) +
      (var(--token-stack-count) - 1) * var(--token-stack-step)
    );
    height: var(--token-stack-chip-size);
  }
  .stacked-token {
    position: absolute;
    z-index: var(--token-stack-z);
    display: block;
    width: var(--token-stack-chip-size);
    height: var(--token-stack-chip-size);
  }
  .vertical .stacked-token {
    top: calc(var(--token-stack-index) * var(--token-stack-step));
    left: 0;
  }
  .horizontal .stacked-token {
    top: 0;
    left: calc(var(--token-stack-index) * var(--token-stack-step));
  }
</style>
