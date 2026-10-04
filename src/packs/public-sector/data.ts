// Westland County Services synthetic data (spec section 6). Generated once per pack load from a seeded PRNG,
// so every demo run shows the same numbers and the agents always agree with the Explorer.
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, daysBetween, pad, person, round, sum, toDate } from '../../mock-snowflake/generators';
import {
  APP_CHANNELS, APP_CHANNEL_WEIGHTS, APPS_PER_MONTH, AS_OF, CASEWORKERS_TOTAL, CONSTITUENTS_TOTAL, DEPARTMENTS, DISTRICTS, ERROR_TYPES,
  FLAG_REASONS, HOLIDAYS, LANGUAGES, LANGUAGE_WEIGHTS, PROGRAMS, SR_CHANNELS, SR_CHANNEL_WEIGHTS, SR_PER_DAY, SR_TYPES, TARGETS, VOLUMES,
} from './generators.config';

export interface Office { key: number; code: string; name: string; district: string; districtCode: string; city: string; residents: number; caseworkers: number }
export interface Constituent {
  key: number; id: number; constituentId: string; first: string; last: string; email: string; street: string; city: string; govId: string;
  ageBand: string; householdSize: number; language: string; channel: string; district: string; districtCode: string; officeKey: number; officeCode: string;
  status: 'Active' | 'Inactive'; lastContact: string; effectiveFrom: string; priorDistrict?: string; changedOn?: string;
}
export type PendingAction = 'NONE' | 'APPLICATION' | 'RENEWAL' | 'CHANGE';
export interface Case {
  key: number; caseId: string; constituentKey: number; program: string; district: string; officeKey: number; caseworkerId: string;
  opened: string; closed: string | null; status: 'Open' | 'Closed'; pendingAction: PendingAction; pendingSince: string | null; nextRenewal: string | null; govId: string;
  flag?: { date: string; reason: string; status: 'Open review' | 'Referred' | 'Overpayment established' | 'Cleared' };
}
export interface Application {
  key: number; appId: string; constituentKey: number; program: string; district: string; officeKey: number; channel: string; received: string;
  complete: string | null; decision: string | null; outcome: 'Approved' | 'Denied' | 'Withdrawn' | 'Pending'; bizDays: number | null; calDays: number | null; expedited: boolean;
}
export interface Payment {
  key: number; paymentId: string; caseKey: number; caseId: string; constituentKey: number; program: string; district: string; month: string; date: string; amount: number;
  improper: boolean; improperAmount: number; errorType: string | null; overpayment: number; recovered: number; onTime: boolean;
  flagged: boolean; flagReason: string | null; flagStatus: string | null; govId: string;
}
export interface ServiceRequest {
  key: number; srId: string; type: string; dept: string; channel: string; district: string; created: string; createdMin: number; closed: string | null;
  resolutionDays: number | null; sla: number; onTime: boolean | null; reopened: boolean; survey: number | null;
}
export interface BudgetLine { key: number; dept: string; month: string; admin: boolean; budget: number; actual: number; fteBudget: number; fteFilled: number }

export interface PsData {
  offices: Office[];
  constituents: Constituent[];
  cases: Case[];
  applications: Application[];
  payments: Payment[];
  requests: ServiceRequest[];
  budget: BudgetLine[];
  /** production constituents ÷ sample constituents (also used for cases and payments) */
  scale: number;
  appScale: number;
  srScale: number;
}

