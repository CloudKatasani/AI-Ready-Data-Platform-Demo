// Enhancement contracts (Enhancement Specification, "Shared data contracts and pack additions").
// Every pack may carry an `ext` block; a pack without it still loads and the new tabs show an empty state.
import type { AgentAnswer, LayerId, ScenarioContext } from '../types';

// ---------------------------------------------------------------- E1 / E2 knockout + raw comparison
export type SwitchableLayer = 'cleansing' | 'semantic' | 'glossary' | 'context' | 'certification' | 'governance';
export type LayerSwitches = Record<SwitchableLayer, boolean>;
export type Severity = 'wrong' | 'unsafe' | 'ambiguous' | 'unverified';

export interface KnockoutResult {
  /** Headline number, computed from the synthetic data with the active layers. */
  value: number;
  valueText: string;
  /** Optional context line under the headline (period, population). */
  caption: string;
  table?: { columns: string[]; rows: (string | number)[][]; masked?: number[]; exposed?: number[] };
  sql: string;
  sources: { productId: string; version: string; certified: boolean }[];
  /** Plain-language notes added by the active layers (rules applied, citations, banners). */
  notes: string[];
  /** Set when sensitive values are shown in clear because governance was off. */
  exposed?: string[];
  /** Set when the answer used a non-certified product without warning (certification off). */
  hiddenWarning?: string;
}

export interface KnockoutFailure { reason: string; severity: Severity }

export interface RawResult extends Omit<KnockoutResult, 'sources' | 'notes'> {
  /** Problems the raw agent could not see (duplicates, unmasked PII, wrong definition, no lineage, no owner). */
  risks: string[];
  tablesUsed: string[];
  /** Sample of rows the raw agent read, with sensitive values in clear. */
  rowsRead: { columns: string[]; rows: (string | number | null)[][]; exposed: number[] };
}

export interface KnockoutScenario {
  id: string;
  /** Agent Studio scenario this question mirrors: the governed answer must match it exactly. */
  scenarioId: string;
  question: string;
  agentId: string;
  /** Layers whose removal visibly changes this answer. */
  affects: SwitchableLayer[];
  /** One function handles every combination of switches, so two layers off combine both failures. */
  compute: (layers: LayerSwitches, ctx: ScenarioContext) => KnockoutResult;
  /** Plain-language reason for a failure caused by one switched-off layer. */
  failure: (layer: SwitchableLayer, governed: KnockoutResult, degraded: KnockoutResult) => KnockoutFailure;
  /** Where the "What went wrong" strip links for each layer (pack-relative route). */
  links: Partial<Record<SwitchableLayer, string>>;
  /** Raw-data variant for the E2 comparison. */
  raw?: (ctx: ScenarioContext) => RawResult;
}

// ---------------------------------------------------------------- E4 roadmap
export type Workstream = 'platform' | 'engineering' | 'semantic' | 'products' | 'ai' | 'governance' | 'change';
export interface RoadmapDefaults { phase: number; progress: Partial<Record<Workstream, number>>; startDate: string }

// ---------------------------------------------------------------- E5 coverage
export interface InventoryTable {
  /** Source system, matching a pack profile source name where possible */
  source: string;
  table: string;
  domain: string;
  /** Manual level, used only when the table is not in the catalog (`lands` unset). */
  level: 0 | 1;
  /** RAW_BRONZE object (SCHEMA.NAME) this source table lands in; levels are then derived from the catalog. */
  lands?: string;
  /**
   * Downstream columns (SCHEMA.OBJECT.COLUMN) this source table populates. When set, levels 2–4 follow these
   * columns instead of everything downstream of `lands`.
   */
  carries?: string[];
  /** Products that consume this table's columns; defaults to every product downstream of `lands`. */
  consumedBy?: string[];
  note?: string;
}
export interface LegacyReport { id: string; name: string; tool: string; owner: string; kpiIds: string[]; missing: string[] }

// ---------------------------------------------------------------- E6 readiness
export interface ReadinessPreset { defaultProfile: 'early' | 'mid' | 'advanced'; wording?: Record<string, string> }

