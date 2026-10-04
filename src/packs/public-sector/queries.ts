// Query functions over the in-memory sample. Agent scenarios, the Explorer worksheet, the semantic playground and
// the pack validator all call these, so an agent's number always equals the worksheet's number.
import { addDays, avg, groupBy, round, sum } from '../../mock-snowflake/generators';
import { AS_OF, CASEWORKERS_TOTAL, DISTRICTS, PROGRAMS } from './generators.config';
import { businessDaysBetween, type Application, type Case, type PsData } from './data';

export const PERIODS = {
  asOf: AS_OF,
  month: '2026-09',
  quarter: { label: 'Q3 2026', months: ['2026-07', '2026-08', '2026-09'] },
  lastWeek: { from: '2026-09-21', to: '2026-09-27' },
  last30: { from: addDays(AS_OF, -29), to: AS_OF },
  ytd: { from: '2026-01-01', to: AS_OF },
  priorYtd: { from: '2025-01-01', to: '2025-09-30' },
  trailing12: { from: '2025-10-01', to: AS_OF },
  next30: { from: addDays(AS_OF, 1), to: addDays(AS_OF, 30) },
};

export type Allow = string[] | undefined;
export const inRange = (d: string, r: { from: string; to: string }) => d >= r.from && d <= r.to;
const okD = (allow: Allow, district: string) => !allow || allow.includes(district);
const pct = (a: number, b: number, dp = 1) => round((a / Math.max(1, b)) * 100, dp);
export const programName = (code: string) => PROGRAMS.find((p) => p.code === code)?.name ?? code;
export const STANDARD_DAYS = 30;

export function openCasesByConstituent(d: PsData): Map<number, Case[]> {
  const m = new Map<number, Case[]>();
  for (const c of d.cases) if (c.status === 'Open') m.set(c.constituentKey, [...(m.get(c.constituentKey) ?? []), c]);
  return m;
}

/** BR-001: Active status, at least one open program case and a contact in the last 12 months. */
export function activeConstituents(d: PsData, allow?: Allow) {
  const open = openCasesByConstituent(d);
  const since = addDays(AS_OF, -365);
  return d.constituents.filter((c) => c.status === 'Active' && (open.get(c.key)?.length ?? 0) > 0 && c.lastContact > since && okD(allow, c.district));
}

export function multiProgram(d: PsData, allow?: Allow) {
  const open = openCasesByConstituent(d);
  const act = activeConstituents(d, allow);
  const multi = act.filter((c) => (open.get(c.key)?.length ?? 0) >= 2);
  const statusOnly = d.constituents.filter((c) => c.status === 'Active' && okD(allow, c.district)).length;
  const byPrograms = [1, 2, 3, 4].map((n) => ({ n, count: act.filter((c) => (n === 4 ? (open.get(c.key)?.length ?? 0) >= 4 : open.get(c.key)?.length === n)).length }));
  return { active: act.length, multi: multi.length, pct: pct(multi.length, act.length), statusOnly, byPrograms };
}

export function renewalsDue(d: PsData, allow?: Allow) {
  const open = openCasesByConstituent(d);
  return activeConstituents(d, allow)
    .map((c) => {
      const cs = open.get(c.key) ?? [];
      const due = cs.map((x) => x.nextRenewal).filter((x): x is string => Boolean(x) && inRange(x!, PERIODS.next30)).sort()[0];
      return { c, programs: cs.map((x) => x.program), due };
    })
    .filter((x) => x.programs.length >= 3 && x.due)
    .sort((a, b) => (a.due! < b.due! ? -1 : 1) || b.programs.length - a.programs.length);
}

// ---- 311 service requests
export function srIn(d: PsData, r: { from: string; to: string }, allow?: Allow) {
  return d.requests.filter((s) => inRange(s.created, r) && okD(allow, s.district));
}

export function srByDistrict(d: PsData, months = PERIODS.quarter.months, allow?: Allow) {
  const xs = d.requests.filter((s) => months.includes(s.created.slice(0, 7)) && okD(allow, s.district));
  const closed = xs.filter((s) => s.resolutionDays !== null);
  const by = groupBy(closed, (s) => s.district);
  const rows = DISTRICTS.filter((x) => okD(allow, x.name)).map((x) => {
    const cs = by.get(x.name) ?? [];
    return { district: x.name, closed: cs.length, avgDays: round(avg(cs.map((s) => s.resolutionDays!)), 2), onTimePct: pct(cs.filter((s) => s.onTime).length, cs.length) };
  });
  return {
    rows, requests: xs.length, closed: closed.length, avgDays: round(avg(closed.map((s) => s.resolutionDays!)), 2),
    onTimePct: pct(closed.filter((s) => s.onTime).length, closed.length), reopenPct: pct(closed.filter((s) => s.reopened).length, closed.length),
  };
}

