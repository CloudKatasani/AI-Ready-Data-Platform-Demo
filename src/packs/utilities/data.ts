// Northvale Energy synthetic data (spec section 6). Generated once per pack load from a seeded PRNG,
// so every demo run shows the same numbers and the agents always agree with the Explorer.
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, iso, monthOf, pad, person, round, sum, toDate } from '../../mock-snowflake/generators';
import {
  AS_OF, CAUSES, CAUSE_WEIGHTS, MAJOR_EVENT_DAYS, OPCOS, RATE_CLASSES, SEASONAL, SERVED_TOTAL, SUPPLIERS, TARGETS, VOLUMES,
} from './generators.config';

export interface Circuit { key: number; id: string; substation: string; opco: string; state: string; served: number; voltageKv: number }
export interface Customer {
  key: number; id: number; custNo: string; first: string; last: string; email: string; street: string; city: string; state: string;
  opco: string; region: string; rateClass: string; segment: string; residential: boolean; status: 'Active' | 'Inactive';
  paperless: boolean; churnRisk: number; arrearsTier: 'none' | 'light' | 'heavy'; arrearsTarget: number;
  premiseKey: number; premiseId: string; meterId: string; circuitKey: number; circuitId: string; lastBillMonth: number;
  priorRateClass?: string; effectiveFrom: string; changedOn?: string;
}
export interface Usage { date: string; premiseKey: number; customerKey: number; kwh: number; peakKw: number; readSuccess: number; rateClass: string; opco: string }
export interface Bill {
  key: number; id: string; customerKey: number; customerId: number; date: string; month: string; billed: number; arrears: number;
  estimated: boolean; daysToPay: number; paperless: boolean; email: string; opco: string; region: string; rateClass: string; residential: boolean;
}
export interface Outage {
  key: number; id: string; circuitKey: number; circuitId: string; opco: string; date: string; startMin: number; duration: number;
  ci: number; cause: string; med: boolean;
}
export interface PoLine {
  key: number; po: string; line: number; supplierKey: number; supplier: string; category: string; spend: number; onContract: boolean;
  date: string; promised: string; received: string; otif: boolean; cycleDays: number;
}
export interface Span { id: string; circuitId: string; opco: string; lastTrim: string; cycleYears: number; clearanceFt: number; overdue: boolean }
export interface Supplier { key: number; name: string; category: string; preferred: boolean; diversity: boolean }

export interface UtilData {
  circuits: Circuit[];
  customers: Customer[];
  usage: Usage[];
  bills: Bill[];
  outages: Outage[];
  poLines: PoLine[];
  spans: Span[];
  suppliers: Supplier[];
  servedByOpco: Record<string, number>;
  scale: number;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 9 + i, 1));
  return iso(d).slice(0, 7);
}); // 2025-10 .. 2026-09

