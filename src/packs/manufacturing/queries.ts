// Query functions over the in-memory sample. Agent scenarios, the Explorer worksheet, the semantic playground and
// the pack validator all call these, so an agent's number always equals the worksheet's number.
import { addDays, groupBy, round, sum } from '../../mock-snowflake/generators';
import { AS_OF, BUSINESS_UNITS, PLANTS } from './generators.config';
import type { MfgData, Production } from './data';

export const PERIODS = {
  asOf: AS_OF,
  month: '2026-09',
  prevMonth: '2026-08',
  quarter: { label: 'Q3 2026', months: ['2026-07', '2026-08', '2026-09'] },
  prevQuarter: { label: 'Q2 2026', months: ['2026-04', '2026-05', '2026-06'] },
  lastWeek: { from: '2026-09-21', to: '2026-09-27' },
  last30: { from: addDays(AS_OF, -29), to: AS_OF },
};

export type Range = { from: string; to: string };
export const inRange = (d: string, r: Range) => d >= r.from && d <= r.to;
export const inMonths = (d: string, months: string[]) => months.includes(d.slice(0, 7));
const okBu = (bu: string, allow?: string[]) => !allow || allow.includes(bu);
const pct = (a: number, b: number, dp = 1) => round(b ? (a / b) * 100 : 0, dp);

export interface OeeAgg { planned: number; run: number; idealMin: number; total: number; good: number; scrap: number; rework: number; unplanned: number; breakdown: number; minor: number; energy: number; shifts: number; availability: number; performance: number; quality: number; oee: number }

/** OEE = availability × performance × quality over planned production time (planned downtime already excluded). */
export function oeeOf(rows: Production[]): OeeAgg {
  const planned = sum(rows.map((r) => r.plannedMin));
  const run = sum(rows.map((r) => r.runMin));
  const idealMin = sum(rows.map((r) => r.idealMin));
  const total = sum(rows.map((r) => r.total));
  const good = sum(rows.map((r) => r.good));
  const a = planned ? run / planned : 0;
  const p = run ? idealMin / run : 0;
  const q = total ? good / total : 0;
  return {
    planned, run, idealMin, total, good, scrap: sum(rows.map((r) => r.scrap)), rework: sum(rows.map((r) => r.rework)), unplanned: sum(rows.map((r) => r.unplannedMin)),
    breakdown: sum(rows.map((r) => r.breakdownMin)), minor: sum(rows.map((r) => r.minorStopMin)), energy: sum(rows.map((r) => r.energyKwh)), shifts: rows.length,
    availability: round(a * 100, 1), performance: round(p * 100, 1), quality: round(q * 100, 1), oee: round(a * p * q * 100, 1),
  };
}

export const prodIn = (d: MfgData, f: (p: Production) => boolean) => d.production.filter(f);

export function oeeByBu(d: MfgData, months = PERIODS.quarter.months, allow?: string[]) {
  const rows = prodIn(d, (p) => inMonths(p.date, months) && okBu(p.bu, allow));
  const by = groupBy(rows, (p) => p.bu);
  return {
    rows: BUSINESS_UNITS.filter((b) => by.has(b.name)).map((b) => ({ bu: b.name, ...oeeOf(by.get(b.name)!), lines: new Set(by.get(b.name)!.map((x) => x.lineKey)).size })),
    total: oeeOf(rows),
  };
}

/** Active Production Line (T-002 / BR-003): status Active and scheduled production time in the last 30 days. */
export function activeLines(d: MfgData, allow?: string[]) {
  const ran = new Set(prodIn(d, (p) => inRange(p.date, PERIODS.last30)).map((p) => p.lineKey));
  const scoped = d.lines.filter((l) => okBu(l.bu, allow));
  const active = scoped.filter((l) => l.status === 'Active' && ran.has(l.key));
  return { active, statusActive: scoped.filter((l) => l.status === 'Active').length, decommissioned: scoped.filter((l) => l.status === 'Decommissioned').length, all: scoped.length };
}

