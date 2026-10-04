// Query functions over the in-memory sample. Agent scenarios, the Explorer worksheet, the semantic playground and
// the pack validator all call these, so an agent's number always equals the worksheet's number.
import { addDays, avg, groupBy, round, sum } from '../../mock-snowflake/generators';
import { AS_OF, DEPOSIT_PRODUCTS, LOAN_SEGMENTS, MONTHS, REGIONS } from './generators.config';
import type { BankData, Customer } from './data';

export const PERIODS = {
  asOf: AS_OF,
  month: '2026-09',
  quarter: { label: 'Q3 2026', months: ['2026-07', '2026-08', '2026-09'] },
  priorQuarter: { label: 'Q3 2025', months: ['2025-07', '2025-08', '2025-09'] },
  lastWeek: { from: '2026-09-21', to: '2026-09-27' },
  last30: { from: addDays(AS_OF, -29), to: AS_OF },
  q3: { from: '2026-07-01', to: AS_OF },
  ytd: { from: '2026-01-01', to: AS_OF },
  ytdMonths: MONTHS.filter((m) => m >= '2026-01'),
  priorYtd: { from: '2025-01-01', to: '2025-09-30' },
};

export type Allow = string[] | undefined;
const ok = (allow: Allow, region: string) => !allow || allow.includes(region);
const inRange = (d: string, r: { from: string; to: string }) => d >= r.from && d <= r.to;
const memoBy = <T,>(f: (d: BankData) => T) => {
  const cache = new WeakMap<BankData, T>();
  return (d: BankData) => {
    let v = cache.get(d);
    if (v === undefined) {
      v = f(d);
      cache.set(d, v);
    }
    return v;
  };
};

/** Month buckets over the two largest month-end facts, so per-month queries never scan the whole history. */
export const depByMonth = memoBy((d) => groupBy(d.deposits, (x) => x.month));
export const loanByMonth = memoBy((d) => groupBy(d.loanBals, (x) => x.month));
const depAt = (d: BankData, m: string) => depByMonth(d).get(m) ?? [];
const loanAt = (d: BankData, m: string) => loanByMonth(d).get(m) ?? [];

// ---------------------------------------------------------------- Customers (DP-01)
const sepHoldings = memoBy((d) => {
  const dep = new Map<number, { accounts: number; balance: number }>();
  for (const x of depAt(d, PERIODS.month)) {
    const cur = dep.get(x.customerKey) ?? { accounts: 0, balance: 0 };
    cur.accounts += 1;
    cur.balance += x.balance;
    dep.set(x.customerKey, cur);
  }
  const loans = new Map<number, { loans: number; balance: number }>();
  for (const x of loanAt(d, PERIODS.month)) {
    const cur = loans.get(x.customerKey) ?? { loans: 0, balance: 0 };
    cur.loans += 1;
    cur.balance += x.balance;
    loans.set(x.customerKey, cur);
  }
  const cards = new Map<number, number>();
  for (const c of d.cards) cards.set(c.customerKey, (cards.get(c.customerKey) ?? 0) + 1);
  return { dep, loans, cards };
});

export const holdingsOf = (d: BankData, key: number) => {
  const h = sepHoldings(d);
  return { deposits: h.dep.get(key)?.balance ?? 0, depositAccounts: h.dep.get(key)?.accounts ?? 0, loans: h.loans.get(key)?.balance ?? 0, loanCount: h.loans.get(key)?.loans ?? 0, cards: h.cards.get(key) ?? 0 };
};

/** BR-001: Active status, at least one open account at month-end and customer activity in the last 90 days. */
export const isActive = (d: BankData, c: Customer) => {
  const h = sepHoldings(d);
  return c.status === 'Active' && c.lastActivity >= addDays(AS_OF, -89) && (h.dep.has(c.key) || h.loans.has(c.key));
};

export function activeCustomers(d: BankData, allow?: Allow) {
  return d.customers.filter((c) => ok(allow, c.region) && isActive(d, c));
}

export function digitalAdoption(d: BankData, allow?: Allow) {
  const act = activeCustomers(d, allow);
  const dig = act.filter((c) => c.digitalActive);
  const statusOnly = d.customers.filter((c) => ok(allow, c.region) && c.status === 'Active').length;
  return { active: act.length, digital: dig.length, pct: round((dig.length / act.length) * 100, 1), statusOnly, activeScaled: Math.round(act.length * d.scale), digitalScaled: Math.round(dig.length * d.scale) };
}

