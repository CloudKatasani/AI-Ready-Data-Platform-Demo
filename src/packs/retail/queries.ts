// Query functions over the in-memory sample. Agent scenarios, the Explorer worksheet, the semantic playground and
// the pack validator all call these, so an agent's number always equals the worksheet's number.
import { addDays, avg, dateRange, groupBy, round, sum } from '../../mock-snowflake/generators';
import { AS_OF, CATEGORY_NAMES, REGION_NAMES, SCALES } from './generators.config';
import { compTotals, INV_WEEKS, isCompInMonth, type RetailData, type Sale } from './data';

export const PERIODS = {
  asOf: AS_OF,
  month: '2026-09',
  quarter: { label: 'Q3 2026', months: ['2026-07', '2026-08', '2026-09'], from: '2026-07-01', to: AS_OF },
  priorQuarter: { label: 'Q3 2025', from: '2025-07-01', to: '2025-09-30' },
  lastWeek: { from: '2026-09-21', to: '2026-09-27' },
  last30: { from: addDays(AS_OF, -29), to: AS_OF },
  ytd: { from: '2026-01-01', to: AS_OF },
  priorYtd: { from: '2025-01-01', to: '2025-09-30' },
};

type Range = { from: string; to: string };
const inRange = (d: string, r: Range) => d >= r.from && d <= r.to;
const ok = (region: string, allow?: string[]) => !allow || allow.includes(region);

// ---------------------------------------------------------------- Customer & loyalty (DP-01)
export function activeMembers(d: RetailData, allow?: string[]) {
  const since = addDays(AS_OF, -365);
  return d.members.filter((m) => m.status === 'Active' && m.lastPurchase > since && ok(m.region, allow));
}

export function memberSummary(d: RetailData, allow?: string[]) {
  const act = activeMembers(d, allow);
  const omni = act.filter((m) => m.storeBuyer && m.onlineBuyer);
  const repeat = act.filter((m) => m.purchases12m >= 2);
  const openStatus = d.members.filter((m) => m.status === 'Active' && ok(m.region, allow)).length;
  return {
    sampleActive: act.length, active: Math.round(act.length * d.memberScale), lapsed: Math.round((openStatus - act.length) * d.memberScale),
    omni: Math.round(omni.length * d.memberScale), omniPct: round((omni.length / act.length) * 100, 1),
    repeatPct: round((repeat.length / act.length) * 100, 1), avgSpend: round(avg(act.map((m) => m.spend12m)), 2),
    avgClv: round(avg(act.map((m) => m.clv)), 2),
    byTier: (['Elite', 'Plus', 'Member'] as const).map((t) => {
      const xs = act.filter((m) => m.tier === t);
      return { tier: t, active: Math.round(xs.length * d.memberScale), omniPct: round((xs.filter((m) => m.storeBuyer && m.onlineBuyer).length / Math.max(1, xs.length)) * 100, 1) };
    }),
  };
}

export function lapsingElite(d: RetailData, allow?: string[]) {
  const cut = addDays(AS_OF, -90);
  return activeMembers(d, allow)
    .filter((m) => m.tier === 'Elite' && m.lastPurchase < cut)
    .sort((a, b) => b.spend12m - a.spend12m);
}

export function loyaltyShareByRegion(d: RetailData, range: Range = PERIODS.quarter, allow?: string[]) {
  const xs = d.sales.filter((s) => inRange(s.date, range) && ok(s.region, allow));
  const by = groupBy(xs, (s) => s.region);
  const rows = REGION_NAMES.filter((r) => by.has(r)).map((r) => {
    const ys = by.get(r)!;
    const net = sum(ys.map((y) => y.net));
    return { region: r, net: net * d.storeScale, loyalty: sum(ys.map((y) => y.loyalty)) * d.storeScale, pct: round((sum(ys.map((y) => y.loyalty)) / net) * 100, 1) };
  });
  const net = sum(xs.map((x) => x.net));
  return { rows, pct: round((sum(xs.map((x) => x.loyalty)) / net) * 100, 1), net: net * d.storeScale };
}

export function dailyLoyaltySales(d: RetailData, allow?: string[]) {
  const xs = d.sales.filter((s) => inRange(s.date, PERIODS.last30) && ok(s.region, allow));
  const by = groupBy(xs, (s) => s.date);
  const days = dateRange(PERIODS.last30.from, PERIODS.last30.to).map((day) => {
    const ys = by.get(day) ?? [];
    const net = sum(ys.map((y) => y.net));
    const loy = sum(ys.map((y) => y.loyalty));
    return { day, loyalty: Math.round(loy * d.storeScale), net: Math.round(net * d.storeScale), pct: round((loy / Math.max(1, net)) * 100, 1) };
  });
  return { days, total: sum(days.map((x) => x.loyalty)), pct: round((sum(xs.map((x) => x.loyalty)) / sum(xs.map((x) => x.net))) * 100, 1) };
}

