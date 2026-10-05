import { describe, expect, it } from 'vitest';
import { MockSnowflake } from '../src/mock-snowflake';
import { initialLive } from '../src/packs/validate';
import { creatorOf, STEPS, type BuildCtx } from '../src/ext/buildGuide';
import { DEFAULT_TOOLING } from '../src/ext/state';
import { bandOf } from '../src/ext/readiness';
import { runKnockout } from '../src/ext/knockout';
import { ALL_ON, SWITCHES } from '../src/ext/types';
import { respond } from '../src/agents/engine/respond';
import { persona, utilities } from './helpers';

const pack = utilities();
const db = new MockSnowflake(pack);
const live = initialLive(pack);
const ctx: BuildCtx = { pack, db, tooling: DEFAULT_TOOLING, live };

describe('E3 build guide', () => {
  it('has 35 steps with unique ids and valid prerequisites', () => {
    expect(STEPS).toHaveLength(35);
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(35);
    for (const s of STEPS) for (const p of s.prereqs) expect(STEPS.findIndex((x) => x.id === p), `${s.id} → ${p}`).toBeLessThan(STEPS.findIndex((x) => x.id === s.id));
  });

  it('creates every catalog object in exactly one step', () => {
    const counts = new Map<string, number>();
    for (const s of STEPS) for (const o of s.creates(ctx)) counts.set(o, (counts.get(o) ?? 0) + 1);
    const all = db.listSchemas().flatMap((sc) => sc.objects.map((o) => `${o.schema}.${o.name}`));
    for (const o of all) expect(counts.get(o), o).toBe(1);
    for (const o of counts.keys()) expect(all, `${o} is not in the catalog`).toContain(o);
    for (const o of all.slice(0, 5)) expect(creatorOf(ctx, o)).toBeDefined();
  });

  it('produces non-empty artifacts for every step and tooling choice', () => {
    for (const tooling of [DEFAULT_TOOLING, { ingestion: 'fivetran', transformation: 'snowpark', orchestration: 'airflow', format: 'native' } as const]) {
      for (const s of STEPS) {
        const arts = s.artifacts({ ...ctx, tooling: tooling as typeof DEFAULT_TOOLING });
        expect(arts.length, s.id).toBeGreaterThan(0);
        for (const a of arts) expect(a.code.trim().length, `${s.id}/${a.label}`).toBeGreaterThan(10);
      }
    }
  });
});

describe('E6 readiness bands', () => {
  it('uses the specified boundaries', () => {
    expect(bandOf(1.9)).toBe('Exploring');
    expect(bandOf(2.0)).toBe('Foundational');
    expect(bandOf(2.9)).toBe('Foundational');
    expect(bandOf(3.0)).toBe('Operational');
    expect(bandOf(4.5)).toBe('AI-ready');
    expect(bandOf(4.6)).toBe('AI-native');
    expect(bandOf(5)).toBe('AI-native');
  });
});

describe('E1 layer knockout', () => {
  const scenarios = pack.ext!.knockoutScenarios;
  const a = persona(pack, 'A');
  const sctx = { persona: a, live };

  it('governed answer matches the Agent Studio scenario', () => {
    for (const ks of scenarios) {
      const governed = ks.compute(ALL_ON, sctx);
      const ans = respond(pack, ks.agentId, ks.question, a, live, () => 'G');
      expect(ans.scenarioId, ks.id).toBe(ks.scenarioId);
      expect(ans.summary, ks.id).toContain(governed.valueText);
      expect(runKnockout(pack, ks, ALL_ON, sctx).confidence).toBe('Trusted');
    }
  });

  it('every switch changes at least one question', () => {
    for (const sw of SWITCHES) {
      const changed = scenarios.some((ks) => runKnockout(pack, ks, { ...ALL_ON, [sw.id]: false }, sctx).failures.length > 0);
      expect(changed, sw.id).toBe(true);
    }
  });

  it('two layers off combine both failures', () => {
    const ks = scenarios.find((k) => k.affects.length >= 2)!;
    const [l1, l2] = ks.affects;
    const run = runKnockout(pack, ks, { ...ALL_ON, [l1]: false, [l2]: false }, sctx);
    expect(run.failures.map((f) => f.layer).sort()).toEqual([l1, l2].sort());
  });
});

// ------------------------------------------------------------------ Wave 2
import { coverage, levelHistogram, reportStatus, groupBy } from '../src/ext/coverage';
import { ACTIVITIES, raciFor } from '../src/ext/raci';
import { computeCost, defaultLevers, slaBreaches } from '../src/ext/cost';
import { applyIncidents, kpisAtRisk, productHealth } from '../src/ext/health';
import { defaultExt } from '../src/ext/state';

