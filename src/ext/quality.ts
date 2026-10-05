// E10 agent quality: eval sets, accuracy recomputed from the current context state, and the fixes that write to the
// CONTEXT and SEMANTIC layers.
import type { AgentAnswer, BusinessRule, IndustryPack, Persona, ScenarioContext, Synonym, TraceStep, VerifiedQuery } from '../types';
import { respond } from '../agents/engine/respond';
import type { ExtState, FailCategory, FixType } from './state';

export const CATEGORY_LABEL: Record<FailCategory, string> = {
  wrong_metric: 'Wrong metric', missing_rule: 'Missing business rule', ambiguous_term: 'Ambiguous term', wrong_join: 'Wrong join', access_gap: 'Access gap', stale_data: 'Stale data',
};
export const FIX_LABEL: Record<FixType, string> = { rule: 'Add business rule', verified_query: 'Add verified query', synonym: 'Add synonym', relationship: 'Fix semantic relationship' };
export const FIX_FOR: Partial<Record<FailCategory, FixType>> = { missing_rule: 'rule', ambiguous_term: 'synonym', wrong_join: 'relationship', wrong_metric: 'verified_query' };

export interface EvalRow {
  id: string;
  question: string;
  category?: FailCategory;
  expected: string;
  actual: string;
  result: 'pass' | 'fail';
  fix?: FixType;
}

const firstSentence = (s: string) => (s.match(/^[^.!?\n]*(?:[.!?](?=\s|$)|$)/)?.[0] ?? s).trim().slice(0, 160);
const TEMPLATES = [(q: string) => q, (q: string) => `Can you tell me ${q.charAt(0).toLowerCase()}${q.slice(1)}`, (q: string) => `Quick question: ${q}`, (q: string) => `${q.replace(/\?$/, '')} please`];
const STATIC_FAILS: FailCategory[] = ['stale_data', 'access_gap', 'wrong_metric'];

/** An eval persona: the data steward, without row filters, so expected values are the full-population answers. */
function evalPersona(pack: IndustryPack): Persona {
  const p = pack.personas.find((x) => x.archetype === 'D') ?? pack.personas[0];
  return { ...p, rowFilter: undefined };
}

const cache = new Map<string, EvalRow[]>();

/** Size of an agent's eval set (the pack's evalQuestions). */
export const evalSize = (pack: IndustryPack, agentId: string) => pack.agents.find((a) => a.id === agentId)?.evalQuestions ?? 25;

/**
 * Run an agent's eval set against a given fix state. Passing questions go through the real answer engine; the
 * scripted AG-01 failures pass only once their fix is in the context or semantic state.
 */
