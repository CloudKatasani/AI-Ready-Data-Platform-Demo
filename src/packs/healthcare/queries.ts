// Query functions over the in-memory sample. Agent scenarios, the Explorer worksheet, the semantic playground and
// the pack validator all call these, so an agent's number always equals the worksheet's number.
import { avg, groupBy, round, sum } from '../../mock-snowflake/generators';
import { AS_OF, MARKETS, SERVICE_LINES } from './generators.config';
import type { Claim, Disposition, HcData, Stay } from './data';


// Fast, cached calendar arithmetic (the generators and queries do a lot of it).
const DAY_MS = 86_400_000;
const dayCache = new Map<string, number>();
export const dayNum = (iso: string) => {
  let v = dayCache.get(iso);
  if (v === undefined) dayCache.set(iso, (v = Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)));
  return v;
};
const isoCache = new Map<number, string>();
const isoOf = (n: number) => {
  let v = isoCache.get(n);
  if (v === undefined) isoCache.set(n, (v = new Date(n * DAY_MS).toISOString().slice(0, 10)));
  return v;
};
export const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);
export const addDaysFast = (iso: string, n: number) => isoOf(dayNum(iso) + n);

export const PERIODS = {
  asOf: AS_OF,
  month: { label: 'September 2026', from: '2026-09-01', to: AS_OF },
  priorMonth: { label: 'August 2026', from: '2026-08-01', to: '2026-08-31' },
  quarter: { label: 'Q3 2026', from: '2026-07-01', to: AS_OF, months: ['2026-07', '2026-08', '2026-09'] },
  priorQuarter: { label: 'Q2 2026', from: '2026-04-01', to: '2026-06-30' },
  lastWeek: { from: '2026-09-21', to: '2026-09-27' },
  last30: { from: '2026-09-01', to: AS_OF },
  last12: { from: '2025-10-01', to: AS_OF },
  ytd: { from: '2026-01-01', to: AS_OF },
  priorYtd: { from: '2025-01-01', to: '2025-09-30' },
  /** Readmission windows: index discharges whose 30-day window has closed by the as-of date (rule BR-013). */
  readmitYtd: { label: '1 Jan – 31 Aug 2026', from: '2026-01-01', to: '2026-08-31' },
  readmitPrior: { label: '1 Jan – 31 Aug 2025', from: '2025-01-01', to: '2025-08-31' },
  /** 7-day follow-up: Q3 discharges whose 7-day window has closed. */
  followup: { label: '1 Jul – 23 Sep 2026', from: '2026-07-01', to: '2026-09-23' },
  /** Net collection rate: services in H1 2026, mature enough to be resolved. */
  collections: { label: 'services Jan – Jun 2026', from: '2026-01-01', to: '2026-06-30' },
};

type Range = { from: string; to: string };
const inRange = (d: string, r: Range) => d >= r.from && d <= r.to;
const inMk = (m: string, markets?: string[]) => !markets || markets.includes(m);
const pct = (a: number, b: number, dp = 1) => round(b ? (a / b) * 100 : 0, dp);

// ---------------------------------------------------------------- Readmissions (CMS method, rule BR-012)
export const EXCLUDED_DISPOSITIONS: Disposition[] = ['Expired', 'Transfer to acute', 'Left AMA', 'In house'];
export interface ReadmitFlag { eligible: boolean; readmit: boolean; readmitKey?: number; days?: number; plannedExcluded: boolean }
type StayLike = Pick<Stay, 'key' | 'patientKey' | 'admit' | 'discharge' | 'inHouse' | 'disposition' | 'planned'>;

/** For every stay: is it an eligible index stay, and was it followed by an unplanned admission within 30 days? */
export function readmitFlags(stays: StayLike[]): Map<number, ReadmitFlag> {
  const out = new Map<number, ReadmitFlag>();
  for (const xs of groupBy(stays, (s) => String(s.patientKey)).values()) {
    xs.sort((a, b) => (a.admit < b.admit ? -1 : a.admit > b.admit ? 1 : 0));
    xs.forEach((s, i) => {
      const eligible = !s.inHouse && !EXCLUDED_DISPOSITIONS.includes(s.disposition);
      let readmitKey: number | undefined;
      let days: number | undefined;
      let plannedSeen = false;
      if (eligible) {
        for (let j = i + 1; j < xs.length; j++) {
          const gap = daysBetween(s.discharge, xs[j].admit);
          if (gap > 30) break;
          if (gap < 1) continue;
          if (xs[j].planned) { plannedSeen = true; continue; }
          readmitKey = xs[j].key;
          days = gap;
          break;
        }
      }
      out.set(s.key, { eligible, readmit: readmitKey !== undefined, readmitKey, days, plannedExcluded: plannedSeen && readmitKey === undefined });
    });
  }
  return out;
}

