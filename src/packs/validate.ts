// Pack contract validator (spec section 4). Used by `npm run validate:pack` and the pack-contract tests.
import type { IndustryPack, LiveState, SchemaName } from '../types';
import { buildTrace } from '../agents/engine/trace';
import { Matcher } from '../agents/engine/matcher';
import { computeGates, gateStatus } from '../lib/certification';

const SCHEMAS: SchemaName[] = ['RAW_BRONZE', 'CURATED_SILVER', 'CONFORMED_GOLD', 'SEMANTIC', 'GLOSSARY', 'CONTEXT', 'DATA_PRODUCTS', 'AGENTS', 'GOVERNANCE'];
const SHARED: Record<string, string[]> = {
  GLOSSARY: ['BUSINESS_TERM', 'TERM_COLUMN_MAP', 'CDE_REGISTER'],
  CONTEXT: ['AGENT_INSTRUCTIONS', 'BUSINESS_RULES', 'VERIFIED_QUERIES', 'SYNONYMS'],
  DATA_PRODUCTS: ['DP_REGISTRY', 'DP_CONTRACT'],
  AGENTS: ['AGENT_REGISTRY', 'AGENT_EVAL_RESULTS'],
  GOVERNANCE: ['DMF_RESULTS', 'ACCESS_HISTORY_V'],
};

export interface ValidationResult { pack: string; errors: string[]; checks: number }

export function initialLive(pack: IndustryPack): LiveState {
  return {
    productStatus: Object.fromEntries(pack.products.map((p) => [p.id, p.status])),
    productVersion: Object.fromEntries(pack.products.map((p) => [p.id, p.version])),
    fixes: {},
  };
}