export function srDaily(d: PsData, allow?: Allow) {
  const xs = srIn(d, PERIODS.last30, allow);
  const by = groupBy(xs, (s) => s.created);
  const days = [...by.keys()].sort();
  const daily = days.map((day) => ({ day, requests: Math.round(by.get(day)!.length * d.srScale) }));
  const byType = [...groupBy(xs, (s) => s.type).entries()].map(([type, ys]) => ({ type, requests: Math.round(ys.length * d.srScale) })).sort((a, b) => b.requests - a.requests);
  return { daily, total: Math.round(xs.length * d.srScale), sample: xs.length, byType };
}

export function csat(d: PsData, months = PERIODS.quarter.months, allow?: Allow) {
  const xs = d.requests.filter((s) => months.includes(s.created.slice(0, 7)) && s.survey !== null && okD(allow, s.district));
  return { responses: xs.length, satisfiedPct: pct(xs.filter((s) => s.survey! >= 4).length, xs.length) };
}

export function digitalSelfService(d: PsData, allow?: Allow) {
  const xs = d.applications.filter((a) => inRange(a.received, PERIODS.ytd) && okD(allow, a.district));
  return pct(xs.filter((a) => a.channel === 'Online').length, xs.length);
}

// ---- Applications and cases (DP-02)
const decidedIn = (d: PsData, r: { from: string; to: string }, allow?: Allow) =>
  d.applications.filter((a) => a.decision && inRange(a.decision, r) && (a.outcome === 'Approved' || a.outcome === 'Denied') && okD(allow, a.district));

/** Signature: BR-006 business days from a complete application; BR-007 30-business-day standard. */
export function processingStandard(d: PsData, allow?: Allow) {
  const decided = decidedIn(d, PERIODS.ytd, allow);
  const pending = d.applications.filter((a) => a.outcome === 'Pending' && okD(allow, a.district));
  const pendingComplete = pending.filter((a) => a.complete);
  const ageOf = (a: Application) => businessDaysBetween(a.complete!, AS_OF);
  const rows = PROGRAMS.map((p) => {
    const xs = decided.filter((a) => a.program === p.code);
    const over = xs.filter((a) => a.bizDays! > STANDARD_DAYS);
    const pend = pendingComplete.filter((a) => a.program === p.code && ageOf(a) > STANDARD_DAYS);
    return { program: p.name, code: p.code, decided: xs.length, over: over.length, timelyPct: pct(xs.length - over.length, xs.length), avgDays: round(avg(xs.map((a) => a.bizDays!)), 1), pendingOver: pend.length };
  });
  const over = decided.filter((a) => a.bizDays! > STANDARD_DAYS);
  const pendingOver = pendingComplete.filter((a) => ageOf(a) > STANDARD_DAYS);
  const calendarOver = decided.filter((a) => a.calDays! > STANDARD_DAYS);
  return {
    rows, decided: decided.length, over: over.length, overScaled: Math.round(over.length * d.appScale), pendingOver: pendingOver.length,
    pendingOverScaled: Math.round(pendingOver.length * d.appScale), incompleteExcluded: pending.length - pendingComplete.length,
    calendarOverScaled: Math.round(calendarOver.length * d.appScale), timelyPct: pct(decided.length - over.length, decided.length),
    avgDays: round(avg(decided.map((a) => a.bizDays!)), 1),
  };
}

export function processingYoY(d: PsData, allow?: Allow) {
  const cur = decidedIn(d, PERIODS.ytd, allow);
  const prev = decidedIn(d, PERIODS.priorYtd, allow);
  const stat = (xs: Application[]) => ({ n: xs.length, avgDays: round(avg(xs.map((a) => a.bizDays!)), 1), approvalPct: pct(xs.filter((a) => a.outcome === 'Approved').length, xs.length), timelyPct: pct(xs.filter((a) => a.bizDays! <= STANDARD_DAYS).length, xs.length) });
  const rows = PROGRAMS.map((p) => ({ program: p.name, prev: stat(prev.filter((a) => a.program === p.code)), cur: stat(cur.filter((a) => a.program === p.code)) }));
  return { rows, prev: stat(prev), cur: stat(cur) };
}

