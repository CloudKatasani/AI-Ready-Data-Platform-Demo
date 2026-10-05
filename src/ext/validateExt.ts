// Enhancement contract checks (spec "Shared data contracts and pack additions"), run by validate:pack when a pack
// carries an `ext` block. Every rule here mirrors an acceptance criterion from E1–E11.
import type { IndustryPack, LiveState } from '../types';
import { respond } from '../agents/engine/respond';
import { MockSnowflake } from '../mock-snowflake';
import { runKnockout } from './knockout';
import { ALL_ON, SWITCHES } from './types';
import { coverage, levelHistogram, reportStatus } from './coverage';
import { analyzeImpact } from './impact';
import { accuracyOf, runEval } from './quality';
import { defaultExt } from './state';
import { creatorOf, STEPS } from './buildGuide';
import { DEFAULT_TOOLING } from './state';
import { applyIncidents, productHealth } from './health';
import { computeCost, defaultLevers } from './cost';

export function validateExt(pack: IndustryPack, live: LiveState, check: (ok: boolean, msg: string) => void): void {
  const x = pack.ext;
  if (!x) return;
  const ids = new Set(pack.objects.map((o) => `${o.schema}.${o.name}`));
  const obj = (fqn: string) => pack.objects.find((o) => `${o.schema}.${o.name}` === fqn);
  const prod = new Set(pack.products.map((p) => p.id));
  const agents = new Set(pack.agents.map((a) => a.id));
  const scen = new Set(pack.scenarios.map((s) => s.id));
  const ext = defaultExt();
  const safe = <T,>(f: () => T, msg: string): T | undefined => { try { return f(); } catch (e) { check(false, `${msg}: threw ${(e as Error).message}`); return undefined; } };

  // E1 / E2 knockout
  check(x.knockoutScenarios.length >= 4, `ext.knockoutScenarios: need ≥ 4 (got ${x.knockoutScenarios.length})`);
  check(x.knockoutScenarios.filter((k) => k.raw).length >= 3, 'ext.knockoutScenarios: need ≥ 3 with a raw variant');
  for (const persona of [pack.personas.find((p) => p.archetype === 'A')!, pack.personas.find((p) => p.archetype === 'D')!]) {
    const ctx = { persona, live };
    for (const k of x.knockoutScenarios) {
      const s = pack.scenarios.find((y) => y.id === k.scenarioId);
      check(Boolean(s) && s!.agentId === k.agentId, `${k.id}: scenario ${k.scenarioId} missing or on another agent`);
      const gov = safe(() => k.compute(ALL_ON, ctx), `${k.id} compute(all on)`);
      const ans = safe(() => respond(pack, k.agentId, k.question, persona, live, () => 'G'), `${k.id} respond`);
      if (gov && ans) {
        check(ans.scenarioId === k.scenarioId, `${k.id}: question does not match ${k.scenarioId} in Agent Studio`);
        check(ans.summary.includes(gov.valueText), `${k.id} (${persona.roleId}): governed "${gov.valueText}" not in the Agent Studio answer`);
      }
      const run = safe(() => runKnockout(pack, k, ALL_ON, ctx), `${k.id} runKnockout`);
      check(run?.confidence === 'Trusted', `${k.id}: all layers on must be Trusted`);
      if (k.raw) safe(() => { const r = k.raw!(ctx); check(r.risks.length > 0 && r.tablesUsed.length > 0, `${k.id}: raw variant needs risks and tables`); }, `${k.id} raw`);
    }
    // Governance only bites for a restricted role, so switch coverage is judged for the analyst.
    if (persona.archetype === 'A') for (const sw of SWITCHES) {
      const changed = x.knockoutScenarios.some((k) => (safe(() => runKnockout(pack, k, { ...ALL_ON, [sw.id]: false }, ctx), `${k.id} ${sw.id} off`)?.failures.length ?? 0) > 0);
      check(changed, `switch "${sw.id}" changes no knockout question (${persona.roleId})`);
    }
  }

  // E3 build guide: every catalog object is created by exactly one step
  const db = new MockSnowflake(pack);
  const bctx = { pack, db, tooling: DEFAULT_TOOLING, live };
  const counts = new Map<string, number>();
  for (const s of STEPS) for (const o of safe(() => s.creates(bctx), `build step ${s.id}`) ?? []) counts.set(o, (counts.get(o) ?? 0) + 1);
  for (const id of ids) check(counts.get(id) === 1, `build guide: ${id} created by ${counts.get(id) ?? 0} steps`);
  check(Boolean(creatorOf(bctx, [...ids][0])), 'build guide: creatorOf failed');

  // E4 / E6
  check(x.roadmapDefaults.phase >= 0 && x.roadmapDefaults.phase <= 6, 'ext.roadmapDefaults.phase must be 0–6');
  check(['early', 'mid', 'advanced'].includes(x.readinessPreset.defaultProfile), 'ext.readinessPreset.defaultProfile invalid');
  check(x.domains.length > 0, 'ext.domains is empty');

  // E5 coverage
  check(x.sourceInventory.length >= 50, `ext.sourceInventory: need ~60 tables (got ${x.sourceInventory.length})`);
  for (const t of x.sourceInventory) {
    if (t.lands) check(ids.has(t.lands) && obj(t.lands)!.layer === 'bronze', `inventory ${t.source}.${t.table}: lands ${t.lands} is not a RAW_BRONZE object`);
    for (const c of t.carries ?? []) { const [s, n, col] = c.split('.'); check(Boolean(obj(`${s}.${n}`)?.columns.some((y) => y.name === col)), `inventory ${t.table}: carries unknown column ${c}`); }
    for (const p of t.consumedBy ?? []) check(prod.has(p), `inventory ${t.table}: consumedBy unknown product ${p}`);
  }
  const rows = safe(() => coverage({ pack, live, accuracy: (id) => accuracyOf(runEval(pack, ext, id)) }), 'coverage') ?? [];
  const hist = levelHistogram(rows);
  check(hist.filter((n) => n > 0).length >= 5, `coverage: tables should spread over ≥ 5 levels (got ${hist.join('/')})`);
  check(rows.some((r) => r.consumedBy?.includes('DP-05') && r.levelNow === 4), 'coverage: at least one table must wait on DP-05 certification (level 4, consumedBy DP-05)');
  const certified = { ...live, productStatus: { ...live.productStatus, 'DP-05': 'Certified' as const } };
  const after = safe(() => coverage({ pack, live: certified, accuracy: () => 0 }), 'coverage after DP-05') ?? [];
  check(after.filter((r) => r.consumedBy?.includes('DP-05')).every((r) => r.levelNow >= 5), 'coverage: DP-05 tables must reach Productized once DP-05 is certified');
  check(x.legacyReports.length >= 35, `ext.legacyReports: need ~40 (got ${x.legacyReports.length})`);
  for (const r of x.legacyReports) for (const k of r.kpiIds) check(pack.kpis.some((y) => y.id === k), `legacy report ${r.id}: unknown KPI ${k}`);
  const statuses = new Set(x.legacyReports.map((r) => reportStatus(pack, live, r.kpiIds, r.missing).status));
  for (const s of ['Replaced', 'Partially covered', 'Not covered']) check(statuses.has(s as never), `legacy reports: none is "${s}"`);

  // E8 cost
  const cost = safe(() => computeCost(pack, defaultLevers(pack)), 'cost');
  check(Boolean(cost && cost.total > 0), 'cost: total must be > 0');

  // E9 incidents
  check(x.incidents.length === 5, `ext.incidents: need 5 (got ${x.incidents.length})`);
  for (const i of x.incidents) {
    check(ids.has(i.objectFqn), `${i.id}: unknown object ${i.objectFqn}`);
    if (i.column) check(Boolean(obj(i.objectFqn)?.columns.some((c) => c.name === i.column)), `${i.id}: unknown column ${i.column}`);
    for (const a of i.affects) check(prod.has(a.productId), `${i.id}: unknown product ${a.productId}`);
    for (const e of i.agentEffect) { check(agents.has(e.agentId), `${i.id}: unknown agent ${e.agentId}`); for (const s of e.scenarioIds ?? []) check(scen.has(s), `${i.id}: unknown scenario ${s}`); }
    const open = { ...ext, incidents: { open: [{ id: i.id, openedAt: '' }], postmortems: [] } };
    check(i.affects.every((a) => productHealth(pack, open, a.productId).status === a.status), `${i.id}: product health does not follow affects`);
    const e0 = i.agentEffect[0];
    const s0 = pack.scenarios.find((s) => s.agentId === e0?.agentId && (!e0.scenarioIds || e0.scenarioIds.includes(s.id)));
    if (e0 && s0) {
      const D = pack.personas.find((p) => p.archetype === 'D')!;
      const a = safe(() => applyIncidents(pack, open, e0.agentId, respond(pack, e0.agentId, s0.question, D, live, () => 'G')), `${i.id} agent effect`);
      check(Boolean(a?.trace.some((t) => t.title === 'Health check')), `${i.id}: agent answer for "${s0.question}" gains no Health check step`);
    }
  }

  // E10 agent quality
  const fs = x.feedbackScript;
  check(Boolean(fs) && agents.has(fs.agentId), 'ext.feedbackScript missing or unknown agent');
  if (fs) {
    check(pack.glossary.some((g) => g.id === fs.termId), `feedbackScript: unknown term ${fs.termId}`);
    for (const p of fs.productIds) check(prod.has(p), `feedbackScript: unknown product ${p}`);
    check(!pack.context.rules.some((r) => r.id === fs.rule.id), `feedbackScript: rule ${fs.rule.id} already exists in the pack`);
    check(fs.paraphrases.length >= 2, 'feedbackScript: need ≥ 2 paraphrases');
    const cats = fs.evalItems.map((e) => e.category).sort().join(',');
    check(cats === 'ambiguous_term,ambiguous_term,missing_rule,missing_rule,missing_rule,wrong_join', `feedbackScript.evalItems: need 3 missing_rule, 2 ambiguous_term, 1 wrong_join (got ${cats})`);
    check(new Set(fs.evalItems.map((e) => e.fix)).size === 4, 'feedbackScript.evalItems: the four fix types must each flip a question');
    for (const persona of pack.personas) {
      const c = { persona, live };
      const t = safe(() => fs.compute(true, c), 'feedbackScript.compute(true)');
      const f = safe(() => fs.compute(false, c), 'feedbackScript.compute(false)');
      if (t && f) check(t.valueText !== f.valueText, `feedbackScript (${persona.roleId}): the rule must change the answer (${t.valueText})`);
      for (const e of fs.evalItems) { const a = safe(() => e.expected(c), `${e.id} expected`); const b = safe(() => e.wrong(c), `${e.id} wrong`); check(Boolean(a && b && a !== b), `${e.id}: expected and wrong answers must differ`); }
    }
    check(accuracyOf(runEval(pack, ext, fs.agentId, [])) === 88, `${fs.agentId} must start at 88% (got ${accuracyOf(runEval(pack, ext, fs.agentId, []))}%)`);
    check(accuracyOf(runEval(pack, ext, fs.agentId, ['rule'])) === 94, `${fs.agentId} must reach 94% after the rule fix`);
    for (const a of pack.agents) for (const r of runEval(pack, ext, a.id, []).filter((y) => y.id.includes('-E'))) check(r.result === 'pass', `eval ${r.id}: "${r.question}" does not match its scenario`);
  }

  // E11 impact
  check(x.impactPresets.length === 4, `ext.impactPresets: need 4 (got ${x.impactPresets.length})`);
  for (const p of x.impactPresets) {
    check(Boolean(obj(p.objectFqn)?.columns.some((c) => c.name === p.column)), `${p.id}: unknown column ${p.objectFqn}.${p.column}`);
    const r = safe(() => analyzeImpact(pack, live, p), `${p.id} impact`);
    check((r?.nodes.length ?? 0) >= 4, `${p.id}: blast radius reaches fewer than 4 nodes`);
    check(Boolean(r?.nodes.some((n) => n.stage === 'product')), `${p.id}: reaches no data product`);
  }
}
