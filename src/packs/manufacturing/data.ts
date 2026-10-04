// Forgepoint Industries synthetic data (spec section 6). Generated once per pack load from a seeded PRNG,
// so every demo run shows the same numbers and the agents always agree with the Explorer.
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, pad, person, round, toDate } from '../../mock-snowflake/generators';
import {
  AS_OF, ASSET_TYPES, BU_CODE_TO_NAME, CUSTOMER_PREFIX, CUSTOMER_SUFFIX, DEFECT_CODES, DEFECT_WEIGHTS, FAILURE_CAUSES, HEADCOUNT_TOTAL, LATE_PROB,
  LINE_TYPES, ORDER_LINES_TOTAL, OTHER_DOWNTIME, OTHER_DOWNTIME_WEIGHTS, PLANTS, PRODUCT_FAMILIES, SUPPLIERS, VOLUMES, WINDOW_START,
} from './generators.config';

export interface Plant { key: number; code: string; name: string; country: string; bu: string; buCode: string; ef: number }
export interface Line {
  key: number; id: string; plantKey: number; plantCode: string; plantName: string; bu: string; buCode: string; type: string; family: string;
  idealCycleSec: number; kwRun: number; kwIdle: number; shifts: number; status: 'Active' | 'Decommissioned'; idleFrom?: string;
  bdProb: number; otherMed: number; perf: number; scrap: number; rework: number; leads: number[];
}
export interface Operator {
  key: number; id: string; first: string; last: string; email: string; plantCode: string; plantName: string; bu: string; buCode: string;
  lineKey: number; lineId: string; role: string; certLevel: number; hireDate: string; status: 'Active' | 'Leave' | 'Terminated';
  priorRole?: string; changedOn?: string;
}
export interface Production {
  key: number; date: string; lineKey: number; lineId: string; plantCode: string; plantName: string; bu: string; shift: number; leadKey: number;
  plannedMin: number; plannedDownMin: number; unplannedMin: number; breakdownMin: number; runMin: number; minorStopMin: number;
  idealCycleSec: number; total: number; good: number; scrap: number; rework: number; idealMin: number; topReason: string; energyKwh: number;
}
export interface Asset { key: number; id: string; lineKey: number; lineId: string; plantCode: string; bu: string; type: string; criticality: 'A' | 'B' | 'C'; installYear: number }
export interface MaintEvent { key: number; wo: string; assetKey: number; assetId: string; lineKey: number; lineId: string; plantCode: string; bu: string; date: string; kind: 'Corrective' | 'Preventive'; hours: number; cause: string }
export interface Lot {
  key: number; lotId: string; date: string; lineKey: number; lineId: string; plantCode: string; bu: string; operatorKey: number; family: string;
  lotQty: number; inspected: number; defects: number; passedFirst: boolean; defectCode: string | null; disposition: string; ncr: string | null; copq: number;
}
export interface Customer { key: number; id: string; name: string; contact: string; contactEmail: string; buCode: string }
export interface Order {
  key: number; orderNo: string; lineNo: number; customerKey: number; customer: string; contactEmail: string; bu: string; plantCode: string; family: string;
  qty: number; shippedQty: number; orderDate: string; promised: string; delivered: string | null; onTime: boolean | null; inFull: boolean;
  leadDays: number | null; value: number; unitCost: number; status: 'Delivered' | 'Open';
}
export interface Supplier { key: number; id: string; name: string; category: string; country: string; preferred: boolean }
export interface Receipt {
  key: number; asn: string; supplierKey: number; supplier: string; category: string; plantCode: string; bu: string; poDate: string; promised: string;
  received: string; qty: number; rejected: number; onTime: boolean; inFull: boolean; otif: boolean; leadDays: number;
}

export interface MfgData {
  plants: Plant[]; lines: Line[]; operators: Operator[]; production: Production[]; assets: Asset[]; maint: MaintEvent[]; lots: Lot[];
  customers: Customer[]; orders: Order[]; suppliers: Supplier[]; receipts: Receipt[];
  headcountScale: number; orderScale: number;
}