export function applicationsReceived(d: PsData, month = PERIODS.month, allow?: Allow) {
  return Math.round(d.applications.filter((a) => a.received.startsWith(month) && okD(allow, a.district)).length * d.appScale);
}

export function backlogByOffice(d: PsData, allow?: Allow) {
  const open = d.cases.filter((c) => c.status === 'Open' && okD(allow, c.district));
  const rows = d.offices.filter((o) => okD(allow, o.district)).map((o) => {
    const xs = open.filter((c) => c.officeKey === o.key);
    const bl = xs.filter((c) => c.pendingAction !== 'NONE');
    return {
      office: o.name, code: o.code, district: o.district, backlog: Math.round(bl.length * d.scale), sampleBacklog: bl.length,
      openCases: Math.round(xs.length * d.scale), caseload: round((xs.length * d.scale) / o.caseworkers, 0),
      oldestDays: bl.length ? Math.max(...bl.map((c) => businessDaysBetween(c.pendingSince!, AS_OF))) : 0,
    };
  }).sort((a, b) => b.backlog - a.backlog);
  const bl = open.filter((c) => c.pendingAction !== 'NONE');
  return {
    rows, backlog: Math.round(bl.length * d.scale), openCases: Math.round(open.length * d.scale),
    caseload: round((open.length * d.scale) / (allow ? sum(d.offices.filter((o) => okD(allow, o.district)).map((o) => o.caseworkers)) : CASEWORKERS_TOTAL), 1),
    byAction: (['APPLICATION', 'RENEWAL', 'CHANGE'] as const).map((k) => ({ action: k, cases: Math.round(bl.filter((c) => c.pendingAction === k).length * d.scale) })),
  };
}

// ---- Workforce & budget (DP-06)
export function workforce(d: PsData) {
  const t12 = d.budget.filter((b) => inRange(`${b.month}-01`, PERIODS.trailing12));
  const adminT12 = sum(t12.filter((b) => b.admin).map((b) => b.actual));
  const openScaled = d.cases.filter((c) => c.status === 'Open').length * d.scale;
  const ytd = d.budget.filter((b) => inRange(`${b.month}-01`, PERIODS.ytd));
  const sep = d.budget.filter((b) => b.month === PERIODS.month);
  const caseworkerDepts = sep.filter((b) => b.dept === 'Eligibility Services' || b.dept === 'Case Management');
  const rows = [...groupBy(ytd, (b) => b.dept).entries()].map(([dept, xs]) => {
    const s = sep.find((b) => b.dept === dept)!;
    return { dept, budget: sum(xs.map((b) => b.budget)), actual: sum(xs.map((b) => b.actual)), execPct: pct(sum(xs.map((b) => b.actual)), sum(xs.map((b) => b.budget))), fteBudget: s.fteBudget, fteFilled: s.fteFilled, vacancyPct: pct(s.fteBudget - s.fteFilled, s.fteBudget) };
  });
  return {
    rows, adminT12, openCases: Math.round(openScaled), costPerCase: round(adminT12 / openScaled, 2),
    budgetExecPct: pct(sum(ytd.map((b) => b.actual)), sum(ytd.map((b) => b.budget))),
    vacancyPct: pct(sum(caseworkerDepts.map((b) => b.fteBudget - b.fteFilled)), sum(caseworkerDepts.map((b) => b.fteBudget))),
  };
}

// ---- Benefit payments (DP-03) and program integrity (DP-05)
export function paymentsIn(d: PsData, r: { from: string; to: string }, allow?: Allow) {
  return d.payments.filter((p) => inRange(p.date, r) && okD(allow, p.district));
}

export function paymentSummary(d: PsData, r = PERIODS.ytd, allow?: Allow) {
  const xs = paymentsIn(d, r, allow);
  const paid = sum(xs.map((p) => p.amount));
  const improper = sum(xs.map((p) => p.improperAmount));
  return {
    payments: xs.length, paid: paid * d.scale, improper: improper * d.scale, improperRate: pct(improper, paid, 2),
    accuracyPct: pct(xs.filter((p) => !p.improper).length, xs.length), onTimePct: pct(xs.filter((p) => p.onTime).length, xs.length),
    avgPayment: round(avg(xs.map((p) => p.amount)), 2),
  };
}