export function productsPerCustomer(d: BankData, allow?: Allow) {
  const act = activeCustomers(d, allow);
  return round(avg(act.map((c) => { const h = holdingsOf(d, c.key); return h.depositAccounts + h.loanCount + h.cards; })), 2);
}

export function depositBalanceByRegion(d: BankData, allow?: Allow) {
  const act = activeCustomers(d, allow);
  const rows = REGIONS.filter((r) => ok(allow, r.name)).map((r) => {
    const xs = act.filter((c) => c.region === r.name);
    const bal = sum(xs.map((c) => holdingsOf(d, c.key).deposits));
    return { region: r.name, customers: xs.length, deposits: bal, avgPerCustomer: round(bal / Math.max(1, xs.length), 2) };
  });
  const total = sum(rows.map((r) => r.deposits));
  return { rows, overall: round(total / Math.max(1, act.length), 2), customers: act.length };
}

export function attrition(d: BankData, allow?: Allow) {
  const start = '2025-10-01';
  const base = d.customers.filter((c) => ok(allow, c.region) && c.openDate < start && (!c.closedDate || c.closedDate >= start));
  const closed = base.filter((c) => c.closedDate && c.closedDate <= AS_OF);
  return { base: base.length, closed: closed.length, pct: round((closed.length / base.length) * 100, 1) };
}

export function depositOnlyHighBalance(d: BankData, threshold = 250_000, allow?: Allow) {
  return activeCustomers(d, allow)
    .map((c) => ({ c, h: holdingsOf(d, c.key) }))
    .filter((x) => x.h.deposits > threshold && x.h.loanCount === 0)
    .sort((a, b) => b.h.deposits - a.h.deposits);
}

// ---------------------------------------------------------------- Deposits, liquidity and margin (DP-02)
export function totalDeposits(d: BankData, month = PERIODS.month, allow?: Allow) {
  return sum(depAt(d, month).filter((x) => ok(allow, x.region)).map((x) => x.balance)) * d.scale;
}

export function depositGrowth(d: BankData, allow?: Allow) {
  const sep = totalDeposits(d, '2026-09', allow);
  const dec = totalDeposits(d, '2025-12', allow);
  const sepPy = totalDeposits(d, '2025-09', allow);
  return { sep, dec, sepPy, ytdPct: round(((sep - dec) / dec) * 100, 2), yoyPct: round(((sep - sepPy) / sepPy) * 100, 2) };
}

export function depositsByRegion(d: BankData, allow?: Allow) {
  return REGIONS.filter((r) => ok(allow, r.name)).map((r) => {
    const sep = totalDeposits(d, '2026-09', [r.name]);
    const dec = totalDeposits(d, '2025-12', [r.name]);
    return { region: r.name, sep, dec, ytdPct: round(((sep - dec) / dec) * 100, 2), cost: costOfDeposits(d, ['2026-09'], [r.name]) };
  });
}

export function branchDepositChange(d: BankData, from = '2026-06', to = '2026-09', allow?: Allow) {
  return d.branches
    .filter((b) => ok(allow, b.region))
    .map((b) => {
      const at = (m: string) => sum(depAt(d, m).filter((x) => x.branchKey === b.key).map((x) => x.balance)) * d.scale;
      const start = at(from);
      const end = at(to);
      return { branch: b.name, code: b.code, region: b.region, start, end, change: end - start, pct: round(((end - start) / start) * 100, 1) };
    })
    .sort((a, b) => a.change - b.change);
}

export function costOfDeposits(d: BankData, months = [PERIODS.month], allow?: Allow) {
  const xs = months.flatMap((m) => depAt(d, m)).filter((x) => ok(allow, x.region));
  return round((sum(xs.map((x) => x.interest)) * 12 * 100) / sum(xs.map((x) => x.balance)), 2);
}

export function depositMix(d: BankData, month = PERIODS.month, allow?: Allow) {
  const xs = depAt(d, month).filter((x) => ok(allow, x.region));
  const total = sum(xs.map((x) => x.balance));
  return DEPOSIT_PRODUCTS.map((p) => {
    const ys = xs.filter((x) => x.productCode === p.code);
    const bal = sum(ys.map((x) => x.balance));
    return { product: p.label, balance: bal * d.scale, share: round((bal / total) * 100, 1), rate: round((sum(ys.map((x) => x.interest)) * 1200) / Math.max(1, bal), 2) };
  });
}