const flagCache = new WeakMap<HcData, Map<number, ReadmitFlag>>();
export function flagsOf(d: HcData) {
  let f = flagCache.get(d);
  if (!f) flagCache.set(d, (f = readmitFlags(d.stays)));
  return f;
}

export function readmissions(d: HcData, range: Range = PERIODS.readmitYtd, markets?: string[]) {
  const f = flagsOf(d);
  const disch = d.stays.filter((s) => !s.inHouse && inRange(s.discharge, range) && inMk(s.market, markets));
  const elig = disch.filter((s) => f.get(s.key)!.eligible);
  const rows = SERVICE_LINES.map((sl) => {
    const xs = elig.filter((s) => s.serviceLine === sl.name);
    const r = xs.filter((s) => f.get(s.key)!.readmit).length;
    return { serviceLine: sl.name, index: xs.length, readmits: r, rate: pct(r, xs.length) };
  }).sort((a, b) => b.rate - a.rate);
  const readmits = elig.filter((s) => f.get(s.key)!.readmit);
  return {
    rows, index: elig.length, readmits: readmits.length, rate: pct(readmits.length, elig.length), discharges: disch.length,
    transfers: disch.filter((s) => s.disposition === 'Transfer to acute').length,
    expired: disch.filter((s) => s.disposition === 'Expired').length,
    ama: disch.filter((s) => s.disposition === 'Left AMA').length,
    plannedExcluded: elig.filter((s) => f.get(s.key)!.plannedExcluded).length,
    avgDays: round(avg(readmits.map((s) => f.get(s.key)!.days!)), 1),
  };
}

const apptCache = new WeakMap<HcData, Map<number, string[]>>();
function completedVisitsByPatient(d: HcData) {
  let m = apptCache.get(d);
  if (!m) {
    m = new Map();
    for (const a of d.appts) if (a.status === 'Completed') { const xs = m.get(a.patientKey) ?? []; xs.push(a.date); m.set(a.patientKey, xs); }
    apptCache.set(d, m);
  }
  return m;
}

/** 7-day follow-up: discharges home / home health with a completed clinic visit 1–7 days later (rule BR-014). */
export function followup7(d: HcData, range: Range = PERIODS.followup, markets?: string[]) {
  const visits = completedVisitsByPatient(d);
  const elig = d.stays.filter((s) => !s.inHouse && inRange(s.discharge, range) && ['Home', 'Home health'].includes(s.disposition) && inMk(s.market, markets));
  const hit = (s: Stay) => (visits.get(s.patientKey) ?? []).some((v) => { const g = daysBetween(s.discharge, v); return g >= 1 && g <= 7; });
  const followed = elig.filter(hit);
  const byMarket = MARKETS.filter((m) => inMk(m.name, markets)).map((m) => {
    const xs = elig.filter((s) => s.market === m.name);
    const f = xs.filter(hit).length;
    return { market: m.name, discharges: xs.length, followed: f, rate: pct(f, xs.length) };
  });
  const payerClass = (s: Stay) => d.payers[s.payerKey - 1].payerClass;
  const byPayer = ['Medicare', 'Medicaid', 'Commercial', 'Self-pay'].map((c) => {
    const xs = elig.filter((s) => payerClass(s) === c);
    const f = xs.filter(hit).length;
    return { payerClass: c, discharges: xs.length, followed: f, rate: pct(f, xs.length) };
  });
  return { eligible: elig.length, followed: followed.length, rate: pct(followed.length, elig.length), byMarket, byPayer };
}

export function mortality(d: HcData, range: Range = PERIODS.ytd, markets?: string[]) {
  const disch = d.stays.filter((s) => !s.inHouse && inRange(s.discharge, range) && inMk(s.market, markets));
  const dead = disch.filter((s) => s.disposition === 'Expired').length;
  return { discharges: disch.length, expired: dead, rate: pct(dead, disch.length, 2) };
}

