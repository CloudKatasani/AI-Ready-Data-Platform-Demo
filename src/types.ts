// Core data model for AI Ready Data Platform (spec section 11).
// UI components only ever read from the active IndustryPack.

export type LayerId = 'bronze' | 'silver' | 'gold' | 'semantic' | 'glossary' | 'context' | 'product' | 'agent' | 'gov';
export type RoleId = string;
export type PackId = 'utilities' | 'telecom' | 'retail' | 'banking' | 'insurance' | 'healthcare' | 'manufacturing' | 'public-sector';
export type SensitiveClass = 'PII' | 'PHI' | 'PCI' | 'CPNI' | 'NPI' | 'GOV_ID' | 'TRADE_SECRET';
export type ColumnTag = SensitiveClass | 'CDE';

export type SchemaName =
  | 'RAW_BRONZE' | 'CURATED_SILVER' | 'CONFORMED_GOLD' | 'SEMANTIC' | 'GLOSSARY'
  | 'CONTEXT' | 'DATA_PRODUCTS' | 'AGENTS' | 'GOVERNANCE';

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  comment: string;
  tags?: ColumnTag[];
  termId?: string;
  /** Tagged sensitive but the masking policy is only attached once this certification fix is applied (the DP-05 gate-6 gap). */
  maskPendingFix?: string;
}

export type ObjectType =
  | 'ICEBERG TABLE' | 'DYNAMIC TABLE' | 'TABLE' | 'VIEW' | 'SECURE VIEW' | 'SEMANTIC VIEW'
  | 'CORTEX SEARCH SERVICE' | 'AGENT' | 'TAG' | 'MASKING POLICY' | 'ROW ACCESS POLICY' | 'STREAM';

/** Live demo state that shared-schema previews (DP registry, agent registry...) reflect. */
export interface LiveState {
  productStatus: Record<string, DataProduct['status']>;
  productVersion: Record<string, string>;
  /** checkIds of certification fixes applied, keyed by product id */
  fixes: Record<string, string[]>;
}

export interface SfObject {
  schema: SchemaName;
  name: string;
  layer: LayerId;
  type: ObjectType;
  comment: string;
  columns: Column[];
  /** Production-like row count shown in the Explorer header (metadata only). */
  rowCount: number;
  bytes?: number;
  owner: string;
  lastAltered: string;
  /** Upstream objects as SCHEMA.NAME, or "ext:<system>" for external sources. */
  upstream: string[];
  targetLag?: string;
  /** Full, un-policied rows in natural order. Policies are applied by MockSnowflake.preview(). */
  rows?: (live: LiveState) => Row[];
  /** Row access policy binding: which column carries the policy dimension, with optional value mapping. */
  rowAccess?: { column: string; map?: Record<string, string> };
  /** Custom DDL body (semantic views, agents, search services). */
  ddl?: string;
  /** Sort order hint inside the object tree */
  order?: number;
}

export interface Metric {
  name: string;
  expr: string;
  description: string;
  synonyms: string[];
  termId: string;
  unit: string;
}

export interface PlaygroundSpec {
  /** Fact-grain rows already joined to dimensions. */
  rows: () => Row[];
  dimensions: { name: string; column: string }[];
  filters: { label: string; sql: string; test: (r: Row) => boolean }[];
  metrics: { name: string; agg: (rows: Row[], group: { dimension: string; value: string }) => number; decimals: number; unit: string; sqlExpr: string }[];
  /** FQN used in generated SQL */
  from: string;
}

export interface SemanticView {
  name: string;
  description: string;
  tables: { alias: string; fqn: string; pk: string }[];
  relationships: { from: string; to: string; on: string }[];
  dimensions: { name: string; expr: string; synonyms: string[]; description?: string }[];
  timeDimensions: { name: string; expr: string; description?: string }[];
  facts: { name: string; expr: string; description?: string }[];
  metrics: Metric[];
  verifiedQueryIds: string[];
  productIds: string[];
  playground?: PlaygroundSpec;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  formula?: string;
  domain: string;
  owner: string;
  steward: string | null;
  status: 'Approved' | 'Draft' | 'Deprecated';
  isCde: boolean;
  synonyms: string[];
  related: string[];
  mappings: { fqn: string; column: string; kind: 'defines' | 'derives' | 'filters' }[];
  metricRefs: string[];
  dqRules?: string[];
  dqScore?: number;
}

