<script lang="ts">
  import { assets as assetBase } from '$app/paths';
  import type { Good, Token } from '$lib/jaipur-rules';

  let {
    token,
    hidden = false,
    sideRim = false
  }: {
    token: Token;
    hidden?: boolean;
    sideRim?: boolean;
  } = $props();

  const isBonus = (kind: Token['kind']) => kind.startsWith('bonus-');
  const artKind = (kind: Token['kind']): Good | 'card-back' => {
    if (isBonus(kind) || kind === 'camel') return 'card-back';
    return kind as Good;
  };
  const rimLabel = (kind: Token['kind'], value: number) =>
    hidden ? `${kind.replace('bonus-', '')}+` : String(value);
</script>

<span
  class="token-chip"
  class:hidden
  class:side-rim={sideRim}
  data-chip-kind={token.kind}
  aria-hidden="true"
>
  <img
    class="token-chip-image"
    src={`${assetBase}/components/${artKind(token.kind)}.webp`}
    alt=""
    draggable="false"
  />
  <span class="token-chip-center">{hidden ? '?' : token.value}</span>
  <span class="token-chip-rim">{rimLabel(token.kind, token.value)}</span>
</span>

<style>
  .token-chip {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    overflow: hidden;
    border: 0.14rem solid #f8e7b7;
    border-radius: 50%;
    background: #183a37;
    box-shadow:
      inset 0 0 0 0.12rem rgb(24 58 55 / 78%),
      0 0.16rem 0.28rem rgb(24 58 55 / 34%);
    color: white;
    isolation: isolate;
  }
  .token-chip::before {
    position: absolute;
    z-index: 2;
    inset: 0.18rem;
    border: 0.08rem dashed rgb(255 250 229 / 88%);
    border-radius: 50%;
    content: '';
    pointer-events: none;
  }
  .token-chip-image {
    position: absolute;
    z-index: 0;
    width: 100%;
    height: 100%;
    inset: 0;
    opacity: 0.82;
    object-fit: cover;
  }
  .token-chip-center {
    z-index: 1;
    display: grid;
    min-width: 46%;
    min-height: 46%;
    place-items: center;
    border: 0.08rem solid rgb(255 250 229 / 82%);
    border-radius: 50%;
    background: rgb(24 58 55 / 72%);
    font-size: 48%;
    font-weight: 700;
    line-height: 1;
    text-shadow: 0 1px 2px #000;
  }
  .token-chip-rim {
    position: absolute;
    z-index: 3;
    right: 20%;
    bottom: -0.02rem;
    left: 20%;
    padding: 0.05rem 0;
    border-radius: 50%;
    background: #f8e7b7;
    color: #183a37;
    font-size: clamp(0.34rem, 28%, 0.48rem);
    font-weight: 700;
    line-height: 1;
    text-align: center;
    text-shadow: none;
  }
  .token-chip.hidden .token-chip-image {
    opacity: 0.94;
  }
  .token-chip.side-rim .token-chip-rim {
    top: 32%;
    right: -0.02rem;
    bottom: 32%;
    left: auto;
    display: grid;
    width: 0.3rem;
    padding: 0;
    place-items: center;
    font-size: 0.28rem;
  }
</style>
