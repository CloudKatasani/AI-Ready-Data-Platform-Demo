// Sentinel Mutual synthetic data (spec section 6). Generated once per pack load from a seeded PRNG, so every demo
// run shows the same numbers and the agents always agree with the Explorer.
import { Rng } from '../../mock-snowflake/rng';
import { dateRange, pad, person, round, sum } from '../../mock-snowflake/generators';
import {
  AGENCY_PREFIXES, AGENCY_SUFFIXES, AS_OF, CAT_EVENTS, CAT_ZONE_BY_STATE, CAT_ZONES, CLAIM_SCALE, INJURIES, LINE_BY_CODE, LINES,
  POLICIES_IN_FORCE, REGIONS, SUBMISSION_SCALE, TARGETS, VOLUMES, type LineSpec,
} from './generators.config';

export type Channel = 'Independent agent' | 'Captive agent' | 'Broker' | 'Direct digital';
export interface Agency { key: number; id: string; name: string; channel: Channel; region: string; state: string; bindRate: number; turnaround: number }
export interface Term { start: string; premium: number }
export interface Policy {
  key: number; policyNo: string; holderId: string; first: string; last: string; insuredName: string; email: string; dob: string; street: string;
  city: string; state: string; region: string; line: string; lineName: string; segment: 'Personal' | 'Commercial'; agencyKey: number;
  inception: string; terms: Term[]; termStart: string; expiry: string; premium: number; endDate?: string; status: 'In force' | 'Lapsed' | 'Cancelled';
  payPlan: 'Monthly' | 'Annual'; due: Record<string, boolean>; renewed: Record<string, boolean>; tiv: number | null; catZone: string | null;
}
export interface PremiumRow {
  key: number; policyKey: number; month: string; written: number; earned: number; billed: number; daysPastDue: number | null;
  expense: number; line: string; region: string; state: string;
}
export interface Claim {
  key: number; claimNo: string; policyKey: number; line: string; region: string; state: string; lossDate: string; reportDate: string;
  closeDate?: string; status: 'Open' | 'Closed' | 'Reopened'; cause: string; incurred: number; paid: number; reserve: number; lae: number;
  catCode: string | null; subroEligible: boolean; subroRecovered: number; recoveryDate?: string; claimantFirst: string; claimantLast: string;
  claimantDob: string; injury: string | null; adjuster: string; fraudScore: number; firstParty: boolean;
}
export interface ClaimTxn { key: number; claimKey: number; date: string; type: 'Initial reserve' | 'Loss payment' | 'Expense payment' | 'Subrogation recovery'; amount: number; line: string; region: string }
export interface ReserveRow {
  key: number; claimKey: number; valuation: string; month: string; line: string; region: string; accidentYear: number;
  caseReserve: number; paidToDate: number; ibnr: number; claimantDob: string;
}
export interface Submission {
  key: number; id: string; agencyKey: number; line: string; state: string; region: string; channel: Channel; received: string;
  quoteDate?: string; turnaround?: number; boundDate?: string; premium: number; type: 'New business' | 'Rewrite' | 'Reinstatement';
  status: 'Declined' | 'Received' | 'Quoted' | 'Bound' | 'Not taken';
}

export interface InsData {
  agencies: Agency[];
  policies: Policy[];
  premiums: PremiumRow[];
  claims: Claim[];
  txns: ClaimTxn[];
  reserves: ReserveRow[];
  submissions: Submission[];
  /** Production policies per sample policy, production claims per sample claim, production submissions per sample submission. */
  scale: number;
  claimScale: number;
  subScale: number;
}


// Fast calendar arithmetic on ISO dates (integer day numbers, cached ISO strings): the generator does ~100k date ops.
const DAY_MS = 86_400_000;
const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS;
const isoCache = new Map<number, string>();
const isoOf = (n: number) => {
  let s = isoCache.get(n);
  if (!s) isoCache.set(n, (s = new Date(n * DAY_MS).toISOString().slice(0, 10)));
  return s;
};
export const addDays = (iso: string, k: number) => isoOf(dayNum(iso) + k);
export const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);

