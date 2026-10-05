// Walks the Implementation story (Enhancement Specification, demo script) end to end for every pack that carries
// the enhancement block: Readiness → Roadmap → Build Guide → Knockout → Data Health, then the agent quality loop,
// impact analysis and "Reset demo". Names come from the pack, so a new pack is covered once it ships an ext block.
import { expect, test, type Page } from '@playwright/test';
import { isPackReady, loadPack, PROFILES } from '../../src/packs';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function asPersona(page: Page, name: string) {
  await page.getByRole('button', { name: /switch persona$/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(esc(name)) }).click();
  await expect(page.getByRole('button', { name: /switch persona$/ })).toContainText(name);
}

async function presenter(page: Page, item: RegExp) {
  await page.getByRole('button', { name: 'Presenter menu' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

for (const profile of PROFILES.filter((p) => isPackReady(p.id))) {
  test(`implementation story — ${profile.id}`, async ({ page }) => {
    const pack = await loadPack(profile.id);
    test.skip(!pack.ext, `${profile.id} has no enhancement block`);
    const x = pack.ext!;
    const analyst = pack.personas.find((p) => p.archetype === 'A')!.name;
    const steward = pack.personas.find((p) => p.archetype === 'D')!.name;
    const fs = x.feedbackScript;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const go = async (route: string) => { await page.goto(`/#/${profile.id}/${route}`); await expect(page.locator('h1').first()).toBeVisible(); };

    // 1. Platform Map: Implementation story path
    await go('map');
    await page.getByRole('tab', { name: 'Implementation story' }).click();
    await expect(page.getByRole('link', { name: /Assess readiness/ })).toBeVisible();

    // 2. Readiness: load the example profile, see scored results with gaps linked to the roadmap and build guide
    await go('readiness/assess');
    await page.getByRole('button', { name: /^Mid-migration, BI-led/ }).click();
    await page.getByRole('button', { name: 'See results' }).click();
    await expect(page.getByRole('region', { name: 'Scores and targets' })).toBeVisible();
    const gaps = page.getByRole('region', { name: 'Top gaps' });
    await expect(gaps.getByRole('link', { name: /^Phase \d/ }).first()).toBeVisible();

    // 3. Roadmap generated from readiness
    await go('roadmap');
    await page.getByRole('button', { name: 'Generate from readiness' }).click();
    await expect(page.getByText('You are here')).toBeVisible();

    // 4. Build Guide: step through, artifacts and results link to the Explorer
    await go('build');
    await expect(page.getByText(/^Step 1 of \d+$/)).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/^Step 2 of \d+$/)).toBeVisible();
    await go('build/gold');
    const result = page.getByRole('link', { name: /^CONFORMED_GOLD\./ }).first();
    await result.click();
    await expect(page.getByRole('heading', { level: 2 })).toContainText(/^(DIM|FCT|[A-Z_]+)/);

    // 5. Knockout: semantic off degrades at least one answer
    await go('why/knockout');
    const strip = page.getByRole('region', { name: 'What went wrong' });
    for (const k of x.knockoutScenarios.filter((q) => q.affects.includes('semantic')).slice(0, 1)) {
      await page.getByRole('radio', { name: new RegExp(esc(k.question.slice(0, 40))) }).click();
      await page.getByRole('switch', { name: /^Semantic/ }).click();
      await expect(strip).toContainText(/Semantic|semantic/);
    }

    // 6. Data Health: break something, see it in the Marketplace and Agent Studio, resolve it
    const inc = x.incidents[0];
    await go('health?break=1');
    await page.getByRole('dialog').getByRole('listitem').filter({ hasText: inc.title }).getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('region', { name: `Incident ${inc.title}` })).toBeVisible();
    await go('marketplace');
    await expect(page.getByText(/Open incident:/).first()).toBeVisible();
    await go('health/incidents');
    await page.getByRole('region', { name: `Incident ${inc.title}` }).getByRole('button', { name: 'Resolve incident' }).click();
    await expect(page.getByRole('region', { name: 'Postmortems' })).toContainText(inc.title);

    // 7. Agent quality loop: 88% → thumbs down → steward fix → re-run → 94%
    await go('agent-quality');
    const row = page.getByRole('row', { name: new RegExp(esc(pack.agents.find((a) => a.id === fs.agentId)!.name)) });
    await expect(row).toContainText('88%');
    await asPersona(page, analyst);
    await go(`agents/${fs.agentId}`);
    await page.getByLabel('Question').fill(fs.question);
    await page.getByRole('button', { name: 'Ask' }).click();
    await page.getByRole('button', { name: 'Bad answer' }).last().click();
    await page.getByLabel('What was wrong with this answer').fill(fs.comment);
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await asPersona(page, steward);
    await go('agent-quality/inbox');
    await expect(page.getByText('Missing business rule').first()).toBeVisible();
    await page.getByRole('button', { name: 'Fix' }).first().click();
    await page.getByRole('button', { name: /^Apply: Add business rule/ }).click();
    await page.getByRole('button', { name: 'Re-run eval' }).click();
    await go('agent-quality');
    await expect(row).toContainText('94%');
    await go('context/rules');
    await expect(page.getByText(fs.rule.id).first()).toBeVisible();

    // 8. Impact analysis from a preset
    await go(`impact?preset=${x.impactPresets[0].id}`);
    await expect(page.getByRole('region', { name: 'Blast radius' }).getByRole('link').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Change plan' }).getByRole('checkbox').first()).toBeVisible();

    // 9. Reset demo restores every enhancement state
    await presenter(page, /^Reset demo/);
    await go('agent-quality');
    await expect(row).toContainText('88%');
    await go('health/incidents');
    await expect(page.getByText(/No open incidents/)).toBeVisible();

    expect(errors).toEqual([]);
  });
}
