// E6 AI-readiness assessment: shared question bank (7 dimensions × 3 questions, five anchored levels each),
// scoring, bands, presets and gap ranking. Packs can override question wording via ext.readinessPreset.wording.
import type { LayerId } from '../types';

export type ReadinessDim = 'foundation' | 'modelling' | 'semantics' | 'vocabulary' | 'context' | 'governance' | 'aiops';

export interface ReadinessQuestion { id: string; dim: ReadinessDim; text: string; levels: [string, string, string, string, string] }

export const DIMENSIONS: { id: ReadinessDim; label: string; layers: LayerId[]; weight: number; actions: [string, string] }[] = [
  { id: 'foundation', label: 'Data foundation', layers: ['bronze', 'silver'], weight: 1.0,
    actions: ['Land priority sources with CDC into Iceberg-backed Bronze', 'Add Silver dynamic tables with DQ expectations on CDEs'] },
  { id: 'modelling', label: 'Data modelling', layers: ['gold'], weight: 1.0,
    actions: ['Agree conformed dimensions for the first three use cases', 'Document Gold lineage and reconcile facts to source'] },
  { id: 'semantics', label: 'Semantics', layers: ['semantic'], weight: 1.2,
    actions: ['Define each priority metric once in a semantic view', 'Point BI and Cortex Analyst at the same semantic views'] },
  { id: 'vocabulary', label: 'Business vocabulary', layers: ['glossary'], weight: 1.2,
    actions: ['Stand up an owned glossary with CDE flags', 'Map every CDE column to an approved term and assign stewards'] },
  { id: 'context', label: 'Context & knowledge', layers: ['context'], weight: 1.0,
    actions: ['Capture business rules and verified queries per domain', 'Index policies and standards in Cortex Search'] },
  { id: 'governance', label: 'Governance & trust', layers: ['gov', 'product'], weight: 1.2,
    actions: ['Move to tag-based masking and row access policies', 'Certify data products through quality and governance gates'] },
  { id: 'aiops', label: 'AI operations & adoption', layers: ['agent'], weight: 1.0,
    actions: ['Create evaluation sets and a feedback loop per agent', 'Track agent usage and value against a pilot target'] },
];

const q = (id: string, dim: ReadinessDim, text: string, levels: ReadinessQuestion['levels']): ReadinessQuestion => ({ id, dim, text, levels });

