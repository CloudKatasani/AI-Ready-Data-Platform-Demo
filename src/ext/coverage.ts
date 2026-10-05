// E5 Migration coverage: derives each source table's furthest layer from the catalog, glossary, products and agents.
import type { IndustryPack, LiveState } from '../types';
import type { InventoryTable } from './types';
import { layout, PHASES } from './roadmap';

export const LEVELS = [
  { n: 0, name: 'Not started', rule: 'In the source inventory only' },
  { n: 1, name: 'Landed', rule: 'Present in RAW_BRONZE with CDC running' },
  { n: 2, name: 'Curated', rule: 'Feeds a Silver object with DQ rules passing' },
  { n: 3, name: 'Modelled', rule: 'Feeds a Gold dimension or fact' },
  { n: 4, name: 'Meaningful', rule: 'Its Gold columns are in a semantic view and mapped to glossary terms' },
  { n: 5, name: 'Productized', rule: 'Part of a certified data product' },
  { n: 6, name: 'Agent-ready', rule: 'Used by a production agent with eval ≥ 90%' },
] as const;

export interface CoverageRow extends InventoryTable {
  id: string;
  derived: boolean;
  levelNow: number;
  /** Objects reached at each level (1–6), for the cell drill-down. */
  objectsAt: Record<number, string[]>;
  /** Why the table cannot reach the next level. */
  blocker?: string;
}

export interface CoverageCtx {
  pack: IndustryPack;
  live: LiveState;
  /** Current eval accuracy per agent (E10 can raise or lower it). */
  accuracy: (agentId: string) => number;
  /** Products currently Degraded or Down because of an open incident. */
  dqFailing?: (fqn: string) => boolean;
}

const fqnOf = (o: { schema: string; name: string }) => `${o.schema}.${o.name}`;

/** Every object downstream of `start` (inclusive), following `upstream` links. */
export function downstreamOf(pack: IndustryPack, start: string): Set<string> {
  const out = new Set<string>([start]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of pack.objects) {
      const id = fqnOf(o);
      if (!out.has(id) && o.upstream.some((u) => out.has(u))) { out.add(id); grew = true; }
    }
  }
  return out;
}

function deriveLevel(c: CoverageCtx, t: InventoryTable): Pick<CoverageRow, 'levelNow' | 'objectsAt' | 'blocker'> {
  const { pack, live } = c;
  const objectsAt: Record<number, string[]> = {};
  const landed = pack.objects.find((o) => fqnOf(o) === t.lands);
  if (!landed) return { levelNow: t.level, objectsAt, blocker: t.level === 0 ? 'Not yet in the CDC scope' : 'Landed in a staging area, not yet in RAW_BRONZE' };
  objectsAt[1] = [t.lands!];
  const down = downstreamOf(pack, t.lands!);
  const objs = pack.objects.filter((o) => down.has(fqnOf(o)));

  // With `carries`, follow only the objects that hold this table's columns.
  const carriedObj = t.carries ? new Set(t.carries.map((c) => c.split('.').slice(0, 2).join('.'))) : undefined;
  const scoped = carriedObj ? objs.filter((o) => carriedObj.has(fqnOf(o))) : objs;
  const silver = scoped.filter((o) => o.layer === 'silver');
  const dqFail = (fqn: string) => pack.dmf.some((d) => d.fqn === fqn && d.status === 'fail') || Boolean(c.dqFailing?.(fqn));
  const curated = silver.length ? silver : carriedObj ? scoped.filter((o) => o.layer === 'gold').flatMap((g) => objs.filter((o) => o.layer === 'silver' && downstreamOf(pack, fqnOf(o)).has(fqnOf(g)))) : [];
  if (!curated.length) return { levelNow: 1, objectsAt, blocker: 'No Silver object curates this table yet' };
  objectsAt[2] = curated.map(fqnOf);
  if (!curated.some((o) => !dqFail(fqnOf(o)))) return { levelNow: 1, objectsAt, blocker: `DQ rules failing on ${curated.map((o) => o.name).join(', ')}` };

  const gold = scoped.filter((o) => o.layer === 'gold');
  if (!gold.length) return { levelNow: 2, objectsAt, blocker: carriedObj ? 'Its columns are curated in Silver but not yet modelled into Gold' : 'Not yet modelled into a Gold dimension or fact' };
  objectsAt[3] = gold.map(fqnOf);

  const goldIds = new Set(gold.map(fqnOf));
  const views = pack.semanticViews.filter((v) => v.tables.some((tb) => goldIds.has(tb.fqn)));
  const mapped = new Set(pack.glossary.flatMap((g) => g.mappings.map((m) => `${m.fqn}.${m.column}`)));
  const exprs = views.flatMap((v) => [...v.dimensions, ...v.facts, ...v.timeDimensions, ...v.metrics].map((d) => d.expr)).join(' ');
  const goldCols = t.carries ? t.carries.filter((col) => goldIds.has(col.split('.').slice(0, 2).join('.'))) : [];
  const unmapped = goldCols.filter((col) => !mapped.has(col) && !exprs.includes(col.split('.')[2]));
  const terms = pack.glossary.filter((g) => g.mappings.some((m) => goldIds.has(m.fqn) || down.has(m.fqn)));
  if (!views.length) return { levelNow: 3, objectsAt, blocker: 'Gold columns are not in a semantic view' };
  if (unmapped.length) return { levelNow: 3, objectsAt, blocker: `No glossary mapping or semantic use for ${unmapped.length} column${unmapped.length > 1 ? 's' : ''}: ${unmapped.map((x) => x.split('.').slice(1).join('.')).join(', ')}` };
  if (!terms.length) return { levelNow: 3, objectsAt, blocker: 'No glossary mapping for its Gold columns' };
  const unmappedCdes = gold.flatMap((o) => o.columns.filter((col) => col.tags?.includes('CDE') && !mapped.has(`${fqnOf(o)}.${col.name}`)));
  objectsAt[4] = views.map((v) => `SEMANTIC.${v.name}`);

  const candidates = pack.products.filter((p) => (t.consumedBy ? t.consumedBy.includes(p.id) : true) && p.upstream.some((u) => (carriedObj ? goldIds.has(u) || carriedObj.has(u) : down.has(u))));
  const certified = candidates.filter((p) => live.productStatus[p.id] === 'Certified');
  if (!certified.length) {
    const why = candidates.length ? `${candidates.map((p) => `${p.name} is ${live.productStatus[p.id]}`).join('; ')}` : 'Not part of any data product';
    return { levelNow: 4, objectsAt, blocker: unmappedCdes.length ? `${why}; no glossary mapping for ${unmappedCdes.length} CDE column${unmappedCdes.length > 1 ? 's' : ''}` : why };
  }
  objectsAt[5] = certified.map((p) => `DATA_PRODUCTS.${p.outputPort}`);

  const certIds = new Set(certified.map((p) => p.id));
  const agents = pack.agents.filter((a) => a.productIds.some((id) => certIds.has(id)));
  const ready = agents.filter((a) => a.status === 'Production' && c.accuracy(a.id) >= 90);
  if (!ready.length) {
    return { levelNow: 5, objectsAt, blocker: agents.length ? `${agents.map((a) => `${a.name}: ${a.status === 'Production' ? `eval ${c.accuracy(a.id)}%` : 'Pilot'}`).join('; ')} (needs a production agent at eval ≥ 90%)` : 'No agent uses its certified product yet' };
  }
  objectsAt[6] = ready.map((a) => `AGENTS.${a.objectName}`);
  return { levelNow: 6, objectsAt };
}