export function generateUtilities(seed: number): UtilData {
  const rng = new Rng(seed);

  // ---- Circuits (120), customers served split by OPCO
  const servedByOpco: Record<string, number> = {};
  const circuits: Circuit[] = [];
  const usedIds = new Set<string>();
  for (const op of OPCOS) {
    const served = Math.round(SERVED_TOTAL * op.weight);
    servedByOpco[op.name] = served;
    const raw = Array.from({ length: op.circuits }, () => rng.range(0.6, 1.4));
    const total = sum(raw);
    let assigned = 0;
    raw.forEach((r, i) => {
      const town = op.towns[i % op.towns.length];
      let id: string;
      do id = `CKT-${town.state}-${pad(rng.int(100, 999), 4)}`;
      while (usedIds.has(id));
      usedIds.add(id);
      const s = i === raw.length - 1 ? served - assigned : Math.round((served * r) / total);
      assigned += s;
      circuits.push({
        key: circuits.length + 1, id, opco: op.name, state: town.state, served: s,
        substation: `${town.city} ${['North', 'South', 'East', 'West', 'Junction', 'Hill'][i % 6]} ${1 + (i % 3)}`,
        voltageKv: rng.pick([12.47, 12.47, 13.2, 34.5]),
      });
    });
  }

  // ---- Customers / premises (2,000 standing in for 1.385M)
  const customers: Customer[] = [];
  for (let i = 0; i < VOLUMES.customers; i++) {
    const op = rng.weighted(OPCOS, OPCOS.map((o) => o.weight));
    const town = rng.pick<{ city: string; state: string }>(op.towns);
    const rc = rng.weighted(RATE_CLASSES, RATE_CLASSES.map((r) => r.weight));
    const p = person(rng, i);
    const opCircuits = circuits.filter((c) => c.opco === op.name && c.state === town.state);
    const circ = rng.pick(opCircuits.length ? opCircuits : circuits.filter((c) => c.opco === op.name));
    const id = 410000 + i * 7 + rng.int(0, 6);
    const inactive = rng.chance(0.03);
    const stale = !inactive && rng.chance(0.012);
    const tierRoll = rng.float();
    const arrearsTier = tierRoll < 0.06 ? 'heavy' : tierRoll < 0.28 ? 'light' : 'none';
    const hasHistory = rng.chance(0.08);
    customers.push({
      key: i + 1, id, custNo: pad(id, 10), first: p.first, last: p.last, email: p.email, street: p.street,
      city: town.city, state: town.state, opco: op.name, region: op.region, rateClass: rc.code, segment: rc.segment,
      residential: rc.residential, status: inactive ? 'Inactive' : 'Active', paperless: rng.chance(0.46),
      churnRisk: Math.min(99, Math.max(1, Math.round(rng.lognormal(24, 0.55) + (arrearsTier === 'heavy' ? 30 : 0)))),
      arrearsTier, arrearsTarget: arrearsTier === 'heavy' ? round(rng.range(550, 2600), 2) : arrearsTier === 'light' ? round(rng.range(15, 320), 2) : 0,
      premiseKey: i + 1, premiseId: `PRM-${pad(700000 + i * 3, 7)}`, meterId: `MTR-${pad(5100000 + i * 11, 8)}`,
      circuitKey: circ.key, circuitId: circ.id, lastBillMonth: inactive ? rng.int(2, 9) : stale ? 8 : 11,
      priorRateClass: hasHistory ? (rc.code === 'RS-TOU' ? 'RS-1' : rc.code === 'GS-2' ? 'GS-1' : rc.code) : undefined,
      effectiveFrom: hasHistory ? addDays('2024-01-01', rng.int(200, 600)) : addDays('2012-01-01', rng.int(0, 4000)),
    });
    if (hasHistory) customers[i].changedOn = customers[i].effectiveFrom;
  }

  // ---- Daily usage: 2,000 premises × 30 days (Sep 2026)
  const days = dateRange(addDays(AS_OF, -VOLUMES.usageDays + 1), AS_OF);
  const usage: Usage[] = [];
  for (const c of customers) {
    const rc = RATE_CLASSES.find((r) => r.code === c.rateClass)!;
    const own = rng.lognormal(1, 0.25);
    for (const d of days) {
      const dow = toDate(d).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const factor = (rc.residential ? (weekend ? 1.08 : 0.97) : weekend ? 0.55 : 1.12) * rng.range(0.85, 1.15);
      const kwh = round(rc.kwhDay * own * factor * (c.status === 'Inactive' ? 0.05 : 1), 2);
      const peak = round((kwh / 24) * rng.range(1.9, 2.6) * (c.rateClass === 'RS-TOU' ? 0.88 : 1), 2);
      const rs = rng.chance(0.03) ? round(rng.range(93, 98.5), 1) : round(Math.min(100, rng.normal(99.6, 0.3)), 1);
      usage.push({ date: d, premiseKey: c.premiseKey, customerKey: c.key, kwh, peakKw: peak, readSuccess: rs, rateClass: c.rateClass, opco: c.opco });
    }
  }

  // ---- Billing statements: 2,000 × 12 months
  const bills: Bill[] = [];
  for (const c of customers) {
    const day = rng.int(1, 28);
    const rcBase = c.rateClass === 'GS-2' ? 2700 : c.rateClass === 'GS-1' ? 410 : TARGETS.residentialBillBase * (c.rateClass === 'RS-TOU' ? 0.95 : 1);
    const own = rng.lognormal(1, 0.12);
    MONTHS.forEach((m, i) => {
      if (i > c.lastBillMonth) return;
      const season = SEASONAL[Number(m.slice(5, 7)) - 1];
      const billed = round(rcBase * own * season * rng.normal(1, 0.08), 2);
      const arrears =
        c.arrearsTier === 'heavy' ? round(c.arrearsTarget * (0.55 + (0.45 * i) / 11), 2)
        : c.arrearsTier === 'light' ? (rng.chance(0.6) ? round(c.arrearsTarget * rng.range(0.2, 1), 2) : 0)
        : rng.chance(0.03) ? round(rng.range(5, 60), 2) : 0;
      const daysToPay =
        c.arrearsTier === 'heavy' ? rng.int(45, 120) : c.arrearsTier === 'light' ? rng.int(20, 58) : rng.int(9, 30);
      bills.push({
        key: bills.length + 1, id: `ST-${m.replace('-', '')}-${pad(c.id, 7)}`, customerKey: c.key, customerId: c.id,
        date: `${m}-${pad(day)}`, month: m, billed, arrears, estimated: rng.chance(0.031), daysToPay,
        paperless: c.paperless, email: c.email, opco: c.opco, region: c.region, rateClass: c.rateClass, residential: c.residential,
      });
    });
  }

  // ---- Outages: 1,800 events, 2025-01-01 .. 2026-09-30 (calibrated to IEEE 1366 targets)
  const outageDays = dateRange('2025-01-01', AS_OF);
  const monthW = [0.8, 0.8, 0.9, 1.0, 1.1, 1.3, 1.4, 1.3, 1.0, 0.9, 0.8, 0.9];
  const medEventsPerDay = 20;
  const normalCount = VOLUMES.outages - MAJOR_EVENT_DAYS.length * medEventsPerDay;
  const dayWeights = outageDays.map((d) => monthW[Number(d.slice(5, 7)) - 1]);
  const raw: Omit<Outage, 'key' | 'id'>[] = [];
  const circuitWeights = circuits.map((c) => c.served);
  for (let i = 0; i < normalCount; i++) {
    const d = rng.weighted(outageDays, dayWeights);
    const circ = rng.weighted(circuits, circuitWeights);
    raw.push({
      circuitKey: circ.key, circuitId: circ.id, opco: circ.opco, date: d, startMin: rng.int(0, 1439),
      duration: Math.max(6, rng.lognormal(85, 0.6)), ci: Math.max(1, rng.lognormal(600, 1.0)),
      cause: rng.weighted(CAUSES, CAUSE_WEIGHTS), med: MAJOR_EVENT_DAYS.includes(d),
    });
  }
  for (const d of MAJOR_EVENT_DAYS) {
    for (let i = 0; i < medEventsPerDay; i++) {
      const circ = rng.weighted(circuits, circuitWeights);
      raw.push({
        circuitKey: circ.key, circuitId: circ.id, opco: circ.opco, date: d, startMin: rng.int(600, 1200),
        duration: Math.max(30, rng.lognormal(540, 0.5)), ci: Math.max(50, rng.lognormal(4200, 0.6)),
        cause: rng.pick(['Tree contact', 'Weather – wind', 'Weather – wind', 'Lightning']), med: true,
      });
    }
  }
  calibrateOutages(raw, circuits);
  raw.sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : a.date < b.date ? -1 : 1));
  const outages: Outage[] = raw.map((o, i) => ({ ...o, key: i + 1, id: `OUT-${o.date.replace(/-/g, '').slice(2)}-${pad(i + 1, 4)}` }));

  // ---- Suppliers and PO lines (FY Oct 2025 – Sep 2026)
  const suppliers: Supplier[] = SUPPLIERS.map((s, i) => ({ key: i + 1, name: s.name, category: s.category, preferred: s.otif > 0.9, diversity: i % 3 === 1 }));
  const poDays = dateRange('2025-10-01', AS_OF);
  const poLines: PoLine[] = [];
  let poNo = 4500120000;
  while (poLines.length < VOLUMES.poLines) {
    const si = rng.weighted(SUPPLIERS.map((_, i) => i), [1.1, 1, 1.1, 0.8, 1.1, 1.2, 1.0, 0.7]);
    const s = SUPPLIERS[si];
    const date = rng.pick(poDays);
    const lines = rng.int(1, 4);
    poNo += rng.int(1, 9);
    for (let l = 1; l <= lines && poLines.length < VOLUMES.poLines; l++) {
      const category = rng.chance(0.88) ? s.category : rng.pick(SUPPLIERS).category;
      const promisedLead = rng.int(10, 35);
      const promised = addDays(date, promisedLead);
      poLines.push({
        key: poLines.length + 1, po: String(poNo), line: l * 10, supplierKey: si + 1, supplier: s.name, category,
        spend: round(rng.lognormal(s.spendMedian, 0.7), 2), onContract: false, date, promised, received: promised, otif: true, cycleDays: promisedLead,
      });
    }
  }
  // Exact per-supplier OTIF and contract rates (deterministic shuffles), then calibrate overall spend under contract.
  SUPPLIERS.forEach((s, si) => {
    const mine = poLines.filter((p) => p.supplierKey === si + 1);
    const late = rng.shuffle([...mine]).slice(0, Math.round(mine.length * (1 - s.otif)));
    for (const p of late) {
      p.otif = false;
      p.received = addDays(p.promised, rng.int(2, 18));
    }
    for (const p of mine) {
      if (p.otif) p.received = addDays(p.promised, -rng.int(0, 4));
      p.cycleDays = Math.max(1, Math.round((toDate(p.received).getTime() - toDate(p.date).getTime()) / 86_400_000));
      p.onContract = rng.chance(s.contract);
    }
  });
  calibrateContract(poLines, rng);

  // ---- Vegetation spans (600)
  const spans: Span[] = [];
  for (let i = 0; i < VOLUMES.spans; i++) {
    const circ = rng.pick(circuits);
    const cycle = rng.chance(0.7) ? 4 : 5;
    const ageDays = rng.int(60, Math.round(cycle * 365 * 1.2));
    const lastTrim = addDays(AS_OF, -ageDays);
    const overdue = ageDays > cycle * 365;
    spans.push({
      id: `SPN-${circ.id.slice(4)}-${pad(i + 1, 4)}`, circuitId: circ.id, opco: circ.opco, lastTrim, cycleYears: cycle,
      clearanceFt: round(overdue ? rng.range(1.5, 6) : rng.range(5.5, 15), 1), overdue,
    });
  }

  return { circuits, customers, usage, bills, outages, poLines, spans, suppliers, servedByOpco, scale: SERVED_TOTAL / VOLUMES.customers };
}

