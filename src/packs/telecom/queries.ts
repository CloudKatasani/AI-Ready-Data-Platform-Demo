// Query functions over the in-memory sample. Agent scenarios, the Explorer worksheet, the semantic playground and
// the pack validator all call these, so an agent's number always equals the worksheet's number.
import { addDays, avg, groupBy, round, sum } from '../../mock-snowflake/generators';
import { AS_OF, MARKETS, PLANS, REGIONS, SITES_TOTAL } from './generators.config';
import type { BaseRow, Invoice, TelData } from './data';

export const PERIODS = {
  asOf: AS_OF,
  month: '2026-09',
  prevMonth: '2026-08',
  quarter: { label: 'Q3 2026', months: ['2026-07', '2026-08', '2026-09'], from: '2026-07-01', to: '2026-09-30' },
  prevQuarter: { label: 'Q2 2026', months: ['2026-04', '2026-05', '2026-06'], from: '2026-04-01', to: '2026-06-30' },
  lastWeek: { from: '2026-09-21', to: '2026-09-27' },
  last30: { from: addDays(AS_OF, -29), to: AS_OF },
  ytd: { from: '2026-01-01', to: AS_OF },
};

const inRange = (d: string, r: { from: string; to: string }) => d >= r.from && d <= r.to;
const ok = (region: string, allow?: string[]) => !allow || allow.includes(region);

// ---------- Subscribers (DP-01)

/** Active Subscriber (T-002 / BR-001): status Active and an invoice in the latest closed month. */
export function activeSubscribers(d: TelData, allow?: string[]) {
  const billed = new Set(d.invoices.filter((v) => v.month === PERIODS.month).map((v) => v.subKey));
  return d.subscribers.filter((s) => s.status === 'Active' && billed.has(s.key) && ok(s.region, allow));
}

export function activeMobile(d: TelData, allow?: string[]) {
  const act = activeSubscribers(d, allow).filter((s) => s.lob === 'Mobile');
  const statusOnly = d.subscribers.filter((s) => s.lob === 'Mobile' && s.status === 'Active' && ok(s.region, allow)).length;
  const autopay = act.filter((s) => s.autopay).length;
  return { sample: act.length, scaled: Math.round(act.length * d.scale), statusOnly, autopay, autopayPct: round((autopay / act.length) * 100, 1), list: act };
}

export function autopayRate(d: TelData, allow?: string[]) {
  const act = activeSubscribers(d, allow);
  return round((act.filter((s) => s.autopay).length / act.length) * 100, 1);
}

/** Postpaid subscribers out of contract with churn propensity ≥ 70 (BR-006). */
export function churnRiskOutOfContract(d: TelData, allow?: string[]) {
  const act = activeSubscribers(d, allow);
  const sep = new Map(d.invoices.filter((v) => v.month === PERIODS.month).map((v) => [v.subKey, v]));
  return act
    .filter((s) => s.segment === 'Postpaid' && s.outOfContract && s.churnPropensity >= 70)
    .map((s) => ({ s, bill: sep.get(s.key)!.billed }))
    .sort((a, b) => b.s.churnPropensity - a.s.churnPropensity || b.bill - a.bill);
}

// ---------- Usage & revenue (DP-03)

const postpaid = (v: Invoice) => v.segment === 'Postpaid';

export function arpu(invoices: Invoice[]) {
  const pp = invoices.filter(postpaid);
  return pp.length ? sum(pp.map((v) => v.billed)) / pp.length : 0;
}

export function arpuByRegion(d: TelData, months: string[], allow?: string[]) {
  const inv = d.invoices.filter((v) => months.includes(v.month) && postpaid(v) && ok(v.region, allow));
  const by = groupBy(inv, (v) => v.region);
  const rows = REGIONS.filter((r) => by.has(r)).map((r) => ({ region: r, arpu: round(arpu(by.get(r)!), 2), invoices: by.get(r)!.length, revenue: sum(by.get(r)!.map((v) => v.billed)) }));
  return { rows, overall: round(arpu(inv), 2), invoices: inv.length };
}