/** Lines with chronic losses (one dominant loss each) and last-week incidents (spec: signature question). */
const CHRONIC: Record<string, 'availability' | 'performance' | 'quality'> = {
  'RFD-L2': 'availability', 'MAA-L1': 'performance', 'PEN-L3': 'quality', 'QRO-L2': 'availability', 'WUX-L2': 'performance',
};
const LAST_WEEK = { from: '2026-09-21', to: '2026-09-27' };
const INCIDENTS: Record<string, { kind: 'breakdown' | 'quality' | 'speed'; days: string[] }> = {
  'DAY-L1': { kind: 'breakdown', days: ['2026-09-23', '2026-09-24'] },
  'ELK-L2': { kind: 'quality', days: dateRange(LAST_WEEK.from, LAST_WEEK.to) },
  'MKE-L1': { kind: 'speed', days: dateRange(LAST_WEEK.from, LAST_WEEK.to) },
};
/** Business-unit character: Industrial Controls runs fast automated lines, Aerospace long low-volume cycles with more downtime. */
const BU_PERF: Record<string, number> = { MS: 1.0, FP: 0.985, IC: 1.025, AC: 0.97 };
const BU_DOWN: Record<string, number> = { MS: 1.0, FP: 1.1, IC: 0.82, AC: 1.15 };
const DECOMMISSIONED = ['GVL-L3', 'ICT-L3'];
const IDLE_FROM: Record<string, string> = { 'BRN-L3': '2026-08-01', 'TLS-L3': '2026-08-10' };

