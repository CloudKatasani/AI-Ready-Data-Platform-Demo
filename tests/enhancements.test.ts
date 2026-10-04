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
