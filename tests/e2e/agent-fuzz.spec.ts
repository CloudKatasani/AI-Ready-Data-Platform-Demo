// Every pack × persona × agent × starter question, before and after DP-05 is certified and approved.
import { expect, test, type Page } from '@playwright/test';
import { isPackReady, loadPack, PROFILES } from '../../src/packs';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function asPersona(page: Page, name: string) {
  await page.getByRole('button', { name: /switch persona$/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(esc(name)) }).click();
}

for (const profile of PROFILES.filter((p) => isPackReady(p.id))) {
  test(`agent fuzz — ${profile.id}`, async ({ page }) => {
    test.setTimeout(600_000);
    const pack = await loadPack(profile.id);
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && problems.push(`console ${m.text().slice(0, 300)}`));
    const sweep = async (phase: string) => {
      for (const persona of pack.personas) {
        await page.goto(`/#/${profile.id}/map`);
        await asPersona(page, persona.name);
        for (const agent of pack.agents) {
          await page.goto(`/#/${profile.id}/agents/${agent.id}`);
          await page.waitForTimeout(150);
          const qs = pack.scenarios.filter((s) => s.agentId === agent.id).map((s) => s.question);
          const input = page.getByLabel('Question');
          if (!(await input.count())) continue;
          for (const q of [...qs, 'what is the weather']) {
            await input.fill(q);
            await page.getByRole('button', { name: 'Ask', exact: true }).click();
            await page.waitForTimeout(120);
            if (await page.getByText('This view hit an error').count()) {
              problems.push(`${phase} ${persona.roleId} ${agent.id} "${q}": ${await page.locator('[role=alert] pre').innerText()}`);
              await page.getByRole('button', { name: 'Retry' }).click();
            }
          }
        }
      }
    };
    await sweep('initial');
    // certify DP-05 and approve the analyst's request via the store (state as after the demo script)
    await page.evaluate(() => {
      const raw = sessionStorage.getItem('data-fabric-studio');
      if (!raw) return;
      const st = JSON.parse(raw);
      for (const p of Object.values<any>(st.state.packs)) {
        p.cert['DP-05'] = { ran: true, fixes: ['G4-VQ', 'G6-MASK'], published: { version: '1.0.0', certifier: 'x', date: '2026-10-04', score: 97 } };
        p.requests = p.requests.map((r: any) => ({ ...r, status: 'approved' }));
      }
      sessionStorage.setItem('data-fabric-studio', JSON.stringify(st));
    });
    await page.reload();
    await sweep('certified');
    expect(problems).toEqual([]);
  });
}
