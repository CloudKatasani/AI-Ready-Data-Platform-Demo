// E4 Implementation roadmap: six phases with gates, workstream activities and links to build steps and readiness.
import type { ReadinessDim } from './readiness';
import type { RoadmapDefaults, Workstream } from './types';

export const WORKSTREAMS: { id: Workstream; label: string }[] = [
  { id: 'platform', label: 'Platform' },
  { id: 'engineering', label: 'Data engineering' },
  { id: 'semantic', label: 'Semantic & glossary' },
  { id: 'products', label: 'Data products' },
  { id: 'ai', label: 'AI & agents' },
  { id: 'governance', label: 'Governance' },
  { id: 'change', label: 'Change & adoption' },
];

export interface RoadmapPhase {
  id: number;
  name: string;
  goal: string;
  weeks: [number, number];
  deliverables: string[];
  features: string[];
  gate: { label: string; proofRoute?: string };
  buildStepIds: string[];
  readinessDims: ReadinessDim[];
  activities: Partial<Record<Workstream, string>>;
  risks: [string, string, string];
  roles: string[];
}

export const PHASES: RoadmapPhase[] = [
  { id: 0, name: 'Mobilize', goal: 'Agree scope, owners and target use cases', weeks: [2, 4],
    deliverables: ['Readiness baseline', '3 priority use cases', 'Operating model and RACI', 'Environment plan'],
    features: ['Account setup', 'RBAC design'], gate: { label: 'Use cases and domain owners signed off', proofRoute: 'readiness/results' },
    buildStepIds: ['setup-database', 'setup-roles'], readinessDims: ['aiops', 'governance'],
    activities: { platform: 'Account, RBAC design', governance: 'Policy baseline', change: 'Use-case workshops' },
    risks: ['Use cases chosen for visibility rather than value', 'Domain owners named but not available', 'Security review starts too late'],
    roles: ['Platform owner', 'Data product owner', 'Governance lead'] },
  { id: 1, name: 'Foundation', goal: 'Land and cleanse priority sources', weeks: [6, 10],
    deliverables: ['CDC to Bronze', 'Silver entities', 'DQ rules', 'Cost guardrails'],
    features: ['Iceberg', 'Streams', 'Dynamic tables', 'Resource monitors'], gate: { label: 'Priority sources in Silver with DQ ≥ 95%', proofRoute: 'coverage' },
    buildStepIds: ['setup-warehouses', 'setup-monitors', 'bronze-cdc', 'bronze-volume', 'bronze-tables', 'bronze-streams', 'silver-main', 'silver-entities', 'silver-dq', 'silver-orchestration'], readinessDims: ['foundation'],
    activities: { platform: 'Warehouses, monitors', engineering: 'CDC, Bronze, Silver', governance: 'Tags on sensitive columns' },
    risks: ['Source CDC access delayed by DBA change windows', 'Deletes not captured, inflating counts', 'Lag set too low, inflating cost'],
    roles: ['Data engineer', 'Platform owner'] },
  { id: 2, name: 'Model', goal: 'Build conformed Gold for the use cases', weeks: [4, 8],
    deliverables: ['Conformed dimensions and facts', 'Documented lineage'],
    features: ['Dynamic tables', 'dbt', 'Lineage'], gate: { label: 'Gold reconciles to source within tolerance', proofRoute: 'explorer' },
    buildStepIds: ['gold-dims', 'gold-facts', 'gold-clustering'], readinessDims: ['modelling'],
    activities: { engineering: 'Gold dimensions and facts', semantic: 'Draft glossary', products: 'Product scoping' },
    risks: ['Legacy report logic copied without review', 'Grain mixed in facts', 'Keys not conformed across domains'],
    roles: ['Analytics engineer', 'Data engineer'] },
  { id: 3, name: 'Meaning', goal: 'Add semantics, vocabulary and judgment', weeks: [4, 6],
    deliverables: ['Semantic views', 'Glossary with CDEs', 'Business rules', 'Verified queries', 'Document search'],
    features: ['Semantic views', 'Cortex Analyst', 'Cortex Search', 'Tags'], gate: { label: 'Analyst eval accuracy ≥ 90% on 50 questions', proofRoute: 'agent-quality' },
    buildStepIds: ['semantic-views', 'semantic-vq', 'semantic-test', 'glossary-terms', 'glossary-map', 'glossary-tags', 'context-instructions', 'context-rules', 'context-search'], readinessDims: ['semantics', 'vocabulary', 'context'],
    activities: { semantic: 'Semantic views, glossary, rules', ai: 'Analyst tests', governance: 'CDE stewards' },
    risks: ['Metrics defined in BI and semantic view diverge', 'Glossary owners do not approve in time', 'Rules live only in SME heads'],
    roles: ['Analytics engineer', 'Data steward', 'Domain SME'] },
  { id: 4, name: 'Products', goal: 'Certify and publish the first data products', weeks: [4, 6],
    deliverables: ['3–4 certified products', 'Data contracts', 'Marketplace listings'],
    features: ['Secure views', 'DMFs', 'Internal Marketplace'], gate: { label: 'Products pass all eight certification gates', proofRoute: 'certify' },
    buildStepIds: ['product-ports', 'product-registry', 'product-dmf', 'product-listing', 'gov-tags', 'gov-masking', 'gov-rap'], readinessDims: ['governance'],
    activities: { products: 'Certification, contracts', governance: 'Masking, row access', change: 'Marketplace launch' },
    risks: ['Certification treated as paperwork', 'Sensitive column missed by masking', 'No consumer named for a product'],
    roles: ['Data product owner', 'Data steward', 'Governance lead'] },
  { id: 5, name: 'Agents', goal: 'Release governed agents to pilot users', weeks: [4, 6],
    deliverables: ['2–3 agents', 'Eval sets', 'Feedback loop', 'Usage dashboards'],
    features: ['Cortex Agents', 'Snowflake Intelligence'], gate: { label: 'Agent eval ≥ 90%, pilot NPS target met', proofRoute: 'agent-quality' },
    buildStepIds: ['agent-spec', 'agent-grants', 'agent-eval'], readinessDims: ['aiops', 'context'],
    activities: { ai: 'Agents, evals, feedback', change: 'Pilot users and training', products: 'Product SLAs for agents' },
    risks: ['Agent given broad SQL access', 'No owner for feedback triage', 'Pilot users not trained on limits'],
    roles: ['AI engineer', 'Data steward', 'Consumer'] },
  { id: 6, name: 'Scale', goal: 'Repeat per domain and industrialize', weeks: [12, 12],
    deliverables: ['Domain onboarding playbook', 'FinOps', 'Incident runbooks'],
    features: ['Alerts', 'Budgets', 'Access history'], gate: { label: 'Each new domain follows phases 1–5', proofRoute: 'health' },
    buildStepIds: ['gov-monitoring'], readinessDims: ['governance', 'aiops'],
    activities: { platform: 'FinOps, budgets', governance: 'Audits, incident runbooks', change: 'Domain onboarding', engineering: 'Next domains' },
    risks: ['Each domain reinvents its pipeline patterns', 'Costs grow faster than adoption', 'Incidents handled outside the runbook'],
    roles: ['Platform owner', 'Governance lead'] },
];