// ---------------------------------------------------------------- Throughput
export function alos(d: HcData, range: Range = PERIODS.ytd, markets?: string[]) {
  const disch = d.stays.filter((s) => !s.inHouse && inRange(s.discharge, range) && inMk(s.market, markets));
  const rows = MARKETS.filter((m) => inMk(m.name, markets)).map((m) => {
    const xs = disch.filter((s) => s.market === m.name);
    return { market: m.name, discharges: xs.length, alos: round(avg(xs.map((s) => s.los)), 2) };
  });
  return { rows, discharges: disch.length, alos: round(avg(disch.map((s) => s.los)), 2), patientDays: sum(disch.map((s) => s.los)) };
}

/** Average discharges per month over the range (default Q3 2026), scaled to the system. */
export function dischargesMonthly(d: HcData, range: Range = PERIODS.quarter, months = 3, markets?: string[]) {
  const n = d.stays.filter((s) => !s.inHouse && inRange(s.discharge, range) && inMk(s.market, markets)).length;
  return { sample: n, scaled: Math.round((n * d.scale.ip) / months) };
}

/** Bed occupancy: midnight census nights in the period ÷ (staffed beds × days in period) (rule BR-009). */
export function occupancy(d: HcData, month: Range = PERIODS.quarter, markets?: string[]) {
  const end = month.to === AS_OF ? '2026-10-01' : addOne(month.to);
  const days = daysBetween(month.from, end);
  const nights = new Map<string, number>();
  for (const s of d.stays) {
    const from = s.admit > month.from ? s.admit : month.from;
    const to = s.discharge < end ? s.discharge : end;
    const n = daysBetween(from, to);
    if (n > 0) nights.set(s.hospitalCode, (nights.get(s.hospitalCode) ?? 0) + n);
  }
  const rows = d.hospitals.filter((h) => inMk(h.market, markets)).map((h) => {
    const census = ((nights.get(h.code) ?? 0) * d.scale.ip) / days;
    return { code: h.code, hospital: h.name, market: h.market, beds: h.beds, adc: Math.round(census), occupancy: round((census / h.beds) * 100, 1) };
  });
  const beds = sum(rows.map((r) => r.beds));
  const adc = sum(rows.map((r) => ((nights.get(r.code) ?? 0) * d.scale.ip) / days));
  return { rows: rows.sort((a, b) => b.occupancy - a.occupancy), beds, adc: Math.round(adc), occupancy: round((adc / beds) * 100, 1) };
}
const addOne = (iso: string) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

/** ED door-to-provider wait; LWBS visits are excluded from the wait and reported as a rate (rule BR-010). */
export function edWait(d: HcData, range: Range = PERIODS.month, markets?: string[]) {
  const vs = d.ed.filter((v) => inRange(v.date, range) && inMk(v.market, markets));
  const seen = vs.filter((v) => !v.lwbs);
  const rows = d.hospitals.filter((h) => inMk(h.market, markets)).map((h) => {
    const xs = vs.filter((v) => v.hospitalCode === h.code);
    const s = xs.filter((v) => !v.lwbs);
    return { hospital: h.name, market: h.market, visits: xs.length, avgWait: round(avg(s.map((v) => v.waitMin!)), 1), lwbsPct: pct(xs.length - s.length, xs.length) };
  }).filter((r) => r.visits > 0).sort((a, b) => b.avgWait - a.avgWait);
  return { visits: vs.length, avgWait: round(avg(seen.map((v) => v.waitMin!)), 1), lwbsPct: pct(vs.length - seen.length, vs.length), rows, scaledVisits: Math.round(vs.length * d.scale.ed) };
}

/** No-show rate = no-shows ÷ (completed + no-shows); cancellations are excluded (rule BR-011). */
export function noShowByClinic(d: HcData, range: Range = PERIODS.last12, minVisits = 25) {
  const by = groupBy(d.appts.filter((a) => inRange(a.date, range) && a.status !== 'Cancelled'), (a) => String(a.clinicKey));
  return [...by.entries()].map(([k, xs]) => {
    const c = d.clinics[Number(k) - 1];
    const ns = xs.filter((a) => a.status === 'No-show').length;
    return { clinicId: c.id, clinic: c.name, specialty: c.specialty, market: c.market, scheduled: xs.length, noShows: ns, rate: pct(ns, xs.length) };
  }).filter((r) => r.scheduled >= minVisits).sort((a, b) => b.rate - a.rate);
}

export function noShowRate(d: HcData, range: Range = PERIODS.quarter, markets?: string[]) {
  const xs = d.appts.filter((a) => inRange(a.date, range) && a.status !== 'Cancelled' && inMk(a.market, markets));
  return pct(xs.filter((a) => a.status === 'No-show').length, xs.length);
}

