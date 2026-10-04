// Query functions over the in-memory sample. Agent scenarios, the Explorer worksheet, the semantic playground and
// the pack validator all call these, so an agent's number always equals the worksheet's number.
import { addDays, avg, groupBy, round, sum } from '../../mock-snowflake/generators';
import { AS_OF, OPCOS, SERVED_TOTAL } from './generators.config';
import type { Bill, UtilData } from './data';

export const PERIODS = {
  asOf: AS_OF,
  month: '2026-09',
  quarter: { label: 'Q3 2026', months: ['2026-07', '2026-08', '2026-09'] },
  lastWeek: { from: '2026-09-21', to: '2026-09-27' },
  last30: { from: addDays(AS_OF, -29), to: AS_OF },
  ytd: { from: '2026-01-01', to: AS_OF },
  priorYtd: { from: '2025-01-01', to: '2025-09-30' },
};

const inRange = (d: string, r: { from: string; to: string }) => d >= r.from && d <= r.to;

export function activeCustomers(d: UtilData) {
  const since = addDays(AS_OF, -60);
  const billed = new Set(d.bills.filter((b) => b.date > since).map((b) => b.customerKey));
  return d.customers.filter((c) => c.status === 'Active' && billed.has(c.key));
}

export function avgResidentialBillByRegion(d: UtilData) {
  const bills = d.bills.filter((b) => b.residential && PERIODS.quarter.months.includes(b.month));
  const byRegion = groupBy(bills, (b) => b.region);
  const rows = OPCOS.map((o) => {
    const bs = byRegion.get(o.region) ?? [];
    return { region: o.region, opco: o.name, avgBill: round(avg(bs.map((b) => b.billed)), 2), statements: bs.length };
  });
  return { rows, overall: round(avg(bills.map((b) => b.billed)), 2), statements: bills.length };
}

export function paperlessActive(d: UtilData) {
  const act = activeCustomers(d);
  const pl = act.filter((c) => c.paperless);
  return {
    sampleActive: act.length, samplePaperless: pl.length, pct: round((pl.length / act.length) * 100, 1),
    active: Math.round(act.length * d.scale), paperless: Math.round(pl.length * d.scale), statusActiveOnly: d.customers.filter((c) => c.status === 'Active').length,
  };
}

export function latestBills(d: UtilData): Map<number, Bill> {
  const m = new Map<number, Bill>();
  for (const b of d.bills) {
    const cur = m.get(b.customerKey);
    if (!cur || b.date > cur.date) m.set(b.customerKey, b);
  }
  return m;
}

export function highChurnArrears(d: UtilData) {
  const latest = latestBills(d);
  return d.customers
    .filter((c) => c.churnRisk >= 70 && (latest.get(c.key)?.arrears ?? 0) > 500)
    .map((c) => ({ c, arrears: latest.get(c.key)!.arrears }))
    .sort((a, b) => b.c.churnRisk - a.c.churnRisk || b.arrears - a.arrears);
}

export function dso(d: UtilData, month = PERIODS.month) {
  const bs = d.bills.filter((b) => b.month === month);
  const billed = sum(bs.map((b) => b.billed));
  const arrears = sum(bs.map((b) => b.arrears));
  const ar = billed + arrears;
  return { month, billed: billed * d.scale, ar: ar * d.scale, arrears: arrears * d.scale, dso: round((ar / billed) * 30, 1), statements: bs.length };
}

export function dsoTrend(d: UtilData) {
  const months = [...new Set(d.bills.map((b) => b.month))].sort().slice(-6);
  return months.map((m) => ({ month: m, dso: dso(d, m).dso }));
}