export function arpuMonth(d: TelData, month = PERIODS.month) {
  const inv = d.invoices.filter((v) => v.month === month);
  const pp = inv.filter(postpaid);
  return {
    month, arpu: round(arpu(inv), 2), postpaidInvoices: pp.length, postpaidRevenue: sum(pp.map((v) => v.billed)) * d.scale,
    serviceRevenue: Math.round(sum(inv.map((v) => v.billed)) * d.scale), byPlan: PLANS.filter((p) => p.segment === 'Postpaid').map((p) => ({ plan: p.name, arpu: round(arpu(pp.filter((v) => v.planCode === p.code)), 2) })),
  };
}

export function serviceRevenue(d: TelData, month = PERIODS.month) {
  return Math.round(sum(d.invoices.filter((v) => v.month === month).map((v) => v.billed)) * d.scale);
}

export function leakageByMarket(d: TelData, months = PERIODS.quarter.months) {
  const inv = d.invoices.filter((v) => months.includes(v.month));
  const rows = MARKETS.map((m) => {
    const xs = inv.filter((v) => v.marketCode === m.code);
    const rated = sum(xs.map((v) => v.rated));
    const leak = sum(xs.map((v) => v.leakage));
    return { market: m.name, code: m.code, region: m.region, rated: rated * d.scale, leakage: leak * d.scale, pct: round((leak / rated) * 100, 2), invoices: xs.filter((v) => v.leakage > 0).length };
  }).sort((a, b) => b.pct - a.pct);
  const rated = sum(inv.map((v) => v.rated));
  const leak = sum(inv.map((v) => v.leakage));
  return { rows, pct: round((leak / rated) * 100, 2), leakage: leak * d.scale, rated: rated * d.scale };
}

export function leakageMonth(d: TelData, month = PERIODS.month) {
  return Math.round(sum(d.invoices.filter((v) => v.month === month).map((v) => v.leakage)) * d.scale);
}

export function roamingShare(d: TelData, months = PERIODS.quarter.months) {
  const inv = d.invoices.filter((v) => months.includes(v.month) && v.lob === 'Mobile');
  const byMonth = months.map((m) => {
    const xs = inv.filter((v) => v.month === m);
    return { month: m, roaming: sum(xs.map((v) => v.roaming)) * d.scale, pct: round((sum(xs.map((v) => v.roaming)) / sum(xs.map((v) => v.billed))) * 100, 2) };
  });
  const roam = sum(inv.map((v) => v.roaming));
  const svc = sum(inv.map((v) => v.billed));
  return { pct: round((roam / svc) * 100, 2), roaming: roam * d.scale, service: svc * d.scale, byMonth, roamingInvoices: inv.filter((v) => v.roaming > 0).length };
}

export function dailyUsage(d: TelData, allow?: string[]) {
  const us = d.usage.filter((u) => ok(u.region, allow));
  const subs = new Set(us.map((u) => u.subKey)).size;
  const by = groupBy(us, (u) => u.date);
  const daily = [...by.entries()].sort().map(([day, xs]) => ({ day, tb: round((sum(xs.map((x) => x.dataGb)) * d.scale) / 1000, 0), gbPerSub: round(sum(xs.map((x) => x.dataGb)) / subs, 3) }));
  return { daily, subs, gbPerSub: round(sum(us.map((u) => u.dataGb)) / subs, 2), minPerSub: round(sum(us.map((u) => u.voiceMin)) / subs, 0) };
}

// ---------- Device & plan profitability (DP-05)

export function marginByPlan(d: TelData, months = PERIODS.quarter.months, allow?: string[]) {
  const inv = d.invoices.filter((v) => months.includes(v.month) && ok(v.region, allow));
  const gm = (xs: Invoice[]) => sum(xs.map((v) => v.billed - v.costOfService - v.deviceSubsidy));
  const rows = PLANS.map((p) => {
    const xs = inv.filter((v) => v.planCode === p.code);
    const rev = sum(xs.map((v) => v.billed));
    return { plan: p.name, segment: p.segment, perSub: round(gm(xs) / Math.max(1, xs.length), 2), pct: round((gm(xs) / Math.max(1, rev)) * 100, 1), subsidy: round(sum(xs.map((v) => v.deviceSubsidy)) / Math.max(1, xs.length), 2) };
  }).sort((a, b) => b.perSub - a.perSub);
  const pp = inv.filter(postpaid);
  return {
    rows, perSub: round(gm(inv) / inv.length, 2), pct: round((gm(inv) / sum(inv.map((v) => v.billed))) * 100, 1),
    subsidyPerPostpaid: round(sum(pp.map((v) => v.deviceSubsidy)) / pp.length, 2),
  };
}

