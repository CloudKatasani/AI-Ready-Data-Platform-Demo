// E9 Data Health: product health from open incidents, and incident effects on agents and other tabs.
import type { AgentAnswer, IndustryPack, LayerId, TraceStep } from '../types';
import type { ExtState } from './state';
import type { IncidentScript } from './types';

export type HealthStatus = 'Healthy' | 'Degraded' | 'Down';
const RANK: Record<HealthStatus, number> = { Healthy: 0, Degraded: 1, Down: 2 };

export function openIncidents(pack: IndustryPack, ext: ExtState): IncidentScript[] {
  const all = pack.ext?.incidents ?? [];
  return ext.incidents.open.map((o) => all.find((i) => i.id === o.id)).filter((i): i is IncidentScript => Boolean(i));
}

export function productHealth(pack: IndustryPack, ext: ExtState, productId: string): { status: HealthStatus; incidents: IncidentScript[] } {
  const incidents = openIncidents(pack, ext).filter((i) => i.affects.some((a) => a.productId === productId));
  let status: HealthStatus = 'Healthy';
  for (const i of incidents) for (const a of i.affects) if (a.productId === productId && RANK[a.status] > RANK[status]) status = a.status;
  return { status, incidents };
}

/** Objects currently failing a DQ check because of an open incident. */
export const failingObjects = (pack: IndustryPack, ext: ExtState) => new Set(openIncidents(pack, ext).map((i) => i.objectFqn));

export function layerOfFqn(pack: IndustryPack, fqn: string): LayerId {
  return pack.ext?.incidentLayer?.(fqn) ?? pack.objects.find((o) => `${o.schema}.${o.name}` === fqn)?.layer ?? 'bronze';
}

/** KPIs touched by open incidents (My Access warning icon). */
export function kpisAtRisk(pack: IndustryPack, ext: ExtState): Map<string, IncidentScript> {
  const out = new Map<string, IncidentScript>();
  for (const i of openIncidents(pack, ext)) for (const a of i.affects) for (const k of pack.products.find((p) => p.id === a.productId)?.kpiIds ?? []) if (!out.has(k)) out.set(k, i);
  return out;
}

/**
 * Apply open-incident effects to an Agent Studio answer: warn adds a banner and caveat, block withholds the
 * number. Either way the trace gains a "Health check" step in the governance colour.
 */
export function applyIncidents(pack: IndustryPack, ext: ExtState, agentId: string, answer: AgentAnswer): AgentAnswer {
  if (answer.kind !== 'answer') return answer;
  const effects = openIncidents(pack, ext).flatMap((i) => i.agentEffect.filter((e) => e.agentId === agentId && (!e.scenarioIds || (answer.scenarioId && e.scenarioIds.includes(answer.scenarioId)))).map((e) => ({ i, e })));
  if (!effects.length) return answer;
  const block = effects.find((x) => x.e.mode === 'block');
  const step: TraceStep = {
    layer: 'gov',
    title: 'Health check',
    detail: effects.map(({ i, e }) => `${i.title}: ${i.dmf.metric} ${i.dmf.value}${i.dmf.unit} vs threshold ${i.dmf.threshold}${i.dmf.unit} on ${i.objectFqn} → ${e.mode === 'block' ? 'answer withheld' : 'warning added'}.`).join(' '),
    ms: 40,
    refs: [{ kind: 'object', id: 'GOVERNANCE.DMF_RESULTS', label: 'DMF_RESULTS' }],
  };
  if (block) {
    return {
      ...answer,
      summary: block.e.message,
      table: undefined,
      chart: undefined,
      sources: [],
      sql: '',
      banner: 'incident',
      bannerText: `Open incident: ${block.i.title}. ${block.i.affects.map((a) => `${pack.products.find((p) => p.id === a.productId)?.name ?? a.productId} is ${a.status}`).join(', ')}.`,
      trace: [...answer.trace.slice(0, 1), step],
    };
  }
  return {
    ...answer,
    summary: `${effects.map((x) => `⚠ ${x.e.message}`).join('\n')}\n${answer.summary}`,
    banner: answer.banner ?? 'incident',
    bannerText: answer.bannerText ?? `Open incident: ${effects.map((x) => x.i.title).join(', ')}.`,
    trace: [...answer.trace.slice(0, -1), step, ...answer.trace.slice(-1)],
  };
}
