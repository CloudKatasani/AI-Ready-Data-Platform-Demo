// Ridgeline Bank synthetic data (spec section 6). Generated once per pack load from a seeded PRNG,
// so every demo run shows the same numbers and the agents always agree with the Explorer.
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, groupBy, pad, person, round, sum, toDate } from '../../mock-snowflake/generators';
import {
  AML_SCENARIOS, AS_OF, BRANCH_Q3_DRIFT, DEPOSIT_PRODUCTS, LOAN_SEGMENTS, MERCHANT_CATEGORIES, MONTHS, PRODUCTION, REGIONS, SEGMENTS, TARGETS, VOLUMES,
} from './generators.config';

export interface Branch { key: number; code: string; name: string; city: string; state: string; region: string; regionCode: string; manager: string }
export interface Customer {
  key: number; id: number; cifNo: string; first: string; last: string; name: string; email: string; phone: string; taxId: string; street: string;
  city: string; state: string; region: string; regionCode: string; branchKey: number; branchCode: string; branchName: string;
  segment: string; priorSegment?: string; changedOn?: string; effectiveFrom: string;
  status: 'Active' | 'Dormant' | 'Closed'; openDate: string; closedDate?: string; lastActivity: string;
  digitalEnrolled: boolean; digitalActive: boolean; amlRisk: 'Low' | 'Medium' | 'High'; hasCard: boolean;
  costToServe: number; feeIncome: number;
}
export interface DepositAccount {
  key: number; acctNo: string; customerKey: number; productCode: string; productLabel: string; rate: number; runoff: number;
  openDate: string; region: string; branchCode: string; branchKey: number;
}
export interface DepositBal {
  month: string; date: string; acctKey: number; customerKey: number; region: string; branchKey: number; branchCode: string;
  productCode: string; balance: number; rate: number; interest: number; runoff: number;
}
export interface Loan {
  key: number; loanNo: string; customerKey: number; segment: string; segCode: string; region: string; branchKey: number;
  origDate: string; payoffMonth?: string; yield: number; stress: number; riskGrade: number; naUnder90: boolean; accruing90: boolean;
}
export interface LoanBal {
  month: string; date: string; loanKey: number; customerKey: number; region: string; branchKey: number; segment: string;
  balance: number; dpd: number; nonAccrual: boolean; npl: boolean; nco: number; allowance: number; yield: number; riskWeight: number;
}
export interface Card { key: number; pan: string; last4: string; customerKey: number; region: string; activity: number }
export interface CardTxn {
  key: number; id: string; date: string; minute: number; cardKey: number; customerKey: number; region: string; category: string;
  channel: string; amount: number; approved: boolean; fraud: boolean; fraudLoss: number;
}
export interface DigitalSession { key: number; id: string; customerKey: number; date: string; minute: number; channel: string; eventType: string; deviceId: string; region: string }
export interface AmlAlert {
  key: number; id: string; customerKey: number; acctNo: string; region: string; scenario: string; scenarioCode: string; score: number; date: string;
  disposition: 'Open' | 'Closed – no action' | 'Escalated to case'; dispositionDate?: string; daysToDisposition?: number;
  caseId?: string; caseStatus?: 'Under investigation' | 'SAR filed' | 'Closed – no SAR';
}
export interface GlLine { month: string; date: string; region: string; glAccount: string; line: string; type: 'Balance' | 'Income' | 'Expense' | 'Liquidity'; amount: number }

export interface BankData {
  branches: Branch[];
  customers: Customer[];
  accounts: DepositAccount[];
  deposits: DepositBal[];
  loans: Loan[];
  loanBals: LoanBal[];
  cards: Card[];
  cardTxns: CardTxn[];
  sessions: DigitalSession[];
  alerts: AmlAlert[];
  gl: GlLine[];
  /** customers, deposit accounts, cards and sessions */
  scale: number;
  loanScale: number;
  alertScale: number;
}