export const MONTHS = Array.from({ length: 21 }, (_, i) => `${2025 + Math.floor(i / 12)}-${pad((i % 12) + 1)}`); // 2025-01 .. 2026-09
const MIDS = MONTHS.map((m) => `${m}-15`);
export const VALUATION_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
export const monthEnd = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return addDays(mo === 12 ? `${y + 1}-01-01` : `${y}-${pad(mo + 1)}-01`, -1);
};
const anniversary = (inception: string, year: number) => {
  const md = inception.slice(5);
  return `${year}-${md === '02-29' ? '02-28' : md}`;
};
export const inForceOn = (p: Pick<Policy, 'inception' | 'endDate'>, day: string) => p.inception <= day && (!p.endDate || day < p.endDate);

const ADJUSTERS = ['J. Ferris', 'M. Albright', 'T. Osei', 'K. Nakamura', 'R. Pellegrino', 'S. Dubois', 'A. Kaur', 'L. Marchetti', 'D. Whitcombe', 'P. Achebe'];
const BUSINESS = ['Logistics', 'Builders', 'Dental Group', 'Hardware', 'Farms', 'Bakery', 'Auto Body', 'Properties', 'Landscaping', 'Machine Works'];
const INJURY_CAUSES: Record<string, string[]> = { PA: ['Bodily injury'], HO: ['Liability'], CA: ['Bodily injury'], CP: [], GL: ['Premises liability', 'Products liability', 'Completed operations'], WC: ['Strain/sprain', 'Slip and fall', 'Struck by object', 'Repetitive motion'] };

