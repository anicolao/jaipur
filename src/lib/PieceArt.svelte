<script lang="ts">
  import { assets as assetBase } from '$app/paths';
  import type { CardKind } from '$lib/jaipur-rules';

  let {
    kind,
    label,
    detail = ''
  }: {
    kind: CardKind | 'seal' | 'card-back';
    label: string;
    detail?: string;
  } = $props();
</script>

<img
  class="piece-image"
  src={`${assetBase}/components/${kind}.webp`}
  alt=""
  draggable="false"
/>
<span class="piece-label">{label}</span>
{#if detail}<small>{detail}</small>{/if}