export function generateManufacturing(seed: number): MfgData {
  const rng = new Rng(seed);

  // ---- Plants and lines (22 plants, 80 lines)
  const plants: Plant[] = PLANTS.map((p, i) => ({ key: i + 1, code: p.code, name: p.name, country: p.country, bu: BU_CODE_TO_NAME[p.bu], buCode: p.bu, ef: p.ef }));
  const lines: Line[] = [];
  PLANTS.forEach((p, pi) => {
    for (let i = 0; i < p.lines; i++) {
      const lt = LINE_TYPES[p.bu][i % 4];
      const id = `${p.code}-L${i + 1}`;
      const chronic = CHRONIC[id];
      lines.push({
        key: lines.length + 1, id, plantKey: pi + 1, plantCode: p.code, plantName: p.name, bu: BU_CODE_TO_NAME[p.bu], buCode: p.bu, type: lt.type,
        family: PRODUCT_FAMILIES[p.bu][i % 3].family, idealCycleSec: round(lt.cycleSec * rng.range(0.9, 1.1), 1), kwRun: lt.kwRun, kwIdle: lt.kwIdle,
        shifts: p.bu === 'AC' ? 2 : rng.chance(0.55) ? 3 : 2, status: DECOMMISSIONED.includes(id) ? 'Decommissioned' : 'Active', idleFrom: IDLE_FROM[id],
        bdProb: (chronic === 'availability' ? 0.17 : 0.075) * rng.range(0.75, 1.25),
        otherMed: (chronic === 'availability' ? 62 : 33) * BU_DOWN[p.bu] * rng.range(0.8, 1.2),
        perf: Math.min(0.97, (chronic === 'performance' ? 0.775 : 0.872) * BU_PERF[p.bu] * rng.normal(1, 0.015)),
        scrap: (chronic === 'quality' ? 0.06 : 0.021) * rng.lognormal(1, 0.2),
        rework: (chronic === 'quality' ? 0.032 : 0.012) * rng.lognormal(1, 0.2),
        leads: [],
      });
    }
  });

  // ---- Operators (2,000 standing in for 14,600 employees)
  const operators: Operator[] = [];
  const liveLines = lines.filter((l) => l.status === 'Active');
  const byLine = new Map<number, Operator[]>();
  for (let i = 0; i < VOLUMES.operators; i++) {
    const line = rng.pick(liveLines);
    const p = person(rng, i, 'forgepoint.example');
    const roleRoll = rng.float();
    const role = roleRoll < 0.72 ? 'Operator' : roleRoll < 0.86 ? 'Technician' : 'Inspector';
    const hasHistory = rng.chance(0.08);
    const status = rng.chance(0.025) ? 'Terminated' : rng.chance(0.02) ? 'Leave' : 'Active';
    const op: Operator = {
      key: i + 1, id: `E${pad(104000 + i * 7 + rng.int(0, 6), 6)}`, first: p.first, last: p.last, email: p.email,
      plantCode: line.plantCode, plantName: line.plantName, bu: line.bu, buCode: line.buCode, lineKey: line.key, lineId: line.id,
      role, certLevel: rng.weighted([1, 2, 3], [0.35, 0.45, 0.2]), hireDate: addDays('2008-01-01', rng.int(0, 6600)), status,
      priorRole: hasHistory ? 'Operator' : undefined, changedOn: hasHistory ? addDays('2025-01-01', rng.int(0, 600)) : undefined,
    };
    operators.push(op);
    byLine.set(line.key, [...(byLine.get(line.key) ?? []), op]);
  }
  for (const l of liveLines) {
    const crew = (byLine.get(l.key) ?? []).filter((o) => o.status === 'Active');
    for (let s = 0; s < 3; s++) {
      const lead = crew[s % Math.max(1, crew.length)] ?? operators[l.key];
      lead.role = 'Shift lead';
      l.leads.push(lead.key);
    }
  }

  // ---- Assets (4 per line)
  const assets: Asset[] = [];
  for (const l of lines) {
    const types = rng.shuffle([...ASSET_TYPES[l.buCode]]).slice(0, 4);
    types.forEach((t, i) => {
      assets.push({ key: assets.length + 1, id: `${l.id}-A${i + 1}`, lineKey: l.key, lineId: l.id, plantCode: l.plantCode, bu: l.bu, type: t, criticality: i === 0 ? 'A' : i < 3 ? 'B' : 'C', installYear: rng.int(2004, 2024) });
    });
  }
  const assetsByLine = new Map<number, Asset[]>();
  for (const a of assets) assetsByLine.set(a.lineKey, [...(assetsByLine.get(a.lineKey) ?? []), a]);

  // ---- Production at line × shift grain, Q2–Q3 2026, plus corrective work orders and inspection lots
  const days = dateRange(WINDOW_START, AS_OF);
  const production: Production[] = [];
  const maint: MaintEvent[] = [];
  const lots: Lot[] = [];
  let woNo = 7_310_000;
  for (const l of lines) {
    if (l.status === 'Decommissioned') continue;
    const crew = byLine.get(l.key) ?? [];
    const inc = INCIDENTS[l.id];
    for (const date of days) {
      if (l.idleFrom && date >= l.idleFrom) break;
      const dow = toDate(date).getUTCDay();
      const shifts = dow === 0 ? 0 : dow === 6 ? (l.shifts === 3 ? 1 : 0) : l.shifts;
      const incident = inc && inc.days.includes(date) ? inc.kind : undefined;
      for (let s = 1; s <= shifts; s++) {
        const plannedDown = 30 + (rng.chance(0.3) ? rng.int(20, 60) : 0);
        const planned = 480 - plannedDown;
        let breakdown = rng.chance(l.bdProb) ? Math.min(planned * 0.8, rng.lognormal(150, 0.6)) : 0;
        if (incident === 'breakdown') breakdown = planned * rng.range(0.78, 0.9);
        const other = Math.min(planned * 0.5, rng.lognormal(l.otherMed, 0.7));
        const unplanned = Math.round(breakdown + other);
        const run = planned - unplanned;
        const perf = Math.min(0.99, Math.max(0.5, (incident === 'speed' ? 0.7 : l.perf) * rng.normal(1, 0.025)));
        const total = Math.floor(((run * 60) / l.idealCycleSec) * perf);
        const scrapRate = (incident === 'quality' ? 0.19 : l.scrap * (date >= '2026-07-01' ? 0.92 : 1)) * rng.lognormal(1, 0.3);
        const reworkRate = l.rework * rng.lognormal(1, 0.3);
        const scrap = Math.round(total * scrapRate);
        const rework = Math.round(total * reworkRate);
        const topReason = breakdown > other ? 'Breakdown' : rng.weighted(OTHER_DOWNTIME, OTHER_DOWNTIME_WEIGHTS);
        const lead = rng.chance(0.08) && crew.length ? rng.pick(crew).key : l.leads[s - 1];
        production.push({
          key: production.length + 1, date, lineKey: l.key, lineId: l.id, plantCode: l.plantCode, plantName: l.plantName, bu: l.bu, shift: s, leadKey: lead,
          plannedMin: planned, plannedDownMin: plannedDown, unplannedMin: unplanned, breakdownMin: Math.round(breakdown), runMin: run,
          minorStopMin: Math.round(run * (1 - perf) * 0.55), idealCycleSec: l.idealCycleSec, total, good: total - scrap - rework, scrap, rework,
          idealMin: (total * l.idealCycleSec) / 60, topReason, energyKwh: round((run / 60) * l.kwRun * rng.range(0.92, 1.08) + ((planned - run) / 60) * l.kwIdle, 1),
        });
        if (breakdown > 0) {
          const la = assetsByLine.get(l.key)!;
          const a = rng.weighted(la, la.map((x) => (x.criticality === 'A' ? 3 : x.criticality === 'B' ? 2 : 1)));
          woNo += rng.int(1, 4);
          maint.push({ key: 0, wo: `WO-${woNo}`, assetKey: a.key, assetId: a.id, lineKey: l.key, lineId: l.id, plantCode: l.plantCode, bu: l.bu, date, kind: 'Corrective', hours: round(breakdown / 60, 2), cause: rng.pick(FAILURE_CAUSES) });
        }
        if (rng.chance(VOLUMES.lotInspectProb)) {
          const inspected = rng.int(32, 200);
          const expected = inspected * (scrapRate + reworkRate) * 0.045;
          const defects = Math.floor(expected) + (rng.chance(expected % 1) ? 1 : 0);
          const passedFirst = defects === 0 || !rng.chance(0.42);
          const disposition = passedFirst ? 'Accept' : rng.weighted(['Rework', 'Scrap', 'Use as is'], [0.55, 0.3, 0.15]);
          const costF = l.buCode === 'AC' ? 3.2 : l.buCode === 'FP' ? 1.2 : 1;
          lots.push({
            key: lots.length + 1, lotId: `LOT-${date.replace(/-/g, '').slice(2)}-${l.id.replace('-', '')}-${s}`, date, lineKey: l.key, lineId: l.id, plantCode: l.plantCode, bu: l.bu,
            operatorKey: lead, family: l.family, lotQty: Math.max(inspected, Math.round(total * rng.range(0.3, 0.6))), inspected, defects, passedFirst,
            defectCode: defects > 0 ? rng.weighted(DEFECT_CODES, DEFECT_WEIGHTS) : null, disposition, ncr: passedFirst ? null : `NCR-26-${pad(lots.length + 1, 5)}`,
            copq: passedFirst ? 0 : round((disposition === 'Scrap' ? rng.lognormal(5200, 0.5) : disposition === 'Rework' ? rng.lognormal(1600, 0.5) : 420) * costF, 2),
          });
        }
      }
    }
  }

  production.sort((a, b) => (a.date === b.date ? a.lineKey - b.lineKey || a.shift - b.shift : a.date < b.date ? -1 : 1));
  production.forEach((p, i) => (p.key = i + 1));
  lots.sort((a, b) => (a.date === b.date ? a.lineKey - b.lineKey : a.date < b.date ? -1 : 1));
  lots.forEach((l, i) => (l.key = i + 1));

  // ---- Preventive work orders (every 6–9 days per asset, inside planned downtime)
  for (const a of assets) {
    const l = lines[a.lineKey - 1];
    if (l.status === 'Decommissioned') continue;
    for (let d = addDays(WINDOW_START, rng.int(0, 6)); d <= AS_OF; d = addDays(d, rng.int(6, 9))) {
      if (l.idleFrom && d >= l.idleFrom) break;
      woNo += rng.int(1, 4);
      maint.push({ key: 0, wo: `WO-${woNo}`, assetKey: a.key, assetId: a.id, lineKey: l.key, lineId: l.id, plantCode: l.plantCode, bu: l.bu, date: d, kind: 'Preventive', hours: round(rng.range(1, 3.5), 2), cause: a.criticality === 'A' ? 'Condition-based PM' : 'Calendar PM' });
    }
  }
  maint.sort((a, b) => (a.date === b.date ? a.wo.localeCompare(b.wo) : a.date < b.date ? -1 : 1));
  maint.forEach((m, i) => (m.key = i + 1));

  // ---- Customers and order lines (6,000 standing in for 61,200 lines)
  const customers: Customer[] = Array.from({ length: VOLUMES.customers }, (_, i) => {
    const p = person(rng, i + 5000);
    const name = `${CUSTOMER_PREFIX[i % CUSTOMER_PREFIX.length]} ${CUSTOMER_SUFFIX[(i * 7) % CUSTOMER_SUFFIX.length]}`;
    const dom = name.toLowerCase().replace(/[^a-z]+/g, '');
    return { key: i + 1, id: `C${pad(30100 + i * 3, 6)}`, name, contact: `${p.first} ${p.last}`, contactEmail: `${p.first.toLowerCase()}.${p.last.toLowerCase()}@${dom}.example`, buCode: rng.weighted(['MS', 'FP', 'IC', 'AC'], [0.32, 0.28, 0.27, 0.13]) };
  });
  const custByBu = new Map<string, Customer[]>();
  for (const c of customers) custByBu.set(c.buCode, [...(custByBu.get(c.buCode) ?? []), c]);
  const orderDays = dateRange('2026-02-20', '2026-09-28');
  const orders: Order[] = [];
  let soNo = 5_402_100;
  while (orders.length < VOLUMES.orderLines) {
    const buCode = rng.weighted(['MS', 'FP', 'IC', 'AC'], [0.32, 0.28, 0.27, 0.13]);
    const c = rng.pick(custByBu.get(buCode)!);
    const orderDate = rng.pick(orderDays);
    soNo += rng.int(1, 6);
    const nLines = rng.int(1, 3);
    for (let ln = 1; ln <= nLines && orders.length < VOLUMES.orderLines; ln++) {
      const fam = rng.pick(PRODUCT_FAMILIES[buCode]);
      const plant = rng.pick(PLANTS.filter((p) => p.bu === buCode));
      const promised = addDays(orderDate, Math.round(fam.quoteDays * rng.range(0.8, 1.2)));
      const late = rng.chance(LATE_PROB[buCode]);
      const delivered = late ? addDays(promised, rng.int(1, 12)) : addDays(promised, -rng.int(0, 5));
      const open = delivered > AS_OF;
      const qty = buCode === 'AC' ? rng.int(2, 40) : Math.max(5, Math.round(rng.lognormal(60, 0.8)));
      const inFull = rng.chance(0.972);
      orders.push({
        key: orders.length + 1, orderNo: `SO-${soNo}`, lineNo: ln * 10, customerKey: c.key, customer: c.name, contactEmail: c.contactEmail,
        bu: BU_CODE_TO_NAME[buCode], plantCode: plant.code, family: fam.family, qty, shippedQty: open ? 0 : inFull ? qty : Math.floor(qty * rng.range(0.6, 0.95)),
        orderDate, promised, delivered: open ? null : delivered, onTime: open ? null : !late, inFull, leadDays: open ? null : Math.round((toDate(delivered).getTime() - toDate(orderDate).getTime()) / 86_400_000),
        value: round(qty * fam.unitPrice * rng.range(0.94, 1.04), 2), unitCost: fam.unitCost, status: open ? 'Open' : 'Delivered',
      });
    }
  }

  // ---- Suppliers and inbound receipts (exact per-supplier OTIF via deterministic shuffles)
  const suppliers: Supplier[] = SUPPLIERS.map((s, i) => ({ key: i + 1, id: `V${pad(20410 + i * 13, 6)}`, name: s.name, category: s.category, country: s.country, preferred: s.otif >= 0.92 }));
  const recDays = dateRange(WINDOW_START, AS_OF);
  const receipts: Receipt[] = [];
  for (let i = 0; i < VOLUMES.receipts; i++) {
    const si = rng.weighted(SUPPLIERS.map((_, k) => k), [1.2, 1, 1.1, 0.9, 1.3, 0.5, 0.8, 1, 1.2, 0.9]);
    const s = SUPPLIERS[si];
    const plant = rng.pick(PLANTS);
    const promised = rng.pick(recDays);
    const qty = s.category === 'Aerospace alloys' ? rng.int(20, 400) : rng.int(200, 5000);
    receipts.push({
      key: i + 1, asn: `ASN-${pad(880000 + i * 3, 7)}`, supplierKey: si + 1, supplier: s.name, category: s.category, plantCode: plant.code, bu: BU_CODE_TO_NAME[plant.bu],
      poDate: addDays(promised, -Math.round(s.lead * rng.range(0.8, 1.2))), promised, received: promised, qty, rejected: 0, onTime: true, inFull: true, otif: true, leadDays: 0,
    });
  }
  SUPPLIERS.forEach((s, si) => {
    const mine = receipts.filter((r) => r.supplierKey === si + 1);
    const bad = new Set(rng.shuffle([...mine]).slice(0, Math.round(mine.length * (1 - s.otif))));
    for (const r of mine) {
      if (bad.has(r)) {
        r.otif = false;
        if (rng.chance(0.8)) { r.onTime = false; r.received = addDays(r.promised, rng.int(1, 9)); } else { r.inFull = false; r.received = addDays(r.promised, -rng.int(0, 2)); }
      } else r.received = addDays(r.promised, -rng.int(0, 3));
      const exp = (r.qty * s.ppm) / 1e6 * rng.lognormal(1, 0.6);
      r.rejected = Math.floor(exp) + (rng.chance(exp % 1) ? 1 : 0);
      r.leadDays = Math.round((toDate(r.received).getTime() - toDate(r.poDate).getTime()) / 86_400_000);
    }
  });

  return {
    plants, lines, operators, production, assets, maint, lots, customers, orders, suppliers, receipts,
    headcountScale: HEADCOUNT_TOTAL / VOLUMES.operators, orderScale: ORDER_LINES_TOTAL / VOLUMES.orderLines,
  };
}

export const LAST_WEEK_RANGE = LAST_WEEK;