export function paymentsByProgram(d: PsData, r = PERIODS.ytd, allow?: Allow) {
  const xs = paymentsIn(d, r, allow);
  return PROGRAMS.filter((p) => p.pays).map((p) => {
    const ys = xs.filter((x) => x.program === p.code);
    const paid = sum(ys.map((x) => x.amount));
    return {
      program: p.name, code: p.code, payments: Math.round(ys.length * d.scale), paid: paid * d.scale, accuracyPct: pct(ys.filter((x) => !x.improper).length, ys.length),
      improperRate: pct(sum(ys.map((x) => x.improperAmount)), paid, 2), onTimePct: pct(ys.filter((x) => x.onTime).length, ys.length),
    };
  });
}

export function largeImproper(d: PsData, threshold = 300, allow?: Allow) {
  return d.payments
    .filter((p) => PERIODS.quarter.months.includes(p.month) && p.improper && p.improperAmount > threshold && okD(allow, p.district))
    .sort((a, b) => b.improperAmount - a.improperAmount);
}

export const REVIEW_STATUSES = ['Open review', 'Referred'];

export function integrityReview(d: PsData, allow?: Allow) {
  const payingCases = new Set(paymentsIn(d, PERIODS.ytd).filter((p) => okD(allow, p.district)).map((p) => p.caseKey));
  const flaggedAll = d.cases.filter((c) => c.flag && payingCases.has(c.key));
  const review = flaggedAll.filter((c) => REVIEW_STATUSES.includes(c.flag!.status));
  const rows = DISTRICTS.filter((x) => okD(allow, x.name)).map((x) => {
    const r = review.filter((c) => c.district === x.name);
    return { district: x.name, openReview: r.filter((c) => c.flag!.status === 'Open review').length, referred: r.filter((c) => c.flag!.status === 'Referred').length, total: r.length, scaled: Math.round(r.length * d.scale) };
  });
  const reasons = [...groupBy(review, (c) => c.flag!.reason).entries()].map(([reason, xs]) => ({ reason, cases: xs.length })).sort((a, b) => b.cases - a.cases);
  const ytdPay = paymentsIn(d, PERIODS.ytd, allow);
  const over = sum(ytdPay.map((p) => p.overpayment));
  return {
    rows, reasons, review, flagged: review.length, flaggedScaled: Math.round(review.length * d.scale), payingCases: payingCases.size,
    flagRate: pct(flaggedAll.length, payingCases.size, 2), recoveryPct: pct(sum(ytdPay.map((p) => p.recovered)), over), overpayments: over * d.scale,
  };
}

/** Every KPI in the dictionary, computed from the sample (scaled where a system total is shown). */
export function computeKpis(d: PsData): Record<string, number> {
  const mp = multiProgram(d);
  const sr = srByDistrict(d);
  const ps = processingStandard(d);
  const yoy = processingYoY(d);
  const bl = backlogByOffice(d);
  const pay = paymentSummary(d);
  const wf = workforce(d);
  const ir = integrityReview(d);
  return {
    'K-01': Math.round(mp.active * d.scale),
    'K-02': mp.pct,
    'K-03': csat(d).satisfiedPct,
    'K-04': digitalSelfService(d),
    'K-05': Math.round(d.requests.filter((s) => s.created.startsWith(PERIODS.month)).length * d.srScale),
    'K-06': sr.avgDays,
    'K-07': sr.onTimePct,
    'K-08': sr.reopenPct,
    'K-09': bl.backlog,
    'K-10': ps.avgDays,
    'K-11': ps.overScaled,
    'K-12': ps.timelyPct,
    'K-13': yoy.cur.approvalPct,
    'K-14': bl.caseload,
    'K-15': applicationsReceived(d),
    'K-16': Math.round(pay.paid),
    'K-17': pay.accuracyPct,
    'K-18': pay.improperRate,
    'K-19': Math.round(pay.improper),
    'K-20': pay.onTimePct,
    'K-21': wf.costPerCase,
    'K-22': ir.flaggedScaled,
    'K-23': ir.flagRate,
    'K-24': ir.recoveryPct,
    'K-25': wf.budgetExecPct,
    'K-26': wf.vacancyPct,
  };
}
