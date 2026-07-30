import { expect, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Verification {
  spec: string;
  check: () => Promise<void>;
}

interface DocStep {
  title: string;
  image: string;
  specs: string[];
}

export class TestStepHelper {
  private count = 0;
  private steps: DocStep[] = [];
  private title = '';
  private description = '';

  constructor(
    private page: Page,
    private testInfo: TestInfo
  ) {}

  setMetadata(title: string, description: string) {
    this.title = title;
    this.description = description;
  }

  async step(
    id: string,
    options: { description: string; verifications: Verification[]; status?: string }
  ) {
    for (const verification of options.verifications) await verification.check();
    await expect(this.page.locator('[data-status]')).toHaveAttribute(
      'data-status',
      options.status ?? 'synced'
    );
    await this.page.mouse.move(0, 0);
    await this.page.evaluate(() => {
      const root = document.documentElement;
      if (root.scrollWidth > window.innerWidth + 1 || root.scrollHeight > window.innerHeight + 1) {
        throw new Error(
          `page scrolls: ${root.scrollWidth}×${root.scrollHeight} inside ${window.innerWidth}×${window.innerHeight}`
        );
      }
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        throw new Error(`page is scrolled to ${window.scrollX},${window.scrollY}`);
      }

      for (const element of document.querySelectorAll<HTMLElement>('[data-e2e-layout] *')) {
        if (!element.checkVisibility()) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (
          rect.left < -1 ||
          rect.right > window.innerWidth + 1 ||
          rect.top < -1 ||
          rect.bottom > window.innerHeight + 1
        ) {
          throw new Error(`${element.tagName} is outside the viewport`);
        }
      }

      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-e2e-layout] button:not([disabled]), [data-e2e-layout] input:not([disabled])'
        )
      ).filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
      for (let left = 0; left < controls.length; left += 1) {
        const first = controls[left].getBoundingClientRect();
        for (let right = left + 1; right < controls.length; right += 1) {
          const second = controls[right].getBoundingClientRect();
          const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
          const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
          if (overlapWidth > 1 && overlapHeight > 1) {
            throw new Error(`${controls[left].tagName} overlaps ${controls[right].tagName}`);
          }
        }
      }
    });

    const index = String(this.count++).padStart(3, '0');
    const platform = process.platform === 'linux' ? '-linux' : '';
    const filename = `${index}-${id}-${this.testInfo.project.name}${platform}.png`;
    await expect(this.page).toHaveScreenshot(filename);
    this.steps.push({
      title: options.description,
      image: `./screenshots/${filename}`,
      specs: options.verifications.map(({ spec }) => spec)
    });
  }

  generateDocs() {
    if (this.testInfo.project.name !== 'desktop' || process.platform === 'linux') return;
    let content = `# ${this.title}\n\n${this.description}\n\n`;
    for (const step of this.steps) {
      content += `## ${step.title}\n\n![${step.title}](${step.image})\n\n`;
      content += `**Verifications:**\n\n${step.specs.map((spec) => `- [x] ${spec}`).join('\n')}\n\n`;
    }
    fs.writeFileSync(
      path.join(path.dirname(this.testInfo.file), 'README.md'),
      `${content.trimEnd()}\n`
    );
  }
}
