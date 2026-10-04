// Pack-agnostic builders for certification gates and data contracts (spec section 7.6).
import type { DataProduct, Gate, GateStatus, SfObject } from '../../types';

export const GATE_NAMES = [
  'Ownership & purpose', 'Data contract', 'Data quality', 'Semantic model',
  'Glossary alignment', 'Governance', 'Lineage & observability', 'Agent readiness',
];

export interface GateFacts {
  owner: string;
  steward: string | null;
  domain: string;
  consumers: string[];
  sla: string;
  cdeCount: number;
  dqScore: number;
  metrics: number;
  verifiedQueries: number;
  analystEval: number;
  sensitiveColumns: string[];
  rowPolicy: string;
  maskingPolicy: string;
  upstream: string[];
  agentEval: number;
  rules: number;
  synonyms: number;
}

/** Eight gates with their checks. `upTo` limits evaluated gates (Draft products); `pendingFrom` leaves later gates not run. */
export function buildGates(f: GateFacts, opts: { pendingFrom?: number; upTo?: number } = {}): Gate[] {
  const s = (gate: number, ok: boolean, warn = false): GateStatus =>
    opts.upTo && gate > opts.upTo ? 'pending' : opts.pendingFrom && gate >= opts.pendingFrom ? 'pending' : ok ? 'pass' : warn ? 'warn' : 'fail';
  const gates: Gate[] = [
    { id: 1, name: GATE_NAMES[0], checks: [
      { id: 'G1-OWNER', label: 'Owner named', detail: f.owner, status: s(1, true) },
      { id: 'G1-STEWARD', label: 'Steward named', detail: f.steward ?? 'No steward assigned', status: s(1, Boolean(f.steward), true) },
      { id: 'G1-PURPOSE', label: 'Domain and business purpose', detail: `${f.domain} domain; purpose documented`, status: s(1, true) },
      { id: 'G1-CONSUMERS', label: 'Consumers named', detail: f.consumers.join(', '), status: s(1, f.consumers.length > 0) },
    ] },
    { id: 2, name: GATE_NAMES[1], checks: [
      { id: 'G2-SCHEMA', label: 'Schema defined', detail: 'Output port columns, types and CDE flags in contract', status: s(2, true) },
      { id: 'G2-SLA', label: 'SLA defined', detail: f.sla, status: s(2, true) },
      { id: 'G2-VERSION', label: 'Versioning policy', detail: 'Semantic versioning; breaking changes bump major', status: s(2, true) },
      { id: 'G2-NOTICE', label: 'Change notice period', detail: '30 days for breaking changes', status: s(2, true) },
    ] },
    { id: 3, name: GATE_NAMES[2], checks: [
      { id: 'G3-NULLS', label: 'Null checks on CDEs', detail: `${f.cdeCount} CDE columns, 0 unexpected nulls`, status: s(3, true) },
      { id: 'G3-UNIQUE', label: 'Uniqueness', detail: 'Primary key unique (DUPLICATE_COUNT = 0)', status: s(3, true) },
      { id: 'G3-FRESH', label: 'Freshness within SLA', detail: `FRESHNESS within ${f.sla.toLowerCase()}`, status: s(3, true) },
      { id: 'G3-VOLUME', label: 'Volume anomaly', detail: `ROW_COUNT within forecast band; DQ score ${f.dqScore}`, status: s(3, f.dqScore >= 90, true) },
    ] },
    { id: 4, name: GATE_NAMES[3], checks: [
      { id: 'G4-METRICS', label: 'Metrics defined', detail: `${f.metrics} metrics with descriptions and synonyms`, status: s(4, f.metrics > 0) },
      { id: 'G4-VQ', label: 'At least 10 verified queries', detail: `${f.verifiedQueries} of 10 verified queries`, status: s(4, f.verifiedQueries >= 10, true) },
      { id: 'G4-EVAL', label: 'Cortex Analyst eval ≥ 90%', detail: `${f.analystEval}% on the golden question set`, status: s(4, f.analystEval >= 90) },
    ] },
    { id: 5, name: GATE_NAMES[4], checks: [
      { id: 'G5-MAPPED', label: 'Every CDE column mapped to an Approved term', detail: `${f.cdeCount} of ${f.cdeCount} CDE columns mapped`, status: s(5, true) },
    ] },
    { id: 6, name: GATE_NAMES[5], checks: [
      { id: 'G6-TAGGED', label: 'Sensitive columns tagged', detail: f.sensitiveColumns.length ? `${f.sensitiveColumns.join(', ')} tagged` : 'No sensitive columns', status: s(6, true) },
      { id: 'G6-MASK', label: 'Masking policy attached to every sensitive column', detail: f.sensitiveColumns.length ? `${f.maskingPolicy} attached` : 'Not applicable', status: s(6, true) },
      { id: 'G6-RAP', label: 'Row access policy attached', detail: `${f.rowPolicy} on the output port`, status: s(6, true) },
      { id: 'G6-GRANTS', label: 'Grants reviewed', detail: 'Reviewed by steward in the last 90 days', status: s(6, true) },
    ] },
    { id: 7, name: GATE_NAMES[6], checks: [
      { id: 'G7-LINEAGE', label: 'Upstream lineage complete', detail: `${f.upstream.length} upstream objects resolved to Bronze sources`, status: s(7, true) },
      { id: 'G7-ALERT', label: 'Freshness alerting configured', detail: 'Alert on DMF FRESHNESS breach to #data-ops', status: s(7, true) },
    ] },
    { id: 8, name: GATE_NAMES[7], checks: [
      { id: 'G8-INSTR', label: 'Agent instructions present', detail: 'Persona, response, guardrail and orchestration instructions', status: s(8, true) },
      { id: 'G8-RULES', label: 'Business rules and synonyms present', detail: `${f.rules} rules, ${f.synonyms} synonyms`, status: s(8, f.rules > 0 && f.synonyms > 0) },
      { id: 'G8-EVAL', label: 'Agent eval score ≥ 90%', detail: `${f.agentEval}% on the agent evaluation set`, status: s(8, f.agentEval >= 90) },
    ] },
  ];
  return opts.upTo ? gates.slice(0, opts.upTo) : gates;
}