export function shiftLeadOee(d: MfgData, month = PERIODS.month, allow?: string[]) {
  const rows = prodIn(d, (p) => p.date.startsWith(month) && okBu(p.bu, allow));
  const by = groupBy(rows, (p) => String(p.leadKey));
  return [...by.entries()]
    .filter(([, xs]) => xs.length >= 8)
    .map(([k, xs]) => {
      const o = d.operators[Number(k) - 1];
      const agg = oeeOf(xs);
      return { op: o, below65: xs.filter((x) => oeeOf([x]).oee < 65).length, ...agg, lines: [...new Set(xs.map((x) => x.lineId))].join(', ') };
    })
    .sort((a, b) => a.oee - b.oee);
}

export interface LineLoss { lineId: string; plant: string; bu: string; type: string; agg: OeeAgg; availLoss: number; perfLoss: number; qualLoss: number; driver: string; topReason: string; topReasonHours: number }

/** Lines under an OEE threshold in a period, with the loss that drove the gap (signature question). */
export function linesBelowOee(d: MfgData, range: Range = PERIODS.lastWeek, threshold = 65, allow?: string[]) {
  const rows = prodIn(d, (p) => inRange(p.date, range) && okBu(p.bu, allow));
  const by = groupBy(rows, (p) => p.lineId);
  const all: LineLoss[] = [...by.entries()].map(([lineId, xs]) => {
    const line = d.lines.find((l) => l.id === lineId)!;
    const agg = oeeOf(xs);
    const a = agg.availability / 100;
    const p = agg.performance / 100;
    const q = agg.quality / 100;
    const losses = { Availability: round((1 - a) * 100, 1), Performance: round(a * (1 - p) * 100, 1), Quality: round(a * p * (1 - q) * 100, 1) };
    const reasons = groupBy(xs.filter((x) => x.unplannedMin > 0), (x) => x.topReason);
    const top = [...reasons.entries()].map(([r, ys]) => ({ r, h: sum(ys.map((y) => y.unplannedMin)) / 60 })).sort((m, n) => n.h - m.h)[0];
    const driver = (Object.entries(losses) as [string, number][]).reduce((m, n) => {
      // Compare each loss against a typical line (A 86%, P 88%, Q 96%) so the driver is what is unusual, not what is always largest.
      const norm = { Availability: 13.5, Performance: 10.5, Quality: 3.0 } as Record<string, number>;
      return n[1] - norm[n[0]] > m[1] - norm[m[0]] ? n : m;
    })[0];
    return { lineId, plant: line.plantName, bu: line.bu, type: line.type, agg, availLoss: losses.Availability, perfLoss: losses.Performance, qualLoss: losses.Quality, driver, topReason: top?.r ?? '—', topReasonHours: round(top?.h ?? 0, 1) };
  });
  const below = all.filter((x) => x.agg.oee < threshold).sort((m, n) => m.agg.oee - n.agg.oee);
  return { below, lines: all.length, total: oeeOf(rows) };
}

export function dailyUnits(d: MfgData, range: Range = PERIODS.last30, allow?: string[]) {
  const rows = prodIn(d, (p) => inRange(p.date, range) && okBu(p.bu, allow));
  const by = groupBy(rows, (p) => p.date);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, xs]) => ({ day, units: sum(xs.map((x) => x.good)), oee: oeeOf(xs).oee }));
}

export function quality(d: MfgData, months: string[], allow?: string[]) {
  const lots = d.lots.filter((l) => inMonths(l.date, months) && okBu(l.bu, allow));
  const prod = oeeOf(prodIn(d, (p) => inMonths(p.date, months) && okBu(p.bu, allow)));
  return {
    lots: lots.length, fpy: pct(lots.filter((l) => l.passedFirst).length, lots.length), ncrs: lots.filter((l) => l.ncr).length,
    ppm: Math.round((sum(lots.map((l) => l.defects)) / Math.max(1, sum(lots.map((l) => l.inspected)))) * 1e6), copq: round(sum(lots.map((l) => l.copq)), 0),
    scrapRate: pct(prod.scrap, prod.total, 2), reworkRate: pct(prod.rework, prod.total, 2), total: prod.total, scrap: prod.scrap,
  };
}

