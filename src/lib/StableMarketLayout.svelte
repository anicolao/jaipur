<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    slot
  }: {
    slot: Snippet<[index: number]>;
  } = $props();

  const slots = [0, 1, 2, 3, 4] as const;
</script>

<div class="stable-market-layout" data-stable-market-layout>
  {#each slots as index (index)}
    {@render slot(index)}
  {/each}
</div>

<style>
  .stable-market-layout {
    display: contents;
  }
</style>
