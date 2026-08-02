import { expect, type Page } from '@playwright/test';

export type ExpectedGameLogEntry = readonly [type: string, text: string];
export type ExpectNextGameLogEntry = (...pages: Page[]) => Promise<void>;

export class GameLogOracle {
  private cursor = 0;

  constructor(private readonly expected: readonly ExpectedGameLogEntry[]) {}

  readonly expectNext: ExpectNextGameLogEntry = async (...pages) => {
    const entryNumber = this.cursor + 1;
    const entry = this.expected[this.cursor];
    expect(entry, `game log has no recorded entry ${entryNumber}`).toBeDefined();
    const [expectedType, expectedText] = entry;
    this.cursor = entryNumber;

    for (const page of pages) {
      const log = page.locator('.game-log');
      await expect(
        log.locator('summary span'),
        `game log count after entry ${entryNumber}: ${expectedText}`
      ).toHaveText(String(entryNumber));
      const newest = log.locator('[data-activity-type]').first();
      await expect(
        newest,
        `game log type at entry ${entryNumber}: ${expectedText}`
      ).toHaveAttribute('data-activity-type', expectedType);
      await expect(
        newest,
        `game log text at entry ${entryNumber}`
      ).toHaveText(expectedText);
    }
  };

  expectComplete(): void {
    expect(this.cursor, 'every recorded game log entry was observed').toBe(this.expected.length);
  }
}
