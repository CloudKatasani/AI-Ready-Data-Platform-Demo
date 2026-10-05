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

// ------------------------------------------------------------------ Wave 3
import { accuracyOf, feedbackAnswer, runEval, statusOf } from '../src/ext/quality';
import { analyzeImpact } from '../src/ext/impact';

describe('E10 agent quality loop', () => {
  const ext = defaultExt();
  const fs = pack.ext!.feedbackScript;

  it('AG-01 starts at 88% (At risk) with six failures and reaches 94% after the rule fix', () => {
    const rows = runEval(pack, ext, 'AG-01', []);
    expect(rows).toHaveLength(50);
    expect(accuracyOf(rows)).toBe(88);
    expect(statusOf(88)).toBe('At risk');
    const fails = rows.filter((r) => r.result === 'fail');
    expect(fails.map((f) => f.category).sort()).toEqual(['ambiguous_term', 'ambiguous_term', 'missing_rule', 'missing_rule', 'missing_rule', 'wrong_join']);
    expect(accuracyOf(runEval(pack, ext, 'AG-01', ['rule']))).toBe(94);
  });

  it('every generated eval question is answered by the real engine', () => {
    for (const a of pack.agents) for (const r of runEval(pack, ext, a.id, []).filter((x) => x.id.includes('-E'))) expect(r.result, `${a.id}: ${r.question}`).toBe('pass');
  });

  it('each fix type flips at least one failing question', () => {
    const before = runEval(pack, ext, 'AG-01', []);
    for (const f of ['rule', 'verified_query', 'synonym', 'relationship'] as const) {
      const after = runEval(pack, ext, 'AG-01', [f]);
      expect(after.filter((r, i) => r.result === 'pass' && before[i].result === 'fail').length, f).toBeGreaterThan(0);
    }
  });

  it('the rule fix changes the Agent Studio answer, computed from data', () => {
    const a = persona(pack, 'A');
    const base = respond(pack, 'AG-01', fs.question, a, live, () => 'G');
    const before = feedbackAnswer(pack, ext, 'AG-01', fs.question, { persona: a, live }, base)!;
    const fixed = { ...ext, quality: { ...ext.quality, fixes: ['rule' as const] } };
    const after = feedbackAnswer(pack, fixed, 'AG-01', fs.question, { persona: a, live }, base)!;
    expect(before.summary).not.toEqual(after.summary);
    expect(fs.compute(true, { persona: a, live }).value).toBeLessThan(fs.compute(false, { persona: a, live }).value);
    expect(after.trace.some((t) => t.refs.some((r) => r.id === fs.rule.id))).toBe(true);
  });
});

describe('E11 impact analysis', () => {
  const presets = pack.ext!.impactPresets;
  it('has four presets on real catalog columns, and every node links to a screen', () => {
    expect(presets).toHaveLength(4);
    for (const p of presets) {
      expect(pack.objects.find((o) => `${o.schema}.${o.name}` === p.objectFqn)?.columns.some((c) => c.name === p.column), p.id).toBe(true);
      const r = analyzeImpact(pack, live, p);
      expect(r.nodes.length, p.id).toBeGreaterThan(3);
      for (const n of r.nodes) expect(n.route.length, n.id).toBeGreaterThan(0);
    }
  });

  it('applies the severity rules', () => {
    const drop = analyzeImpact(pack, live, { ...presets[2], change: 'drop' });
    expect(drop.nodes.filter((n) => ['silver', 'gold', 'semantic'].includes(n.stage)).every((n) => n.severity === 'breaking')).toBe(true);
    const rename = analyzeImpact(pack, live, presets[2]);
    expect(rename.nodes.filter((n) => n.stage === 'silver').every((n) => n.severity === 'review')).toBe(true);
    expect(rename.nodes.filter((n) => n.stage === 'gold').every((n) => n.severity === 'none')).toBe(true);
    const sem = analyzeImpact(pack, live, presets[1]);
    expect(sem.nodes.filter((n) => n.stage === 'semantic').every((n) => n.severity === 'review')).toBe(true);
  });

  it('recommends a major bump with the contract notice period for breaking changes', () => {
    const grain = analyzeImpact(pack, live, presets[3]);
    const c = grain.contracts.find((x) => x.productId === 'DP-03')!;
    expect(c.bump).toBe('major');
    expect(c.to.split('.')[0]).toBe(String(Number(c.from.split('.')[0]) + 1));
    expect(c.noticeDays).toBe(30);
    expect(analyzeImpact(pack, live, presets[0]).contracts.every((x) => x.bump === 'minor')).toBe(true);
  });
});