const glSum = (d: BankData, months: string[], gl: string[], allow?: Allow) =>
  sum(d.gl.filter((g) => months.includes(g.month) && gl.includes(g.glAccount) && ok(allow, g.region)).map((g) => g.amount));

/** Quarterly margin, efficiency and balance-sheet ratios from FCT_GL_MONTHLY. */
export function glQuarter(d: BankData, months = PERIODS.quarter.months, allow?: Allow) {
  const ii = glSum(d, months, ['4100', '4200', '4300'], allow);
  const ie = glSum(d, months, ['5100', '5200'], allow);
  const nonII = glSum(d, months, ['4500'], allow);
  const nonIE = glSum(d, months, ['6000'], allow);
  const ea = glSum(d, months, ['1100', '1200', '1000'], allow) / months.length;
  const last = [months[months.length - 1]];
  const loans = glSum(d, last, ['1100'], allow);
  const deposits = glSum(d, last, ['2100'], allow);
  const nii = ii - ie;
  return {
    nii, nonII, nonIE, earningAssets: ea, loans, deposits,
    nim: round(((nii * (12 / months.length)) / ea) * 100, 2), efficiency: round((nonIE / (nii + nonII)) * 100, 1), ldr: round((loans / deposits) * 100, 1),
  };
}

export function lcr(d: BankData, month = PERIODS.month, allow?: Allow) {
  return round((glSum(d, [month], ['9100'], allow) / glSum(d, [month], ['9200'], allow)) * 100, 1);
}

export function nimComparison(d: BankData, allow?: Allow) {
  const cur = glQuarter(d, PERIODS.quarter.months, allow);
  const prev = glQuarter(d, PERIODS.priorQuarter.months, allow);
  const rows = REGIONS.filter((r) => ok(allow, r.name)).map((r) => ({ region: r.name, cur: glQuarter(d, PERIODS.quarter.months, [r.name]), prev: glQuarter(d, PERIODS.priorQuarter.months, [r.name]) }));
  return { cur, prev, rows, costCur: costOfDeposits(d, PERIODS.quarter.months, allow), costPrev: costOfDeposits(d, PERIODS.priorQuarter.months, allow) };
}

// ---------------------------------------------------------------- Loan portfolio (DP-03)
export function loanPortfolio(d: BankData, month = PERIODS.month, allow?: Allow, segment?: string) {
  const xs = loanAt(d, month).filter((x) => ok(allow, x.region) && (!segment || x.segment === segment));
  const total = sum(xs.map((x) => x.balance));
  const npl = sum(xs.filter((x) => x.npl).map((x) => x.balance));
  const dpd90 = sum(xs.filter((x) => x.dpd >= 90).map((x) => x.balance));
  const dpd30 = sum(xs.filter((x) => x.dpd >= 30).map((x) => x.balance));
  const acl = sum(xs.map((x) => x.allowance));
  return {
    month, loans: xs.length, total: total * d.loanScale, npl: npl * d.loanScale, nplRatio: round((npl / total) * 100, 2),
    dpd90Ratio: round((dpd90 / total) * 100, 2), dpd30Ratio: round((dpd30 / total) * 100, 2), nplLoans: xs.filter((x) => x.npl).length,
    acl: acl * d.loanScale, coverage: round((acl / npl) * 100, 1), yield: round(sum(xs.map((x) => x.balance * x.yield)) / total, 2),
  };
}

export function nplBySegment(d: BankData, month = PERIODS.month, allow?: Allow) {
  return LOAN_SEGMENTS.map((s) => ({ segment: s.name, ...loanPortfolio(d, month, allow, s.name) }));
}

export function nplTrend(d: BankData, allow?: Allow) {
  return PERIODS.ytdMonths.map((m) => loanPortfolio(d, m, allow));
}

export function ncoRatio(d: BankData, months = PERIODS.ytdMonths, allow?: Allow) {
  const xs = months.flatMap((m) => loanAt(d, m)).filter((x) => ok(allow, x.region));
  const nco = sum(xs.map((x) => x.nco));
  const avgLoans = sum(xs.map((x) => x.balance)) / months.length;
  return { nco: nco * d.loanScale, pct: round(((nco * (12 / months.length)) / avgLoans) * 100, 2) };
}