// ---------------------------------------------------------------- E8 cost
export interface CostOverrides { queriesPerDayByProduct?: Record<string, number>; questionsPerDayByAgent?: Record<string, number> }

// ---------------------------------------------------------------- E9 incidents
export interface IncidentScript {
  id: string;
  title: string;
  fault: string;
  /** SCHEMA.NAME of the object where the fault is injected */
  objectFqn: string;
  column?: string;
  dmf: { metric: string; value: number; threshold: number; unit: string };
  affects: { productId: string; status: 'Degraded' | 'Down' }[];
  /** Effect on agent answers; `scenarioIds` limits it to those questions (otherwise every answer of the agent). */
  agentEffect: { agentId: string; mode: 'warn' | 'block'; message: string; scenarioIds?: string[] }[];
  resolution: string;
  /** Minutes from fault to detection and from detection to resolution (postmortem). */
  ttdMin: number;
  ttrMin: number;
}

// ---------------------------------------------------------------- E10 agent quality
export interface FeedbackScript {
  /** Always AG-01 */
  agentId: string;
  /** The question a consumer asks, gets wrong, and thumbs down. */
  question: string;
  paraphrases: string[];
  comment: string;
  termId: string;
  productIds: string[];
  /** The business rule the steward adds (fixes the three missing-rule eval questions). */
  rule: { id: string; domain: string; text: string; metric: string; sourceDoc: string };
  /** Synonym fix (fixes one ambiguous-term question). */
  synonym: { term: string; synonym: string; scope: string };
  /** Semantic relationship fix (fixes the wrong-join question). */
  relationship: { view: string; label: string; detail: string };
  /** Computes the answer with or without the business rule applied. */
  compute: (ruleApplied: boolean, ctx: ScenarioContext) => { value: number; valueText: string; summary: string; table?: AgentAnswer['table']; sql: string };
}

// ---------------------------------------------------------------- E11 impact
export type ChangeType = 'type' | 'rename' | 'drop' | 'semantics' | 'grain';
export interface ImpactPreset {
  id: string;
  label: string;
  objectFqn: string;
  column: string;
  change: ChangeType;
  /** Downstream column names that carry this column (Silver/Gold/product renames). */
  aliases: string[];
  note: string;
}

export interface PackExtensions {
  knockoutScenarios: KnockoutScenario[];
  roadmapDefaults: RoadmapDefaults;
  sourceInventory: InventoryTable[];
  legacyReports: LegacyReport[];
  readinessPreset: ReadinessPreset;
  raciOverrides?: Record<string, string>;
  costDrivers?: CostOverrides;
  incidents: IncidentScript[];
  feedbackScript: FeedbackScript;
  impactPresets: ImpactPreset[];
  /** Domain of each layer-0/1 source system, for the coverage domain view. */
  domains: string[];
  /** Which layer an incident marker sits on, by object schema */
  incidentLayer?: (fqn: string) => LayerId;
}

export const SWITCHES: { id: SwitchableLayer; label: string; layer: LayerId; blurb: string }[] = [
  { id: 'cleansing', label: 'Silver/Gold cleansing', layer: 'silver', blurb: 'Deduplicate CDC, apply deletes, conform keys' },
  { id: 'semantic', label: 'Semantic', layer: 'semantic', blurb: 'Named metrics, joins and grain defined once' },
  { id: 'glossary', label: 'Glossary', layer: 'glossary', blurb: 'Resolve business terms to owned definitions' },
  { id: 'context', label: 'Context', layer: 'context', blurb: 'Business rules, verified queries, documents' },
  { id: 'certification', label: 'Data product certification', layer: 'product', blurb: 'Only certified sources, with warnings' },
  { id: 'governance', label: 'Governance', layer: 'gov', blurb: 'Masking and row access policies' },
];

export const ALL_ON: LayerSwitches = { cleansing: true, semantic: true, glossary: true, context: true, certification: true, governance: true };
