// Accessibility gate (spec section 10/12): WCAG 2.x A/AA axe rules on every tab, light and dark, for every pack.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { isPackReady, PROFILES } from '../../src/packs';

const TABS = ['map', 'explorer', 'semantic', 'glossary', 'context', 'certify', 'agents', 'marketplace', 'my-access'];

for (const scheme of ['light', 'dark'] as const) {
  for (const profile of PROFILES.filter((p) => isPackReady(p.id))) {
    test(`a11y — ${profile.id} — ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const report: string[] = [];
      for (const tab of ['', ...TABS]) {
        await page.goto(tab ? `/#/${profile.id}/${tab}` : '/#/');
        await page.waitForTimeout(400);
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        for (const v of res.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
          report.push(`${tab || 'start'}: ${v.id} (${v.impact}) ×${v.nodes.length} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        }
      }
      expect(report).toEqual([]);
    });
  }
}