const MONTH_END = new Map<string, string>();
export const monthEnd = (m: string) => {
  let v = MONTH_END.get(m);
  if (!v) {
    v = addDays(`${nextMonth(m)}-01`, -1);
    MONTH_END.set(m, v);
  }
  return v;
};
function nextMonth(m: string) {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
}

const AS_OF_MS = toDate(AS_OF).getTime();
/** Cumulative weights, so large weighted draws are a binary search (one rng draw, like Rng.weighted). */
const cumulative = (w: readonly number[]) => {
  const out: number[] = [];
  let acc = 0;
  for (const x of w) out.push((acc += x));
  return out;
};
function pickCum<T>(rng: Rng, items: readonly T[], cum: number[]): T {
  const r = rng.float() * cum[cum.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] > r) hi = mid;
    else lo = mid + 1;
  }
  return items[lo];
}
const daysTo = (d: string) => Math.round((AS_OF_MS - toDate(d).getTime()) / 86_400_000);

const BIZ_SUFFIX = ['Holdings LLC', 'Builders Inc', 'Logistics LLC', 'Dental Group', 'Family Farms', 'Partners LP', 'Manufacturing Co', 'Hospitality Group'];
const MANAGERS = ['K. Tamberlane', 'L. Ortega-Brandon', 'S. Pemberton', 'J. Abara', 'M. Rossiter', 'R. Lindholm', 'T. Mwangi-Rhodes', 'P. Duquesne'];

