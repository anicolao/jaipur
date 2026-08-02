import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const cases = [
  { name: 'proposed-desktop-turn', width: 1280, height: 1000, state: 'turn' },
  { name: 'proposed-desktop-exchange', width: 1280, height: 1000, state: 'exchange' },
  { name: 'proposed-phone-turn', width: 393, height: 852, state: 'turn' },
  { name: 'proposed-phone-exchange', width: 393, height: 852, state: 'exchange' }
] as const;

test('capture proposed ordinary-game desktop and phone surfaces', async ({ browser }) => {
  const markup = fs.readFileSync(
    path.join(import.meta.dirname, 'ui-fixes.mockup.html'),
    'utf8'
  );
  fs.mkdirSync(path.resolve('docs/ui-fixes'), { recursive: true });
  for (const fixture of cases) {
    const page = await browser.newPage({
      viewport: { width: fixture.width, height: fixture.height }
    });
    await page.setContent(markup);
    await page.locator('[data-ui-fixes-mockup]').evaluate(
      (element, state) => element.setAttribute('data-state', state),
      fixture.state
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((image) => image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
            }))
      );
    });
    await expect(page.locator('[data-ui-fixes-mockup]')).toHaveAttribute(
      'data-state',
      fixture.state
    );
    await expect.poll(() => page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      brokenImages: Array.from(document.images).filter((image) => image.naturalWidth === 0).length
    }))).toEqual({
      width: fixture.width,
      height: fixture.height,
      viewportWidth: fixture.width,
      viewportHeight: fixture.height,
      brokenImages: 0
    });
    await page.screenshot({
      path: path.resolve('docs/ui-fixes', `${fixture.name}.png`),
      animations: 'disabled'
    });
    await page.close();
  }
});