export function peakDemandByRateClass(d: UtilData) {
  const us = d.usage.filter((u) => inRange(u.date, PERIODS.lastWeek));
  const byRc = groupBy(us, (u) => u.rateClass);
  const rows = ['RS-1', 'RS-TOU', 'GS-1', 'GS-2'].map((rc) => {
    const xs = byRc.get(rc) ?? [];
    return { rateClass: rc, avgPeakKw: round(avg(xs.map((x) => x.peakKw)), 2), maxPeakKw: round(Math.max(...xs.map((x) => x.peakKw)), 1), premises: new Set(xs.map((x) => x.premiseKey)).size };
  });
  const byDay = groupBy(us, (u) => u.date);
  const daily = [...byDay.entries()].sort().map(([day, xs]) => ({ day, systemPeakMw: round((sum(xs.map((x) => x.peakKw)) * d.scale * 0.62) / 1000, 0) }));
  return { rows, daily };
}

export interface ReliabilityRow { opco: string; served: number; ci: number; cmi: number; events: number; saidi: number; saifi: number; caidi: number }

export function reliability(d: UtilData, range: { from: string; to: string }, excludeMed = true, opcos?: string[]) {
  const evs = d.outages.filter((o) => inRange(o.date, range) && (!excludeMed || !o.med));
  const byOpco = groupBy(evs, (o) => o.opco);
  const rows: ReliabilityRow[] = OPCOS.filter((o) => !opcos || opcos.includes(o.name)).map((o) => {
    const xs = byOpco.get(o.name) ?? [];
    const served = d.servedByOpco[o.name];
    const ci = sum(xs.map((x) => x.ci));
    const cmi = sum(xs.map((x) => x.ci * x.duration));
    return { opco: o.name, served, ci, cmi, events: xs.length, saidi: round(cmi / served, 1), saifi: round(ci / served, 3), caidi: round(ci ? cmi / ci : 0, 1) };
  });
  const served = opcos ? sum(rows.map((r) => r.served)) : SERVED_TOTAL;
  const ci = sum(rows.map((r) => r.ci));
  const cmi = sum(rows.map((r) => r.cmi));
  return {
    rows, events: evs.length, medEventsExcluded: excludeMed ? d.outages.filter((o) => inRange(o.date, range) && o.med).length : 0,
    total: { served, ci, cmi, saidi: round(cmi / served, 1), saifi: round(ci / served, 3), caidi: round(ci ? cmi / ci : 0, 1) },
  };
}

export function topCircuitsByCi(d: UtilData, n = 5) {
  const evs = d.outages.filter((o) => inRange(o.date, PERIODS.last30));
  const byC = groupBy(evs, (o) => o.circuitId);
  return [...byC.entries()]
    .map(([id, xs]) => {
      const c = d.circuits.find((cc) => cc.id === id)!;
      return { circuitId: id, opco: c.opco, substation: c.substation, ci: sum(xs.map((x) => x.ci)), events: xs.length, cmi: sum(xs.map((x) => x.ci * x.duration)) };
    })
    .sort((a, b) => b.ci - a.ci)
    .slice(0, n);
}

export function treeOutagesQuarter(d: UtilData) {
  const q = d.outages.filter((o) => PERIODS.quarter.months.includes(o.date.slice(0, 7)));
  const tree = q.filter((o) => o.cause === 'Tree contact');
  const byMonth = PERIODS.quarter.months.map((m) => ({ month: m, tree: tree.filter((o) => o.date.startsWith(m)).length }));
  return { total: q.length, tree: tree.length, pct: round((tree.length / q.length) * 100, 1), byMonth };
}

export function vegetation(d: UtilData) {
  const overdue = d.spans.filter((s) => s.overdue);
  const byOpco = OPCOS.map((o) => ({ opco: o.name, spans: d.spans.filter((s) => s.opco === o.name).length, overdue: overdue.filter((s) => s.opco === o.name).length }));
  return { spans: d.spans.length, overdue: overdue.length, pctOverdue: round((overdue.length / d.spans.length) * 100, 1), compliance: round(100 - (overdue.length / d.spans.length) * 100, 1), byOpco };
}

export function causeMix(d: UtilData, range = PERIODS.ytd) {
  const evs = d.outages.filter((o) => inRange(o.date, range) && !o.med);
  const by = groupBy(evs, (o) => o.cause);
  return [...by.entries()].map(([cause, xs]) => ({ cause, events: xs.length, pct: round((xs.length / evs.length) * 100, 1) })).sort((a, b) => b.events - a.events);
}