export function generateBanking(seed: number): BankData {
  const rng = new Rng(seed);
  const scale = PRODUCTION.customers / VOLUMES.customers;
  const loanScale = PRODUCTION.loans / VOLUMES.loans;

  // ---- Branches (16, four per market)
  const branches: Branch[] = REGIONS.flatMap((r) => r.branches.map((b) => ({ ...b, region: r.name, regionCode: r.code, key: 0, manager: '' })));
  branches.forEach((b, i) => { b.key = i + 1; b.manager = MANAGERS[i % MANAGERS.length]; });

  // ---- Customers (2,000 standing in for 3.2 M)
  const customers: Customer[] = [];
  for (let i = 0; i < VOLUMES.customers; i++) {
    const reg = rng.weighted(REGIONS, REGIONS.map((r) => r.weight));
    const brCode = rng.pick<{ code: string }>(reg.branches).code;
    const br = branches.find((b) => b.code === brCode)!;
    const seg = rng.weighted(SEGMENTS, SEGMENTS.map((s) => s.weight));
    const p = person(rng, i, 'examplemail.com');
    const biz = seg.name === 'Small business' || seg.name === 'Commercial';
    const id = 70_400_000 + i * 13 + rng.int(0, 12);
    const roll = rng.float();
    const closed = roll < 0.075;
    const dormant = !closed && roll < 0.115;
    const newCust = !closed && rng.chance(0.09);
    const openDate = newCust ? addDays('2025-10-01', rng.int(0, 360)) : addDays('2004-01-01', rng.int(0, 7500));
    const closedDate = closed ? addDays('2025-10-01', rng.int(0, 364)) : undefined;
    const stale = !closed && !dormant && rng.chance(0.035);
    const lastActivity = closed ? addDays(closedDate!, -rng.int(5, 60)) : dormant ? addDays(AS_OF, -rng.int(400, 900)) : stale ? addDays(AS_OF, -rng.int(95, 300)) : addDays(AS_OF, -rng.int(0, 40));
    const enrolled = !dormant && rng.chance(biz ? 0.82 : 0.77);
    const upgrade = rng.chance(0.08) && (seg.name === 'Affluent' || seg.name === 'Commercial');
    const effectiveFrom = upgrade ? addDays('2024-06-01', rng.int(0, 600)) : openDate;
    customers.push({
      key: i + 1, id, cifNo: pad(id, 10), first: p.first, last: p.last, name: biz ? `${p.last} ${rng.pick(BIZ_SUFFIX)}` : `${p.first} ${p.last}`,
      email: biz ? `${p.last.toLowerCase()}.ops${i % 97}@examplemail.com` : p.email, phone: `(${rng.int(201, 989)}) 555-${pad(rng.int(100, 9999), 4)}`,
      taxId: biz ? `9${pad(rng.int(1, 9))}-${pad(rng.int(1000000, 9999999), 7)}` : `9${pad(rng.int(0, 99))}-${pad(rng.int(70, 88))}-${pad(rng.int(1, 9999), 4)}`,
      street: p.street, city: br.city, state: br.state, region: reg.name, regionCode: reg.code, branchKey: br.key, branchCode: br.code, branchName: br.name,
      segment: seg.name, priorSegment: upgrade ? (seg.name === 'Affluent' ? 'Mass retail' : 'Small business') : undefined, changedOn: upgrade ? effectiveFrom : undefined, effectiveFrom,
      status: closed ? 'Closed' : dormant ? 'Dormant' : 'Active', openDate, closedDate, lastActivity,
      digitalEnrolled: enrolled, digitalActive: false, amlRisk: rng.chance(0.05) ? 'High' : rng.chance(0.21) ? 'Medium' : 'Low',
      hasCard: !biz && rng.chance(seg.name === 'Affluent' ? 0.82 : 0.56),
      costToServe: round(seg.costToServe * rng.lognormal(1, 0.35), 2), feeIncome: round(seg.fees * rng.lognormal(1, 0.5), 2),
    });
  }

  // ---- Deposit accounts and month-end balances (Jul 2025 – Sep 2026)
  const accounts: DepositAccount[] = [];
  const prod = (code: string) => DEPOSIT_PRODUCTS.find((x) => x.code === code)!;
  for (const c of customers) {
    const codes: string[] =
      c.segment === 'Mass retail' ? ['DDA', ...(rng.chance(0.35) ? ['SAV'] : []), ...(rng.chance(0.1) ? ['CD'] : [])]
      : c.segment === 'Affluent' ? ['DDA', ...(rng.chance(0.5) ? ['SAV'] : []), ...(rng.chance(0.6) ? ['MMDA'] : []), ...(rng.chance(0.35) ? ['CD'] : [])]
      : c.segment === 'Small business' ? ['BDDA', ...(rng.chance(0.35) ? ['MMDA'] : [])]
      : ['BDDA', ...(rng.chance(0.7) ? ['SWEEP'] : [])];
    for (const code of codes) {
      const pr = prod(code);
      accounts.push({
        key: accounts.length + 1, acctNo: pad(4_100_000_000 + accounts.length * 37 + rng.int(0, 30), 10), customerKey: c.key, productCode: code, productLabel: pr.label,
        rate: round(pr.rate * rng.range(0.85, 1.15), 5), runoff: pr.runoff, openDate: c.openDate, region: c.region, branchCode: c.branchCode, branchKey: c.branchKey,
      });
    }
  }
  const custByKey = new Map(customers.map((c) => [c.key, c]));
  const regionGrowth = new Map<string, number>(REGIONS.map((r) => [r.name, r.growth]));
  const deposits: DepositBal[] = [];
  for (const a of accounts) {
    const c = custByKey.get(a.customerKey)!;
    const pr = prod(a.productCode);
    const base = rng.lognormal(pr.median, 0.95) * (c.status === 'Dormant' ? 0.15 : 1);
    const g = regionGrowth.get(a.region)!;
    MONTHS.forEach((m, i) => {
      const date = monthEnd(m);
      if (a.openDate > date) return;
      if (c.closedDate && c.closedDate <= date) return;
      const drift = i >= 12 ? 1 + BRANCH_Q3_DRIFT[a.branchCode] * ((i - 11) / 3) * 1.6 : 1;
      const bal = base * (1 + (g * (i - 14)) / 12) * drift * (1 + rng.normal(0, 0.012));
      deposits.push({ month: m, date, acctKey: a.key, customerKey: a.customerKey, region: a.region, branchKey: a.branchKey, branchCode: a.branchCode, productCode: a.productCode, balance: bal, rate: round(a.rate * TARGETS.depositBeta[i] * 100, 3), interest: Number.NaN, runoff: a.runoff });
    });
  }
  // Calibrate Sep 2026 total deposits to the balance sheet target, then price.
  const sepDep = sum(deposits.filter((x) => x.month === '2026-09').map((x) => x.balance));
  const kDep = TARGETS.totalDeposits / scale / sepDep;
  for (const x of deposits) {
    x.balance = round(x.balance * kDep, 2);
    x.interest = round((x.balance * x.rate) / 100 / 12, 2);
  }

  // ---- Loans (1,400 standing in for 412 K) with month-end snapshots
  const borrowersRetail = customers.filter((c) => c.status !== 'Closed' && (c.segment === 'Mass retail' || c.segment === 'Affluent'));
  const borrowersBiz = customers.filter((c) => c.status !== 'Closed' && (c.segment === 'Small business' || c.segment === 'Commercial'));
  const bizCum = cumulative(borrowersBiz.map((c) => (c.segment === 'Commercial' ? 3.2 : 1)));
  const loans: Loan[] = [];
  const loanBase = new Map<number, number>();
  for (let i = 0; i < VOLUMES.loans; i++) {
    const s = rng.weighted(LOAN_SEGMENTS, LOAN_SEGMENTS.map((x) => x.weight));
    const biz = s.code === 'CRE' || s.code === 'CI';
    const c = biz ? pickCum(rng, borrowersBiz, bizCum) : rng.pick(borrowersRetail);
    const newLoan = rng.chance(0.13);
    const origDate = newLoan ? addDays('2025-07-05', rng.int(0, 440)) : addDays('2012-01-01', rng.int(0, 4900));
    const payoff = !newLoan && rng.chance(0.07) ? MONTHS[rng.int(1, 14)] : undefined;
    const u = rng.float();
    loans.push({
      key: i + 1, loanNo: `${s.code === 'CONS' ? 'CL' : s.code === 'RESI' ? 'ML' : s.code === 'HELOC' ? 'HE' : 'CM'}${pad(81_000_000 + i * 29 + rng.int(0, 28), 9)}`,
      customerKey: c.key, segment: s.name, segCode: s.code, region: c.region, branchKey: c.branchKey, origDate, payoffMonth: payoff,
      yield: round(s.yield + rng.normal(0, 0.004), 4), stress: rng.float() ** (1 / s.stress), riskGrade: biz ? rng.weighted([3, 4, 5, 6, 7], [0.15, 0.35, 0.3, 0.14, 0.06]) : 0,
      naUnder90: u < TARGETS.nonAccrualUnder90, accruing90: s.code === 'RESI' && u > 0.55,
    });
    loanBase.set(i + 1, rng.lognormal(s.median, 0.75));
  }
  const loanBals: LoanBal[] = [];
  const segOf = (code: string) => LOAN_SEGMENTS.find((x) => x.code === code)!;
  for (const l of loans) {
    const s = segOf(l.segCode);
    const base = loanBase.get(l.key)!;
    MONTHS.forEach((m, i) => {
      const date = monthEnd(m);
      if (l.origDate > date) return;
      if (l.payoffMonth && m >= l.payoffMonth) return;
      const amort = s.code === 'CI' ? 1 + rng.normal(0, 0.03) : 1 - (s.code === 'CRE' ? 0.003 : 0.005) * i;
      loanBals.push({
        month: m, date, loanKey: l.key, customerKey: l.customerKey, region: l.region, branchKey: l.branchKey, segment: l.segment,
        balance: base * amort, dpd: 0, nonAccrual: false, npl: false, nco: Number.NaN, allowance: Number.NaN, yield: round(l.yield * 100, 2), riskWeight: s.riskWeight,
      });
    });
  }
  const sepLoans = sum(loanBals.filter((x) => x.month === '2026-09').map((x) => x.balance));
  const kLoan = TARGETS.totalLoans / loanScale / sepLoans;
  for (const x of loanBals) x.balance = round(x.balance * kLoan, 2);
  calibrateCredit(loans, loanBals, rng);

  // ---- Cards and Q3 2026 card transactions
  const cards: Card[] = customers
    .filter((c) => c.hasCard && c.status !== 'Closed')
    .map((c, i) => {
      const pan = `4${pad(rng.int(10000, 99999), 5)}${pad(rng.int(0, 999999), 6)}${pad(rng.int(1000, 9999), 4)}`;
      return { key: i + 1, pan, last4: pan.slice(-4), customerKey: c.key, region: c.region, activity: c.status === 'Dormant' ? 0.01 : rng.lognormal(VOLUMES.cardActivity, 0.55) };
    });
  const q3Days = dateRange('2026-07-01', AS_OF);
  const catCum = cumulative(MERCHANT_CATEGORIES.map((x) => x.weight));
  const cardTxns: CardTxn[] = [];
  for (const d of q3Days) {
    const dow = toDate(d).getUTCDay();
    const wk = dow === 5 || dow === 6 ? 1.18 : dow === 0 ? 0.92 : 1;
    const season = d >= '2026-09-01' ? 1.03 : d < '2026-08-01' ? 0.97 : 1;
    for (const card of cards) {
      const lam = card.activity * wk * season;
      const n = Math.floor(lam) + (rng.chance(lam - Math.floor(lam)) ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const cat = pickCum(rng, MERCHANT_CATEGORIES, catCum);
        const online = cat.name === 'Online retail' || cat.name === 'Digital wallets & P2P' || (cat.name === 'Travel & airlines' && rng.chance(0.7));
        const channel = online ? 'E-commerce' : rng.chance(0.47) ? 'Contactless' : 'Card present';
        cardTxns.push({
          key: 0, id: '', date: d, minute: rng.int(360, 1430), cardKey: card.key, customerKey: card.customerKey, region: card.region, category: cat.name, channel,
          amount: round(Math.max(1.5, rng.lognormal(cat.median, 0.56)), 2), approved: !rng.chance(online ? 0.047 : 0.024), fraud: false, fraudLoss: 0,
        });
      }
    }
  }
  cardTxns.sort((a, b) => (a.date === b.date ? a.minute - b.minute : a.date < b.date ? -1 : 1));
  cardTxns.forEach((t, i) => { t.key = i + 1; t.id = `AUTH${t.date.replace(/-/g, '').slice(2)}${pad(i + 1, 6)}`; });
  calibrateFraud(cardTxns, rng);
  for (const t of cardTxns) if (!t.fraudLoss) t.fraudLoss = 0;

  // ---- Digital banking sessions, September 2026
  const sessions: DigitalSession[] = [];
  const sept = dateRange('2026-09-01', AS_OF);
  for (const c of customers) {
    if (!c.digitalEnrolled || c.status !== 'Active' || c.lastActivity < addDays(AS_OF, -40) || !rng.chance(0.875)) continue;
    c.digitalActive = true;
    const n = rng.int(1, 14);
    const device = `DEV-${pad(rng.int(100000, 999999), 6)}`;
    let last = '';
    for (let k = 0; k < n; k++) {
      const d = rng.pick(sept);
      if (d > last) last = d;
      sessions.push({
        key: 0, id: '', customerKey: c.key, date: d, minute: rng.int(300, 1420), channel: rng.chance(0.71) ? 'Mobile app' : 'Online banking',
        eventType: rng.weighted(['Login', 'Balance check', 'Transfer', 'Bill pay', 'Mobile deposit', 'Card lock', 'Statement download'], [0.3, 0.25, 0.14, 0.12, 0.08, 0.03, 0.08]),
        deviceId: device, region: c.region,
      });
    }
    if (last > c.lastActivity) c.lastActivity = last;
  }
  sessions.sort((a, b) => (a.date === b.date ? a.minute - b.minute : a.date < b.date ? -1 : 1));
  sessions.forEach((s, i) => { s.key = i + 1; s.id = `SES-${s.date.replace(/-/g, '')}-${pad(i + 1, 5)}`; });

  // ---- AML alerts, Jan 2025 – Sep 2026
  const acctsOf = new Map<number, DepositAccount[]>();
  for (const a of accounts) acctsOf.set(a.customerKey, [...(acctsOf.get(a.customerKey) ?? []), a]);
  const alertCust = customers.filter((c) => acctsOf.has(c.key));
  const custW = alertCust.map((c) => (c.amlRisk === 'High' ? 8 : c.amlRisk === 'Medium' ? 2.5 : 1) * (c.segment === 'Commercial' ? 2.5 : c.segment === 'Small business' ? 2 : 1));
  const alertDays = dateRange('2025-01-01', AS_OF);
  const dayW = alertDays.map((d) => (d.startsWith('2026') ? 1.08 : 1) * (toDate(d).getUTCDay() % 6 === 0 ? 0.35 : 1));
  const custCum = cumulative(custW);
  const dayCum = cumulative(dayW);
  const alerts: AmlAlert[] = [];
  for (let i = 0; i < VOLUMES.alerts; i++) {
    const c = pickCum(rng, alertCust, custCum);
    let date = pickCum(rng, alertDays, dayCum);
    if (c.closedDate && date >= c.closedDate) date = addDays(c.closedDate, -rng.int(10, 120));
    const sc = rng.weighted(AML_SCENARIOS, AML_SCENARIOS.map((x) => x.weight));
    const score = Math.min(99, Math.max(31, Math.round(rng.normal(58, 14) + (c.amlRisk === 'High' ? 12 : 0))));
    const age = daysTo(date);
    const openP = age < 7 ? 0.85 : age < 21 ? 0.5 : age < 45 ? 0.12 : 0;
    const open = rng.chance(openP);
    const dtd = Math.max(1, Math.min(age, Math.round(rng.lognormal(10.5, 0.55))));
    alerts.push({
      key: 0, id: '', customerKey: c.key, acctNo: rng.pick(acctsOf.get(c.key)!).acctNo, region: c.region, scenario: sc.name, scenarioCode: sc.code, score, date,
      disposition: open ? 'Open' : 'Closed – no action', dispositionDate: open ? undefined : addDays(date, dtd), daysToDisposition: open ? undefined : dtd,
    });
  }
  alerts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.customerKey - b.customerKey));
  alerts.forEach((a, i) => { a.key = i + 1; a.id = `ALR-${a.date.slice(0, 4)}-${pad(i + 1, 6)}`; });
  calibrateAlerts(alerts, rng);

  const data: BankData = {
    branches, customers, accounts, deposits, loans, loanBals, cards, cardTxns, sessions, alerts, gl: [],
    scale, loanScale, alertScale: (PRODUCTION.alertsPerMonth * 21) / VOLUMES.alerts,
  };
  data.gl = buildGl(data, rng);
  return data;
}

