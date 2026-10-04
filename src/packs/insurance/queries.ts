// Query functions over the in-memory sample. Agent scenarios, the Explorer worksheet, the semantic playground and
// the pack validator all call these, so an agent's number always equals the worksheet's number.
import { avg, daysBetween, groupBy, round, sum } from '../../mock-snowflake/generators';
import { AS_OF, CAT_EVENTS, CAT_ZONES, LINES, REGIONS } from './generators.config';
import { inForceOn, MONTHS, VALUATION_MONTHS, type Claim, type InsData } from './data';

export const PERIODS = {
  asOf: AS_OF,
  month: '2026-09',
  quarter: { label: 'Q3 2026', months: ['2026-07', '2026-08', '2026-09'], from: '2026-07-01', to: AS_OF },
  lastWeek: { from: '2026-09-21', to: '2026-09-27' },
  last30: { from: '2026-09-01', to: AS_OF },
  ytd: { from: '2026-01-01', to: AS_OF },
  priorYtd: { from: '2025-01-01', to: '2025-09-30' },
};

export type Range = { from: string; to: string };
export const inRange = (d: string | undefined, r: Range) => Boolean(d) && d! >= r.from && d! <= r.to;
const monthsOf = (r: Range) => MONTHS.filter((m) => m >= r.from.slice(0, 7) && m <= r.to.slice(0, 7));
const inReg = (regions: string[] | undefined, r: string) => !regions || regions.includes(r);
export const lineName = (code: string) => LINES.find((l) => l.code === code)?.name ?? code;

export interface UwRow { key: string; earned: number; written: number; incurredEx: number; incurredCat: number; lae: number; expense: number; claims: number; catClaims: number; lrEx: number; catLr: number; lr: number }

/** Earned premium, incurred losses (ex-cat and cat), LAE and expenses for a period, grouped by line, state or region. Scaled to production. */
export function underwriting(d: InsData, range: Range, regions?: string[], by: 'line' | 'state' | 'region' | 'all' = 'line') {
  const months = monthsOf(range);
  const keyOf = (x: { line: string; state: string; region: string }) => (by === 'line' ? x.line : by === 'state' ? x.state : by === 'region' ? x.region : 'All');
  const acc = new Map<string, UwRow>();
  const get = (k: string) => acc.get(k) ?? acc.set(k, { key: k, earned: 0, written: 0, incurredEx: 0, incurredCat: 0, lae: 0, expense: 0, claims: 0, catClaims: 0, lrEx: 0, catLr: 0, lr: 0 }).get(k)!;
  for (const p of d.premiums) {
    if (!months.includes(p.month) || !inReg(regions, p.region)) continue;
    const r = get(keyOf(p));
    r.earned += p.earned * d.scale;
    r.written += p.written * d.scale;
    r.expense += p.expense * d.scale;
  }
  for (const c of d.claims) {
    if (!inRange(c.lossDate, range) || !inReg(regions, c.region)) continue;
    const r = get(keyOf(c));
    if (c.catCode) {
      r.incurredCat += c.incurred * d.claimScale;
      r.catClaims += d.claimScale;
    } else r.incurredEx += c.incurred * d.claimScale;
    r.lae += c.lae * d.claimScale;
    r.claims += d.claimScale;
  }
  const finish = (r: UwRow) => ({ ...r, lrEx: round((r.incurredEx / r.earned) * 100, 1), catLr: round((r.incurredCat / r.earned) * 100, 1), lr: round(((r.incurredEx + r.incurredCat) / r.earned) * 100, 1) });
  const order = by === 'line' ? LINES.map((l) => l.code) : [...acc.keys()].sort();
  const rows = order.filter((k) => acc.has(k)).map((k) => finish(acc.get(k)!));
  const t = rows.reduce((a, r) => ({ ...a, earned: a.earned + r.earned, written: a.written + r.written, incurredEx: a.incurredEx + r.incurredEx, incurredCat: a.incurredCat + r.incurredCat, lae: a.lae + r.lae, expense: a.expense + r.expense, claims: a.claims + r.claims, catClaims: a.catClaims + r.catClaims }), { key: 'Total', earned: 0, written: 0, incurredEx: 0, incurredCat: 0, lae: 0, expense: 0, claims: 0, catClaims: 0, lrEx: 0, catLr: 0, lr: 0 } as UwRow);
  return { rows, total: finish(t) };
}

/** Combined ratio and its components on earned premium (BR-006). */
export function combinedRatio(d: InsData, range: Range, regions?: string[]) {
  const t = underwriting(d, range, regions, 'all').total;
  const laeRatio = round((t.lae / t.earned) * 100, 1);
  const expenseRatio = round((t.expense / t.earned) * 100, 1);
  return { ...t, laeRatio, expenseRatio, combined: round(t.lr + laeRatio + expenseRatio, 1) };
}