describe('E5 coverage', () => {
  const acc = (id: string) => pack.agents.find((a) => a.id === id)!.evalAccuracy;
  const rows = coverage({ pack, live, accuracy: acc });

  it('summary totals equal the heatmap rows', () => {
    expect(levelHistogram(rows).reduce((a, b) => a + b, 0)).toBe(rows.length);
    expect(groupBy(rows, 'source').reduce((a, g) => a + g.rows.length, 0)).toBe(rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(50);
  });

  it('DP-05 certification moves its source tables to Productized', () => {
    const before = rows.filter((r) => r.consumedBy?.includes('DP-05'));
    expect(before.length).toBeGreaterThan(0);
    for (const r of before) expect(r.levelNow, r.table).toBe(4);
    const certified = { ...live, productStatus: { ...live.productStatus, 'DP-05': 'Certified' as const } };
    for (const r of coverage({ pack, live: certified, accuracy: () => 80 }).filter((x) => x.consumedBy?.includes('DP-05'))) expect(r.levelNow, r.table).toBe(5);
  });

  it('has at least one legacy report in each status', () => {
    const st = pack.ext!.legacyReports.map((r) => reportStatus(pack, live, r.kpiIds, r.missing).status);
    for (const s of ['Replaced', 'Partially covered', 'Not covered']) expect(st).toContain(s);
  });
});

describe('E7 operating model', () => {
  it('every activity has exactly one A in every style', () => {
    expect(ACTIVITIES.length).toBeGreaterThanOrEqual(22);
    for (const style of ['centralized', 'hub', 'federated'] as const) {
      for (const [name, , , cells] of raciFor(style)) expect(Object.values(cells).filter((v) => v === 'A' || v === 'A/R').length, `${style}: ${name}`).toBe(1);
    }
  });

  it('switching style changes at least eight cells', () => {
    const hub = raciFor('hub');
    for (const style of ['centralized', 'federated'] as const) {
      let n = 0;
      raciFor(style).forEach(([, , , c], i) => { for (const k of Object.keys({ ...c, ...hub[i][3] })) if ((c as Record<string, string>)[k] !== (hub[i][3] as Record<string, string>)[k]) n++; });
      expect(n, style).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('E8 cost', () => {
  const lv = defaultLevers(pack);
  it('recomputes from config and is consistent across views', () => {
    const r = computeCost(pack, lv);
    expect(r.total).toBeGreaterThan(0);
    expect(Object.values(r.byLayer).reduce((a, b) => a + b, 0)).toBeCloseTo(r.total, 6);
    expect(r.months[5].total).toBeCloseTo(r.total, 6);
    const doubled = computeCost(pack, { ...lv, creditPrice: lv.creditPrice * 2 });
    const storage = r.items.filter((i) => i.driver === 'Storage').reduce((a, i) => a + i.usd, 0);
    // Credit-based costs double with the credit price; storage is billed per TB and does not change.
    expect(doubled.total - storage).toBeCloseTo((r.total - storage) * 2, 6);
    expect(slaBreaches(pack, lv).size).toBe(0);
  });

  it('a longer target lag cuts refresh cost and breaches an SLA', () => {
    const slow = { ...lv, lagMinutes: { ...lv.lagMinutes, 'DP-03': 240 } };
    expect(computeCost(pack, slow).total).toBeLessThan(computeCost(pack, lv).total);
    expect(slaBreaches(pack, slow).has('DP-03')).toBe(true);
  });
});

describe('E9 incidents', () => {
  const a = persona(pack, 'A');
  const withOpen = (...ids: string[]) => ({ ...defaultExt(), incidents: { open: ids.map((id) => ({ id, openedAt: '2026-10-04T10:00:00Z' })), postmortems: [] } });
  const ask = (agentId: string, q: string) => respond(pack, agentId, q, a, live, () => 'G');

  it('has five incidents that reference real objects, products and agents', () => {
    expect(pack.ext!.incidents).toHaveLength(5);
    for (const i of pack.ext!.incidents) {
      expect(pack.objects.some((o) => `${o.schema}.${o.name}` === i.objectFqn), i.id).toBe(true);
      for (const x of i.affects) expect(pack.products.some((p) => p.id === x.productId), i.id).toBe(true);
      for (const e of i.agentEffect) expect(pack.agents.some((ag) => ag.id === e.agentId), i.id).toBe(true);
    }
  });

  it('flags products, KPIs and agent answers while open, and two incidents combine', () => {
    const ext = withOpen('INC-2', 'INC-3');
    expect(productHealth(pack, ext, 'DP-03').status).toBe('Down');
    expect(productHealth(pack, ext, 'DP-05').status).toBe('Degraded');
    expect(productHealth(pack, ext, 'DP-04').status).toBe('Healthy');
    expect(kpisAtRisk(pack, ext).has('K-20')).toBe(true);
    const bill = applyIncidents(pack, ext, 'AG-01', ask('AG-01', 'What was the average monthly residential bill last quarter by region?'));
    expect(bill.banner).toBe('incident');
    expect(bill.table).toBeUndefined();
    expect(bill.trace.some((t) => t.title === 'Health check' && t.layer === 'gov')).toBe(true);
    // Resolving INC-3 leaves INC-2's effect in place.
    const one = withOpen('INC-2');
    expect(productHealth(pack, one, 'DP-03').status).toBe('Healthy');
    expect(applyIncidents(pack, one, 'AG-01', ask('AG-01', 'What was the average monthly residential bill last quarter by region?')).banner).toBe('incident');
  });

  it('warn mode keeps the answer and adds a caveat', () => {
    const ans = applyIncidents(pack, withOpen('INC-1'), 'AG-02', ask('AG-02', 'Compare SAIFI this year with last year'));
    expect(ans.summary).toMatch(/6 h ago/);
    expect(ans.kind).toBe('answer');
  });

  it('closed incidents have no effect', () => {
    const q = ask('AG-01', 'What was the average monthly residential bill last quarter by region?');
    expect(applyIncidents(pack, defaultExt(), 'AG-01', q)).toBe(q);
  });
});