// ---------------------------------------------------------------- Cards (DP-04)
export function cardMetrics(d: BankData, range = PERIODS.q3, allow?: Allow) {
  const xs = d.cardTxns.filter((t) => inRange(t.date, range) && ok(allow, t.region));
  const appr = xs.filter((t) => t.approved);
  const vol = sum(appr.map((t) => t.amount));
  const loss = sum(xs.map((t) => t.fraudLoss));
  return {
    txns: xs.length, approved: appr.length, volume: vol, volumeScaled: vol * d.scale, approvalRate: round((appr.length / xs.length) * 100, 2),
    avgTicket: round(vol / appr.length, 2), fraudLoss: loss, fraudLossScaled: loss * d.scale, fraudBps: round((loss / vol) * 10_000, 1), fraudCount: xs.filter((t) => t.fraudLoss > 0).length,
  };
}

export function cardDaily(d: BankData, range = PERIODS.last30, allow?: Allow) {
  const xs = d.cardTxns.filter((t) => inRange(t.date, range) && t.approved && ok(allow, t.region));
  const by = groupBy(xs, (t) => t.date);
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, ts]) => ({ day, spend: sum(ts.map((t) => t.amount)) * d.scale, txns: ts.length }));
}

export function fraudByCategory(d: BankData, range = PERIODS.q3, allow?: Allow) {
  const xs = d.cardTxns.filter((t) => inRange(t.date, range) && ok(allow, t.region));
  const by = groupBy(xs, (t) => t.category);
  return [...by.entries()]
    .map(([category, ts]) => {
      const vol = sum(ts.filter((t) => t.approved).map((t) => t.amount));
      const loss = sum(ts.map((t) => t.fraudLoss));
      return { category, volume: vol * d.scale, loss: loss * d.scale, bps: round((loss / vol) * 10_000, 1), frauds: ts.filter((t) => t.fraudLoss > 0).length };
    })
    .sort((a, b) => b.bps - a.bps);
}

// ---------------------------------------------------------------- AML (DP-05)
export function amlSummary(d: BankData, range: { from: string; to: string }, allow?: Allow) {
  const xs = d.alerts.filter((a) => inRange(a.date, range) && ok(allow, a.region));
  const disp = xs.filter((a) => a.disposition !== 'Open');
  const cases = xs.filter((a) => a.disposition === 'Escalated to case');
  const closedCases = cases.filter((a) => a.caseStatus !== 'Under investigation');
  const sars = cases.filter((a) => a.caseStatus === 'SAR filed');
  return {
    alerts: xs.length, alertsScaled: Math.round(xs.length * d.alertScale), open: xs.length - disp.length, dispositioned: disp.length, cases: cases.length,
    alertToCase: round((cases.length / Math.max(1, disp.length)) * 100, 1), sars: sars.length, sarConversion: round((sars.length / Math.max(1, closedCases.length)) * 100, 1),
    avgDays: round(avg(disp.map((a) => a.daysToDisposition!)), 1),
  };
}

export function amlByMonth(d: BankData, months = PERIODS.quarter.months, allow?: Allow) {
  return months.map((m) => {
    const [y, mo] = m.split('-').map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    return { month: m, ...amlSummary(d, { from: `${m}-01`, to: last }, allow) };
  });
}

export function amlByScenario(d: BankData, range = PERIODS.ytd, allow?: Allow) {
  const xs = d.alerts.filter((a) => inRange(a.date, range) && ok(allow, a.region));
  const by = groupBy(xs, (a) => a.scenario);
  return [...by.entries()]
    .map(([scenario, as]) => {
      const disp = as.filter((a) => a.disposition !== 'Open');
      const cases = as.filter((a) => a.disposition === 'Escalated to case').length;
      return { scenario, alerts: as.length, dispositioned: disp.length, cases, rate: round((cases / Math.max(1, disp.length)) * 100, 1) };
    })
    .sort((a, b) => b.alerts - a.alerts);
}

