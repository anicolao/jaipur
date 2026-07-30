<script lang="ts">
  import '@fontsource/atkinson-hyperlegible/400.css';
  import '@fontsource/atkinson-hyperlegible/700.css';
  import '@fontsource/cormorant-garamond/700.css';
  import { onMount } from 'svelte';
  import { initializeFirebase } from '$lib/firebase';

  let status = $state<'connecting' | 'synced' | 'error'>('connecting');
  let statusText = $state('Connecting to Firebase…');

  onMount(async () => {
    try {
      await initializeFirebase();
      status = 'synced';
      statusText =
        import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
          ? 'Firebase emulator ready'
          : 'Firebase ready';
    } catch (error) {
      status = 'error';
      statusText = error instanceof Error ? error.message : 'Firebase unavailable';
    }
  });
</script>

<svelte:head>
  <title>Jaipur — Live card play</title>
</svelte:head>

<main data-e2e-layout>
  <section class="hero" aria-labelledby="title">
    <p class="eyebrow">A market for two</p>
    <h1 id="title">The bazaar is almost ready.</h1>
    <p class="lede">
      Gather rare goods, trade with camels, and earn two Seals of Excellence before your rival.
    </p>
    <div class="goods" aria-label="Goods in the Jaipur market">
      <span class="diamond">Diamonds</span>
      <span class="gold">Gold</span>
      <span class="silver">Silver</span>
      <span class="cloth">Cloth</span>
      <span class="spice">Spice</span>
      <span class="leather">Leather</span>
    </div>
    <p role="status" data-status={status}>{statusText}</p>
    <p class="build" data-testid="build-marker">Build {import.meta.env.VITE_GIT_HASH ?? 'local'}</p>
  </section>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    background: #f5e7c6;
    color: #183a37;
    font-family: 'Atkinson Hyperlegible', sans-serif;
  }

  :global(body) {
    margin: 0;
  }

  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem;
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
    background: rgb(255 250 238 / 84%);
    box-shadow: 0 1.5rem 4rem rgb(80 46 20 / 16%);
  }

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

  .lede {
    max-width: 42rem;
    margin: 0 auto 2rem;
    font-size: clamp(1.1rem, 2vw, 1.35rem);
  }

  .goods {
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

  [role='status'] {
    margin: 0;
    font-weight: 700;
  }

  [data-status='synced'] {
    color: #236142;
  }

  [data-status='error'] {
    color: #a3212a;
  }

  .build {
    margin: 0.55rem 0 0;
    color: #5f6f69;
    font-size: 0.875rem;
  }

  @media (max-width: 480px) {
    main {
      padding: 1rem;
    }

    .hero {
      padding: 2rem 1.2rem;
      border-radius: 1.4rem;
    }
  }
</style>