/** Default planning duration of a phase in weeks (upper bound of its range, midpoint for long ranges). */
export const defaultWeeks = (p: RoadmapPhase) => Math.round((p.weeks[0] + p.weeks[1]) / 2);

export interface PlacedPhase extends RoadmapPhase { start: number; length: number }

/** Lay phases end to end from week 0 using the (possibly edited) durations. */
export function layout(weeks: Record<number, number>): PlacedPhase[] {
  let t = 0;
  return PHASES.map((p) => {
    const length = Math.max(1, weeks[p.id] ?? defaultWeeks(p));
    const placed = { ...p, start: t, length };
    t += length;
    return placed;
  });
}

export function weekToDate(startIso: string, week: number): string {
  const d = new Date(`${startIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + week * 7);
  return d.toISOString().slice(0, 10);
}

export const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Phase that closes a readiness dimension first. */
export function phaseForDim(dim: ReadinessDim): RoadmapPhase {
  return PHASES.find((p) => p.readinessDims.includes(dim)) ?? PHASES[0];
}

export const FALLBACK_DEFAULTS: RoadmapDefaults = { phase: 2, progress: { platform: 100, engineering: 60, semantic: 15, products: 10, ai: 0, governance: 30, change: 20 }, startDate: '2026-01-05' };

/** "Generate from readiness": start at the earliest phase that closes one of the three largest gaps. */
export function phaseFromGaps(gapDims: ReadinessDim[]): { phase: number; highlight: number[] } {
  const top = gapDims.slice(0, 3);
  const phases = [...new Set(top.map((d) => phaseForDim(d).id))].sort((a, b) => a - b);
  return { phase: phases[0] ?? 0, highlight: phases };
}

export function roadmapMarkdown(company: string, start: string, weeks: Record<number, number>, current: number): string {
  const rows = layout(weeks).map((p) => `| ${p.id}. ${p.name}${p.id === current ? ' (you are here)' : ''} | ${weekToDate(start, p.start)} | ${weekToDate(start, p.start + p.length)} | ${p.length} wk | ${p.gate.label} |`);
  return `# ${company} — AI-ready platform roadmap\n\n| Phase | Start | End | Duration | Exit gate |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;
}
