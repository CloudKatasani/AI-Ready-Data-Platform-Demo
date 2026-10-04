// Release gate: every tab renders with content at 1440, 1024 and 390 px, light and dark, for every pack —
// no console errors, no page-level horizontal scroll, never an empty screen.
import { expect, test } from '@playwright/test';
import { isPackReady, PROFILES } from '../../src/packs';

const TABS = ['map', 'explorer', 'semantic', 'glossary', 'context', 'certify', 'agents', 'marketplace', 'my-access'];
const SIZES = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }];

for (const profile of PROFILES.filter((p) => isPackReady(p.id))) {
  test(`responsive — ${profile.id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const problems: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const size of SIZES) {
        await page.setViewportSize(size);
        for (const tab of TABS) {
          await page.goto(`/#/${profile.id}/${tab}`);
          await expect(page.locator('main h1')).toBeVisible();
          const [mainOverflow, pageOverflow, textLen] = await page.evaluate(() => {
            const m = document.querySelector('main')!;
            return [m.scrollWidth - m.clientWidth, document.documentElement.scrollWidth - window.innerWidth, m.innerText.length];
          });
          if (mainOverflow > 1 || pageOverflow > 1) problems.push(`${scheme} ${size.width} ${tab}: horizontal overflow ${mainOverflow}/${pageOverflow}px`);
          if (textLen < 300) problems.push(`${scheme} ${size.width} ${tab}: looks empty (${textLen} chars)`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
  });
}
