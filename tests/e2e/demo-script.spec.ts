// Walks the 15-minute demo script (spec section 12) end to end for every shipped pack. All names come from the
// pack itself, so a new pack is covered as soon as it is registered.
import { expect, test, type Page } from '@playwright/test';
import { isPackReady, loadPack, PROFILES } from '../../src/packs';
import type { IndustryPack } from '../../src/types';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function facts(pack: IndustryPack) {
  const bronze = pack.objects.filter((o) => o.schema === 'RAW_BRONZE' && o.type === 'ICEBERG TABLE').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  const silver = pack.objects.filter((o) => o.schema === 'CURATED_SILVER').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  const sig = pack.scenarios.find((s) => s.question === pack.signature.question)!;
  const sigProduct = pack.products.find((p) => p.id === sig.productIds[0])!;
  const fact = sigProduct.upstream.find((u) => u.startsWith('CONFORMED_GOLD.'))!;
  const agentObj = pack.agents.find((a) => a.id === pack.signature.agentId)!.objectName;
  const q4 = pack.scenarios.find((s) => s.pattern === 4)!;
  const gate6 = pack.certificationScript.failures.find((f) => f.fix.kind === 'masking')!;
  return {
    bronze: bronze.name, silver: silver.name, fact, port: sigProduct.outputPort, agentObj,
    term: pack.glossary.find((t) => t.id === pack.signature.termId)!,
    rule: pack.signature.ruleId, docQuery: pack.signature.docQuery, docHit: `chunk ${sig.doc!.chunk}`,
    dp05: pack.products.find((p) => p.id === pack.certificationScript.productId)!.name,
    analyst: pack.personas.find((p) => p.archetype === 'A')!.name,
    steward: pack.personas.find((p) => p.archetype === 'D')!.name,
    q4, q4Kpi: pack.kpis.find((k) => k.id === q4.kpiIds[0])!.name, gate6Label: gate6.fix.label,
  };
}

async function asPersona(page: Page, name: string) {
  await page.getByRole('button', { name: /switch persona$/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(esc(name)) }).click();
  await expect(page.getByRole('button', { name: /switch persona$/ })).toContainText(name);
}

for (const profile of PROFILES.filter((p) => isPackReady(p.id))) {
  test(`demo script — ${profile.id}`, async ({ page }) => {
    const pack = await loadPack(profile.id);
    const p = facts(pack);
    const id = profile.id;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    // 0. Start screen → pick the industry
    await page.goto('/#/');
    await page.getByRole('link', { name: new RegExp(esc(profile.company)) }).click();
    await expect(page).toHaveURL(new RegExp(`#/${id}/map`));

    // 1. Platform Map
    await page.getByRole('button', { name: 'Replay flow' }).click();
    for (const layer of ['1. Bronze', '4. Semantic', '6. Context']) {
      await page.getByRole('button', { name: new RegExp(`^${esc(layer)}`) }).click();
      await expect(page.getByRole('heading', { level: 2, name: layer })).toBeVisible();
    }

    // 2. Explorer: Bronze CDC noise, Silver cleaned, lineage to product and agent, live masking
    await page.goto(`/#/${id}/explorer/RAW_BRONZE/${p.bronze}`);
    await expect(page.getByText('Raw CDC:')).toBeVisible();
    const grid = page.locator('table').first();
    await expect(grid.locator('td', { hasText: /^U$/ }).first()).toBeVisible();
    await expect(grid.locator('td', { hasText: /^D$/ }).first()).toBeVisible();
    await expect(grid).toContainText('****');
    await page.goto(`/#/${id}/explorer/CURATED_SILVER/${p.silver}`);
    await expect(page.getByText('Curated: deduplicated')).toBeVisible();
    await page.goto(`/#/${id}/explorer/${p.fact.replace('.', '/')}`);
    await page.getByRole('tab', { name: 'Lineage' }).click();
    await expect(page.getByRole('button', { name: `Open DATA_PRODUCTS.${p.port}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Open AGENTS.${p.agentObj}` })).toBeVisible();
    await page.goto(`/#/${id}/explorer/RAW_BRONZE/${p.bronze}`);
    await asPersona(page, p.steward);
    await expect(page.locator('table').first()).not.toContainText('****');
    await asPersona(page, p.analyst);
    await expect(page.locator('table').first()).toContainText('****');

    // 3. Meaning layers
    await page.goto(`/#/${id}/glossary/${p.term.id}`);
    await expect(page.getByRole('heading', { level: 2, name: p.term.term })).toBeVisible();
    await expect(page.getByLabel('Term lineage')).toBeVisible();
    await page.goto(`/#/${id}/semantic`);
    await expect(page.getByLabel('Try a metric')).toBeVisible();
    await page.goto(`/#/${id}/context/rules`);
    await expect(page.getByRole('cell', { name: p.rule, exact: true })).toBeVisible();
    await page.goto(`/#/${id}/context/search`);
    await page.getByLabel(/^Search CS_/).fill(p.docQuery);
    await expect(page.getByText(p.docHit).first()).toBeVisible();

    // 4. Certification Studio as Data steward
    await asPersona(page, p.steward);
    await page.goto(`/#/${id}/certify/DP-05`);
    await page.getByRole('button', { name: 'Run certification checks' }).click();
    await expect(page.getByRole('button', { name: /Add 3 verified queries/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Add 3 verified queries/ }).click();
    await page.getByRole('button', { name: /Approve 3 verified queries/ }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^6\. Governance/ }).click();
    await page.getByRole('button', { name: p.gate6Label }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Attach / }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /Certify & publish/ }).click();
    await expect(page.getByText(/Certificate · /)).toBeVisible();

    // 5. Marketplace: analyst sees it Certified + New, request pending; steward approves
    await asPersona(page, p.analyst);
    await page.goto(`/#/${id}/marketplace`);
    await expect(page.getByLabel('Certified this month').getByText(p.dp05, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('New').first()).toBeVisible();
    await page.goto(`/#/${id}/marketplace?item=DP-05&tab=access`);
    await expect(page.getByRole('dialog')).toContainText('Pending');
    await page.keyboard.press('Escape');
    await asPersona(page, p.steward);
    await page.getByRole('button', { name: /^Requests \(/ }).click();
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await page.keyboard.press('Escape');

    // 6. Agent answers the DP-05 question with a certified source; My Access shows its KPI answerable
    await asPersona(page, p.analyst);
    await page.goto(`/#/${id}/agents/${p.q4.agentId}`);
    await page.getByLabel('Question').fill(p.q4.question);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByText(/Certified source/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('How I answered').getByText('Generate and run SQL')).toBeVisible({ timeout: 10_000 });
    await page.goto(`/#/${id}/my-access`);
    const row = page.getByLabel('KPI coverage matrix').getByRole('row', { name: new RegExp(esc(p.q4Kpi)) }).first();
    await expect(row.getByText('Yes')).toBeVisible();

    expect(errors).toEqual([]);
  });
}