// ---------- Churn & retention (DP-04)

const churned = (r: BaseRow) => r.voluntary + r.portOuts;

export function churnByPlanRegion(d: TelData, month = PERIODS.month, segment = 'Postpaid', allow?: string[]) {
  const rows = d.base.filter((r) => r.month === month && r.segment === segment && ok(r.region, allow));
  const cells = PLANS.filter((p) => p.segment === segment).flatMap((p) => REGIONS.filter((rg) => ok(rg, allow)).map((rg) => {
    const xs = rows.filter((r) => r.planCode === p.code && r.region === rg);
    const opening = sum(xs.map((r) => r.opening));
    const c = sum(xs.map(churned));
    return { plan: p.name, region: rg, opening, churned: c, voluntary: sum(xs.map((r) => r.voluntary)), portOuts: sum(xs.map((r) => r.portOuts)), migOut: sum(xs.map((r) => r.migOut)), rate: round((c / opening) * 100, 2) };
  }));
  const agg = (key: 'plan' | 'region') => [...groupBy(cells, (c) => c[key]).entries()].map(([k, xs]) => ({ key: k, opening: sum(xs.map((x) => x.opening)), churned: sum(xs.map((x) => x.churned)), rate: round((sum(xs.map((x) => x.churned)) / sum(xs.map((x) => x.opening))) * 100, 2) }));
  const opening = sum(rows.map((r) => r.opening));
  const c = sum(rows.map(churned));
  return {
    cells, byPlan: agg('plan'), byRegion: agg('region'), opening, churned: c, rate: round((c / opening) * 100, 2),
    portOuts: sum(rows.map((r) => r.portOuts)), voluntary: sum(rows.map((r) => r.voluntary)), involuntary: sum(rows.map((r) => r.involuntary)),
    migrationsExcluded: sum(rows.map((r) => r.migOut)), portOutShare: round((sum(rows.map((r) => r.portOuts)) / c) * 100, 1),
  };
}

export function churnRate(d: TelData, segment: string, month = PERIODS.month) {
  return churnByPlanRegion(d, month, segment).rate;
}

export function netAdds(d: TelData, month = PERIODS.month, segment = 'Postpaid') {
  const rows = d.base.filter((r) => r.month === month && r.segment === segment);
  const gross = sum(rows.map((r) => r.grossAdds));
  const disc = sum(rows.map((r) => r.voluntary + r.portOuts + r.involuntary));
  return { gross, disconnects: disc, net: gross - disc };
}

export function churnTrend(d: TelData, segment = 'Postpaid') {
  return [...new Set(d.base.map((r) => r.month))].sort().map((m) => ({ month: m, rate: churnRate(d, segment, m), net: netAdds(d, m, segment).net }));
}

// ---------- Network performance (DP-02)

export interface NetSummary { attempts: number; dropped: number; dcr: number; availability: number; cssr: number; throughput: number; siteDays: number }

export function netSummary(d: TelData, range: { from: string; to: string }, allow?: string[], region?: string): NetSummary {
  const xs = d.network.filter((n) => inRange(n.date, range) && ok(n.region, allow) && (!region || n.region === region));
  const attempts = sum(xs.map((n) => n.attempts));
  const dropped = sum(xs.map((n) => n.dropped));
  return {
    attempts, dropped, dcr: round((dropped / attempts) * 100, 3), availability: round(100 - (sum(xs.map((n) => n.downtimeMin)) / (xs.length * 1440)) * 100, 3),
    cssr: round(100 - (sum(xs.map((n) => n.setupFail)) / attempts) * 100, 2), throughput: round(avg(xs.map((n) => n.throughput)), 1), siteDays: xs.length,
  };
}

export function dcrCompare(d: TelData, allow?: string[]) {
  const regions = REGIONS.filter((r) => ok(r, allow));
  const rows = regions.map((r) => ({ region: r, q2: netSummary(d, PERIODS.prevQuarter, allow, r), q3: netSummary(d, PERIODS.quarter, allow, r) }));
  return { rows, q2: netSummary(d, PERIODS.prevQuarter, allow), q3: netSummary(d, PERIODS.quarter, allow) };
}

