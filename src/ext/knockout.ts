// E1 knockout engine: runs a knockout scenario with the current switches, collects failures, builds the mini trace.
import type { IndustryPack, LayerId, ScenarioContext, TraceStep } from '../types';
import { buildTrace } from '../agents/engine/trace';
import { ALL_ON, SWITCHES, type KnockoutFailure, type KnockoutResult, type KnockoutScenario, type LayerSwitches, type Severity, type SwitchableLayer } from './types';

export interface MiniStep { title: string; layer: LayerId; skipped: boolean; note: string }
export interface KnockoutRun {
  result: KnockoutResult;
  failures: (KnockoutFailure & { layer: SwitchableLayer })[];
  confidence: 'Trusted' | 'Questionable' | 'Unsafe';
  trace: MiniStep[];
  deltaPct?: number;
}

const offLayers = (s: LayerSwitches) => SWITCHES.map((x) => x.id).filter((id) => !s[id]);

export function confidenceOf(failures: { severity: Severity }[]): KnockoutRun['confidence'] {
  if (failures.some((f) => f.severity === 'wrong' || f.severity === 'unsafe')) return 'Unsafe';
  if (failures.length) return 'Questionable';
  return 'Trusted';
}

export function deltaPct(governed: number, degraded: number): number | undefined {
  if (!Number.isFinite(governed) || !Number.isFinite(degraded) || governed === 0) return undefined;
  const d = ((degraded - governed) / Math.abs(governed)) * 100;
  return Math.abs(d) < 0.05 ? undefined : d;
}

function miniTrace(pack: IndustryPack, ks: KnockoutScenario, s: LayerSwitches, ctx: ScenarioContext): MiniStep[] {
  const scenario = pack.scenarios.find((x) => x.id === ks.scenarioId);
  const steps: TraceStep[] = scenario ? buildTrace(pack, scenario, ctx.persona, ctx.live, scenario.run(ctx)) : [];
  return steps.map((st) => {
    if (st.layer === 'glossary' && !s.glossary) return { title: st.title, layer: st.layer, skipped: true, note: 'Layer off: business terms not resolved' };
    if (st.layer === 'context' && !s.context) return { title: st.title, layer: st.layer, skipped: true, note: st.title.startsWith('Ground') ? 'Layer off: no document citation' : 'Layer off: rules, verified queries and instructions skipped' };
    if (st.layer === 'semantic' && !s.semantic) return { title: 'Write its own SQL', layer: st.layer, skipped: true, note: 'Layer off: no semantic view, agent guessed joins and grain' };
    if (st.layer === 'gov' && !s.governance) return { title: st.title, layer: st.layer, skipped: true, note: 'Layer off: masking and row access bypassed' };
    if (st.layer === 'product' && !s.cleansing) return { title: st.title, layer: st.layer, skipped: true, note: 'Layer off: query ran on RAW_BRONZE CDC rows' };
    if (st.layer === 'product' && !s.certification) return { title: st.title, layer: st.layer, skipped: false, note: 'Certification check skipped: any product may be used without warning' };
    if (st.layer === 'agent' && !s.certification) return { title: st.title, layer: st.layer, skipped: false, note: 'Answered without certification warnings' };
    return { title: st.title, layer: st.layer, skipped: false, note: st.detail };
  });
}

export function runKnockout(pack: IndustryPack, ks: KnockoutScenario, switches: LayerSwitches, ctx: ScenarioContext): KnockoutRun {
  const governed = ks.compute(ALL_ON, ctx);
  const result = ks.compute(switches, ctx);
  const failures: KnockoutRun['failures'] = [];
  for (const layer of offLayers(switches)) {
    const only = { ...ALL_ON, [layer]: false };
    const single = ks.compute(only, ctx);
    const changed = single.valueText !== governed.valueText || Boolean(single.exposed?.length) || Boolean(single.hiddenWarning) || single.notes.join('|') !== governed.notes.join('|');
    if (!changed) continue;
    failures.push({ layer, ...ks.failure(layer, governed, single) });
  }
  return { result, failures, confidence: confidenceOf(failures), trace: miniTrace(pack, ks, switches, ctx), deltaPct: deltaPct(governed.value, result.value) };
}

/** Plain-language failure with the computed delta, for packs to reuse in their `failure` functions. */
export function describe(explain: string, governed: KnockoutResult, degraded: KnockoutResult): string {
  if (degraded.valueText === governed.valueText) return explain;
  const d = deltaPct(governed.value, degraded.value);
  return `${explain} ${degraded.valueText} instead of ${governed.valueText}${d !== undefined ? ` (${fmtDelta(d)})` : ''}.`;
}

export const fmtDelta = (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(d) < 10 ? Math.abs(d).toFixed(1) : Math.abs(d).toFixed(0)}%`;

export const SEVERITY_LABEL: Record<Severity, string> = { wrong: 'Wrong number', unsafe: 'Unsafe', ambiguous: 'Ambiguous', unverified: 'Unverified' };