// ---- Business-day helpers (weekends and county holidays excluded), on a precomputed calendar index
const CAL = dateRange('2010-01-01', '2027-12-31');
const CAL_IDX = new Map(CAL.map((d, i) => [d, i]));
const CAL_BIZ = CAL.map((d) => {
  const dow = toDate(d).getUTCDay();
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(d);
});
const CAL_CUM: number[] = [];
CAL_BIZ.reduce((acc, b, i) => (CAL_CUM[i] = acc + (b ? 1 : 0)), 0);
export const isBusinessDay = (d: string) => CAL_BIZ[CAL_IDX.get(d)!];
export function addBusinessDays(d: string, n: number): string {
  let i = CAL_IDX.get(d)!;
  let left = n;
  while (left > 0) {
    i++;
    if (CAL_BIZ[i]) left--;
  }
  return CAL[i];
}
/** Business days in (a, b]. */
export function businessDaysBetween(a: string, b: string): number {
  return CAL_CUM[CAL_IDX.get(b)!] - CAL_CUM[CAL_IDX.get(a)!];
}
/** Calendar date n days after d (fast path over the calendar index). */
const plusDays = (d: string, n: number) => CAL[CAL_IDX.get(d)! + n] ?? addDays(d, n);
const calDiff = (a: string, b: string) => (CAL_IDX.has(a) && CAL_IDX.has(b) ? CAL_IDX.get(b)! - CAL_IDX.get(a)! : daysBetween(a, b));

const MONTHS = Array.from({ length: 21 }, (_, i) => {
  const d = new Date(Date.UTC(2025, i, 1));
  return d.toISOString().slice(0, 7);
}); // 2025-01 .. 2026-09
export const monthsCovered = MONTHS;

const ageBands = ['0–17', '18–24', '25–44', '45–64', '65+'];