/** Average incurred per claim (paid + case reserve) by line, for claims with a loss date in the period (BR-003). */
export function severityByLine(d: InsData, range: Range, regions?: string[]) {
  const cs = d.claims.filter((c) => inRange(c.lossDate, range) && inReg(regions, c.region));
  const by = groupBy(cs, (c) => c.line);
  const rows = LINES.filter((l) => by.has(l.code)).map((l) => {
    const xs = by.get(l.code)!;
    return { line: l.code, name: l.name, severity: round(avg(xs.map((c) => c.incurred)), 0), claims: xs.length, scaledClaims: Math.round(xs.length * d.claimScale) };
  });
  return { rows, overall: round(avg(cs.map((c) => c.incurred)), 0), claims: cs.length };
}

/** Open claims per BR-002: status Open or Reopened and a case reserve above zero. */
export const isOpenClaim = (c: Claim) => c.status !== 'Closed' && c.reserve > 0;

export function openClaims(d: InsData, regions?: string[]) {
  const scoped = d.claims.filter((c) => inReg(regions, c.region));
  const open = scoped.filter(isOpenClaim);
  const statusOnly = scoped.filter((c) => c.status !== 'Closed' && c.reserve <= 0);
  const by = groupBy(open, (c) => c.line);
  const rows = LINES.filter((l) => by.has(l.code)).map((l) => ({ line: l.code, name: l.name, open: by.get(l.code)!.length, reopened: by.get(l.code)!.filter((c) => c.status === 'Reopened').length }));
  return { open, rows, statusOnly: statusOnly.length, scaledOpen: Math.round(open.length * d.claimScale), reopened: open.filter((c) => c.status === 'Reopened').length };
}

/** Open injury claims above an incurred threshold (claimant names and injuries are sensitive). */
export function largeInjuryClaims(d: InsData, regions?: string[], threshold = 50_000) {
  return d.claims
    .filter((c) => isOpenClaim(c) && c.injury && c.incurred > threshold && inReg(regions, c.region))
    .map((c) => ({ c, daysOpen: daysBetween(c.reportDate, AS_OF) }))
    .sort((a, b) => b.c.incurred - a.c.incurred);
}

/** Daily loss payments over the last 30 days, scaled (FCT_CLAIM_TRANSACTION). */
export function dailyPayments(d: InsData, regions?: string[]) {
  const pays = d.txns.filter((t) => t.type === 'Loss payment' && inRange(t.date, PERIODS.last30) && inReg(regions, t.region));
  const by = groupBy(pays, (t) => t.date);
  const days: { day: string; amount: number; payments: number }[] = [];
  for (let i = 1; i <= 30; i++) {
    const day = `2026-09-${String(i).padStart(2, '0')}`;
    const xs = by.get(day) ?? [];
    days.push({ day, amount: sum(xs.map((t) => t.amount)) * d.claimScale, payments: xs.length });
  }
  return { days, total: sum(days.map((x) => x.amount)), payments: pays.length };
}

/** Month-end case reserves and IBNR (SV_LOSS_RESERVES), scaled. */
export function reserves(d: InsData, month = PERIODS.month, regions?: string[]) {
  const rs = d.reserves.filter((r) => r.month === month && inReg(regions, r.region));
  const withCase = rs.filter((r) => r.caseReserve > 0);
  const caseBal = sum(rs.map((r) => r.caseReserve)) * d.claimScale;
  const ibnr = sum(rs.map((r) => r.ibnr)) * d.claimScale;
  const byLine = LINES.map((l) => {
    const xs = rs.filter((r) => r.line === l.code);
    return { line: l.code, name: l.name, caseReserve: sum(xs.map((r) => r.caseReserve)) * d.claimScale, ibnr: sum(xs.map((r) => r.ibnr)) * d.claimScale, open: xs.filter((r) => r.caseReserve > 0).length };
  });
  return { month, caseBal, ibnr, total: caseBal + ibnr, openClaims: withCase.length, avgCase: round(withCase.length ? sum(withCase.map((r) => r.caseReserve)) / withCase.length : 0, 0), byLine };
}

export const reserveTrend = (d: InsData, regions?: string[]) => VALUATION_MONTHS.map((m) => reserves(d, m, regions));

export function topStatesByIncurred(d: InsData, n = 5, regions?: string[]) {
  return underwriting(d, PERIODS.ytd, regions, 'state').rows
    .map((r) => ({ ...r, region: REGIONS.find((g) => g.states.some((s) => s.code === r.key))!.name, incurred: r.incurredEx + r.incurredCat }))
    .sort((a, b) => b.incurred - a.incurred)
    .slice(0, n);
}