/** Month by month, mark non-performing and early-delinquent loans by stress rank so the NPL ratio follows its target path. */
function calibrateCredit(loans: Loan[], bals: LoanBal[], rng: Rng) {
  const loanByKey = new Map(loans.map((l) => [l.key, l]));
  const segByName = new Map<string, (typeof LOAN_SEGMENTS)[number]>(LOAN_SEGMENTS.map((x) => [x.name, x]));
  const rank = [...loans].sort((a, b) => b.stress - a.stress).map((l) => l.key);
  let prevNpl = new Set<number>();
  const nplSince = new Map<number, number>();
  const byMonth = groupBy(bals, (b) => b.month);
  MONTHS.forEach((m, i) => {
    const rows = byMonth.get(m) ?? [];
    const byLoan = new Map(rows.map((r) => [r.loanKey, r]));
    const total = sum(rows.map((r) => r.balance));
    const target = (TARGETS.npl[i] / 100) * total;
    const tol = 0.0004 * total;
    const npl = new Set([...prevNpl].filter((k) => byLoan.has(k)));
    let cur = sum([...npl].map((k) => byLoan.get(k)!.balance));
    for (const k of rank) {
      if (cur >= target - tol) break;
      const r = byLoan.get(k);
      if (!r || npl.has(k) || r.balance > target - cur + tol) continue;
      npl.add(k);
      cur += r.balance;
    }
    const early = new Set<number>();
    const target2 = target + (TARGETS.earlyDelinquency / 100) * total;
    let cur2 = cur;
    for (const k of rank) {
      if (cur2 >= target2 - tol) break;
      const r = byLoan.get(k);
      if (!r || npl.has(k) || r.balance > target2 - cur2 + tol || !rng.chance(0.8)) continue;
      early.add(k);
      cur2 += r.balance;
    }
    for (const r of rows) {
      const l = loanByKey.get(r.loanKey)!;
      const s = segByName.get(r.segment)!;
      if (npl.has(r.loanKey)) {
        if (!nplSince.has(r.loanKey)) nplSince.set(r.loanKey, i);
        const months = i - nplSince.get(r.loanKey)!;
        r.npl = true;
        r.dpd = l.naUnder90 ? 35 + ((r.loanKey * 7 + i * 11) % 50) : Math.min(360, 92 + months * 30 + (r.loanKey % 20));
        r.nonAccrual = l.naUnder90 || !l.accruing90;
        r.nco = round(r.balance * s.nco, 2);
        r.allowance = round(r.balance * 0.27, 2);
      } else if (early.has(r.loanKey)) {
        r.dpd = 30 + ((r.loanKey * 13 + i * 7) % 58);
        r.nco = 0;
        r.allowance = round(r.balance * s.reserve * 3, 2);
      } else {
        r.dpd = (r.loanKey + i) % 23 === 0 ? 1 + ((r.loanKey * 3 + i) % 28) : 0;
        r.nco = 0;
        r.allowance = round(r.balance * s.reserve, 2);
      }
    }
    prevNpl = npl;
  });
}

