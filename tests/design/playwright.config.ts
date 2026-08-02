import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './ui-fixes',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5185',
    browserName: 'chromium',
    deviceScaleFactor: 1,
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
    launchOptions: {
      args: [
        '--font-render-hinting=none',
        '--disable-font-subpixel-positioning',
        '--disable-lcd-text',
        '--force-device-scale-factor=1',
        '--disable-gpu',
        '--use-gl=swiftshader'
      ]
    }
  },
  webServer: {
    command: 'bun run dev:e2e',
    url: 'http://127.0.0.1:5185',
    reuseExistingServer: true,
    timeout: 120_000
  },
  timeout: 30_000
});