export interface AgentInstruction {
  id: string;
  agentId: string;
  type: 'persona' | 'response' | 'guardrail' | 'orchestration';
  text: string;
  version: string;
}
export interface BusinessRule {
  id: string;
  domain: string;
  text: string;
  metric: string;
  sourceDoc: string;
}
export interface VerifiedQuery {
  id: string;
  semanticView: string;
  question: string;
  sql: string;
  verifiedBy: string;
  verifiedOn: string;
}
export interface Synonym {
  term: string;
  synonym: string;
  scope: string;
}
export interface SearchDoc {
  id: string;
  title: string;
  source: string;
  chunkCount: number;
  updatedAt: string;
  chunks: { n: number; text: string }[];
}
export interface ContextLayer {
  searchService: string;
  instructions: AgentInstruction[];
  rules: BusinessRule[];
  verifiedQueries: VerifiedQuery[];
  synonyms: Synonym[];
  documents: SearchDoc[];
}

export type GateStatus = 'pass' | 'warn' | 'fail' | 'pending';
export interface Check {
  id: string;
  label: string;
  detail: string;
  status: GateStatus;
}
export interface Gate {
  id: number;
  name: string;
  checks: Check[];
}

export interface DataProduct {
  id: string;
  name: string;
  domain: string;
  status: 'Certified' | 'In certification' | 'Draft';
  version: string;
  owner: string;
  steward: string | null;
  sla: string;
  semanticView?: string;
  outputPort: string;
  kpiIds: string[];
  qualityScore: number;
  consumers: number;
  queriesPerWeek: number;
  freshness: string;
  lastCertified?: string;
  description: string;
  purpose: string;
  sampleQuestions: string[];
  upstream: string[];
  gates: Gate[];
  contractYaml: string;
}

export interface Agent {
  id: string;
  name: string;
  objectName: string;
  domain: string;
  status: 'Production' | 'Pilot';
  description: string;
  productIds: string[];
  tools: { kind: 'cortex_analyst' | 'cortex_search' | 'sql'; target: string }[];
  instructionIds: string[];
  evalAccuracy: number;
  evalQuestions: number;
  scenarioIds: string[];
  kpiIds: string[];
}

export interface Kpi {
  id: string;
  name: string;
  definition: string;
  formula: string;
  unit: string;
  termId: string;
  metric: string;
  productIds: string[];
  agentIds: string[];
}
export interface KpiRange {
  kpiId: string;
  min: number;
  max: number;
}

export interface Persona {
  roleId: RoleId;
  archetype: 'A' | 'B' | 'C' | 'D';
  name: string;
  title: string;
  domain: string;
  cares: string;
  rowFilter?: { column: string; allowed: string[] };
  unmasked: SensitiveClass[];
}

export type AccessCode = 'G' | 'P' | 'R' | '-';

export interface TraceStep {
  layer: LayerId;
  title: string;
  detail: string;
  refs: { kind: 'object' | 'term' | 'metric' | 'rule' | 'doc' | 'policy' | 'view'; id: string; label?: string }[];
  ms: number;
}

export interface AgentAnswer {
  summary: string;
  table?: { columns: string[]; rows: (string | number)[][]; masked?: number[] };
  chart?: { kind: 'bar' | 'line'; labels: string[]; values: number[]; unit: string };
  sources: { productId: string; version: string; certified: boolean }[];
  sql: string;
  trace: TraceStep[];
  banner?: 'not-certified' | 'no-access' | 'masked' | 'incident';
  bannerText?: string;
  /** Asset to request when the answer was declined */
  requestAssetId?: string;
  /** Object to open with "Open in Explorer" (SCHEMA.NAME) */
  explorerTarget?: string;
  suggestions?: string[];
  switchAgentId?: string;
  /** Scenario the question matched, when it ran one */
  scenarioId?: string;
  kind: 'answer' | 'decline' | 'clarify' | 'help';
}