export function generateInsurance(seed: number): InsData {
  const rng = new Rng(seed);

  // ---- Agencies and producers (48)
  const agencies: Agency[] = [];
  for (let i = 0; i < VOLUMES.agencies; i++) {
    const reg = REGIONS[i % REGIONS.length];
    const st = rng.weighted(reg.states, reg.states.map((s) => s.w));
    const channel: Channel = i === 0 ? 'Direct digital' : rng.weighted<Channel>(['Independent agent', 'Captive agent', 'Broker'], [0.55, 0.3, 0.15]);
    const base = { 'Direct digital': 0.15, 'Captive agent': 0.3, 'Independent agent': 0.23, Broker: 0.19 }[channel];
    const ta = { 'Direct digital': 0.5, 'Captive agent': 1.4, 'Independent agent': 1.9, Broker: 2.7 }[channel];
    agencies.push({
      key: i + 1, id: `AGY-${pad(10200 + i * 37, 5)}`, channel, region: reg.name, state: st.code,
      name: i === 0 ? 'Sentinel Direct (online)' : `${AGENCY_PREFIXES[(i * 7) % AGENCY_PREFIXES.length]} ${AGENCY_SUFFIXES[(i + Math.floor(i / AGENCY_PREFIXES.length)) % AGENCY_SUFFIXES.length]}`,
      bindRate: Math.min(0.42, Math.max(0.09, rng.lognormal(base, 0.28))), turnaround: Math.max(0.3, rng.lognormal(ta, 0.4)),
    });
  }

  // ---- Policies (2,000 standing in for the book), with annual terms, renewals, lapses and cancellations
  const policies: Policy[] = [];
  for (let i = 0; i < VOLUMES.policies; i++) {
    const reg = rng.weighted(REGIONS, REGIONS.map((r) => r.weight));
    const st = rng.weighted(reg.states, reg.states.map((s) => s.w));
    const line = rng.weighted(LINES, LINES.map((l) => l.weight));
    const p = person(rng, i);
    const regional = agencies.filter((a) => a.region === reg.name && a.channel !== 'Direct digital' && (line.segment === 'Commercial' || a.channel !== 'Broker'));
    const agency = line.segment === 'Personal' && rng.chance(0.12) ? agencies[0] : rng.pick(regional);
    const r = rng.float();
    const inception = r < 0.115 ? addDays('2025-10-01', rng.int(0, 364)) : r < 0.195 ? addDays('2025-01-01', rng.int(0, 272)) : addDays('2004-01-01', rng.int(0, 7670));
    const p0 = round(rng.lognormal(line.premium, 0.35), 2);
    const incYear = Number(inception.slice(0, 4));
    const terms: Term[] = [];
    const due: Record<string, boolean> = {};
    const renewed: Record<string, boolean> = {};
    let endDate: string | undefined;
    let status: Policy['status'] = 'In force';
    for (let y = Math.max(incYear, 2024); y <= 2026; y++) {
      const start = y === incYear ? inception : anniversary(inception, y);
      if (start > AS_OF) break;
      if (y > incYear && start >= '2025-01-01') {
        const yr = String(y);
        due[yr] = true;
        if (!rng.chance(line.retention - (y === 2025 ? 0.015 : 0))) {
          endDate = start;
          status = 'Lapsed';
          renewed[yr] = false;
          break;
        }
        renewed[yr] = true;
      }
      const factor = (y >= 2025 ? line.rate2025 : 1) * (y >= 2026 ? line.rate2026 : 1);
      terms.push({ start, premium: round(p0 * factor, 2) });
      if (rng.chance(0.022)) {
        const c = addDays(start, rng.int(30, 330));
        if (c <= AS_OF && c > '2025-01-01') {
          endDate = c;
          status = 'Cancelled';
          break;
        }
      }
    }
    const cur = terms[terms.length - 1] ?? { start: inception, premium: p0 };
    const zoneSpec = CAT_ZONE_BY_STATE[st.code];
    policies.push({
      key: i + 1, policyNo: `SM-${line.code}-${pad(3_100_000 + i * 29, 7)}`, holderId: `PH-${pad(800_000 + i * 13, 7)}`,
      first: p.first, last: p.last, insuredName: line.segment === 'Commercial' ? `${p.last} ${BUSINESS[i % BUSINESS.length]} LLC` : `${p.first} ${p.last}`,
      email: p.email, dob: addDays('1946-01-01', rng.int(0, 20000)), street: p.street, city: st.city, state: st.code, region: reg.name,
      line: line.code, lineName: line.name, segment: line.segment, agencyKey: agency.key, inception, terms, termStart: cur.start,
      expiry: anniversary(inception, Number(cur.start.slice(0, 4)) + 1), premium: cur.premium, endDate, status,
      payPlan: rng.chance(0.64) ? 'Monthly' : 'Annual', due, renewed,
      tiv: line.property ? Math.round(rng.lognormal(line.tivMedian, 0.45) / 1000) * 1000 : null,
      catZone: line.property ? (rng.chance(zoneSpec.p) ? zoneSpec.zone : zoneSpec.fallback) : null,
    });
  }
  calibrateCatZones(policies, rng);
  const inForceNow = policies.filter((p) => inForceOn(p, AS_OF)).length;
  const scale = POLICIES_IN_FORCE / inForceNow;

  // ---- Premium: policy-month rows (written at term start, earned monthly, billed by pay plan)
  const premiums: PremiumRow[] = [];
  for (const p of policies) {
    const line = LINE_BY_CODE[p.line];
    const termMonths = p.terms.map((t) => t.start.slice(0, 7));
    for (let mi = 0; mi < MONTHS.length; mi++) {
      const m = MONTHS[mi];
      const mid = MIDS[mi];
      let written = 0;
      for (let j = 0; j < termMonths.length; j++) if (termMonths[j] === m) written += p.terms[j].premium;
      const inForce = inForceOn(p, mid);
      if (!inForce && !written) continue;
      let term = p.terms[0];
      for (let j = p.terms.length - 1; j >= 0; j--) if (p.terms[j].start <= mid) { term = p.terms[j]; break; }
      const earned = inForce && term ? round(term.premium / 12, 2) : 0;
      const billed = p.payPlan === 'Monthly' ? earned : written;
      premiums.push({
        key: premiums.length + 1, policyKey: p.key, month: m, written: round(written, 2), earned, billed: round(billed, 2),
        daysPastDue: billed > 0 ? (rng.chance(0.036) ? rng.int(31, 95) : rng.int(0, 24)) : null,
        expense: round(earned * line.expenseRate * rng.range(0.94, 1.06), 2), line: p.line, region: p.region, state: p.state,
      });
    }
  }

  // ---- Claims: non-catastrophe claims across 2025-01-01 .. as-of, plus claims on the cat-code list
  const days = dateRange('2025-01-01', AS_OF);
  const monthW = [1.15, 1.1, 1.0, 0.95, 0.95, 0.95, 1.0, 1.0, 0.95, 1.0, 1.0, 1.1];
  const pickDay = sampler(days, days.map((d) => monthW[Number(d.slice(5, 7)) - 1]));
  const byLine = new Map(LINES.map((l) => [l.code, policies.filter((p) => p.line === l.code)]));
  const pickPolicy = (line: string, day: string, states?: string[]) => {
    const pool = byLine.get(line)!;
    const scoped = states ? pool.filter((p) => states.includes(p.state)) : pool;
    const from = scoped.length ? scoped : pool;
    for (let t = 0; t < 40; t++) {
      const p = rng.pick(from);
      if (inForceOn(p, day)) return p;
    }
    return rng.pick(from);
  };
  type Raw = Omit<Claim, 'key' | 'claimNo' | 'incurred' | 'paid' | 'reserve' | 'lae' | 'subroRecovered' | 'status'> & { base: number; duration: number };
  const raw: Raw[] = [];
  const catCount = sum(CAT_EVENTS.map((e) => e.claims));
  const claimant = (pol: Policy, injured: boolean, n: number) => {
    if (!injured) return { first: pol.first, last: pol.last };
    const x = person(rng, n, 'claimant.example');
    return { first: x.first, last: x.last };
  };
  for (let i = 0; i < VOLUMES.claims - catCount; i++) {
    const line = rng.weighted(LINES, LINES.map((l) => l.claimWeight));
    const lossDate = pickDay(rng);
    const pol = pickPolicy(line.code, lossDate);
    const injured = rng.chance(line.injuryShare) && INJURY_CAUSES[line.code].length > 0;
    const cause = injured ? rng.pick(INJURY_CAUSES[line.code]) : rng.pick(line.causes.filter((c) => !INJURY_CAUSES[line.code].includes(c)).concat(line.code === 'GL' ? ['Premises liability'] : []));
    const who = claimant(pol, injured, i);
    raw.push(rawClaim(rng, line, pol, lossDate, cause, injured, who, null, Math.min(1_500_000, rng.lognormal(line.severity, 1.0))));
  }
  for (const ev of CAT_EVENTS) {
    const evDays = dateRange(ev.start, ev.end);
    for (let i = 0; i < ev.claims; i++) {
      const lineCode = rng.weighted(['HO', 'CP', 'PA'], ev.peril === 'Wildfire' ? [0.75, 0.2, 0.05] : ev.peril === 'Severe convective' ? [0.5, 0.12, 0.38] : [0.65, 0.2, 0.15]);
      const line = LINE_BY_CODE[lineCode];
      const lossDate = rng.pick(evDays);
      const pol = pickPolicy(lineCode, lossDate, ev.states);
      const cause = ev.peril === 'Wildfire' ? 'Fire' : ev.peril === 'Winter storm' ? 'Water damage' : lineCode === 'PA' ? 'Hail' : 'Wind/hail';
      const med = lineCode === 'HO' ? 22_000 : lineCode === 'CP' ? 70_000 : 6_000;
      raw.push(rawClaim(rng, line, pol, lossDate, cause, false, { first: pol.first, last: pol.last }, ev.code, Math.min(2_500_000, rng.lognormal(med, 0.8))));
    }
  }
  calibrateLosses(raw, premiums, scale);
  raw.sort((a, b) => (a.lossDate === b.lossDate ? a.reportDate.localeCompare(b.reportDate) : a.lossDate < b.lossDate ? -1 : 1));

  const claims: Claim[] = [];
  const txns: ClaimTxn[] = [];
  raw.forEach((c, i) => {
    const line = LINE_BY_CODE[c.line];
    const incurred = round(c.base, 2);
    const close = addDays(c.reportDate, c.duration);
    let status: Claim['status'] = close <= AS_OF ? 'Closed' : 'Open';
    if (status === 'Closed' && close >= '2026-05-01' && rng.chance(0.05)) status = 'Reopened';
    const open = status !== 'Closed';
    const elapsed = Math.max(1, daysBetween(c.reportDate, AS_OF));
    let paid = open ? round(incurred * Math.min(0.85, Math.max(0.05, elapsed / c.duration)) * rng.range(0.55, 1), 2) : incurred;
    if (open && c.subroEligible && (c.line === 'PA' || c.line === 'CA') && rng.chance(0.1)) paid = incurred; // awaiting subrogation only
    const lae = round(incurred * line.laeRate * rng.range(0.7, 1.3), 2);
    let subroRecovered = 0;
    let recoveryDate: string | undefined;
    if (c.subroEligible && !open) {
      const rate = rng.chance(0.27) ? 0 : rng.range(0.15, 0.65);
      const when = addDays(close, rng.int(15, 120));
      if (rate > 0 && when <= AS_OF) {
        subroRecovered = round(paid * rate, 2);
        recoveryDate = when;
      }
    }
    const claim: Claim = {
      ...c, key: i + 1, claimNo: `CLM-${c.lossDate.slice(2, 4)}-${pad(1_040_000 + i * 11, 7)}`, status, closeDate: open ? undefined : close,
      incurred, paid, reserve: open ? round(incurred - paid, 2) : 0, lae, subroRecovered, recoveryDate,
    };
    delete (claim as Partial<Raw>).base;
    delete (claim as Partial<Raw>).duration;
    claims.push(claim);

    // Transactions: initial reserve, loss payments, expense payments, subrogation recovery
    const end = open ? AS_OF : close;
    const push = (date: string, type: ClaimTxn['type'], amount: number) => txns.push({ key: 0, claimKey: claim.key, date, type, amount: round(amount, 2), line: c.line, region: c.region });
    push(c.reportDate, 'Initial reserve', incurred * rng.range(0.75, 1.15));
    const span = Math.max(1, daysBetween(c.reportDate, end));
    if (paid > 0) {
      const k = open ? rng.int(1, 3) : rng.int(1, 4);
      const parts = Array.from({ length: k }, () => rng.range(0.4, 1.6));
      const tot = sum(parts);
      const dates = parts.map((_, j) => (j === k - 1 && !open ? end : addDays(c.reportDate, Math.min(span, rng.int(1, span))))).sort();
      parts.forEach((w, j) => push(dates[j], 'Loss payment', (paid * w) / tot));
    }
    const ek = rng.int(1, 2);
    for (let j = 0; j < ek; j++) push(addDays(c.reportDate, Math.min(span, rng.int(1, span))), 'Expense payment', lae / ek);
    if (subroRecovered > 0) push(recoveryDate!, 'Subrogation recovery', -subroRecovered);
  });
  txns.sort((a, b) => (a.date === b.date ? a.claimKey - b.claimKey : a.date < b.date ? -1 : 1));
  txns.forEach((t, i) => (t.key = i + 1));

  // ---- Reserves: month-end valuations Apr–Sep 2026 for open claims; IBNR by line allocated pro rata to case reserves
  const earnedByLineMonth = new Map<string, number>();
  for (const p of premiums) earnedByLineMonth.set(`${p.line}|${p.month}`, (earnedByLineMonth.get(`${p.line}|${p.month}`) ?? 0) + p.earned);
  const paysByClaim = new Map<number, ClaimTxn[]>();
  for (const t of txns) if (t.type === 'Loss payment') (paysByClaim.get(t.claimKey) ?? paysByClaim.set(t.claimKey, []).get(t.claimKey)!).push(t);
  const reserves: ReserveRow[] = [];
  for (const m of VALUATION_MONTHS) {
    const v = monthEnd(m);
    const rows: ReserveRow[] = [];
    for (const c of claims) {
      if (c.reportDate > v) continue;
      if (c.status === 'Closed' && c.closeDate! <= v) continue;
      const paidToDate = round(sum((paysByClaim.get(c.key) ?? []).filter((t) => t.date <= v).map((t) => t.amount)), 2);
      rows.push({
        key: 0, claimKey: c.key, valuation: v, month: m, line: c.line, region: c.region, accidentYear: Number(c.lossDate.slice(0, 4)),
        caseReserve: round(Math.max(0, c.incurred - paidToDate), 2), paidToDate, ibnr: 0, claimantDob: c.claimantDob,
      });
    }
    const t12 = MONTHS.slice(MONTHS.indexOf(m) - 11, MONTHS.indexOf(m) + 1);
    for (const l of LINES) {
      const earned = sum(t12.map((x) => earnedByLineMonth.get(`${l.code}|${x}`) ?? 0));
      const ibnrSample = (l.ibnrFactor * earned * scale) / CLAIM_SCALE;
      const mine = rows.filter((r) => r.line === l.code && r.caseReserve > 0);
      const tot = sum(mine.map((r) => r.caseReserve));
      for (const r of mine) r.ibnr = round((ibnrSample * r.caseReserve) / tot, 2);
    }
    reserves.push(...rows);
  }
  reserves.forEach((r, i) => (r.key = i + 1));

  // ---- Submissions from the agent & broker portal (6,000)
  const submissions: Submission[] = [];
  const pickSubDay = sampler(days, days.map((d) => (d >= '2026-01-01' ? 1.08 : 1) * monthW[Number(d.slice(5, 7)) - 1]));
  const agencyW = agencies.map((a) => (a.channel === 'Direct digital' ? 3 : 1));
  const commercial = LINES.filter((l) => l.segment === 'Commercial');
  for (let i = 0; i < VOLUMES.submissions; i++) {
    const a = rng.weighted(agencies, agencyW);
    const reg = a.channel === 'Direct digital' ? rng.weighted(REGIONS, REGIONS.map((r) => r.weight)) : REGIONS.find((r) => r.name === a.region)!;
    const st = rng.weighted(reg.states, reg.states.map((s) => s.w));
    const line = a.channel === 'Broker' ? rng.weighted(commercial, commercial.map((l) => l.weight)) : a.channel === 'Direct digital' ? rng.weighted(LINES.slice(0, 2), [0.6, 0.4]) : rng.weighted(LINES, LINES.map((l) => l.weight));
    const received = pickSubDay(rng);
    const declined = rng.chance(0.08);
    const turnaround = round(Math.max(0.1, rng.lognormal(a.turnaround, 0.5)), 1);
    const quoteDate = declined ? undefined : addDays(received, Math.ceil(turnaround));
    const quoted = Boolean(quoteDate && quoteDate <= AS_OF);
    const binds = quoted && rng.chance(a.bindRate);
    const boundDate = binds ? addDays(quoteDate!, rng.int(0, 21)) : undefined;
    const bound = Boolean(boundDate && boundDate <= AS_OF);
    const status: Submission['status'] = declined ? 'Declined' : !quoted ? 'Received' : bound ? 'Bound' : binds || daysBetween(quoteDate!, AS_OF) < 30 ? 'Quoted' : 'Not taken';
    submissions.push({
      key: i + 1, id: `SUB-${received.slice(2, 4)}${pad(400_000 + i * 3, 7)}`, agencyKey: a.key, line: line.code, state: st.code, region: reg.name, channel: a.channel,
      received, quoteDate: quoted ? quoteDate : undefined, turnaround: quoted ? turnaround : undefined, boundDate: bound ? boundDate : undefined,
      premium: round(rng.lognormal(line.premium * 1.07, 0.35), 2), type: rng.weighted(['New business', 'Rewrite', 'Reinstatement'] as const, [0.9, 0.07, 0.03]), status,
    });
  }
  submissions.sort((a, b) => (a.received < b.received ? -1 : a.received > b.received ? 1 : a.key - b.key));
  submissions.forEach((s, i) => (s.key = i + 1));

  return { agencies, policies, premiums, claims, txns, reserves, submissions, scale, claimScale: CLAIM_SCALE, subScale: SUBMISSION_SCALE };
}