export function buildContractYaml(db: string, p: Omit<DataProduct, 'gates' | 'contractYaml'>, port: SfObject | undefined, policies: { masking: string; row: string }): string {
  const cols = (port?.columns ?? [])
    .map((c) => {
      const sens = (c.tags ?? []).filter((t) => t !== 'CDE');
      return `    - name: ${c.name}\n      type: ${c.type}\n      cde: ${(c.tags ?? []).includes('CDE')}${sens.length ? `\n      classification: ${sens.join(', ')}` : ''}${c.termId ? `\n      term: ${c.termId}` : ''}`;
    })
    .join('\n');
  return `id: ${p.id}
name: ${p.name}
version: ${p.version}
status: ${p.status}
owner: ${p.owner}
steward: ${p.steward ?? 'unassigned'}
domain: ${p.domain}
sla:
  freshness: ${p.sla}
  availability: 99.5%
output_port: ${db}.DATA_PRODUCTS.${p.outputPort}
semantic_view: ${p.semanticView ? `${db}.SEMANTIC.${p.semanticView}` : 'none'}
schema:
  columns:
${cols}
quality:
  - metric: NULL_COUNT
    on: CDE columns
    threshold: 0
  - metric: DUPLICATE_COUNT
    threshold: 0
  - metric: FRESHNESS
    threshold: ${p.sla}
access:
  masking_policy: ${policies.masking}
  row_access_policy: ${policies.row}
  request_via: Internal Marketplace
change_policy:
  versioning: semver
  breaking_change_notice_days: 30`;
}