export interface ScenarioContext {
  persona: Persona;
  live: LiveState;
}

export interface ScenarioResult {
  summary: string;
  table?: AgentAnswer['table'];
  chart?: AgentAnswer['chart'];
  sql: string;
  rows: number;
  maskedColumns?: string[];
  rowFiltered?: boolean;
  /** KPI values computed by this scenario, checked against KpiRanges by the validator. */
  kpiValues?: Record<string, number>;
  explorerTarget?: string;
  /** Extra trace detail lines for the data step */
  note?: string;
}

export interface Scenario {
  id: string;
  agentId: string;
  /** 1–15, see spec section 9 */
  pattern: number;
  question: string;
  paraphrases: string[];
  productIds: string[];
  kpiIds: string[];
  terms: { text: string; termId: string }[];
  ruleIds: string[];
  instruction?: string;
  semantic?: { view: string; metrics: string[]; dimensions: string[]; filters: string[] };
  doc?: { docId: string; chunk: number };
  run: (ctx: ScenarioContext) => ScenarioResult;
}

export interface CertificationFailure {
  gate: number;
  checkId: string;
  status: 'warn' | 'fail';
  detail: string;
  fixedDetail: string;
  fix: { label: string; kind: 'verified-queries' | 'masking'; items: string[] };
}

export interface PackProfile {
  id: PackId;
  industry: string;
  company: string;
  dbPrefix: string;
  tagline: string;
  scale: { label: string; value: string }[];
  regions: string[];
  icon: string;
  accent: string;
  seed: number;
  account: string;
  sources: { name: string; system: string }[];
  headlineKpis: string[];
  sensitiveClasses: SensitiveClass[];
  ready: boolean;
}

export interface WorksheetPreset {
  id: string;
  label: string;
  sql: string;
  run: (ctx: ScenarioContext) => { columns: string[]; rows: (string | number)[][] };
}

export interface GuidedStep {
  label: string;
  route: string;
}

export interface IndustryPack {
  profile: PackProfile;
  database: string;
  objects: SfObject[];
  semanticViews: SemanticView[];
  glossary: GlossaryTerm[];
  context: ContextLayer;
  products: DataProduct[];
  agents: Agent[];
  kpis: Kpi[];
  kpiRanges: KpiRange[];
  personas: Persona[];
  initialAccess: Record<RoleId, Record<string, AccessCode>>;
  initialRequestJustification: string;
  scenarios: Scenario[];
  certificationScript: { productId: 'DP-05'; failures: CertificationFailure[] };
  worksheet: WorksheetPreset[];
  consumers: string[];
  /** Plain-words, per-pack copy for the platform map layer cards */
  layerExamples: Partial<Record<LayerId, string>>;
  signature: { question: string; agentId: string; termId: string; ruleId: string; docQuery: string };
  maskingPolicy: string;
  rowAccessPolicy: string;
  /** Sensitive class -> masking policy name */
  maskingPolicies: Partial<Record<SensitiveClass, string>>;
  warehouse: string;
  dmf: { fqn: string; metric: string; value: number; threshold: string; status: 'pass' | 'warn' | 'fail'; measuredAt: string }[];
  accessHistory: { queryId: string; role: string; fqn: string; columns: string; ts: string }[];
  /** Enhancement-spec additions (E1–E11). Optional: a pack without it still loads. */
  ext?: import('./ext/types').PackExtensions;
}

export interface AccessRequestT {
  id: string;
  role: RoleId;
  assetId: string;
  justification: string;
  duration: '30d' | '90d' | 'permanent';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string;
}