/** Weighted picker with precomputed cumulative weights (one rng draw per pick, like Rng.weighted). */
function sampler<T>(items: T[], weights: number[]) {
  const cum: number[] = [];
  let acc = 0;
  for (const w of weights) cum.push((acc += w));
  return (rng: Rng) => {
    const r = rng.float() * acc;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] > r) hi = mid;
      else lo = mid + 1;
    }
    return items[lo];
  };
}

function rawClaim(rng: Rng, line: LineSpec, pol: Policy, lossDate: string, cause: string, injured: boolean, who: { first: string; last: string }, catCode: string | null, base: number) {
  const lag = Math.round(rng.lognormal(line.code === 'GL' || line.code === 'WC' ? 8 : 2, 0.9));
  const reportDate = addDays(lossDate, lag) > AS_OF ? AS_OF : addDays(lossDate, lag);
  return {
    policyKey: pol.key, line: line.code, region: pol.region, state: pol.state, lossDate, reportDate, cause, catCode,
    subroEligible: rng.chance(catCode ? 0.02 : line.subroShare), claimantFirst: who.first, claimantLast: who.last,
    claimantDob: addDays('1948-01-01', rng.int(0, 21000)), injury: injured ? rng.pick(INJURIES) : null, adjuster: rng.pick(ADJUSTERS),
    fraudScore: Math.min(99, Math.max(1, Math.round(rng.lognormal(18, 0.6)))), firstParty: !injured, base,
    duration: Math.max(3, Math.round(rng.lognormal(line.closeMedian * (catCode ? 1.3 : 1), 0.8))),
  };
}