export function validatePack(pack: IndustryPack): ValidationResult {
  const errors: string[] = [];
  let checks = 0;
  const check = (ok: boolean, msg: string) => {
    checks++;
    if (!ok) errors.push(msg);
  };
  const ids = new Set(pack.objects.map((o) => `${o.schema}.${o.name}`));
  const count = (s: SchemaName, filter = (_: string) => true) => pack.objects.filter((o) => o.schema === s && filter(o.type)).length;

  // Company profile and schemas
  check(pack.database === `${pack.profile.dbPrefix}_AI_PLATFORM`, `database must be <PREFIX>_AI_PLATFORM (got ${pack.database})`);
  for (const s of SCHEMAS) check(count(s) > 0, `schema ${s} has no objects`);
  check(pack.objects.every((o) => SCHEMAS.includes(o.schema)), 'objects outside the nine schemas');
  for (const [s, names] of Object.entries(SHARED)) for (const n of names) check(ids.has(`${s}.${n}`), `shared table ${s}.${n} missing`);

  // Sources and physical objects
  check(pack.profile.sources.length >= 5 && pack.profile.sources.length <= 6, 'need 5–6 source systems');
  const bronzeTables = pack.objects.filter((o) => o.schema === 'RAW_BRONZE' && o.type === 'ICEBERG TABLE');
  check(bronzeTables.length >= 5 && bronzeTables.length <= 6, `Bronze tables: ${bronzeTables.length} (need 5–6)`);
  check(bronzeTables.filter((o) => o.columns.some((c) => c.name === 'OP_TYPE')).length >= 5, 'Bronze tables need OP_TYPE CDC columns');
  const silver = count('CURATED_SILVER');
  check(silver >= 5 && silver <= 6, `Silver objects: ${silver} (need 5–6)`);
  const gold = count('CONFORMED_GOLD');
  check(gold >= 8 && gold <= 10, `Gold objects: ${gold} (need 8–10)`);
  check(pack.objects.length >= 40, `about 45 objects expected, got ${pack.objects.length}`);
  for (const o of pack.objects) {
    for (const u of o.upstream) if (!u.startsWith('ext:')) check(ids.has(u), `${o.schema}.${o.name}: upstream ${u} does not exist`);
    if (['ICEBERG TABLE', 'DYNAMIC TABLE', 'TABLE', 'SECURE VIEW'].includes(o.type)) {
      check(o.columns.length > 0, `${o.name} has no columns`);
      check(Boolean(o.rows), `${o.name} has no sample-row generator`);
    }
  }

  // Semantic views
  check(pack.semanticViews.length === 4, `semantic views: ${pack.semanticViews.length} (need 4)`);
  for (const sv of pack.semanticViews) for (const t of sv.tables) check(ids.has(t.fqn), `${sv.name}: table ${t.fqn} missing`);

  // Glossary
  const g = pack.glossary;
  check(g.length >= 17, `glossary terms: ${g.length} (need ≥ 17)`);
  check(g.filter((t) => t.isCde).length >= 12, 'need ≥ 12 CDEs');
  check(g.filter((t) => t.status === 'Draft').length === 1, 'need exactly 1 Draft term');
  check(g.filter((t) => t.isCde && !t.steward).length === 1, 'need exactly 1 CDE without a steward');
  for (const t of g) for (const m of t.mappings) {
    const o = pack.objects.find((x) => `${x.schema}.${x.name}` === m.fqn);
    check(Boolean(o?.columns.some((c) => c.name === m.column)), `${t.id}: mapping ${m.fqn}.${m.column} does not exist`);
  }

  // Context
  const c = pack.context;
  for (const a of pack.agents) check(c.instructions.some((i) => i.agentId === a.id), `no instructions for ${a.id}`);
  check(c.rules.length >= 10, `rules: ${c.rules.length} (need ≥ 10)`);
  check(c.verifiedQueries.length >= 40, `verified queries: ${c.verifiedQueries.length} (need ≥ 40)`);
  check(c.synonyms.length >= 15, `synonyms: ${c.synonyms.length} (need ≥ 15)`);
  check(c.documents.length === 4, `documents: ${c.documents.length} (need 4)`);

  // Products and agents
  const ps = pack.products;
  check(ps.length === 6, 'need 6 data products');
  check(['DP-01', 'DP-02', 'DP-03', 'DP-04'].every((id) => ps.find((p) => p.id === id)?.status === 'Certified'), 'DP-01..04 must be Certified');
  check(ps.find((p) => p.id === 'DP-05')?.status === 'In certification', 'DP-05 must be In certification');
  check(ps.find((p) => p.id === 'DP-06')?.status === 'Draft', 'DP-06 must be Draft');
  for (const p of ps) check(ids.has(`DATA_PRODUCTS.${p.outputPort}`), `${p.id}: output port ${p.outputPort} missing`);
  check(pack.agents.length === 4 && pack.agents.filter((a) => a.tools.some((t) => t.kind === 'sql')).length === 1, 'need 3 domain agents + Data Steward Assistant');
  for (const a of pack.agents) check(ids.has(`AGENTS.${a.objectName}`), `agent object ${a.objectName} missing`);

  // KPIs
  check(pack.kpis.length >= 22, `KPIs: ${pack.kpis.length} (need ≥ 22)`);
  const metricNames = new Set(pack.semanticViews.flatMap((s) => s.metrics.map((m) => `${s.name}.${m.name}`)));
  const ports = new Set(ps.map((p) => p.outputPort));
  for (const k of pack.kpis) {
    check(g.some((t) => t.id === k.termId), `${k.id}: term ${k.termId} missing`);
    check(metricNames.has(k.metric) || ports.has(k.metric.split('.')[0]), `${k.id}: metric ${k.metric} missing`);
    check(pack.kpiRanges.some((r) => r.kpiId === k.id), `${k.id}: no target range`);
  }

  // Personas and access
  check(['A', 'B', 'C', 'D'].every((a) => pack.personas.filter((p) => p.archetype === a).length === 1), 'need personas on archetypes A–D');
  const archA = pack.personas.find((p) => p.archetype === 'A')!;
  const archD = pack.personas.find((p) => p.archetype === 'D')!;
  check(Boolean(archA?.rowFilter) && archA.unmasked.length === 0, 'archetype A needs a row filter and masked sensitive data');
  check(pack.profile.sensitiveClasses.every((s) => archD.unmasked.includes(s)), 'archetype D must see all sensitive classes');
  check(pack.initialAccess[archA.roleId]?.['DP-05'] === 'P', 'archetype A must hold a pending request for DP-05');

  // Scenarios: 15, computed, in range, full trace
  check(pack.scenarios.length === 15, `scenarios: ${pack.scenarios.length} (need 15)`);
  check(new Set(pack.scenarios.map((s) => s.pattern)).size === 15, 'scenarios must cover patterns 1–15');
  const live = initialLive(pack);
  const matcher = new Matcher(pack);
  for (const s of pack.scenarios) {
    const r = s.run({ persona: archD, live });
    check(r.summary.length > 20 && Boolean(r.sql), `${s.id}: empty answer`);
    const trace = buildTrace(pack, s, archD, live, r);
    check(trace.length >= 6, `${s.id}: trace has ${trace.length} steps`);
    for (const [kpiId, v] of Object.entries(r.kpiValues ?? {})) {
      const range = pack.kpiRanges.find((x) => x.kpiId === kpiId);
      check(Boolean(range) && v >= range!.min && v <= range!.max, `${s.id}: ${kpiId} = ${v} outside ${range?.min}–${range?.max}`);
    }
    for (const q of [s.question, ...s.paraphrases]) {
      const best = matcher.rank(q, s.agentId)[0];
      check(best?.scenario.id === s.id && best.score >= 0.45, `${s.id}: paraphrase not matched: "${q}"`);
    }
  }

  // Certification: DP-05 starts with exactly the two expected failures
  const dp05 = ps.find((p) => p.id === 'DP-05')!;
  const before = dp05.gates;
  check(before.slice(0, 3).every((x) => gateStatus(x) === 'pass') && before.slice(3).every((x) => gateStatus(x) === 'pending'), 'DP-05 must start with gates 1–3 passed and 4–8 not run');
  const ran = computeGates(pack, dp05, { ran: true, fixes: [] });
  const failing = ran.flatMap((x) => x.checks.filter((ch) => ch.status !== 'pass').map((ch) => `${x.id}:${ch.status}`));
  check(failing.join(',') === '4:warn,6:fail', `DP-05 must fail exactly gate 4 (warn) and gate 6 (fail); got ${failing.join(',') || 'none'}`);
  const fixed = computeGates(pack, dp05, { ran: true, fixes: pack.certificationScript.failures.map((f) => f.checkId) });
  check(fixed.every((x) => gateStatus(x) === 'pass'), 'DP-05 must pass every gate after both fixes');

  return { pack: pack.profile.id, errors, checks };
}