export function runEval(pack: IndustryPack, ext: Pick<ExtState, 'quality'>, agentId: string, fixes: FixType[] = ext.quality.evaluated): EvalRow[] {
  const key = `${pack.profile.id}|${agentId}|${[...fixes].sort().join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const agent = pack.agents.find((a) => a.id === agentId);
  if (!agent) return [];
  const persona = evalPersona(pack);
  const live = { productStatus: Object.fromEntries(pack.products.map((p) => [p.id, p.status])), productVersion: Object.fromEntries(pack.products.map((p) => [p.id, p.version])), fixes: {} };
  const ctx: ScenarioContext = { persona, live };
  const n = evalSize(pack, agentId);
  const fs = pack.ext?.feedbackScript;
  const scripted = fs && fs.agentId === agentId ? fs.evalItems : [];
  const staticFails = scripted.length ? 0 : Math.round(n * (1 - agent.evalAccuracy / 100));
  const passing = n - scripted.length - staticFails;

  const scenarios = pack.scenarios.filter((s) => s.agentId === agentId);
  const pool: { q: string; s: (typeof scenarios)[number] }[] = [];
  for (let t = 0; t < TEMPLATES.length && pool.length < passing + staticFails; t++) {
    for (let v = 0; v < 4; v++) for (const s of scenarios) { const base = [s.question, ...s.paraphrases][v]; if (base) pool.push({ q: TEMPLATES[t](base), s }); }
  }
  const rows: EvalRow[] = [];
  const expectedOf = new Map<string, string>();
  const expected = (s: (typeof scenarios)[number]) => {
    if (!expectedOf.has(s.id)) { try { expectedOf.set(s.id, firstSentence(s.run(ctx).summary)); } catch { expectedOf.set(s.id, s.question); } }
    return expectedOf.get(s.id)!;
  };
  pool.slice(0, passing).forEach(({ q, s }, i) => {
    let ans: AgentAnswer | undefined;
    try { ans = respond(pack, agentId, q, persona, live, () => 'G'); } catch { ans = undefined; }
    const ok = ans?.scenarioId === s.id;
    rows.push({ id: `${agentId}-E${String(i + 1).padStart(2, '0')}`, question: q, expected: expected(s), actual: ok ? firstSentence(ans!.summary) : ans ? `Answered a different question: ${firstSentence(ans.summary)}` : 'No answer', result: ok ? 'pass' : 'fail', category: ok ? undefined : 'wrong_metric' });
  });
  pool.slice(passing, passing + staticFails).forEach(({ q, s }, i) => {
    const cat = STATIC_FAILS[i % STATIC_FAILS.length];
    rows.push({ id: `${agentId}-F${i + 1}`, question: q, category: cat, expected: expected(s), actual: cat === 'stale_data' ? 'Answered from yesterday’s snapshot (refresh lag)' : cat === 'access_gap' ? 'Declined: the eval role lacked a grant on a supporting table' : 'Used a near-match metric instead of the governed one', result: 'fail' });
  });
  for (const it of scripted) {
    const ok = fixes.includes(it.fix);
    rows.push({ id: it.id, question: it.question, category: it.category, fix: it.fix, expected: it.expected(ctx), actual: ok ? it.expected(ctx) : it.wrong(ctx), result: ok ? 'pass' : 'fail' });
  }
  cache.set(key, rows);
  return rows;
}

export function accuracyOf(rows: EvalRow[]): number {
  return rows.length ? Math.round((rows.filter((r) => r.result === 'pass').length / rows.length) * 100) : 0;
}

export function agentAccuracy(pack: IndustryPack, ext: ExtState, agentId: string): number {
  return accuracyOf(runEval(pack, ext, agentId));
}

export const statusOf = (acc: number) => (acc >= 90 ? 'Meets bar' : acc >= 85 ? 'At risk' : 'Below bar');

/** Eight weekly runs: seven synthetic weeks drifting up to the initial accuracy, then the latest run. */
export function trend(agentId: string, initial: number, current: number): number[] {
  const weeks = Array.from({ length: 7 }, (_, i) => Math.min(100, Math.round(initial - 4 + (4 * i) / 6 + (((i * 7 + agentId.length) % 3) - 1))));
  return [...weeks, current];
}

// ------------------------------------------------------------------------------------------- live context additions
export function liveRules(pack: IndustryPack, ext: ExtState): BusinessRule[] {
  const fs = pack.ext?.feedbackScript;
  return fs && ext.quality.fixes.includes('rule') ? [...pack.context.rules, fs.rule] : pack.context.rules;
}
export function extraVerifiedQueries(pack: IndustryPack, ext: ExtState): VerifiedQuery[] {
  const fs = pack.ext?.feedbackScript;
  if (!fs || !ext.quality.fixes.includes('verified_query')) return [];
  const p = pack.products.find((x) => x.id === fs.productIds[0]);
  const persona = evalPersona(pack);
  const live = { productStatus: {}, productVersion: {}, fixes: {} };
  return [{ id: `VQ-${String(pack.context.verifiedQueries.length + 50).padStart(3, '0')}`, semanticView: p?.semanticView ?? pack.semanticViews[0]?.name ?? '', question: fs.question, sql: fs.compute(true, { persona, live }).sql, verifiedBy: 'DATA_STEWARD (feedback fix)', verifiedOn: '2026-10-04' }];
}
export function liveSynonyms(pack: IndustryPack, ext: ExtState): Synonym[] {
  const fs = pack.ext?.feedbackScript;
  return fs && ext.quality.fixes.includes('synonym') ? [...pack.context.synonyms, fs.synonym] : pack.context.synonyms;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The scripted feedback questions (the improvement loop and its eval items) are answered from the feedback script, so
 * each fix visibly changes the answer in Agent Studio. Returns undefined for any other question.
 */
export function feedbackAnswer(pack: IndustryPack, ext: ExtState, agentId: string, q: string, ctx: ScenarioContext, base: AgentAnswer): AgentAnswer | undefined {
  const fs = pack.ext?.feedbackScript;
  if (!fs || fs.agentId !== agentId) return undefined;
  const item = fs.evalItems.find((x) => norm(x.question) === norm(q));
  const loop = [fs.question, ...fs.paraphrases].some((x) => norm(x) === norm(q));
  if (!loop && !item) return undefined;
  const fixes = ext.quality.fixes;
  const fix = item && item.fix !== 'rule' ? item.fix : 'rule';
  const fixed = fixes.includes(fix);
  const rule = fixes.includes('rule') || (fix !== 'rule' && fixed);
  const vq = extraVerifiedQueries(pack, ext)[0];
  const r = fs.compute(rule, ctx);
  const term = pack.glossary.find((g) => g.id === fs.termId);
  const p = pack.products.find((x) => x.id === fs.productIds[0]);
  if (fix === 'synonym' && !fixed) {
    return { ...base, kind: 'clarify', summary: `I’m not sure what “${fs.synonym.synonym}” means here. Did you mean ${fs.synonym.term}?`, table: undefined, chart: undefined, sql: '', sources: [], trace: [{ layer: 'glossary', title: 'Understand the question', detail: `“${fs.synonym.synonym}” is not a term or synonym in the glossary, so I asked instead of guessing.`, ms: 280, refs: [] }], suggestions: [fs.question], banner: undefined };
  }
  const contextDetail = fix === 'synonym' ? `Synonym “${fs.synonym.synonym}” → ${fs.synonym.term}.` : fix === 'verified_query' ? (fixed && vq ? `Verified query ${vq.id} matched this question.` : 'No verified query matched: the filter in the question was interpreted loosely.') : fix === 'relationship' ? (fixed ? `Semantic relationship “${fs.relationship.label}” used: ${fs.relationship.detail}.` : 'No relationship to the latest statement: joined every statement.') : rule ? `Rule ${fs.rule.id}: ${fs.rule.text}${vq ? ` Verified query ${vq.id} matched.` : ''}` : 'No business rule found for this metric’s scope: answered with the raw definition.';
  const wrongNow = item && item.fix !== 'rule' && !fixed;
  const trace: TraceStep[] = [
    { layer: 'glossary', title: 'Understand the question', detail: `Resolved the question to ${term ? `${term.term} (${term.id}${term.isCde ? ', CDE' : ''})` : 'the governed term'}.`, ms: 310, refs: term ? [{ kind: 'term', id: term.id, label: term.term }] : [] },
    { layer: fix === 'relationship' ? 'semantic' : 'context', title: fix === 'relationship' ? 'Plan the joins' : 'Apply business context', detail: contextDetail, ms: 240, refs: [...(rule && fix === 'rule' ? [{ kind: 'rule' as const, id: fs.rule.id }] : []), ...(fix === 'relationship' ? [{ kind: 'view' as const, id: fs.relationship.view }] : [])] },
    ...base.trace.filter((t) => t.layer === 'gov' || t.layer === 'product' || t.layer === 'agent'),
  ];
  return {
    ...base,
    kind: 'answer',
    summary: wrongNow ? `Total arrears balance is ${item!.wrong(ctx)}.` : r.summary,
    table: wrongNow ? undefined : r.table,
    chart: undefined,
    sql: r.sql,
    sources: p ? [{ productId: p.id, version: p.version, certified: p.status === 'Certified' }] : base.sources,
    trace,
    banner: undefined,
    suggestions: undefined,
    requestAssetId: undefined,
  };
}

/** Classify a thumbs-down into a failure category and suggested fix. */
export function classify(pack: IndustryPack, agentId: string, q: string, a: AgentAnswer): { category: FailCategory; fix?: FixType } {
  const fs = pack.ext?.feedbackScript;
  if (fs && fs.agentId === agentId && [fs.question, ...fs.paraphrases].some((x) => norm(x) === norm(q))) return { category: 'missing_rule', fix: 'rule' };
  if (a.kind === 'decline') return { category: 'access_gap' };
  if (a.kind === 'clarify') return { category: 'ambiguous_term', fix: 'synonym' };
  if (a.banner === 'incident') return { category: 'stale_data' };
  return { category: 'wrong_metric', fix: 'verified_query' };
}