export function qualityByBu(d: MfgData, months: string[]) {
  return BUSINESS_UNITS.map((b) => ({ bu: b.name, ...quality(d, months, [b.name]) }));
}

export function copqByDefect(d: MfgData, months = PERIODS.quarter.months, allow?: string[]) {
  const lots = d.lots.filter((l) => inMonths(l.date, months) && l.ncr && okBu(l.bu, allow));
  const by = groupBy(lots, (l) => l.defectCode ?? 'Unclassified');
  return [...by.entries()].map(([code, xs]) => ({ code, ncrs: xs.length, copq: round(sum(xs.map((x) => x.copq)), 0), scrapLots: xs.filter((x) => x.disposition === 'Scrap').length })).sort((a, b) => b.copq - a.copq);
}

export function energy(d: MfgData, months = PERIODS.quarter.months, allow?: string[]) {
  const efByPlant = new Map<string, number>(PLANTS.map((p) => [p.code, p.ef]));
  const rows = prodIn(d, (p) => inMonths(p.date, months));
  const rowsOut = BUSINESS_UNITS.filter((b) => okBu(b.name, allow)).map((b) => {
    const xs = rows.filter((r) => r.bu === b.name);
    const kwh = sum(xs.map((x) => x.energyKwh));
    const good = sum(xs.map((x) => x.good));
    return { bu: b.name, kwh, good, kwhPerUnit: round(kwh / Math.max(1, good), 2), tco2e: round(sum(xs.map((x) => x.energyKwh * efByPlant.get(x.plantCode)!)) / 1000, 0) };
  });
  const kwh = sum(rowsOut.map((r) => r.kwh));
  const good = sum(rowsOut.map((r) => r.good));
  return { rows: rowsOut, kwh, good, kwhPerUnit: round(kwh / good, 2), tco2e: sum(rowsOut.map((r) => r.tco2e)) };
}

/** MTBF = asset operating hours ÷ failures; MTTR = repair hours ÷ failures (corrective work orders only). */
export function maintenance(d: MfgData, months = PERIODS.quarter.months, assetFilter: (a: MfgData['assets'][number]) => boolean = () => true) {
  const assets = d.assets.filter(assetFilter);
  const keys = new Set(assets.map((a) => a.key));
  const runByLine = new Map<number, number>();
  for (const p of d.production) if (inMonths(p.date, months)) runByLine.set(p.lineKey, (runByLine.get(p.lineKey) ?? 0) + p.runMin / 60);
  const opHours = sum(assets.map((a) => runByLine.get(a.lineKey) ?? 0));
  const evs = d.maint.filter((m) => inMonths(m.date, months) && keys.has(m.assetKey));
  const fails = evs.filter((m) => m.kind === 'Corrective');
  const pm = evs.filter((m) => m.kind === 'Preventive');
  return {
    assets: assets.length, opHours, failures: fails.length, pm: pm.length, mtbf: round(opHours / Math.max(1, fails.length), 1),
    mttr: round(sum(fails.map((f) => f.hours)) / Math.max(1, fails.length), 2), plannedPct: pct(pm.length, evs.length), repairHours: sum(fails.map((f) => f.hours)), runByLine,
  };
}

