// Per-pack session state for the enhancement features (spec "State additions"). Optional on PackState so sessions
// saved before the enhancements still load; `extOf` fills defaults.
import type { LayerSwitches, Workstream } from './types';
import { ALL_ON } from './types';

export type Tooling = {
  ingestion: 'goldengate' | 'snowpipe' | 'openflow' | 'fivetran';
  transformation: 'dbt' | 'dynamic' | 'snowpark';
  orchestration: 'autosys' | 'tasks' | 'airflow';
  format: 'iceberg' | 'native';
};
export const DEFAULT_TOOLING: Tooling = { ingestion: 'goldengate', transformation: 'dbt', orchestration: 'autosys', format: 'iceberg' };

export type RaciStyle = 'centralized' | 'hub' | 'federated';
export type FixType = 'rule' | 'verified_query' | 'synonym' | 'relationship';

export interface CostLevers {
  lagMinutes: Record<string, number>;
  warehouse: Record<'transform' | 'bi' | 'ai', 'XS' | 'S' | 'M' | 'L'>;
  questionsPerDay: number;
  dmfPerDay: number;
  creditPrice: number;
  currency: string;
}

export interface Postmortem { incidentId: string; openedAt: string; resolvedAt: string; ttdMin: number; ttrMin: number }
export interface FeedbackItem { id: string; agentId: string; question: string; answer: string; comment: string; role: string; category: string; at: string; fixed?: boolean }

export interface ExtState {
  switches: LayerSwitches;
  studioSim: boolean;
  studioSwitches: LayerSwitches;
  tooling: Tooling;
  roadmap?: { phase: number; progress: Partial<Record<Workstream, number>>; startDate: string; weeks: Record<number, number>; generated?: boolean };
  readiness: { answers: Record<string, number>; targets: Record<string, number>; profile?: string };
  raciStyle: RaciStyle;
  cost?: CostLevers;
  incidents: { open: { id: string; openedAt: string }[]; postmortems: Postmortem[] };
  quality: { fixes: FixType[]; feedback: FeedbackItem[]; runs: number; lastRunAt?: string };
}

export const defaultExt = (): ExtState => ({
  switches: { ...ALL_ON },
  studioSim: false,
  studioSwitches: { ...ALL_ON },
  tooling: { ...DEFAULT_TOOLING },
  readiness: { answers: {}, targets: {} },
  raciStyle: 'hub',
  incidents: { open: [], postmortems: [] },
  quality: { fixes: [], feedback: [], runs: 0 },
});

export function extOf(st: { ext?: Partial<ExtState> } | undefined): ExtState {
  const d = defaultExt();
  const e = st?.ext ?? {};
  return {
    ...d,
    ...e,
    switches: { ...d.switches, ...(e.switches ?? {}) },
    studioSwitches: { ...d.studioSwitches, ...(e.studioSwitches ?? {}) },
    tooling: { ...d.tooling, ...(e.tooling ?? {}) },
    readiness: { ...d.readiness, ...(e.readiness ?? {}) },
    incidents: { ...d.incidents, ...(e.incidents ?? {}) },
    quality: { ...d.quality, ...(e.quality ?? {}) },
  };
}