// ---------------------------------------------------------------- Sales performance (DP-02)
export function compSales(d: RetailData, range: Range, allow?: string[], channel?: Sale['channel']) {
  return compTotals(d.stores, d.byStoreDay, dateRange(range.from, range.to), (s) => ok(s.region, allow), channel);
}

export function compByRegion(d: RetailData, range: Range = PERIODS.ytd, allow?: string[]) {
  return REGION_NAMES.filter((r) => ok(r, allow)).map((r) => {
    const c = compTotals(d.stores, d.byStoreDay, dateRange(range.from, range.to), (s) => s.region === r);
    return { region: r, pct: round(c.pct, 1), ty: c.ty * d.storeScale, ly: c.ly * d.storeScale };
  });
}

export function compStoreCount(d: RetailData, month = PERIODS.month, allow?: string[]) {
  const open = d.stores.filter((s) => s.openDate <= `${month}-01` && ok(s.region, allow));
  return { comp: open.filter((s) => isCompInMonth(s, month)).length * d.storeScale, open: open.length * d.storeScale };
}

/** Signature: comparable store sales during each Q3 promotion window vs the same weekday-aligned days last year. */
export function compByPromotion(d: RetailData, allow?: string[]) {
  const q = PERIODS.quarter;
  return d.promos
    .filter((p) => p.year === 2026 && p.from >= q.from && p.from <= q.to)
    .map((p) => {
      const regions = p.regions.filter((r) => ok(r, allow));
      const c = compTotals(d.stores, d.byStoreDay, dateRange(p.from, p.to), (s) => regions.includes(s.region));
      const ly = d.promos.find((x) => x.year === 2025 && x.name === p.name);
      return {
        id: p.id, name: p.name, type: p.type, from: p.from, to: p.to, regions, pct: round(c.pct, 1),
        ty: c.ty * d.storeScale, ly: c.ly * d.storeScale, storeDays: c.storeDays, lappedLy: ly ? ly.name : null,
      };
    })
    .filter((x) => x.regions.length > 0);
}

export function topStoresByNetSales(d: RetailData, range: Range = PERIODS.lastWeek, n = 5, allow?: string[]) {
  const xs = d.sales.filter((s) => inRange(s.date, range) && ok(s.region, allow));
  const by = groupBy(xs, (s) => String(s.storeKey));
  return [...by.entries()]
    .map(([k, ys]) => {
      const s = d.stores.find((x) => x.key === Number(k))!;
      const net = sum(ys.map((y) => y.net));
      const txns = sum(ys.map((y) => y.txns));
      return { store: s, net, txns, basket: net / txns, ecomPct: (sum(ys.filter((y) => y.channel === 'E-commerce').map((y) => y.net)) / net) * 100 };
    })
    .sort((a, b) => b.net - a.net)
    .slice(0, n);
}

export function salesTotals(d: RetailData, range: Range, allow?: string[]) {
  const xs = d.sales.filter((s) => inRange(s.date, range) && ok(s.region, allow));
  const net = sum(xs.map((x) => x.net));
  const txns = sum(xs.map((x) => x.txns));
  const gross = sum(xs.map((x) => x.gross));
  return {
    net: net * d.storeScale, txns: txns * d.storeScale, basket: round(net / txns, 2), upt: round(sum(xs.map((x) => x.units)) / txns, 2),
    ecomPct: round((sum(xs.filter((x) => x.channel === 'E-commerce').map((x) => x.net)) / net) * 100, 1),
    discountPct: round((sum(xs.map((x) => x.discount)) / gross) * 100, 1), returnPct: round((sum(xs.map((x) => x.returns)) / gross) * 100, 1),
    loyaltyPct: round((sum(xs.map((x) => x.loyalty)) / net) * 100, 1),
  };
}

export function basketComparison(d: RetailData, allow?: string[]) {
  const cur = salesTotals(d, PERIODS.quarter, allow);
  const prev = salesTotals(d, PERIODS.priorQuarter, allow);
  const regions = REGION_NAMES.filter((r) => ok(r, allow)).map((r) => {
    const a = salesTotals(d, PERIODS.quarter, [r]);
    const b = salesTotals(d, PERIODS.priorQuarter, [r]);
    return { region: r, cur: a.basket, prev: b.basket, chg: round(((a.basket - b.basket) / b.basket) * 100, 1) };
  });
  return { cur, prev, chg: round(((cur.basket - prev.basket) / prev.basket) * 100, 1), regions };
}