export function topSitesByDcr(d: TelData, n = 10, allow?: string[]) {
  const xs = d.network.filter((x) => inRange(x.date, PERIODS.last30) && ok(x.region, allow));
  const by = groupBy(xs, (x) => x.siteId);
  return [...by.entries()]
    .map(([id, ys]) => {
      const s = d.sites.find((z) => z.id === id)!;
      const attempts = sum(ys.map((y) => y.attempts));
      const dropped = sum(ys.map((y) => y.dropped));
      return { siteId: id, name: s.name, market: s.market, region: s.region, technology: s.technology, attempts, dropped, dcr: round((dropped / attempts) * 100, 2), downtime: sum(ys.map((y) => y.downtimeMin)) };
    })
    .sort((a, b) => b.dcr - a.dcr)
    .slice(0, n);
}

export function slaCompliance(d: TelData, month = PERIODS.month) {
  const xs = d.network.filter((n) => n.date.startsWith(month));
  const days = new Set(xs.map((n) => n.date)).size;
  const by = groupBy(xs, (n) => n.siteId);
  const allowed = 0.001 * days * 1440;
  const breaching = [...by.values()].filter((ys) => sum(ys.map((y) => y.downtimeMin)) > allowed).length;
  return { sites: by.size, breaching, pct: round(((by.size - breaching) / by.size) * 100, 1) };
}

export function dataTrafficPb(d: TelData, month = PERIODS.month) {
  return round((sum(d.network.filter((n) => n.date.startsWith(month)).map((n) => n.dataTb)) * (SITES_TOTAL / d.sites.length)) / 1000, 1);
}

// ---------- Field service (DP-06)

export function fieldService(d: TelData, range: { from: string; to: string } = PERIODS.quarter, allow?: string[]) {
  const xs = d.workOrders.filter((w) => inRange(w.opened, range) && ok(w.region, allow));
  const stats = (ys: typeof xs) => ({ orders: ys.length, ftf: round((ys.filter((y) => y.ftf).length / Math.max(1, ys.length)) * 100, 1), hours: round(avg(ys.map((y) => y.hours)), 1), repeat: round((ys.filter((y) => y.repeat).length / Math.max(1, ys.length)) * 100, 1) });
  return {
    ...stats(xs),
    byRegion: REGIONS.filter((r) => ok(r, allow)).map((r) => ({ region: r, ...stats(xs.filter((x) => x.region === r)) })),
    byType: [...groupBy(xs, (x) => x.type).entries()].map(([type, ys]) => ({ type, ...stats(ys) })),
  };
}

/** Every KPI in the dictionary, computed from the sample (scaled where a system total is shown). */
export function computeKpis(d: TelData): Record<string, number> {
  const usage = dailyUsage(d);
  const q3net = netSummary(d, PERIODS.quarter);
  const margin = marginByPlan(d);
  const pp = churnByPlanRegion(d);
  const fs = fieldService(d);
  return {
    'K-01': activeMobile(d).scaled,
    'K-02': arpuMonth(d).arpu,
    'K-03': usage.gbPerSub,
    'K-04': usage.minPerSub,
    'K-05': autopayRate(d),
    'K-06': serviceRevenue(d),
    'K-07': leakageByMarket(d).pct,
    'K-08': roamingShare(d).pct,
    'K-09': leakageMonth(d),
    'K-10': q3net.dcr,
    'K-11': q3net.availability,
    'K-12': q3net.cssr,
    'K-13': q3net.throughput,
    'K-14': slaCompliance(d).pct,
    'K-15': dataTrafficPb(d),
    'K-16': pp.rate,
    'K-17': churnRate(d, 'Prepaid'),
    'K-18': netAdds(d).net,
    'K-19': netAdds(d).gross,
    'K-20': pp.portOutShare,
    'K-21': churnRate(d, 'Broadband'),
    'K-22': margin.pct,
    'K-23': margin.subsidyPerPostpaid,
    'K-24': margin.perSub,
    'K-25': fs.ftf,
    'K-26': fs.hours,
  };
}