/** Scale customers interrupted and durations per calendar year so SAIFI/CAIDI land on the configured targets. */
function calibrateOutages(raw: Omit<Outage, 'key' | 'id'>[], circuits: Circuit[]) {
  const servedOf = new Map(circuits.map((c) => [c.key, c.served]));
  for (const year of ['2025', '2026'] as const) {
    const ytd = (o: (typeof raw)[number]) => o.date.startsWith(year) && o.date.slice(5, 7) <= '09' && !o.med;
    const inYear = raw.filter((o) => o.date.startsWith(year) && !o.med);
    for (let pass = 0; pass < 3; pass++) {
      const ciSum = sum(raw.filter(ytd).map((o) => o.ci));
      const k = (TARGETS.saifi[year] * SERVED_TOTAL) / ciSum;
      for (const o of inYear) o.ci = Math.min(servedOf.get(o.circuitKey)!, o.ci * k);
    }
    for (const o of inYear) o.ci = Math.max(1, Math.round(o.ci));
    for (let pass = 0; pass < 3; pass++) {
      const set = raw.filter(ytd);
      const caidi = sum(set.map((o) => o.ci * o.duration)) / sum(set.map((o) => o.ci));
      const k = TARGETS.caidi[year] / caidi;
      for (const o of inYear) o.duration = o.duration * k;
    }
    for (const o of inYear) o.duration = Math.max(6, Math.round(o.duration));
  }
  for (const o of raw.filter((x) => x.med)) {
    o.ci = Math.min(servedOf.get(o.circuitKey)!, Math.round(o.ci));
    o.duration = Math.round(o.duration);
  }
}

/** Flip a deterministic set of lines so overall spend under contract lands on target (spec: 78–84%). */
function calibrateContract(lines: PoLine[], rng: Rng) {
  const total = sum(lines.map((l) => l.spend));
  const order = rng.shuffle(lines.map((_, i) => i));
  let on = sum(lines.filter((l) => l.onContract).map((l) => l.spend));
  for (const i of order) {
    const share = on / total;
    if (Math.abs(share - TARGETS.spendUnderContract) < 0.004) break;
    const l = lines[i];
    if (share < TARGETS.spendUnderContract && !l.onContract && l.category !== 'Fleet') {
      l.onContract = true;
      on += l.spend;
    } else if (share > TARGETS.spendUnderContract && l.onContract && l.category !== 'Transformers') {
      l.onContract = false;
      on -= l.spend;
    }
  }
}

export const monthsOfFy = MONTHS;
export { monthOf };