export function assetMtbf(d: MfgData, months = PERIODS.quarter.months) {
  const m = maintenance(d, months);
  const fails = groupBy(d.maint.filter((x) => x.kind === 'Corrective' && inMonths(x.date, months)), (x) => String(x.assetKey));
  return d.assets
    .filter((a) => (m.runByLine.get(a.lineKey) ?? 0) > 0)
    .map((a) => {
      const fs = fails.get(String(a.key)) ?? [];
      const op = m.runByLine.get(a.lineKey) ?? 0;
      return { a, opHours: round(op, 0), failures: fs.length, mtbf: fs.length ? round(op / fs.length, 1) : round(op, 1), mttr: fs.length ? round(sum(fs.map((f) => f.hours)) / fs.length, 2) : 0 };
    });
}

export function supplierPerf(d: MfgData, months = PERIODS.quarter.months, allow?: string[]) {
  const rs = d.receipts.filter((r) => inMonths(r.received, months) && okBu(r.bu, allow));
  const by = groupBy(rs, (r) => r.supplier);
  const rows = d.suppliers.map((s) => {
    const xs = by.get(s.name) ?? [];
    return { supplier: s.name, category: s.category, receipts: xs.length, otif: pct(xs.filter((x) => x.otif).length, xs.length), ppm: Math.round((sum(xs.map((x) => x.rejected)) / Math.max(1, sum(xs.map((x) => x.qty)))) * 1e6), lead: round(sum(xs.map((x) => x.leadDays)) / Math.max(1, xs.length), 1) };
  });
  return {
    rows, receipts: rs.length, otif: pct(rs.filter((x) => x.otif).length, rs.length), onTime: pct(rs.filter((x) => x.onTime).length, rs.length),
    ppm: Math.round((sum(rs.map((x) => x.rejected)) / sum(rs.map((x) => x.qty))) * 1e6), lead: round(sum(rs.map((x) => x.leadDays)) / rs.length, 1),
  };
}

export function delivery(d: MfgData, month = PERIODS.month, allow?: string[]) {
  const os = d.orders.filter((o) => o.delivered && o.delivered.startsWith(month) && okBu(o.bu, allow));
  return {
    month, lines: os.length, scaled: Math.round(os.length * d.orderScale), otd: pct(os.filter((o) => o.onTime).length, os.length), fill: pct(os.filter((o) => o.inFull).length, os.length),
    lead: round(sum(os.map((o) => o.leadDays ?? 0)) / Math.max(1, os.length), 1), late: os.filter((o) => !o.onTime).length,
  };
}

export function deliveryTrend(d: MfgData, allow?: string[]) {
  return ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((m) => delivery(d, m, allow));
}

export function deliveryByBu(d: MfgData, month = PERIODS.month) {
  return BUSINESS_UNITS.map((b) => ({ bu: b.name, ...delivery(d, month, [b.name]) }));
}

/** Every KPI in the dictionary, computed from the sample (scaled where a system total is shown). */
export function computeKpis(d: MfgData): Record<string, number> {
  const q3 = PERIODS.quarter.months;
  const o = oeeByBu(d, q3).total;
  const sep = oeeOf(prodIn(d, (p) => p.date.startsWith(PERIODS.month)));
  const ql = quality(d, q3);
  const mt = maintenance(d, q3);
  const sp = supplierPerf(d, q3);
  const dl = delivery(d);
  const en = energy(d, q3);
  return {
    'K-01': o.oee, 'K-02': o.availability, 'K-03': o.performance, 'K-04': o.quality,
    'K-05': sep.good, 'K-06': Math.round(o.unplanned / 60), 'K-07': activeLines(d).active.length,
    'K-08': ql.fpy, 'K-09': ql.scrapRate, 'K-10': ql.ppm, 'K-11': ql.ncrs, 'K-12': ql.copq, 'K-13': ql.reworkRate,
    'K-14': mt.mtbf, 'K-15': mt.mttr, 'K-16': mt.plannedPct, 'K-17': mt.failures,
    'K-18': sp.otif, 'K-19': sp.ppm, 'K-20': sp.lead,
    'K-21': dl.otd, 'K-22': dl.lead, 'K-23': dl.fill, 'K-24': dl.scaled,
    'K-25': en.kwhPerUnit, 'K-26': en.tco2e,
  };
}