// ---------------------------------------------------------------- Returns & fraud (DP-06)
export function returnsByRegion(d: RetailData, allow?: string[]) {
  const rows = REGION_NAMES.filter((r) => ok(r, allow)).map((r) => {
    const t = salesTotals(d, PERIODS.quarter, [r]);
    const rs = d.returns.filter((x) => x.region === r);
    const susp = rs.filter((x) => x.suspicious);
    return { region: r, returnPct: t.returnPct, returns: rs.length, suspicious: susp.length, suspiciousPct: round((susp.length / Math.max(1, rs.length)) * 100, 1), noReceiptPct: round((rs.filter((x) => !x.hasReceipt).length / Math.max(1, rs.length)) * 100, 1) };
  });
  const rs = d.returns.filter((x) => ok(x.region, allow));
  const susp = rs.filter((x) => x.suspicious);
  return {
    rows, returnPct: salesTotals(d, PERIODS.quarter, allow).returnPct, returns: rs.length, suspicious: susp.length,
    suspiciousScaled: susp.length * SCALES.returns, suspiciousPct: round((susp.length / rs.length) * 100, 1),
    noReceiptPct: round((rs.filter((x) => !x.hasReceipt).length / rs.length) * 100, 1),
    byReason: [...groupBy(susp, (x) => x.suspiciousReason ?? '').entries()].map(([reason, xs]) => ({ reason, n: xs.length })),
  };
}

// ---------------------------------------------------------------- Inventory health (DP-03)
const Q3_WEEKS = INV_WEEKS.filter((w) => w >= PERIODS.quarter.from && w <= AS_OF);
const LAST_WEEK = INV_WEEKS[INV_WEEKS.length - 1];

export function sellThrough(d: RetailData, weeks = Q3_WEEKS, allow?: string[]) {
  const xs = d.inventory.filter((x) => weeks.includes(x.week) && ok(x.region, allow));
  const calc = (ys: typeof xs) => {
    const first = ys.filter((y) => y.week === weeks[0]);
    const sold = sum(ys.map((y) => y.sold));
    const avail = sum(first.map((y) => y.begin)) + sum(ys.map((y) => y.received));
    return round((sold / Math.max(1, avail)) * 100, 1);
  };
  const by = groupBy(xs, (x) => x.category);
  return { pct: calc(xs), rows: CATEGORY_NAMES.map((c) => ({ category: c, pct: calc(by.get(c) ?? []), sold: sum((by.get(c) ?? []).map((y) => y.sold)) * d.storeScale })) };
}

export function inventoryHealth(d: RetailData, allow?: string[]) {
  const last13 = INV_WEEKS.slice(-13);
  const last4 = INV_WEEKS.slice(-4);
  const xs = d.inventory.filter((x) => last13.includes(x.week) && ok(x.region, allow));
  const lw = xs.filter((x) => x.week === LAST_WEEK);
  const cogs = sum(xs.map((x) => x.sold * x.unitCost));
  const avgInv = sum(xs.map((x) => x.end * x.unitCost)) / 13;
  const weeklySold4 = sum(xs.filter((x) => last4.includes(x.week)).map((x) => x.sold)) / 4;
  const rows = CATEGORY_NAMES.map((c) => {
    const ys = lw.filter((x) => x.category === c);
    const s4 = sum(xs.filter((x) => x.category === c && last4.includes(x.week)).map((x) => x.sold)) / 4;
    return {
      category: c, oosPct: round((sum(ys.map((y) => y.oos)) / Math.max(1, sum(ys.map((y) => y.skus)))) * 100, 1),
      wos: round(sum(ys.map((y) => y.end)) / Math.max(1, s4), 1), costUsd: sum(ys.map((y) => y.end * y.unitCost)) * d.storeScale,
      skus: sum(ys.map((y) => y.skus)), oos: sum(ys.map((y) => y.oos)),
    };
  });
  return {
    week: LAST_WEEK, turns: round((cogs * 4) / avgInv, 2), oosPct: round((sum(lw.map((x) => x.oos)) / sum(lw.map((x) => x.skus))) * 100, 1),
    wos: round(sum(lw.map((x) => x.end)) / weeklySold4, 1), costUsd: Math.round(sum(lw.map((x) => x.end * x.unitCost)) * d.storeScale), rows,
  };
}

export function oosByRegion(d: RetailData, allow?: string[]) {
  return REGION_NAMES.filter((r) => ok(r, allow)).map((r) => {
    const ys = d.inventory.filter((x) => x.week === LAST_WEEK && x.region === r);
    return { region: r, oosPct: round((sum(ys.map((y) => y.oos)) / sum(ys.map((y) => y.skus))) * 100, 1) };
  });
}