export function spendUnderContract(d: UtilData, months = PERIODS.quarter.months) {
  const ls = d.poLines.filter((l) => months.includes(l.date.slice(0, 7)));
  const total = sum(ls.map((l) => l.spend));
  const on = sum(ls.filter((l) => l.onContract).map((l) => l.spend));
  return { total, on, off: total - on, pct: round((on / total) * 100, 1), lines: ls.length };
}

export function supplierOtif(d: UtilData) {
  const by = groupBy(d.poLines, (l) => l.supplier);
  return [...by.entries()]
    .map(([supplier, xs]) => ({ supplier, lines: xs.length, otifPct: round((xs.filter((x) => x.otif).length / xs.length) * 100, 1), spend: sum(xs.map((x) => x.spend)) }))
    .sort((a, b) => a.otifPct - b.otifPct);
}

export function maverickByCategory(d: UtilData) {
  const by = groupBy(d.poLines, (l) => l.category);
  return [...by.entries()]
    .map(([category, xs]) => {
      const total = sum(xs.map((x) => x.spend));
      const mav = sum(xs.filter((x) => !x.onContract).map((x) => x.spend));
      return { category, maverick: mav, total, pct: round((mav / total) * 100, 1) };
    })
    .sort((a, b) => b.maverick - a.maverick);
}

/** Every KPI in the dictionary, computed from the sample (scaled where a system total is shown). */
export function computeKpis(d: UtilData): Record<string, number> {
  const act = activeCustomers(d);
  const latest = latestBills(d);
  const sept = d.bills.filter((b) => b.month === PERIODS.month);
  const ytd = reliability(d, PERIODS.ytd);
  const lw = d.usage;
  const q3 = d.poLines.filter((l) => PERIODS.quarter.months.includes(l.date.slice(0, 7)));
  const veg = vegetation(d);
  const last3 = d.bills.filter((b) => PERIODS.quarter.months.includes(b.month));
  return {
    'K-01': Math.round(act.length * d.scale),
    'K-02': avgResidentialBillByRegion(d).overall,
    'K-03': Math.round(sum([...latest.values()].map((b) => b.arrears)) * d.scale),
    'K-04': round((act.filter((c) => c.paperless).length / act.length) * 100, 1),
    'K-05': round(avg(act.map((c) => c.churnRisk)), 1),
    'K-06': ytd.total.saidi,
    'K-07': ytd.total.saifi,
    'K-08': ytd.total.caidi,
    'K-09': ytd.total.ci,
    'K-10': Math.round(ytd.total.cmi),
    'K-11': round(avg(lw.map((u) => u.kwh)), 1),
    'K-12': round(avg(lw.map((u) => u.peakKw)), 2),
    'K-13': round(avg(lw.map((u) => u.readSuccess)), 2),
    'K-14': round(100 - avg(lw.map((u) => u.readSuccess)), 2),
    'K-15': Math.round(sum(d.poLines.map((l) => l.spend))),
    'K-16': spendUnderContract(d, [...new Set(d.poLines.map((l) => l.date.slice(0, 7)))]).pct,
    'K-17': round((d.poLines.filter((l) => l.otif).length / d.poLines.length) * 100, 1),
    'K-18': round(avg(q3.map((l) => l.cycleDays)), 1),
    'K-19': Math.round(sum(d.poLines.filter((l) => !l.onContract).map((l) => l.spend))),
    'K-20': dso(d).dso,
    'K-21': Math.round(sept.length * d.scale),
    'K-22': round((sept.filter((b) => b.estimated).length / sept.length) * 100, 1),
    'K-23': round((sum(last3.filter((b) => b.daysToPay <= 60).map((b) => b.billed)) / sum(last3.map((b) => b.billed))) * 100, 1),
    'K-24': veg.pctOverdue,
    'K-25': treeOutagesQuarter(d).tree,
    'K-26': veg.compliance,
  };
}