export function coverage(c: CoverageCtx): CoverageRow[] {
  return (c.pack.ext?.sourceInventory ?? []).map((t, i) => ({
    ...t,
    id: `${t.source}.${t.table}#${i}`,
    derived: Boolean(t.lands),
    ...deriveLevel(c, t),
  }));
}

/** Count of tables whose furthest level is exactly n (n = 0..6); sums to the row count. */
export function levelHistogram(rows: { levelNow: number }[]): number[] {
  const h = [0, 0, 0, 0, 0, 0, 0];
  for (const r of rows) h[r.levelNow]++;
  return h;
}

export const atLeast = (rows: { levelNow: number }[], n: number) => rows.filter((r) => r.levelNow >= n).length;

/** Mean level per group (systems or domains), with the histogram. */
export function groupBy(rows: CoverageRow[], key: 'source' | 'domain') {
  const groups = new Map<string, CoverageRow[]>();
  for (const r of rows) groups.set(r[key], [...(groups.get(r[key]) ?? []), r]);
  return [...groups.entries()].map(([name, rs]) => ({ name, rows: rs, mean: rs.reduce((a, r) => a + r.levelNow, 0) / rs.length, hist: levelHistogram(rs) }));
}

/** Level each roadmap phase is expected to bring tables to (phase 0 setup … phase 6 scale). */
export const PHASE_LEVEL = [1, 2, 3, 4, 5, 6, 6];

/**
 * "Simulate +N weeks": advance the client along the roadmap from their current phase, and lift tables
 * one level per 4 weeks up to what the reached phase delivers.
 */
export function simulate(rows: CoverageRow[], weeks: number, phaseNow: number, durations: Record<number, number>): { rows: CoverageRow[]; phase: number } {
  if (weeks <= 0) return { rows, phase: phaseNow };
  const placed = layout(durations);
  const startWeek = placed[phaseNow]?.start ?? 0;
  const target = startWeek + weeks;
  const phase = placed.filter((p) => p.start <= target).pop()?.id ?? phaseNow;
  const cap = PHASE_LEVEL[Math.min(phase, PHASES.length - 1)];
  const steps = Math.floor(weeks / 4);
  return {
    phase,
    rows: rows.map((r) => (r.levelNow >= cap ? r : { ...r, levelNow: Math.min(cap, r.levelNow + steps), blocker: r.levelNow + steps >= cap ? undefined : r.blocker })),
  };
}

export type ReportStatus = 'Replaced' | 'Partially covered' | 'Not covered';

/** Legacy report status from the KPIs it needs: covered when a certified product carries the KPI. */
export function reportStatus(pack: IndustryPack, live: LiveState, kpiIds: string[], missing: string[]): { status: ReportStatus; productId?: string; covered: string[]; uncovered: string[] } {
  const covered: string[] = [];
  const uncovered: string[] = [];
  let productId: string | undefined;
  for (const k of kpiIds) {
    const kpi = pack.kpis.find((x) => x.id === k);
    const prod = kpi?.productIds.find((p) => live.productStatus[p] === 'Certified');
    if (prod) { covered.push(k); productId ??= prod; } else uncovered.push(k);
  }
  if (!productId) productId = pack.kpis.find((x) => x.id === kpiIds[0])?.productIds[0];
  const status: ReportStatus = covered.length === kpiIds.length && !missing.length ? 'Replaced' : covered.length ? 'Partially covered' : 'Not covered';
  return { status, productId, covered, uncovered };
}