/** Property TIV by cat zone (policies in force) and catastrophe losses by event (DP-06 + DP-02). */
export function catExposure(d: InsData, range = PERIODS.ytd) {
  const prop = d.policies.filter((p) => p.tiv !== null && inForceOn(p, AS_OF));
  const by = groupBy(prop, (p) => p.catZone!);
  const zones = [...by.entries()].map(([zone, xs]) => ({ zone, policies: Math.round(xs.length * d.scale), tiv: sum(xs.map((p) => p.tiv!)) * d.scale })).sort((a, b) => b.tiv - a.tiv);
  const total = sum(zones.map((z) => z.tiv));
  const inZone = sum(zones.filter((z) => CAT_ZONES.includes(z.zone)).map((z) => z.tiv));
  const events = CAT_EVENTS.map((e) => {
    const xs = d.claims.filter((c) => c.catCode === e.code && inRange(c.lossDate, range));
    return { code: e.code, name: e.name, peril: e.peril, claims: Math.round(xs.length * d.claimScale), incurred: sum(xs.map((c) => c.incurred)) * d.claimScale };
  }).filter((e) => e.claims > 0);
  return { zones, total, inZone, pct: round((inZone / total) * 100, 1), events, catLosses: sum(events.map((e) => e.incurred)) };
}

/** Quote-to-bind on submissions quoted in the period (BR-014: declined-to-quote excluded). */
export function quoteToBind(d: InsData, range: Range, regions?: string[]) {
  const q = d.submissions.filter((s) => inRange(s.quoteDate, range) && inReg(regions, s.region));
  const bound = q.filter((s) => s.boundDate);
  return { quoted: q.length, bound: bound.length, ratio: round((bound.length / Math.max(1, q.length)) * 100, 1), scaledQuoted: Math.round(q.length * d.subScale), scaledBound: Math.round(bound.length * d.subScale), turnaround: round(avg(q.map((s) => s.turnaround!)), 2) };
}

export function quoteToBindByQuarter(d: InsData) {
  const qs = [['2025-Q4', '2025-10-01', '2025-12-31'], ['2026-Q1', '2026-01-01', '2026-03-31'], ['2026-Q2', '2026-04-01', '2026-06-30'], ['2026-Q3', '2026-07-01', '2026-09-30']];
  return qs.map(([label, from, to]) => ({ quarter: label, ...quoteToBind(d, { from, to }) }));
}

/** Average days from submission to quote by agency, year to date. */
export function agencyTurnaround(d: InsData, range = PERIODS.ytd) {
  const q = d.submissions.filter((s) => inRange(s.quoteDate, range));
  const by = groupBy(q, (s) => String(s.agencyKey));
  return [...by.entries()].map(([k, xs]) => {
    const a = d.agencies.find((x) => x.key === Number(k))!;
    return { agency: a.name, id: a.id, channel: a.channel, region: a.region, quotes: xs.length, turnaround: round(avg(xs.map((s) => s.turnaround!)), 1), bindRatio: round((xs.filter((s) => s.boundDate).length / xs.length) * 100, 1) };
  }).sort((a, b) => b.turnaround - a.turnaround);
}

/** New business premium bound in the period (BR-015 excludes rewrites and reinstatements), by channel. */
export function newBusinessPremium(d: InsData, range = PERIODS.ytd) {
  const b = d.submissions.filter((s) => inRange(s.boundDate, range));
  const nb = b.filter((s) => s.type === 'New business');
  const excluded = b.filter((s) => s.type !== 'New business');
  const by = groupBy(nb, (s) => s.channel);
  const rows = ['Independent agent', 'Captive agent', 'Broker', 'Direct digital'].filter((c) => by.has(c)).map((c) => ({ channel: c, premium: sum(by.get(c)!.map((s) => s.premium)) * d.subScale, policies: Math.round(by.get(c)!.length * d.subScale) }));
  return { rows, total: sum(rows.map((r) => r.premium)), policies: Math.round(nb.length * d.subScale), excluded: sum(excluded.map((s) => s.premium)) * d.subScale, excludedCount: Math.round(excluded.length * d.subScale) };
}

export function retention(d: InsData, year = '2026', regions?: string[]) {
  const due = d.policies.filter((p) => p.due[year] && inReg(regions, p.region) && p.terms.length && (year === '2026' ? true : true));
  const renewed = due.filter((p) => p.renewed[year]);
  return { due: due.length, renewed: renewed.length, pct: round((renewed.length / Math.max(1, due.length)) * 100, 1) };
}