/** Scale incurred losses per line and accident year (Jan–Sep) so ex-cat and cat loss ratios land on target. */
function calibrateLosses(raw: { line: string; lossDate: string; catCode: string | null; base: number }[], premiums: PremiumRow[], scale: number) {
  for (const year of ['2025', '2026']) {
    const ytd = (m: string) => m.startsWith(year) && m.slice(5, 7) <= '09';
    const earnedBy = new Map<string, number>();
    for (const p of premiums) if (ytd(p.month)) earnedBy.set(p.line, (earnedBy.get(p.line) ?? 0) + p.earned);
    for (const l of LINES) {
      const inYear = raw.filter((c) => !c.catCode && c.line === l.code && c.lossDate.startsWith(year));
      const s = sum(inYear.filter((c) => ytd(c.lossDate.slice(0, 7))).map((c) => c.base));
      const k = (TARGETS.lossRatioExCat[year][l.code] * (earnedBy.get(l.code) ?? 0) * scale) / (s * CLAIM_SCALE);
      for (const c of inYear) c.base *= k;
    }
    const cats = raw.filter((c) => c.catCode && c.lossDate.startsWith(year));
    const s = sum(cats.filter((c) => ytd(c.lossDate.slice(0, 7))).map((c) => c.base));
    const k = (TARGETS.catLossRatio[year] * sum([...earnedBy.values()]) * scale) / (s * CLAIM_SCALE);
    for (const c of cats) c.base *= k;
  }
}

/** Flip a deterministic set of property risks between their cat zone and fallback so hurricane + wildfire TIV lands on target. */
function calibrateCatZones(policies: Policy[], rng: Rng) {
  const prop = policies.filter((p) => p.tiv !== null && inForceOn(p, AS_OF));
  const total = sum(prop.map((p) => p.tiv!));
  let inZone = sum(prop.filter((p) => CAT_ZONES.includes(p.catZone!)).map((p) => p.tiv!));
  for (const p of rng.shuffle([...prop])) {
    const share = inZone / total;
    if (Math.abs(share - TARGETS.catConcentration) < 0.004) break;
    const spec = CAT_ZONE_BY_STATE[p.state];
    if (!CAT_ZONES.includes(spec.zone)) continue;
    if (share < TARGETS.catConcentration && !CAT_ZONES.includes(p.catZone!)) {
      p.catZone = spec.zone;
      inZone += p.tiv!;
    } else if (share > TARGETS.catConcentration && CAT_ZONES.includes(p.catZone!)) {
      p.catZone = spec.fallback;
      inZone -= p.tiv!;
    }
  }
}