/** Flag confirmed fraud (weighted by merchant category risk) until Q3 fraud losses hit the target basis points. */
function calibrateFraud(txns: CardTxn[], rng: Rng) {
  const risk = new Map<string, number>(MERCHANT_CATEGORIES.map((c) => [c.name, c.fraud]));
  const approved = txns.filter((t) => t.approved);
  const target = (TARGETS.fraudBps / 10_000) * sum(approved.map((t) => t.amount));
  // Weighted sampling without replacement by rejection: draw a transaction, accept with probability weight ÷ max weight.
  const weight = (t: CardTxn) => risk.get(t.category)! * (t.channel === 'E-commerce' ? 2 : 1) * (t.amount > 150 ? 2 : 1);
  const wMax = Math.max(...MERCHANT_CATEGORIES.map((c) => c.fraud)) * 4;
  let loss = 0;
  for (let guard = 0; loss < target && guard < 200_000; guard++) {
    const t = approved[rng.int(0, approved.length - 1)];
    if (t.fraud || !rng.chance(weight(t) / wMax)) continue;
    const l = round(t.amount * rng.range(0.75, 1), 2);
    if (loss + l > target * 1.002) continue;
    t.fraud = true;
    t.fraudLoss = l;
    loss += l;
  }
  // Fraud attempts stopped at authorisation: declined, confirmed fraud, no loss.
  for (const t of txns) if (!t.approved && rng.chance(0.18 * risk.get(t.category)!)) t.fraud = true;
}