// ---------------------------------------------------------------- Customer profitability (DP-06, draft)
const FTP = 0.041;
const LOAN_FTP = 0.046;
export const profitability = memoBy((d: BankData) => {
  const depAvg = new Map<number, number>();
  const depSpread = new Map<number, number>();
  const last12 = MONTHS.slice(-12);
  for (const x of d.deposits) {
    if (!last12.includes(x.month)) continue;
    depAvg.set(x.customerKey, (depAvg.get(x.customerKey) ?? 0) + x.balance / 12);
    depSpread.set(x.customerKey, (depSpread.get(x.customerKey) ?? 0) + (x.balance * (FTP - x.rate / 100)) / 12);
  }
  const loanSpread = new Map<number, number>();
  const ecl = new Map<number, number>();
  for (const x of d.loanBals) {
    if (!last12.includes(x.month)) continue;
    loanSpread.set(x.customerKey, (loanSpread.get(x.customerKey) ?? 0) + (x.balance * (x.yield / 100 - LOAN_FTP)) / 12);
    ecl.set(x.customerKey, (ecl.get(x.customerKey) ?? 0) + x.nco + (x.allowance * 0.12) / 12);
  }
  const interchange = new Map<number, number>();
  for (const t of d.cardTxns) if (t.approved) interchange.set(t.customerKey, (interchange.get(t.customerKey) ?? 0) + t.amount * 4 * 0.0155 - t.fraudLoss * 4);
  return d.customers
    .filter((c) => c.status !== 'Closed')
    .map((c) => {
      const h = holdingsOf(d, c.key);
      const dep = depSpread.get(c.key) ?? 0;
      const loan = loanSpread.get(c.key) ?? 0;
      const card = interchange.get(c.key) ?? 0;
      const cost = c.costToServe + 20 * (h.depositAccounts + h.loanCount + h.cards);
      const loss = ecl.get(c.key) ?? 0;
      const net = dep + loan + card + c.feeIncome - cost - loss;
      return {
        c, depositSpread: round(dep, 2), loanSpread: round(loan, 2), interchange: round(card, 2), fees: c.feeIncome, costToServe: round(cost, 2), ecl: round(loss, 2),
        net: round(net, 2), unprofitable: net < 0, avgDeposits: depAvg.get(c.key) ?? 0,
      };
    });
});

export function profitabilityBySegment(d: BankData, allow?: Allow) {
  const rows = profitability(d).filter((r) => ok(allow, r.c.region));
  const by = groupBy(rows, (r) => r.c.segment);
  const segs = ['Mass retail', 'Affluent', 'Small business', 'Commercial'].map((s) => {
    const xs = by.get(s) ?? [];
    return { segment: s, customers: xs.length, avgNet: round(avg(xs.map((x) => x.net)), 0), totalNet: sum(xs.map((x) => x.net)) * d.scale, unprofitablePct: round((xs.filter((x) => x.unprofitable).length / Math.max(1, xs.length)) * 100, 1), ecl: sum(xs.map((x) => x.ecl)) * d.scale };
  });
  return { segs, avgNet: round(avg(rows.map((r) => r.net)), 0), unprofitablePct: round((rows.filter((r) => r.unprofitable).length / rows.length) * 100, 1), customers: rows.length };
}

/** Every KPI in the dictionary, computed from the sample (scaled where a system total is shown). */
export function computeKpis(d: BankData): Record<string, number> {
  const dig = digitalAdoption(d);
  const gq = glQuarter(d);
  const lp = loanPortfolio(d);
  const card = cardMetrics(d);
  const last30 = cardMetrics(d, PERIODS.last30);
  const amlQ = amlSummary(d, PERIODS.q3);
  const amlY = amlSummary(d, PERIODS.ytd);
  const prof = profitabilityBySegment(d);
  return {
    'K-01': dig.activeScaled,
    'K-02': dig.pct,
    'K-03': productsPerCustomer(d),
    'K-04': depositBalanceByRegion(d).overall,
    'K-05': attrition(d).pct,
    'K-06': Math.round(totalDeposits(d)),
    'K-07': depositGrowth(d).ytdPct,
    'K-08': gq.ldr,
    'K-09': costOfDeposits(d),
    'K-10': lcr(d),
    'K-11': gq.nim,
    'K-12': gq.efficiency,
    'K-13': Math.round(lp.total),
    'K-14': lp.nplRatio,
    'K-15': lp.dpd30Ratio,
    'K-16': ncoRatio(d).pct,
    'K-17': lp.coverage,
    'K-18': lp.yield,
    'K-19': Math.round(card.volumeScaled),
    'K-20': card.fraudBps,
    'K-21': card.approvalRate,
    'K-22': last30.avgTicket,
    'K-23': amlQ.alertsScaled,
    'K-24': amlY.alertToCase,
    'K-25': amlY.sarConversion,
    'K-26': amlY.avgDays,
    'K-27': prof.avgNet,
    'K-28': prof.unprofitablePct,
  };
}