export function newPatientLag(d: HcData, range: Range = PERIODS.quarter, markets?: string[]) {
  return round(avg(d.appts.filter((a) => a.type === 'New' && inRange(a.date, range) && inMk(a.market, markets)).map((a) => a.lag)), 1);
}

// ---------------------------------------------------------------- Patients
const lastEncCache = new WeakMap<HcData, Map<number, string>>();
/** Latest completed encounter date per patient (discharge, ED visit or completed appointment). */
export function lastEncounter(d: HcData) {
  let m = lastEncCache.get(d);
  if (!m) {
    m = new Map();
    const put = (k: number, dt: string) => { if (dt <= AS_OF && (m!.get(k) ?? '') < dt) m!.set(k, dt); };
    for (const s of d.stays) if (!s.inHouse) put(s.patientKey, s.discharge);
    for (const v of d.ed) put(v.patientKey, v.date);
    for (const a of d.appts) if (a.status === 'Completed') put(a.patientKey, a.date);
    lastEncCache.set(d, m);
  }
  return m;
}

/** Active Patient (rule BR-001): alive and at least one completed encounter in the last 12 months. */
export function activePatients(d: HcData, markets?: string[]) {
  const last = lastEncounter(d);
  return d.patients.filter((p) => !p.deathDate && (last.get(p.key) ?? '') >= PERIODS.last12.from && inMk(p.market, markets));
}

export function activeByPayerClass(d: HcData, markets?: string[]) {
  const act = activePatients(d, markets);
  const cls = (k: number) => d.payers[k - 1].payerClass;
  const rows = ['Medicare', 'Medicaid', 'Commercial', 'Self-pay'].map((c) => {
    const n = act.filter((p) => cls(p.payerKey) === c).length;
    return { payerClass: c, sample: n, patients: Math.round(n * d.scale.patients), share: pct(n, act.length) };
  });
  const alive = d.patients.filter((p) => !p.deathDate && inMk(p.market, markets)).length;
  return { active: act.length, activeScaled: Math.round(act.length * d.scale.patients), rows, selfPay: rows[3], notActive: alive - act.length, portalPct: pct(act.filter((p) => p.portal).length, act.length), avgRisk: round(avg(act.map((p) => p.risk)), 2) };
}

// ---------------------------------------------------------------- Revenue cycle
const claimsIn = (d: HcData, range: Range, markets?: string[]) => d.claims.filter((c) => inRange(c.submitDate, range) && inMk(c.market, markets));

export function denialByPayer(d: HcData, range: Range = PERIODS.quarter, markets?: string[]) {
  const cs = claimsIn(d, range, markets);
  const rows = d.payers.map((p) => {
    const xs = cs.filter((c) => c.payerKey === p.key);
    const den = xs.filter((c) => c.denied).length;
    return { payer: p.name, payerClass: p.payerClass, claims: xs.length, denied: den, rate: pct(den, xs.length), topReason: topReason(xs) };
  }).filter((r) => r.claims > 0).sort((a, b) => b.rate - a.rate);
  return { rows, claims: cs.length, denied: cs.filter((c) => c.denied).length, rate: pct(cs.filter((c) => c.denied).length, cs.length), cleanRate: pct(cs.filter((c) => c.clean).length, cs.length) };
}
function topReason(xs: Claim[]) {
  const by = groupBy(xs.filter((c) => c.denied), (c) => c.denialReason!);
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? '—';
}

export function denialReasons(d: HcData, range: Range = PERIODS.quarter, markets?: string[]) {
  const den = claimsIn(d, range, markets).filter((c) => c.denied);
  return [...groupBy(den, (c) => c.denialReason!).entries()].map(([reason, xs]) => ({ reason, denied: xs.length, pct: pct(xs.length, den.length), expected: sum(xs.map((c) => c.expected)) })).sort((a, b) => b.denied - a.denied);
}

export function claimsDaily(d: HcData, range: Range = PERIODS.last30, markets?: string[]) {
  const cs = claimsIn(d, range, markets);
  const by = groupBy(cs, (c) => c.submitDate);
  const days = [...by.keys()].sort();
  const rows = days.map((day) => { const xs = by.get(day)!; return { day, claims: xs.length, scaled: Math.round(xs.length * d.scale.claims), cleanPct: pct(xs.filter((c) => c.clean).length, xs.length) }; });
  return { rows, claims: cs.length, scaled: Math.round(cs.length * d.scale.claims), cleanRate: pct(cs.filter((c) => c.clean).length, cs.length) };
}