export const QUESTIONS: ReadinessQuestion[] = [
  q('F1', 'foundation', 'How much priority source data lands in the platform with CDC?', [
    'Manual extracts, weekly or slower', 'Nightly batch extracts for a few sources', 'Daily batch for most priority sources', 'CDC for some priority sources, hourly or better', 'All priority sources via CDC, latency in minutes']),
  q('F2', 'foundation', 'How are raw records cleansed and deduplicated before use?', [
    'Each report cleans its own copy', 'Shared scripts, run by hand', 'Scheduled cleansing jobs without tests', 'Curated entities with DQ checks on key fields', 'Declarative curated layer (e.g. dynamic tables) with DQ expectations on every CDE']),
  q('F3', 'foundation', 'How is history kept for changing reference data?', [
    'Overwritten, no history', 'Occasional snapshots', 'Monthly snapshots for some entities', 'SCD2 for core entities', 'SCD2 everywhere it matters, replayable from CDC']),
  q('M1', 'modelling', 'Is there a conformed model shared across domains?', [
    'Report-specific tables', 'A few shared tables, inconsistent keys', 'Departmental star schemas', 'Conformed dimensions for core entities', 'Conformed Gold with documented lineage']),
  q('M2', 'modelling', 'How are facts reconciled back to source systems?', [
    'Not reconciled', 'Ad hoc when numbers look wrong', 'Monthly manual reconciliation', 'Automated reconciliation for key facts', 'Automated reconciliation with tolerances and alerts on every fact']),
  q('M3', 'modelling', 'How is model change managed?', [
    'Direct edits in production', 'Scripts in a shared folder', 'Version control without tests', 'Version-controlled models with tests in CI', 'Versioned models, tests, contracts and impact analysis before release']),
  q('S1', 'semantics', 'Are business metrics defined once and reused by BI and AI?', [
    'Defined in each report', 'A metric spreadsheet nobody maintains', 'BI semantic model for one tool only', 'Shared semantic layer for most metrics', 'Semantic views used by BI and agents']),
  q('S2', 'semantics', 'Are joins and grain encoded so tools cannot double count?', [
    'Every analyst writes joins', 'Documented join patterns', 'BI model handles some joins', 'Semantic relationships for core domains', 'All relationships and grains declared in semantic views']),
  q('S3', 'semantics', 'Do you keep verified questions with their answers?', [
    'No', 'A few examples in documents', 'Test queries per report', 'Verified queries for some metrics', 'Verified queries per semantic view, used to evaluate AI']),
  q('V1', 'vocabulary', 'Are terms and CDEs owned and mapped to data?', [
    'No glossary', 'Glossary document, not maintained', 'Glossary tool, partial ownership', 'Owned glossary, most CDEs mapped', 'Approved glossary, all CDEs mapped and stewarded']),
  q('V2', 'vocabulary', 'Do synonyms and local language resolve to the same term?', [
    'Not captured', 'Known informally', 'Listed for some terms', 'Synonyms maintained per domain', 'Synonyms maintained and used by search and agents']),
  q('V3', 'vocabulary', 'How are term definitions approved and changed?', [
    'No process', 'Email agreement', 'Committee, irregular', 'Defined workflow with stewards', 'Workflow with stewards, versioning and impact review']),
  q('C1', 'context', 'Are business rules and documents available to AI?', [
    'Tribal knowledge', 'In documents on shared drives', 'Partially written down in wikis', 'Rules captured for priority metrics', 'Rules, verified queries and indexed documents per domain']),
  q('C2', 'context', 'Can an assistant cite the policy behind an answer?', [
    'No', 'Users look it up themselves', 'Links in reports', 'Search over some policies', 'Indexed policies with citations in every relevant answer']),
  q('C3', 'context', 'Are agent instructions and guardrails defined and versioned?', [
    'No agents', 'Prompts in notebooks', 'Prompts per team, unversioned', 'Versioned instructions for some agents', 'Versioned persona, response, guardrail and orchestration instructions']),
  q('G1', 'governance', 'Are sensitive data, quality and access controlled by policy?', [
    'Manual, per request', 'Role grants per table', 'Some masking views', 'Policies on most sensitive columns', 'Tag-based policies, DMFs, certified products']),
  q('G2', 'governance', 'How is data quality measured and published?', [
    'Not measured', 'Spot checks', 'Scheduled checks, results not shared', 'Quality scores on key datasets', 'Data metric functions on every CDE, published with each product']),
  q('G3', 'governance', 'How do people find and request trusted data?', [
    'Ask around', 'A list of tables', 'A catalog with little curation', 'A catalog with owners and certification', 'An internal marketplace of certified products with request workflow']),
  q('A1', 'aiops', 'Are agents evaluated, monitored and adopted?', [
    'No AI in use', 'Experiments without evaluation', 'Pilots with manual testing', 'Evaluated agents with usage tracking', 'Eval sets, feedback loop, usage and value tracked']),
  q('A2', 'aiops', 'Do agents respect the same access rules as people?', [
    'No agents', 'Agents use a service account with broad access', 'Some row filtering in prompts', 'Agents run as the user for most data', 'Agents run as the user; masking and row policies apply automatically']),
  q('A3', 'aiops', 'How is agent feedback turned into improvements?', [
    'Not collected', 'Collected, not reviewed', 'Reviewed occasionally', 'Triage by an AI team', 'Steward-owned loop fixing rules, terms and queries, re-evaluated weekly']),
];