export function generatePublicSector(seed: number): PsData {
  const rng = new Rng(seed);
  const scale = CONSTITUENTS_TOTAL / VOLUMES.constituents;

  // ---- Offices (8): two per district, caseworkers split by district weight
  const offices: Office[] = [];
  for (const d of DISTRICTS) {
    d.offices.forEach((o, i) => {
      offices.push({
        key: offices.length + 1, code: o.code, name: o.name, district: d.name, districtCode: d.code, city: o.city,
        residents: Math.round(d.residents * (i === 0 ? 0.58 : 0.42)), caseworkers: Math.round(CASEWORKERS_TOTAL * d.weight * (i === 0 ? 0.58 : 0.42)),
      });
    });
  }
  const officeByKey = new Map(offices.map((o) => [o.key, o]));

  // ---- Constituents (2,000 standing in for 312 K)
  const constituents: Constituent[] = [];
  for (let i = 0; i < VOLUMES.constituents; i++) {
    const dist = rng.weighted(DISTRICTS, DISTRICTS.map((d) => d.weight));
    const off = offices.filter((o) => o.district === dist.name)[rng.chance(0.58) ? 0 : 1];
    const p = person(rng, i, 'mailbox.example');
    const id = 3_100_000 + i * 13 + rng.int(0, 12);
    const moved = rng.chance(0.06);
    const other = DISTRICTS.filter((x) => x.name !== dist.name);
    constituents.push({
      key: i + 1, id, constituentId: `WC-${pad(id, 8)}`, first: p.first, last: p.last, email: p.email, street: p.street, city: off.city,
      govId: `9${pad(rng.int(0, 99), 2)}-${pad(rng.int(70, 99), 2)}-${pad(rng.int(0, 9999), 4)}`,
      ageBand: rng.weighted(ageBands, [0.24, 0.11, 0.3, 0.22, 0.13]), householdSize: rng.weighted([1, 2, 3, 4, 5, 6], [0.31, 0.22, 0.18, 0.15, 0.09, 0.05]),
      language: rng.weighted(LANGUAGES, LANGUAGE_WEIGHTS), channel: rng.weighted(APP_CHANNELS, APP_CHANNEL_WEIGHTS), district: dist.name, districtCode: dist.code,
      officeKey: off.key, officeCode: off.code, status: rng.chance(0.03) ? 'Inactive' : 'Active',
      lastContact: rng.chance(0.035) ? addDays(AS_OF, -rng.int(380, 900)) : addDays(AS_OF, -rng.int(0, 330)),
      effectiveFrom: moved ? addDays('2024-06-01', rng.int(0, 600)) : addDays('2012-01-01', rng.int(0, 4300)),
      priorDistrict: moved ? rng.pick(other).name : undefined,
    });
    if (moved) constituents[i].changedOn = constituents[i].effectiveFrom;
  }

  // ---- Cases: one per constituent × program enrollment
  const cases: Case[] = [];
  const workersByOffice = new Map(offices.map((o) => [o.key, Math.max(4, Math.round(o.caseworkers / 30))]));
  for (const c of constituents) {
    const n = rng.weighted([1, 2, 3, 4], [0.71, 0.22, 0.06, 0.01]);
    const progs = new Set<string>();
    while (progs.size < n) progs.add(rng.weighted(PROGRAMS, PROGRAMS.map((p) => p.weight)).code);
    for (const pg of progs) {
      const prog = PROGRAMS.find((p) => p.code === pg)!;
      const opened = rng.chance(0.25) ? addDays('2025-01-01', rng.int(0, 600)) : addDays('2014-01-01', rng.int(0, 4000));
      const closes = c.status === 'Inactive' || rng.chance(0.13);
      const closed = closes ? addDays(opened > '2025-01-01' ? opened : '2025-01-01', rng.int(30, 600)) : null;
      const isClosed = closed !== null && closed <= AS_OF;
      const office = officeByKey.get(c.officeKey)!;
      const renewalBase = addDays(AS_OF, rng.int(-20, prog.renewalMonths * 30));
      cases.push({
        key: cases.length + 1, caseId: `CS-${prog.code}-${pad(c.id, 8)}`, constituentKey: c.key, program: pg, district: c.district, officeKey: c.officeKey,
        caseworkerId: `CW-${office.code.replace('-', '')}-${pad(rng.int(1, workersByOffice.get(c.officeKey)!), 3)}`,
        opened, closed: isClosed ? closed : null, status: isClosed ? 'Closed' : 'Open', pendingAction: 'NONE', pendingSince: null,
        nextRenewal: isClosed ? null : renewalBase > AS_OF ? renewalBase : addDays(AS_OF, rng.int(1, 60)), govId: c.govId,
      });
    }
  }
  // Backlog: an exact share of open cases has an action awaiting a caseworker decision
  const open = cases.filter((x) => x.status === 'Open');
  const backlogSet = rng.shuffle([...open]).slice(0, Math.round(open.length * TARGETS.backlogShare));
  for (const x of backlogSet) {
    x.pendingAction = rng.weighted(['APPLICATION', 'RENEWAL', 'CHANGE'] as const, [0.45, 0.35, 0.2]);
    x.pendingSince = addDays(AS_OF, -rng.int(3, 70));
  }

  // ---- Applications (4,200 over Jan 2025 – Sep 2026), processing days in business days from a complete application
  const appDays = dateRange('2025-01-01', AS_OF).filter(isBusinessDay);
  const raw: Application[] = [];
  for (let i = 0; i < VOLUMES.applications; i++) {
    const received = rng.pick(appDays);
    const c = rng.pick(constituents);
    const prog = rng.weighted(PROGRAMS, [0.36, 0.08, 0.38, 0.06, 0.12]);
    const incomplete = rng.chance(0.05);
    const complete = incomplete ? null : rng.chance(0.55) ? received : addBusinessDays(received, rng.int(1, 12));
    const expedited = prog.code === 'FA' && rng.chance(0.12);
    const biz = complete ? Math.max(1, rng.lognormal(expedited ? 5 : 17, expedited ? 0.3 : 0.42)) : null;
    raw.push({
      key: 0, appId: '', constituentKey: c.key, program: prog.code, district: c.district, officeKey: c.officeKey, channel: rng.weighted(APP_CHANNELS, APP_CHANNEL_WEIGHTS),
      received, complete, decision: null, outcome: 'Pending', bizDays: biz, calDays: null, expedited,
    });
  }
  calibrateProcessing(raw);
  raw.sort((a, b) => (a.received < b.received ? -1 : a.received > b.received ? 1 : a.constituentKey - b.constituentKey));
  const applications: Application[] = raw.map((a, i) => {
    let decision: string | null = null;
    let bizDays: number | null = null;
    let outcome: Application['outcome'] = 'Pending';
    if (a.complete && a.bizDays !== null) {
      const d = addBusinessDays(a.complete, a.bizDays);
      if (d <= AS_OF) {
        decision = d;
        bizDays = a.bizDays;
        outcome = rng.chance(0.04) ? 'Withdrawn' : rng.chance(0.715) ? 'Approved' : 'Denied';
      }
    } else if (a.received < addDays(AS_OF, -60)) {
      outcome = 'Withdrawn';
      decision = addDays(a.received, 45);
    }
    return {
      ...a, key: i + 1, appId: `APP-${a.received.slice(2, 4)}${a.received.slice(5, 7)}-${pad(i + 1, 5)}`, decision, bizDays,
      outcome, calDays: decision ? calDiff(a.received, decision) : null,
    };
  });

  // ---- Integrity flags on paying cases (exact rate), then monthly benefit payments
  const paying = cases.filter((x) => PROGRAMS.find((p) => p.code === x.program)!.pays && (x.closed === null || x.closed >= '2026-01-01') && x.opened <= AS_OF);
  const flagged = rng.shuffle([...paying]).slice(0, Math.round(paying.length * TARGETS.flagRate));
  for (const x of flagged) {
    x.flag = {
      date: addDays('2026-01-05', rng.int(0, 260)), reason: rng.weighted(FLAG_REASONS, [0.34, 0.18, 0.16, 0.14, 0.18]),
      status: rng.weighted(['Open review', 'Referred', 'Overpayment established', 'Cleared'] as const, [0.47, 0.2, 0.18, 0.15]),
    };
  }
  const payments: Payment[] = [];
  for (const x of cases) {
    const prog = PROGRAMS.find((p) => p.code === x.program)!;
    if (!prog.pays) continue;
    const own = rng.lognormal(1, 0.4);
    for (const m of MONTHS) {
      const date = addBusinessDays(`${m}-01`, prog.code === 'CCS' ? 4 : 2);
      if (x.opened > date || (x.closed && x.closed < date)) continue;
      const mo = Number(m.slice(5, 7));
      if (prog.seasonal && mo > 4 && mo < 11) continue;
      const amount = round(prog.median * own * rng.normal(1, 0.05) * (prog.seasonal && (mo === 1 || mo === 2) ? 1.25 : 1), 2);
      const improper = rng.chance(0.039);
      const under = improper && rng.chance(0.22);
      const improperAmount = improper ? round(amount * rng.range(0.25, 0.95), 2) : 0;
      const overpayment = improper && !under ? improperAmount : 0;
      const age = calDiff(date, AS_OF);
      const recovered = overpayment ? round(overpayment * Math.min(1, Math.max(0, rng.range(0.1, 0.75) + age / 1400)), 2) : 0;
      const fl = x.flag && date >= x.flag.date ? x.flag : undefined;
      payments.push({
        key: payments.length + 1, paymentId: `PMT-${m.replace('-', '')}-${pad(x.key, 6)}`, caseKey: x.key, caseId: x.caseId, constituentKey: x.constituentKey,
        program: x.program, district: x.district, month: m, date, amount, improper, improperAmount, errorType: improper ? (under ? 'Underpayment – ' : '') + rng.weighted(ERROR_TYPES, [0.38, 0.27, 0.27, 0.08]) : null,
        overpayment, recovered, onTime: rng.chance(0.983), flagged: Boolean(fl), flagReason: fl?.reason ?? null, flagStatus: fl?.status ?? null, govId: x.govId,
      });
    }
  }

  // ---- 311 service requests (~46 per day, Jan 2025 – Sep 2026)
  const requests: ServiceRequest[] = [];
  const srW = SR_TYPES.map((s) => s.weight);
  const distW = DISTRICTS.map((x) => x.weight);
  for (const day of dateRange('2025-01-01', AS_OF)) {
    const dow = toDate(day).getUTCDay();
    const mo = Number(day.slice(5, 7));
    const season = mo >= 4 && mo <= 9 ? 1.1 : 0.92;
    const n = Math.round(VOLUMES.srPerDay * (dow === 0 || dow === 6 ? 0.55 : 1.18) * season * rng.range(0.85, 1.15));
    for (let k = 0; k < n; k++) {
      const t = rng.weighted(SR_TYPES, srW);
      const dist = rng.weighted(DISTRICTS, distW);
      const res = round(Math.max(0.05, rng.lognormal(t.median, 0.68)), 1);
      const createdMin = rng.int(360, 1260);
      const closedDay = plusDays(day, Math.floor(res + createdMin / 1440));
      const isClosed = closedDay <= AS_OF;
      const onTime = isClosed ? res <= t.sla : null;
      requests.push({
        key: requests.length + 1, srId: `SR-${day.slice(2, 4)}-${pad(requests.length + 1, 6)}`, type: t.type, dept: t.dept,
        channel: rng.weighted(SR_CHANNELS, SR_CHANNEL_WEIGHTS), district: dist.name, created: day, createdMin, closed: isClosed ? closedDay : null,
        resolutionDays: isClosed ? res : null, sla: t.sla, onTime, reopened: isClosed && rng.chance(0.045),
        survey: isClosed && rng.chance(0.22) ? (rng.chance(onTime ? 0.86 : 0.52) ? rng.weighted([4, 5], [0.45, 0.55]) : rng.weighted([1, 2, 3], [0.3, 0.3, 0.4])) : null,
      });
    }
  }

  // ---- Budget and positions by department and month, calibrated to the cost-per-case target
  const openScaled = cases.filter((x) => x.status === 'Open').length * scale;
  const adminAnnual = TARGETS.costPerCase * openScaled;
  const budget: BudgetLine[] = [];
  for (const dept of DEPARTMENTS) {
    for (const m of MONTHS) {
      const yearF = m.startsWith('2025') ? 0.965 : 1;
      const monthly = 'monthly' in dept ? dept.monthly : (adminAnnual / 12 / TARGETS.budgetExecution) * dept.share;
      const b = round(monthly * yearF * rng.range(0.97, 1.03), 0);
      const vac = rng.range(0.07, 0.125) * (dept.admin ? 1 : 0.8);
      budget.push({
        key: budget.length + 1, dept: dept.name, month: m, admin: dept.admin, budget: b, actual: round(b * TARGETS.budgetExecution * rng.normal(1, 0.025), 0),
        fteBudget: dept.fte, fteFilled: Math.round(dept.fte * (1 - vac)),
      });
    }
  }

  const appsPerMonthSample = VOLUMES.applications / MONTHS.length;
  return {
    offices, constituents, cases, applications, payments, requests, budget, scale,
    appScale: APPS_PER_MONTH / appsPerMonthSample, srScale: SR_PER_DAY / VOLUMES.srPerDay,
  };
}

/** Scale processing durations per received-year so average business days land on the configured targets. */
function calibrateProcessing(raw: Application[]) {
  for (const year of ['2025', '2026'] as const) {
    const xs = raw.filter((a) => a.received.startsWith(year) && a.bizDays !== null);
    const mean = sum(xs.map((a) => a.bizDays!)) / xs.length;
    const k = TARGETS.avgProcessingDays[year] / mean;
    for (const a of xs) a.bizDays = Math.max(1, Math.round(a.bizDays! * k));
  }
}