/** Escalate alerts (higher scores first, with noise) so the alert-to-case rate on dispositioned alerts hits target. */
function calibrateAlerts(alerts: AmlAlert[], rng: Rng) {
  const closed = alerts.filter((a) => a.disposition !== 'Open');
  const n = Math.round(closed.length * TARGETS.alertToCase);
  const ranked = closed.map((a) => ({ a, k: a.score + rng.normal(0, 13) })).sort((x, y) => y.k - x.k).slice(0, n);
  let c = 0;
  for (const { a } of ranked.sort((x, y) => x.a.key - y.a.key)) {
    a.disposition = 'Escalated to case';
    a.caseId = `CASE-${a.date.slice(2, 4)}${pad(++c, 5)}`;
    const caseAge = daysTo(a.dispositionDate!);
    a.caseStatus = caseAge < 30 && rng.chance(0.7) ? 'Under investigation' : rng.chance(0.19 + (a.score - 50) / 170) ? 'SAR filed' : 'Closed – no SAR';
  }
}

/** Monthly general-ledger balances and P&L by market, reconciled to the loan and deposit sub-ledgers. */
function buildGl(d: BankData, rng: Rng): GlLine[] {
  const out: GlLine[] = [];
  const regions = REGIONS.map((r) => r.name);
  const depBy = groupBy(d.deposits, (x) => x.month);
  const lnBy = groupBy(d.loanBals, (x) => x.month);
  MONTHS.forEach((m, i) => {
    const date = monthEnd(m);
    const dep = depBy.get(m) ?? [];
    const ln = lnBy.get(m) ?? [];
    const depTot = sum(dep.map((x) => x.balance));
    for (const r of regions) {
      const dr = dep.filter((x) => x.region === r);
      const lr = ln.filter((x) => x.region === r);
      const share = sum(dr.map((x) => x.balance)) / depTot;
      const loans = sum(lr.map((x) => x.balance)) * d.loanScale;
      const deposits = sum(dr.map((x) => x.balance)) * d.scale;
      const sec = TARGETS.securities * share * (1 + 0.002 * i);
      const cash = TARGETS.cash * share * (1 + rng.normal(0, 0.03));
      const bor = TARGETS.borrowings * share;
      const iiLoans = (sum(lr.filter((x) => !x.nonAccrual).map((x) => (x.balance * x.yield) / 100)) * d.loanScale) / 12;
      const iiSec = (sec * TARGETS.securitiesYield) / 12;
      const iiCash = (cash * TARGETS.cashYield) / 12;
      const ieDep = sum(dr.map((x) => x.interest)) * d.scale;
      const ieBor = (bor * TARGETS.borrowingRate) / 12;
      const nonII = ((deposits * TARGETS.nonInterestIncomePct) / 12) * (1 + rng.normal(0, 0.04));
      const nii = iiLoans + iiSec + iiCash - ieDep - ieBor;
      const nonIE = TARGETS.efficiency[r] * (nii + nonII) * (1 + rng.normal(0, 0.025)) * (1 - 0.0012 * i);
      const outflows = sum(dr.map((x) => x.balance * x.runoff)) * d.scale;
      const hqla = outflows * TARGETS.lcr * (1 + rng.normal(0, 0.02));
      const lines: [string, string, GlLine['type'], number][] = [
        ['1100', 'Loans and leases, gross', 'Balance', loans], ['1200', 'Investment securities', 'Balance', sec], ['1000', 'Cash and due from Fed', 'Balance', cash],
        ['2100', 'Total deposits', 'Balance', deposits], ['2300', 'Borrowings', 'Balance', bor],
        ['4100', 'Interest income – loans', 'Income', iiLoans], ['4200', 'Interest income – securities', 'Income', iiSec], ['4300', 'Interest income – cash', 'Income', iiCash],
        ['5100', 'Interest expense – deposits', 'Expense', ieDep], ['5200', 'Interest expense – borrowings', 'Expense', ieBor],
        ['4500', 'Non-interest income', 'Income', nonII], ['6000', 'Non-interest expense', 'Expense', nonIE],
        ['9100', 'High-quality liquid assets', 'Liquidity', hqla], ['9200', 'Net cash outflows (30-day stress)', 'Liquidity', outflows],
      ];
      for (const [glAccount, line, type, amount] of lines) out.push({ month: m, date, region: r, glAccount, line, type, amount: round(amount, 2) });
    }
  });
  return out;
}