export const BANDS = [
  { min: 1.0, max: 1.9, label: 'Exploring' },
  { min: 2.0, max: 2.9, label: 'Foundational' },
  { min: 3.0, max: 3.9, label: 'Operational' },
  { min: 4.0, max: 4.5, label: 'AI-ready' },
  { min: 4.6, max: 5.0, label: 'AI-native' },
];

export const round1 = (v: number) => Math.round(v * 10) / 10;

export function bandOf(score: number): string {
  const s = round1(score);
  return BANDS.find((b) => s >= b.min && s <= b.max)?.label ?? (s < 1 ? 'Not assessed' : 'AI-native');
}

/** Dimension score = mean of its answered questions (1.0–5.0, one decimal); undefined when none answered. */
export function dimScore(dim: ReadinessDim, answers: Record<string, number>): number | undefined {
  const vals = QUESTIONS.filter((x) => x.dim === dim).map((x) => answers[x.id]).filter((v): v is number => typeof v === 'number');
  return vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : undefined;
}

export function overallScore(answers: Record<string, number>): number | undefined {
  const ds = DIMENSIONS.map((d) => dimScore(d.id, answers)).filter((v): v is number => v !== undefined);
  return ds.length === DIMENSIONS.length ? round1(ds.reduce((a, b) => a + b, 0) / ds.length) : undefined;
}

export const DEFAULT_TARGET = 4.0;

export interface Gap { dim: ReadinessDim; label: string; score: number; target: number; gap: number; weighted: number; actions: [string, string] }

/** Gaps ranked by gap size × dimension weight (Semantics, Vocabulary and Governance weigh 1.2). */
export function rankGaps(answers: Record<string, number>, targets: Record<string, number>): Gap[] {
  return DIMENSIONS.map((d) => {
    const score = dimScore(d.id, answers) ?? 1;
    const target = targets[d.id] ?? DEFAULT_TARGET;
    const gap = round1(Math.max(0, target - score));
    return { dim: d.id, label: d.label, score, target, gap, weighted: round1(gap * d.weight), actions: d.actions };
  })
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.weighted - a.weighted || b.gap - a.gap);
}

/** Example profiles (spec: Early cloud migration, Mid-migration BI-led, Advanced piloting AI). */
export const PRESETS: { id: 'early' | 'mid' | 'advanced'; label: string; answers: Record<string, number> }[] = [
  { id: 'early', label: 'Early cloud migration', answers: { F1: 2, F2: 1, F3: 2, M1: 1, M2: 2, M3: 2, S1: 1, S2: 1, S3: 1, V1: 1, V2: 1, V3: 2, C1: 1, C2: 1, C3: 1, G1: 2, G2: 1, G3: 2, A1: 1, A2: 1, A3: 1 } },
  { id: 'mid', label: 'Mid-migration, BI-led', answers: { F1: 4, F2: 3, F3: 3, M1: 3, M2: 3, M3: 3, S1: 2, S2: 2, S3: 1, V1: 2, V2: 1, V3: 2, C1: 2, C2: 1, C3: 1, G1: 3, G2: 2, G3: 2, A1: 2, A2: 1, A3: 1 } },
  { id: 'advanced', label: 'Advanced, piloting AI', answers: { F1: 5, F2: 4, F3: 4, M1: 4, M2: 4, M3: 4, S1: 4, S2: 3, S3: 3, V1: 4, V2: 3, V3: 3, C1: 3, C2: 3, C3: 3, G1: 4, G2: 4, G3: 3, A1: 3, A2: 3, A3: 2 } },
];

/** The pack's demo company profile, used as a reference overlay on the radar. */
export const DEMO_COMPANY_ANSWERS: Record<string, number> = Object.fromEntries(QUESTIONS.map((x) => [x.id, x.dim === 'aiops' ? 4 : 5]));

export function questionText(qq: ReadinessQuestion, wording?: Record<string, string>) {
  return wording?.[qq.id] ?? qq.text;
}