// ---------------------------------------------------------------- Supplier performance (DP-04)
export function supplierPerformance(d: RetailData) {
  const by = groupBy(d.poLines, (l) => l.supplier);
  return [...by.entries()]
    .map(([supplier, xs]) => ({
      supplier, category: xs[0].category, lines: xs.length, otifPct: round((xs.filter((x) => x.otif).length / xs.length) * 100, 1),
      fillPct: round((sum(xs.map((x) => x.receivedUnits)) / sum(xs.map((x) => x.ordered))) * 100, 1), leadDays: round(avg(xs.map((x) => x.leadDays)), 1),
      asnPct: round((xs.filter((x) => x.asnAccurate).length / xs.length) * 100, 1), spend: sum(xs.map((x) => x.cost)) * SCALES.po,
    }))
    .sort((a, b) => a.otifPct - b.otifPct);
}

export function supplierTotals(d: RetailData) {
  const xs = d.poLines;
  return {
    otifPct: round((xs.filter((x) => x.otif).length / xs.length) * 100, 1), fillPct: round((sum(xs.map((x) => x.receivedUnits)) / sum(xs.map((x) => x.ordered))) * 100, 1),
    leadDays: round(avg(xs.map((x) => x.leadDays)), 1), asnPct: round((xs.filter((x) => x.asnAccurate).length / xs.length) * 100, 1),
    spend: Math.round(sum(xs.map((x) => x.cost)) * SCALES.po), lines: xs.length,
  };
}

// ---------------------------------------------------------------- Promotion effectiveness (DP-05)
export function promoEffectiveness(d: RetailData, months = PERIODS.quarter.months, allow?: string[]) {
  const promos = d.promos.filter((p) => p.year === 2026 && months.includes(p.from.slice(0, 7)));
  const rows = promos.map((p) => {
    const xs = d.promoSales.filter((x) => x.promoKey === p.key && ok(x.region, allow));
    const incr = sum(xs.map((x) => x.incrementalMargin));
    const cost = sum(xs.map((x) => x.promoCost));
    const base = sum(xs.map((x) => x.baseline));
    const net = sum(xs.map((x) => x.net));
    return {
      id: p.id, name: p.name, type: p.type, lines: xs.length, roi: round(incr / Math.max(1, cost), 2), liftPct: round(((net - base) / Math.max(1, base)) * 100, 1),
      redemptionPct: round(((xs.length * SCALES.promoSales) / p.offersIssued) * 100, 1), cost: cost * SCALES.promoSales, incremental: incr * SCALES.promoSales,
      offers: p.offersIssued, net: net * SCALES.promoSales,
    };
  }).filter((r) => r.lines > 0);
  const all = d.promoSales.filter((x) => promos.some((p) => p.key === x.promoKey) && ok(x.region, allow));
  const offers = sum(rows.map((r) => r.offers));
  const net = sum(all.map((x) => x.net));
  const base = sum(all.map((x) => x.baseline));
  return {
    rows, roi: round(sum(all.map((x) => x.incrementalMargin)) / sum(all.map((x) => x.promoCost)), 2), liftPct: round(((net - base) / base) * 100, 1),
    redemptionPct: round(((all.length * SCALES.promoSales) / offers) * 100, 1), cost: sum(all.map((x) => x.promoCost)) * SCALES.promoSales,
  };
}

/** Every KPI in the dictionary, computed from the sample (scaled where a system total is shown). */
export function computeKpis(d: RetailData): Record<string, number> {
  const m = memberSummary(d);
  const ytd = salesTotals(d, PERIODS.ytd);
  const inv = inventoryHealth(d);
  const sup = supplierTotals(d);
  const promo = promoEffectiveness(d);
  const ret = returnsByRegion(d);
  return {
    'K-01': m.active,
    'K-02': loyaltyShareByRegion(d).pct,
    'K-03': m.avgSpend,
    'K-04': m.repeatPct,
    'K-05': m.omniPct,
    'K-06': round(compSales(d, PERIODS.ytd).pct, 1),
    'K-07': Math.round(ytd.net),
    'K-08': ytd.basket,
    'K-09': ytd.upt,
    'K-10': ytd.ecomPct,
    'K-11': ytd.discountPct,
    'K-12': sellThrough(d).pct,
    'K-13': inv.turns,
    'K-14': inv.oosPct,
    'K-15': inv.wos,
    'K-16': inv.costUsd,
    'K-17': sup.otifPct,
    'K-18': sup.fillPct,
    'K-19': sup.leadDays,
    'K-20': sup.asnPct,
    'K-21': sup.spend,
    'K-22': promo.roi,
    'K-23': promo.liftPct,
    'K-24': promo.redemptionPct,
    'K-25': m.avgClv,
    'K-26': ret.returnPct,
    'K-27': ret.suspiciousPct,
  };
}
