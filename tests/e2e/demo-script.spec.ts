// Walks the 15-minute demo script (spec section 12) end to end for each shipped pack.
import { expect, test, type Page } from '@playwright/test';

const PACKS = [
  { id: 'utilities', bronze: 'CIS_CUSTOMER_CDC', silver: 'CUSTOMER', fact: 'FCT_OUTAGE', port: 'DP_SYSTEM_RELIABILITY', agentObj: 'AGT_RELIABILITY_ANALYST', term: 'T-004', termName: 'SAIDI', rule: 'BR-012', docQuery: 'major event day', docHit: 'chunk 14', dp05: 'Billing & Receivables', analyst: 'Priya Iyer', steward: 'Hannah Sullivan', dsoQ: 'What is our days sales outstanding this month?', dsoKpi: 'Days sales outstanding' },
];

async function asPersona(page: Page, name: string) {
  await page.getByRole('button', { name: /^Role: / }).click();
  await page.getByRole('menuitem', { name: new RegExp(name) }).click();
  await expect(page.getByRole('button', { name: /^Role: / })).toContainText(name);
}

for (const p of PACKS) {
  test(`demo script — ${p.id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    // 1. Platform Map
    await page.goto(`/#/${p.id}/map`);
    await page.getByRole('button', { name: 'Replay flow' }).click();
    for (const layer of ['1. Bronze', '4. Semantic', '6. Context']) {
      await page.getByRole('button', { name: new RegExp(`^${layer}`) }).click();
      await expect(page.getByRole('heading', { level: 2, name: layer })).toBeVisible();
    }

    // 2. Explorer: Bronze CDC noise, Silver cleaned, lineage to product and agent, live masking
    await page.goto(`/#/${p.id}/explorer/RAW_BRONZE/${p.bronze}`);
    await expect(page.getByText('Raw CDC:')).toBeVisible();
    const grid = page.locator('table').first();
    await expect(grid.locator('td', { hasText: /^U$/ }).first()).toBeVisible();
    await expect(grid).toContainText('****');
    await page.goto(`/#/${p.id}/explorer/CURATED_SILVER/${p.silver}`);
    await expect(page.getByText('Curated: deduplicated')).toBeVisible();
    await page.goto(`/#/${p.id}/explorer/CONFORMED_GOLD/${p.fact}`);
    await page.getByRole('tab', { name: 'Lineage' }).click();
    await expect(page.getByRole('button', { name: `Open DATA_PRODUCTS.${p.port}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Open AGENTS.${p.agentObj}` })).toBeVisible();
    await page.goto(`/#/${p.id}/explorer/RAW_BRONZE/${p.bronze}`);
    await asPersona(page, p.steward);
    await expect(page.locator('table').first()).not.toContainText('****');
    await asPersona(page, p.analyst);
    await expect(page.locator('table').first()).toContainText('****');

    // 3. Meaning layers
    await page.goto(`/#/${p.id}/glossary/${p.term}`);
    await expect(page.getByRole('heading', { level: 2, name: p.termName })).toBeVisible();
    await expect(page.getByLabel('Term lineage')).toBeVisible();
    await page.goto(`/#/${p.id}/semantic`);
    await expect(page.getByLabel('Try a metric')).toBeVisible();
    await page.goto(`/#/${p.id}/context/rules`);
    await expect(page.getByRole('cell', { name: p.rule })).toBeVisible();
    await page.goto(`/#/${p.id}/context/search`);
    await page.getByLabel(/^Search CS_/).fill(p.docQuery);
    await expect(page.getByText(p.docHit).first()).toBeVisible();

    // 4. Certification Studio as Data steward
    await asPersona(page, p.steward);
    await page.goto(`/#/${p.id}/certify/DP-05`);
    await page.getByRole('button', { name: 'Run certification checks' }).click();
    await expect(page.getByRole('button', { name: /Add 3 verified queries/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Add 3 verified queries/ }).click();
    await page.getByRole('button', { name: /Approve 3 verified queries/ }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^6\. Governance/ }).click();
    await page.getByRole('button', { name: /^Attach / }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Attach / }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /Certify & publish/ }).click();
    await expect(page.getByText(/Certificate · /)).toBeVisible();

    // 5. Marketplace: analyst sees it Certified + New, request pending; steward approves
    await asPersona(page, p.analyst);
    await page.goto(`/#/${p.id}/marketplace`);
    await expect(page.getByLabel('Certified this month').getByText(p.dp05)).toBeVisible();
    await expect(page.getByText('New').first()).toBeVisible();
    await page.goto(`/#/${p.id}/marketplace?item=DP-05&tab=access`);
    await expect(page.getByRole('dialog')).toContainText('Pending');
    await page.keyboard.press('Escape');
    await asPersona(page, p.steward);
    await page.getByRole('button', { name: /^Requests \(/ }).click();
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await page.keyboard.press('Escape');

    // 6. Agent answers DSO with a certified source; My Access shows it answerable
    await asPersona(page, p.analyst);
    await page.goto(`/#/${p.id}/agents/AG-01`);
    await page.getByLabel('Question').fill(p.dsoQ);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByText(/Certified source/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('How I answered').getByText('Generate and run SQL')).toBeVisible({ timeout: 10_000 });
    await page.goto(`/#/${p.id}/my-access`);
    const row = page.getByRole('row', { name: new RegExp(p.dsoKpi) });
    await expect(row.getByText('Yes')).toBeVisible();

    expect(errors).toEqual([]);
  });
}