export function policyholderSummary(d: InsData, regions?: string[]) {
  const pif = d.policies.filter((p) => inForceOn(p, AS_OF) && inReg(regions, p.region));
  const byRegion = REGIONS.filter((r) => inReg(regions, r.name)).map((r) => {
    const xs = pif.filter((p) => p.region === r.name);
    return { region: r.name, pif: Math.round(xs.length * d.scale), avgPremium: round(avg(xs.map((p) => p.premium)), 0), retention: retention(d, '2026', [r.name]).pct };
  });
  return {
    pif: Math.round(pif.length * d.scale), samplePif: pif.length, avgPremium: round(avg(pif.map((p) => p.premium)), 0),
    tenure: round(avg(pif.map((p) => daysBetween(p.inception, AS_OF) / 365.25)), 1), retention: retention(d, '2026', regions).pct, byRegion,
  };
}

export function premiumGrowth(d: InsData, regions?: string[]) {
  const cur = underwriting(d, PERIODS.ytd, regions, 'all').total;
  const prev = underwriting(d, PERIODS.priorYtd, regions, 'all').total;
  return { written: cur.written, prior: prev.written, earned: cur.earned, pct: round(((cur.written - prev.written) / prev.written) * 100, 1) };
}

/** Invoices more than 30 days past due at month end ÷ invoices billed in the month (BR-013). */
export function delinquency(d: InsData, month = PERIODS.month, regions?: string[]) {
  const inv = d.premiums.filter((p) => p.month === month && p.billed > 0 && inReg(regions, p.region));
  const late = inv.filter((p) => (p.daysPastDue ?? 0) > 30);
  return { invoices: Math.round(inv.length * d.scale), late: Math.round(late.length * d.scale), pct: round((late.length / Math.max(1, inv.length)) * 100, 1) };
}

/** Claims closed in the period: average days FNOL → close (BR-004). */
export function cycleTime(d: InsData, range = PERIODS.ytd, regions?: string[]) {
  const cs = d.claims.filter((c) => c.status === 'Closed' && inRange(c.closeDate, range) && inReg(regions, c.region));
  return { closed: cs.length, days: round(avg(cs.map((c) => daysBetween(c.reportDate, c.closeDate!))), 1) };
}

/** Recoveries ÷ paid losses on subrogation-eligible claims closed in the period (BR-008). */
export function subrogation(d: InsData, range = PERIODS.ytd) {
  const cs = d.claims.filter((c) => c.subroEligible && c.status === 'Closed' && inRange(c.closeDate, range));
  const paid = sum(cs.map((c) => c.paid));
  const rec = sum(cs.map((c) => c.subroRecovered));
  return { claims: cs.length, paid: paid * d.claimScale, recovered: rec * d.claimScale, pct: round((rec / paid) * 100, 1) };
}

/** Claims per 100 policies in force, annualised. */
export function frequency(d: InsData, range = PERIODS.ytd) {
  const months = monthsOf(range);
  const policyMonths = d.premiums.filter((p) => months.includes(p.month) && p.earned > 0).length;
  const claims = d.claims.filter((c) => inRange(c.lossDate, range)).length;
  return round(((claims * d.claimScale) / ((policyMonths * d.scale) / 12)) * 100, 2);
}

export function paidLosses(d: InsData, range = PERIODS.ytd) {
  return sum(d.txns.filter((t) => t.type === 'Loss payment' && inRange(t.date, range)).map((t) => t.amount)) * d.claimScale;
}

/** Every KPI in the dictionary, computed from the sample (scaled where a system total is shown). */
export function computeKpis(d: InsData): Record<string, number> {
  const uw = underwriting(d, PERIODS.ytd, undefined, 'all').total;
  const cr = combinedRatio(d, PERIODS.ytd);
  const ph = policyholderSummary(d);
  const res = reserves(d);
  const cat = catExposure(d);
  return {
    'K-01': uw.lrEx,
    'K-02': cr.combined,
    'K-03': cycleTime(d).days,
    'K-04': severityByLine(d, PERIODS.ytd).overall,
    'K-05': subrogation(d).pct,
    'K-06': frequency(d),
    'K-07': openClaims(d).scaledOpen,
    'K-08': uw.catLr,
    'K-09': cr.laeRatio,
    'K-10': Math.round(uw.incurredEx + uw.incurredCat),
    'K-11': Math.round(paidLosses(d)),
    'K-12': Math.round(uw.earned),
    'K-13': Math.round(uw.written),
    'K-14': premiumGrowth(d).pct,
    'K-15': cr.expenseRatio,
    'K-16': ph.avgPremium,
    'K-17': delinquency(d).pct,
    'K-18': ph.retention,
    'K-19': ph.pif,
    'K-20': ph.tenure,
    'K-21': quoteToBind(d, PERIODS.ytd).ratio,
    'K-22': Math.round(newBusinessPremium(d).total),
    'K-23': quoteToBind(d, PERIODS.ytd).turnaround,
    'K-24': Math.round(res.caseBal),
    'K-25': Math.round(res.ibnr),
    'K-26': res.avgCase,
    'K-27': Math.round(cat.inZone),
    'K-28': cat.pct,
  };
}