/** Days in A/R = open A/R at the as-of date ÷ average daily expected net revenue over the last 90 days (rule BR-005). */
export function daysInAr(d: HcData, asOf = AS_OF, markets?: string[]) {
  const cs = d.claims.filter((c) => inMk(c.market, markets));
  const open = cs.filter((c) => c.submitDate <= asOf && c.resolvedDate > asOf);
  const openAr = sum(open.map((c) => c.expected));
  const from = addDaysLocal(asOf, -89);
  const daily = sum(cs.filter((c) => c.serviceDate >= from && c.serviceDate <= asOf).map((c) => c.expected)) / 90;
  const over90 = sum(open.filter((c) => daysBetween(c.serviceDate, asOf) > 90).map((c) => c.expected));
  return { openAr, openArScaled: openAr * d.scale.claims, daily, days: round(openAr / daily, 1), over90Pct: pct(over90, openAr), openClaims: open.length };
}
const addDaysLocal = (iso: string, n: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function daysInArTrend(d: HcData, markets?: string[]) {
  return ['2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', AS_OF].map((m) => ({ month: m.slice(0, 7), days: daysInAr(d, m, markets).days }));
}

/** Net collection rate: payments ÷ expected net reimbursement on resolved claims (rule BR-007). */
export function netCollection(d: HcData, range: Range = PERIODS.collections, markets?: string[]) {
  const cs = d.claims.filter((c) => inRange(c.serviceDate, range) && c.resolvedDate <= AS_OF && inMk(c.market, markets));
  return { claims: cs.length, rate: pct(sum(cs.map((c) => c.paid)), sum(cs.map((c) => c.expected))) };
}

/** Patient accounts with open balances older than `minDays` from service date (rule BR-006). */
export function agedBalances(d: HcData, minBalance = 5000, minDays = 90, markets?: string[]) {
  const open = d.claims.filter((c) => c.submitDate <= AS_OF && c.resolvedDate > AS_OF && daysBetween(c.serviceDate, AS_OF) > minDays && inMk(c.market, markets));
  return [...groupBy(open, (c) => String(c.patientKey)).entries()].map(([k, xs]) => {
    const p = d.patients[Number(k) - 1];
    return { p, payer: d.payers[p.payerKey - 1].name, balance: round(sum(xs.map((c) => c.expected)), 2), oldest: Math.max(...xs.map((c) => daysBetween(c.serviceDate, AS_OF))), claims: xs.length, denied: xs.some((c) => c.denied) };
  }).filter((r) => r.balance > minBalance).sort((a, b) => b.balance - a.balance);
}

export function openBalanceByPatient(d: HcData) {
  const m = new Map<number, { open: number; aged: number }>();
  for (const c of d.claims) {
    if (!(c.submitDate <= AS_OF && c.resolvedDate > AS_OF)) continue;
    const cur = m.get(c.patientKey) ?? { open: 0, aged: 0 };
    cur.open += c.expected;
    if (daysBetween(c.serviceDate, AS_OF) > 90) cur.aged += c.expected;
    m.set(c.patientKey, cur);
  }
  return m;
}

// ---------------------------------------------------------------- Clinical supply chain
/** Supply cost per surgical case: med-surg supplies and implants on surgical stays ÷ surgical cases (rule BR-015). */
export function supplyCostPerCase(d: HcData, range: Range = PERIODS.quarter, markets?: string[]) {
  const cases = d.stays.filter((s) => s.surgical && !s.inHouse && inRange(s.discharge, range) && inMk(s.market, markets));
  const keys = new Set(cases.map((s) => s.key));
  const lines = d.supply.filter((l) => l.itemType === 'Supply' && keys.has(l.stayKey));
  const rows = SERVICE_LINES.map((sl) => {
    const cs = cases.filter((s) => s.serviceLine === sl.name);
    const k = new Set(cs.map((s) => s.key));
    const cost = sum(lines.filter((l) => k.has(l.stayKey)).map((l) => l.cost));
    return { serviceLine: sl.name, cases: cs.length, cost, perCase: round(cs.length ? cost / cs.length : 0, 0) };
  }).filter((r) => r.cases > 0).sort((a, b) => b.perCase - a.perCase);
  const cost = sum(lines.map((l) => l.cost));
  const implants = sum(lines.filter((l) => l.category === 'Implants' || l.category === 'Cardiac devices').map((l) => l.cost));
  return { cases: cases.length, casesScaled: Math.round(cases.length * d.scale.ip), cost, perCase: round(cost / Math.max(1, cases.length), 0), implantShare: pct(implants, cost), rows };
}

export function supplySpend(d: HcData, range: Range = PERIODS.quarter, markets?: string[]) {
  const ls = d.supply.filter((l) => inRange(l.date, range) && inMk(l.market, markets));
  const total = sum(ls.map((l) => l.cost));
  const on = sum(ls.filter((l) => l.onContract).map((l) => l.cost));
  const byCat = [...groupBy(ls, (l) => l.category).entries()].map(([category, xs]) => { const t = sum(xs.map((x) => x.cost)); return { category, spend: t, onPct: pct(sum(xs.filter((x) => x.onContract).map((x) => x.cost)), t) }; }).sort((a, b) => b.spend - a.spend);
  return { total, scaled: total * d.scale.ip, onContractPct: pct(on, total), pharmacy: sum(ls.filter((l) => l.itemType === 'Pharmacy').map((l) => l.cost)), byCat };
}

// ---------------------------------------------------------------- Care gaps (DP-06, draft)
export function careGaps(d: HcData, markets?: string[]) {
  const gs = d.gaps.filter((g) => inMk(g.market, markets));
  const measures = [...groupBy(gs, (g) => g.measure).entries()].map(([measure, xs]) => {
    const closed = xs.filter((g) => g.status === 'Closed').length;
    return { measure, eligible: xs.length, open: xs.length - closed, closureRate: pct(closed, xs.length) };
  }).sort((a, b) => a.closureRate - b.closureRate);
  const patients = new Set(gs.map((g) => g.patientKey));
  const openPatients = new Set(gs.filter((g) => g.status === 'Open').map((g) => g.patientKey));
  const f = flagsOf(d);
  const idx = d.stays.filter((s) => !s.inHouse && inRange(s.discharge, PERIODS.readmitYtd) && f.get(s.key)!.eligible && inMk(s.market, markets));
  const grp = (pred: (k: number) => boolean) => { const xs = idx.filter((s) => pred(s.patientKey)); const r = xs.filter((s) => f.get(s.key)!.readmit).length; return { index: xs.length, readmits: r, rate: pct(r, xs.length) }; };
  return {
    measures, gaps: gs.length, openGaps: gs.filter((g) => g.status === 'Open').length,
    closureRate: pct(gs.filter((g) => g.status === 'Closed').length, gs.length),
    patients: patients.size, openPatients: openPatients.size, openPatientsScaled: Math.round(openPatients.size * d.scale.patients), openPatientPct: pct(openPatients.size, patients.size),
    readmitOpen: grp((k) => openPatients.has(k)), readmitClosed: grp((k) => !openPatients.has(k)),
  };
}

/** Every KPI in the dictionary, computed from the sample (scaled where a system total is shown). */
export function computeKpis(d: HcData): Record<string, number> {
  const act = activeByPayerClass(d);
  const ar = daysInAr(d);
  const den = denialByPayer(d);
  const ed = edWait(d);
  const ra = readmissions(d);
  const gaps = careGaps(d);
  return {
    'K-01': act.activeScaled,
    'K-02': act.selfPay.share,
    'K-03': act.portalPct,
    'K-04': act.avgRisk,
    'K-05': ar.days,
    'K-06': den.rate,
    'K-07': den.cleanRate,
    'K-08': netCollection(d).rate,
    'K-09': ar.over90Pct,
    'K-10': claimsDaily(d, PERIODS.month).scaled,
    'K-11': alos(d).alos,
    'K-12': occupancy(d).occupancy,
    'K-13': ed.avgWait,
    'K-14': ed.lwbsPct,
    'K-15': dischargesMonthly(d).scaled,
    'K-16': noShowRate(d, PERIODS.last12),
    'K-17': newPatientLag(d),
    'K-18': ra.rate,
    'K-19': followup7(d).rate,
    'K-20': mortality(d).rate,
    'K-21': Math.round(ra.readmits * d.scale.ip),
    'K-22': supplyCostPerCase(d).perCase,
    'K-23': Math.round(supplySpend(d).scaled),
    'K-24': supplySpend(d).onContractPct,
    'K-25': gaps.closureRate,
    'K-26': gaps.openPatientPct,
  };
}
