// Crestview Health System synthetic data (spec section 6). Generated once per pack load from a seeded PRNG,
// so every demo run shows the same numbers and the agents always agree with the Explorer.
import { Rng } from '../../mock-snowflake/rng';
import { dateRange, pad, person, round, sum } from '../../mock-snowflake/generators';
import {
  AS_OF, CARE_GAP_MEASURES, CLINIC_SPECIALTIES, DENIAL_REASONS, DENIAL_WEIGHTS, DRUGS, HOSPITALS, MARKETS, PAYERS, PRODUCTION,
  SERVICE_LINES, SUPPLY_ITEMS, TARGETS, VENDOR_CONTRACT, VOLUMES, type ServiceLineName,
} from './generators.config';
import { addDaysFast as addDays, dayNum, daysBetween, readmitFlags } from './queries';

export type Disposition = 'Home' | 'Home health' | 'Skilled nursing' | 'Transfer to acute' | 'Left AMA' | 'Expired' | 'In house';

export interface Hospital { key: number; code: string; name: string; market: string; city: string; trauma: string; beds: number; weight: number; losF: number; edF: number; targetOcc: number }
export interface Clinic { key: number; id: string; name: string; specialty: string; market: string; hospitalCode: string; noShow: number; lag: number }
export interface Payer { key: number; id: string; name: string; payerClass: string; clean: number; denial: number; lag: number; ratio: number }
export interface Patient {
  key: number; mrn: string; first: string; last: string; dob: string; age: number; sex: 'F' | 'M'; email: string; zip: string; city: string;
  market: string; marketCode: string; homeHospital: string; payerKey: number; portal: boolean; risk: number;
  diabetic: boolean; cvd: boolean; htn: boolean; engaged: boolean; deathDate?: string; pcpClinicKey: number;
  priorPayerKey?: number; effectiveFrom: string; changedOn?: string;
}
export interface Stay {
  key: number; id: string; patientKey: number; hospitalCode: string; market: string; serviceLine: ServiceLineName;
  admit: string; discharge: string; los: number; inHouse: boolean; disposition: Disposition; planned: boolean; surgical: boolean;
  payerKey: number; gen: 'index' | 'readmit' | 'planned';
}
export interface EdVisit { key: number; id: string; patientKey: number; hospitalCode: string; market: string; date: string; arrivalMin: number; waitMin: number | null; lwbs: boolean; esi: number; admitted: boolean }
export interface Appointment {
  key: number; id: string; patientKey: number; clinicKey: number; market: string; specialty: string; date: string; booked: string; lag: number;
  type: 'New' | 'Established'; status: 'Completed' | 'No-show' | 'Cancelled'; postDischarge: boolean;
}
export interface Claim {
  key: number; id: string; encType: 'IP' | 'ED' | 'OP'; encId: string; patientKey: number; payerKey: number; market: string; facilityCode: string;
  serviceDate: string; submitDate: string; clean: boolean; denied: boolean; denialReason: string | null; charges: number; expected: number;
  paid: number; resolvedDate: string; writeOff: boolean;
}
export interface SupplyLine {
  key: number; id: string; stayKey: number; encId: string; patientKey: number; mrn: string; hospitalCode: string; market: string; serviceLine: string;
  date: string; itemType: 'Supply' | 'Pharmacy'; itemId: string; desc: string; category: string; vendor: string; qty: number; unitCost: number; cost: number;
  onContract: boolean; surgical: boolean;
}
export interface CareGap { key: number; patientKey: number; measure: string; status: 'Open' | 'Closed'; market: string; clinicKey: number; dueDate: string }

export interface HcData {
  hospitals: Hospital[];
  clinics: Clinic[];
  payers: Payer[];
  patients: Patient[];
  stays: Stay[];
  ed: EdVisit[];
  appts: Appointment[];
  claims: Claim[];
  supply: SupplyLine[];
  gaps: CareGap[];
  scale: { patients: number; ip: number; ed: number; appt: number; claims: number };
}

const SEASON = [1.12, 1.1, 1.02, 0.97, 0.95, 0.93, 0.94, 0.95, 0.97, 1.0, 1.03, 1.1];
const monthIdx = (d: string) => Number(d.slice(5, 7)) - 1;
const dow = (d: string) => (((dayNum(d) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
const isWeekend = (d: string) => { const w = dow(d); return w === 0 || w === 6; };

function picker<T>(rng: Rng, items: readonly T[], weights: readonly number[]): () => T {
  const pre: number[] = [];
  let acc = 0;
  for (const w of weights) pre.push((acc += w));
  return () => {
    const r = rng.float() * acc;
    let lo = 0;
    let hi = pre.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pre[mid] > r) hi = mid;
      else lo = mid + 1;
    }
    return items[lo];
  };
}

function poisson(rng: Rng, lam: number): number {
  const L = Math.exp(-lam);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.float();
  } while (p > L);
  return k - 1;
}

export function generateHealthcare(seed: number): HcData {
  const rng = new Rng(seed);

  // ---- Facilities, clinics, payers
  const hospitals: Hospital[] = HOSPITALS.map((h, i) => ({ key: i + 1, code: h.code, name: h.name, market: h.market, city: h.city, trauma: h.trauma, beds: 0, weight: h.weight, losF: h.losF, edF: h.edF, targetOcc: h.targetOcc }));
  const hospByCode = new Map(hospitals.map((h) => [h.code, h]));
  const clinics: Clinic[] = [];
  const nameCount = new Map<string, number>();
  for (let i = 0; i < VOLUMES.clinics; i++) {
    const m = rng.weighted(MARKETS, MARKETS.map((x) => x.weight));
    const spec = rng.weighted(CLINIC_SPECIALTIES, CLINIC_SPECIALTIES.map((s) => s.weight));
    const town = rng.pick(m.towns);
    const base = `Crestview ${spec.name} – ${town}`;
    const n = (nameCount.get(base) ?? 0) + 1;
    nameCount.set(base, n);
    const hs = hospitals.filter((h) => h.market === m.name);
    clinics.push({
      key: i + 1, id: `CLN-${pad(101 + i, 3)}`, name: n > 1 ? `${base} ${n}` : base, specialty: spec.name, market: m.name,
      hospitalCode: rng.pick(hs).code, noShow: spec.noShow * rng.lognormal(1, 0.28), lag: spec.lag * rng.lognormal(1, 0.3),
    });
  }
  const payers: Payer[] = PAYERS.map((p, i) => ({ key: i + 1, ...p }));
  const payerById = new Map(payers.map((p) => [p.id, p]));

  // ---- Patients (2,000 standing in for 1.24 M)
  const patients: Patient[] = [];
  const AGE_GROUPS = [{ lo: 0, hi: 17, w: 0.18, risk: 0.45 }, { lo: 18, hi: 44, w: 0.32, risk: 0.6 }, { lo: 45, hi: 64, w: 0.27, risk: 1.0 }, { lo: 65, hi: 92, w: 0.23, risk: 1.35 }];
  for (let i = 0; i < VOLUMES.patients; i++) {
    const g = rng.weighted(AGE_GROUPS, AGE_GROUPS.map((x) => x.w));
    const age = rng.int(g.lo, g.hi);
    const sex: 'F' | 'M' = rng.chance(0.52) ? 'F' : 'M';
    const m = rng.weighted(MARKETS, MARKETS.map((x) => x.weight));
    const hs = HOSPITALS.filter((h) => h.market === m.name);
    const home = rng.weighted(hs, hs.map((h) => h.weight));
    const p = person(rng, i);
    const payerId = age >= 65
      ? rng.weighted(['MCR-01', 'MCR-02', 'COM-01', 'SELF'], [0.48, 0.4, 0.1, 0.02])
      : age < 18
        ? rng.weighted(['MCD-01', 'MCD-02', 'COM-01', 'COM-02', 'COM-03', 'SELF'], [0.16, 0.24, 0.22, 0.18, 0.17, 0.03])
        : rng.weighted(['MCD-01', 'MCD-02', 'COM-01', 'COM-02', 'COM-03', 'SELF'], [0.1, 0.16, 0.24, 0.2, 0.22, 0.08]);
    const risk = Math.min(6, Math.max(0.15, round(rng.lognormal(g.risk, 0.45), 2)));
    const pcpSpec = age < 18 ? 'Pediatrics' : 'Primary Care';
    const pcps = clinics.filter((c) => c.market === m.name && c.specialty === pcpSpec);
    const pcp = pcps.length ? rng.pick(pcps) : rng.pick(clinics.filter((c) => c.market === m.name && c.specialty === 'Primary Care'));
    const dob = addDays(AS_OF, -(age * 365 + rng.int(0, 364)));
    const hasHistory = rng.chance(0.09);
    const payerKey = payerById.get(payerId)!.key;
    patients.push({
      key: i + 1, mrn: `CV${pad(10_400_000 + i * 37 + rng.int(0, 30), 8)}`, first: p.first, last: p.last, dob, age, sex, email: p.email,
      zip: `${{ North: '481', Central: '482', Coastal: '483', Valley: '484' }[m.name]}${pad(rng.int(1, 99), 2)}`, city: home.city,
      market: m.name, marketCode: m.code, homeHospital: home.code, payerKey,
      portal: rng.chance(age < 18 ? 0.55 : age < 45 ? 0.72 : age < 65 ? 0.66 : 0.5), risk,
      diabetic: rng.chance(Math.min(0.5, 0.03 + 0.12 * risk) * (age >= 18 ? 1 : 0.1)), cvd: age >= 45 && rng.chance(Math.min(0.5, 0.02 + 0.09 * risk)),
      htn: age >= 18 && rng.chance(Math.min(0.6, 0.08 + 0.17 * risk)), engaged: rng.chance(0.86), pcpClinicKey: pcp.key,
      priorPayerKey: hasHistory ? (payerKey === 1 ? 5 : payerKey === 2 ? 1 : payerKey === 4 ? 3 : payerKey === 5 ? 6 : payerKey) : undefined,
      effectiveFrom: hasHistory ? addDays('2024-06-01', rng.int(0, 600)) : addDays('2014-01-01', rng.int(0, 3600)),
    });
    if (hasHistory) patients[i].changedOn = patients[i].effectiveFrom;
  }
  const payerOf = (p: Patient) => payers[p.payerKey - 1];

  // ---- Inpatient stays: index admissions, unplanned readmissions and planned readmissions (2025-01-01 .. as of)
  const ipDays = dateRange('2025-01-01', AS_OF);
  const pickIpDay = picker(rng, ipDays, ipDays.map((d) => SEASON[monthIdx(d)]));
  let tmpKey = 0;
  const raw: Stay[] = [];
  const makeStay = (p: Patient, admit: string, sl: (typeof SERVICE_LINES)[number], hospitalCode: string, gen: Stay['gen'], planned: boolean): Stay => {
    const h = hospByCode.get(hospitalCode)!;
    const los = Math.max(1, Math.round(rng.lognormal(sl.los * 0.92 * h.losF * (admit >= '2026-01-01' ? 0.965 : 1), 0.42)));
    const discharge = addDays(admit, los);
    const inHouse = discharge > AS_OF;
    const r = rng.float();
    const mort = sl.mort * (0.45 + 0.35 * p.risk);
    const snf = p.age >= 65 ? 0.16 : 0.04;
    const disposition: Disposition = inHouse ? 'In house'
      : r < mort ? 'Expired' : r < mort + 0.022 ? 'Transfer to acute' : r < mort + 0.034 ? 'Left AMA' : r < mort + 0.034 + snf ? 'Skilled nursing' : r < mort + 0.174 + snf ? 'Home health' : 'Home';
    return {
      key: ++tmpKey, id: '', patientKey: p.key, hospitalCode, market: h.market, serviceLine: sl.name, admit, discharge, los, inHouse, disposition,
      planned, surgical: rng.chance(sl.surgical), payerKey: p.payerKey, gen,
    };
  };
  for (const p of patients) {
    const ageF = p.age < 18 ? 0.45 : p.age < 45 ? 0.8 : p.age < 65 ? 1.0 : 1.2;
    const n = poisson(rng, 2.1 * p.risk * ageF);
    const mine: Stay[] = [];
    for (let k = 0; k < n; k++) {
      const admit = pickIpDay();
      if (!p.engaged && admit >= '2025-10-01') continue;
      const womens = p.sex === 'F' && p.age >= 18 && p.age <= 45;
      const sl = rng.weighted(SERVICE_LINES, SERVICE_LINES.map((s) => (s.name === "Women's & Infants" ? (womens ? s.weight * 4 : 0) : s.weight)));
      const home = hospByCode.get(p.homeHospital)!;
      const others = hospitals.filter((h) => h.market === p.market && h.code !== home.code);
      const hospitalCode = rng.chance(0.8) ? home.code : home.code !== 'RMC' && rng.chance(0.5) ? 'RMC' : rng.pick(others).code;
      const s = makeStay(p, admit, sl, hospitalCode, 'index', rng.chance(sl.planned));
      mine.push(s);
      const eligible = !['Expired', 'Transfer to acute', 'Left AMA', 'In house'].includes(s.disposition);
      const yearF = s.discharge < '2026-01-01' ? 1.06 : 0.97;
      if (eligible && rng.chance(Math.min(0.6, sl.readmit * (0.55 + 0.45 * p.risk) * 1.3 * yearF))) {
        const gap = 1 + Math.floor(29 * rng.float() ** 1.5);
        const admit2 = addDays(s.discharge, gap);
        if (admit2 <= AS_OF) {
          const sl2 = rng.chance(0.55) ? sl : rng.weighted(SERVICE_LINES.filter((x) => ['GMED', 'CARD', 'PULM', 'NEUR'].includes(x.code)), [0.4, 0.25, 0.25, 0.1]);
          mine.push(makeStay(p, admit2, sl2, rng.chance(0.85) ? s.hospitalCode : home.code, 'readmit', false));
        }
      }
      if (eligible && ['ONC', 'GSUR', 'CARD'].includes(sl.code) && rng.chance(0.05)) {
        const admit3 = addDays(s.discharge, rng.int(7, 28));
        if (admit3 <= AS_OF) mine.push(makeStay(p, admit3, sl, s.hospitalCode, 'planned', true));
      }
    }
    // No overlapping stays; nothing after an in-hospital death.
    mine.sort((a, b) => (a.admit < b.admit ? -1 : a.admit > b.admit ? 1 : 0));
    let lastDis = '';
    for (const s of mine) {
      if (lastDis && s.admit <= lastDis) continue;
      // Unrelated admissions rarely fall inside a prior stay's 30-day window; keep most readmissions explicit.
      if (lastDis && s.gen === 'index' && daysBetween(lastDis, s.admit) <= 30 && rng.chance(0.9)) continue;
      if (p.deathDate) break;
      raw.push(s);
      lastDis = s.discharge;
      if (s.disposition === 'Expired') p.deathDate = s.discharge;
    }
  }
  calibrateReadmissions(raw, rng);
  raw.sort((a, b) => (a.admit === b.admit ? a.patientKey - b.patientKey : a.admit < b.admit ? -1 : 1));
  const stays: Stay[] = raw.map((s, i) => ({ ...s, key: i + 1, id: `IP${s.admit.replace(/-/g, '').slice(2)}-${pad(i + 1, 5)}` }));

  // ---- ED visits (2025-01-01 .. as of)
  const pickEdDay = picker(rng, ipDays, ipDays.map((d) => SEASON[monthIdx(d)] * (isWeekend(d) ? 1.06 : 1)));
  const pickPatient = picker(rng, patients, patients.map((p) => p.risk * (p.age < 18 ? 0.8 : 1)));
  const edRaw: Omit<EdVisit, 'key' | 'id'>[] = [];
  const ESI = [1, 2, 3, 4, 5];
  const ESI_F = [0.15, 0.45, 1, 1.05, 0.95];
  while (edRaw.length < VOLUMES.edVisits) {
    const date = pickEdDay();
    let p = pickPatient();
    for (let t = 0; t < 5 && ((!p.engaged && date >= '2025-10-01') || (p.deathDate && date > p.deathDate)); t++) p = pickPatient();
    if ((!p.engaged && date >= '2025-10-01') || (p.deathDate && date > p.deathDate)) continue;
    const home = hospByCode.get(p.homeHospital)!;
    const hs = hospitals.filter((h) => h.market === p.market);
    const h = rng.chance(0.75) ? home : rng.weighted(hs, hs.map((x) => x.weight));
    const esi = rng.weighted(ESI, [0.01, 0.12, 0.45, 0.32, 0.1]);
    const wait = rng.lognormal(28 * h.edF * SEASON[monthIdx(date)] * (date >= '2026-01-01' ? 0.95 : 1) * ESI_F[esi - 1], 0.55);
    const lwbs = esi >= 3 && (wait > 65 ? rng.chance(0.45) : rng.chance(0.004));
    edRaw.push({
      patientKey: p.key, hospitalCode: h.code, market: h.market, date, arrivalMin: rng.int(0, 1439), waitMin: lwbs ? null : Math.max(2, Math.round(wait)), lwbs, esi,
      admitted: !lwbs && rng.chance(esi <= 2 ? 0.55 : esi === 3 ? 0.2 : 0.03),
    });
  }
  edRaw.sort((a, b) => (a.date === b.date ? a.arrivalMin - b.arrivalMin : a.date < b.date ? -1 : 1));
  const ed: EdVisit[] = edRaw.map((v, i) => ({ ...v, key: i + 1, id: `ED${v.date.replace(/-/g, '').slice(2)}-${pad(i + 1, 5)}` }));

  // ---- Clinic appointments (Oct 2025 – Sep 2026) plus post-discharge follow-ups
  const apptDays = dateRange('2025-10-01', AS_OF).filter((d) => !isWeekend(d));
  const engaged = patients.filter((p) => p.engaged);
  const pickApptPatient = picker(rng, engaged, engaged.map((p) => 0.5 + 0.5 * p.risk));
  const clinicsByMarket = new Map<string, Clinic[]>(MARKETS.map((m) => [m.name, clinics.filter((c) => c.market === m.name && c.specialty !== 'Primary Care' && c.specialty !== 'Pediatrics')]));
  const payerF = (p: Patient) => ({ Medicaid: 1.45, 'Self-pay': 1.35 } as Record<string, number>)[payerOf(p).payerClass] ?? 0.9;
  const apRaw: Omit<Appointment, 'key' | 'id'>[] = [];
  while (apRaw.length < VOLUMES.appointments) {
    const date = rng.pick(apptDays);
    const p = pickApptPatient();
    if (p.deathDate && date > p.deathDate) continue;
    const pcp = clinics[p.pcpClinicKey - 1];
    const c = rng.chance(0.55) ? pcp : rng.pick(clinicsByMarket.get(p.market)!);
    const isNew = rng.chance(c === pcp ? 0.08 : 0.3);
    const lag = Math.max(0, Math.round(rng.lognormal(c.lag * (isNew ? 1 : 0.65), 0.55)));
    const r = rng.float();
    const ns = c.noShow * payerF(p) * (lag > 30 ? 1.25 : 1);
    apRaw.push({
      patientKey: p.key, clinicKey: c.key, market: c.market, specialty: c.specialty, date, booked: addDays(date, -lag), lag,
      type: isNew ? 'New' : 'Established', status: r < ns ? 'No-show' : r < ns + 0.07 ? 'Cancelled' : 'Completed', postDischarge: false,
    });
  }
  for (const s of stays) {
    if (s.inHouse || s.discharge < '2025-09-20' || !['Home', 'Home health'].includes(s.disposition)) continue;
    const p = patients[s.patientKey - 1];
    if (!p.engaged) continue;
    const pf = 0.6 * (({ Medicaid: 0.82, 'Self-pay': 0.7 } as Record<string, number>)[payerOf(p).payerClass] ?? 1);
    let gap = 0;
    if (rng.chance(pf)) gap = rng.int(2, 7);
    else if (rng.chance(0.35)) gap = rng.int(8, 21);
    if (!gap) continue;
    let date = addDays(s.discharge, gap);
    if (isWeekend(date)) date = addDays(date, dow(date) === 6 ? -1 : 1);
    if (date > AS_OF || date < '2025-10-01') continue;
    const c = clinics[p.pcpClinicKey - 1];
    apRaw.push({
      patientKey: p.key, clinicKey: c.key, market: c.market, specialty: c.specialty, date, booked: s.discharge, lag: daysBetween(s.discharge, date),
      type: 'Established', status: rng.chance(0.08) ? 'No-show' : 'Completed', postDischarge: true,
    });
  }
  apRaw.sort((a, b) => (a.date === b.date ? a.clinicKey - b.clinicKey : a.date < b.date ? -1 : 1));
  const appts: Appointment[] = apRaw.map((a, i) => ({ ...a, key: i + 1, id: `APT-${pad(7_200_000 + i * 3, 8)}` }));

  // ---- Claims (837) and remits (835) for services Oct 2025 – Sep 2026
  const claimRaw: Omit<Claim, 'key' | 'id'>[] = [];
  const addClaim = (encType: Claim['encType'], encId: string, p: Patient, market: string, facilityCode: string, serviceDate: string, charges: number) => {
    const payer = payerOf(p);
    const expected = round(charges * payer.ratio * rng.normal(1, 0.03), 2);
    let submitDate = addDays(serviceDate, Math.max(1, Math.round(rng.lognormal(encType === 'IP' ? 5 : 3, 0.4))));
    if (isWeekend(submitDate)) submitDate = addDays(submitDate, dow(submitDate) === 6 ? 2 : 1); // billing office batches on weekdays
    const self = payer.payerClass === 'Self-pay';
    const clean = rng.chance(payer.clean);
    const denied = !self && rng.chance(payer.denial * (clean ? 0.068 : 0.3) * (encType === 'IP' ? 1.1 : 1));
    let resolvedDate: string;
    let paid: number;
    let writeOff = false;
    if (self) {
      const bad = rng.chance(0.28);
      resolvedDate = addDays(submitDate, bad ? 200 + rng.int(0, 160) : Math.round(rng.lognormal(payer.lag, 0.45)));
      paid = bad ? round(expected * rng.range(0, 0.2), 2) : expected;
      writeOff = bad;
    } else if (!denied) {
      // ~3% of payable claims pend for medical records or coordination of benefits and pay late.
      resolvedDate = addDays(submitDate, Math.max(5, Math.round(rng.lognormal(payer.lag * (clean ? 1 : 1.25) * (rng.chance(0.03) ? 3.5 : 1), 0.35))));
      paid = round(expected * Math.min(1.02, rng.normal(0.992, 0.015)), 2);
    } else if (rng.chance(0.75)) {
      resolvedDate = addDays(submitDate, Math.round(rng.lognormal(payer.lag, 0.35)) + Math.round(rng.lognormal(70, 0.45)));
      paid = round(expected * Math.min(1, rng.normal(0.97, 0.03)), 2);
    } else {
      resolvedDate = addDays(submitDate, 120 + rng.int(0, 180));
      paid = 0;
      writeOff = true;
    }
    claimRaw.push({
      encType, encId, patientKey: p.key, payerKey: payer.key, market, facilityCode, serviceDate, submitDate, clean, denied,
      denialReason: denied ? rng.weighted(DENIAL_REASONS, DENIAL_WEIGHTS) : null, charges: round(charges, 2), expected, paid, resolvedDate, writeOff,
    });
  };
  for (const s of stays) {
    if (s.inHouse || s.discharge < '2025-10-01') continue;
    addClaim('IP', s.id, patients[s.patientKey - 1], s.market, s.hospitalCode, s.discharge, rng.lognormal(36_000 * (s.surgical ? 1.6 : 1) * (s.los / 4.5) ** 0.6, 0.35));
  }
  for (const v of ed) {
    if (v.lwbs || v.date < '2025-10-01') continue;
    addClaim('ED', v.id, patients[v.patientKey - 1], v.market, v.hospitalCode, v.date, rng.lognormal(2900 * [3.2, 2.1, 1.2, 0.7, 0.45][v.esi - 1], 0.4));
  }
  for (const a of appts) {
    if (a.status !== 'Completed') continue;
    addClaim('OP', a.id, patients[a.patientKey - 1], a.market, clinics[a.clinicKey - 1].id, a.date, rng.lognormal(a.type === 'New' ? 340 : 240, 0.35));
  }
  claimRaw.sort((a, b) => (a.submitDate === b.submitDate ? a.patientKey - b.patientKey : a.submitDate < b.submitDate ? -1 : 1));
  const claims: Claim[] = claimRaw.map((c, i) => ({ ...c, key: i + 1, id: `CLM${c.submitDate.replace(/-/g, '').slice(2)}${pad(i + 1, 6)}` }));

  // ---- Point-of-use supply capture and pharmacy dispenses for stays discharged Oct 2025 – Sep 2026
  const supplyRaw: Omit<SupplyLine, 'key' | 'id'>[] = [];
  const item = (id: string) => SUPPLY_ITEMS.find((x) => x.id === id)!;
  for (const s of stays) {
    if (s.inHouse || s.discharge < '2025-10-01') continue;
    const p = patients[s.patientKey - 1];
    const date = addDays(s.admit, Math.floor(s.los / 2));
    const base = { stayKey: s.key, encId: s.id, patientKey: p.key, mrn: p.mrn, hospitalCode: s.hospitalCode, market: s.market, serviceLine: s.serviceLine, date, surgical: s.surgical };
    const add = (id: string, qty: number) => {
      const it = item(id);
      const unit = round(it.cost * rng.lognormal(1, 0.08), 2);
      supplyRaw.push({ ...base, itemType: 'Supply', itemId: it.id, desc: it.desc, category: it.category, vendor: it.vendor, qty, unitCost: unit, cost: round(unit * qty, 2), onContract: rng.chance(VENDOR_CONTRACT[it.vendor]) });
    };
    if (s.surgical) {
      const sl = s.serviceLine;
      if (sl === 'Orthopedics') { if (rng.chance(0.85)) add(rng.chance(0.55) ? 'IMP-4410' : 'IMP-4420', 1); else add('IMP-4470', 1); if (rng.chance(0.15)) add('MSR-1090', 1); }
      else if (sl === 'Cardiology') { add('CRD-2290', 1); add('CRD-2210', rng.int(1, 2)); }
      else if (sl === 'General Surgery') { add('SUR-3105', rng.int(1, 3)); if (rng.chance(0.35)) add('SUR-3140', 1); if (rng.chance(0.15)) add('MSR-1090', 1); }
      else if (sl === 'Neurosciences') { if (rng.chance(0.6)) add('IMP-4470', 1); else add('SUR-3105', 1); }
      else add('SUR-3105', rng.int(1, 2));
      add('SUR-3180', 1);
      add('MSR-1001', rng.int(1, 3));
    } else if (rng.chance(0.3)) add('MSR-1001', 1);
    add('MSR-1020', rng.int(1, 4));
    if (rng.chance(0.5)) add('MSR-1044', rng.int(1, 6));
    const nRx = rng.int(2, 5);
    for (let k = 0; k < nRx; k++) {
      const onc = s.serviceLine === 'Oncology' && k === 0 && rng.chance(0.5);
      const dr = onc ? DRUGS[5] : rng.pick(DRUGS.filter((x) => x.ndc !== DRUGS[5].ndc));
      const qty = onc ? 1 : rng.int(1, Math.min(10, s.los * 2));
      const unit = round(dr.cost * rng.lognormal(1, 0.05), 2);
      supplyRaw.push({ ...base, itemType: 'Pharmacy', itemId: dr.ndc, desc: dr.name, category: dr.formulary ? 'Formulary drugs' : 'Non-formulary drugs', vendor: dr.vendor, qty, unitCost: unit, cost: round(unit * qty, 2), onContract: rng.chance(VENDOR_CONTRACT[dr.vendor]) });
    }
  }
  calibrateSupply(supplyRaw, stays, rng);
  const supply: SupplyLine[] = supplyRaw.map((x, i) => ({ ...x, key: i + 1, id: `${x.itemType === 'Supply' ? 'SU' : 'RX'}-${pad(880_000 + i, 7)}` }));

  // ---- HEDIS-style care gaps for the attributed panel (measurement year 2026)
  const gaps: CareGap[] = [];
  const adj: Record<string, number> = { North: 0.02, Central: 0.03, Coastal: -0.03, Valley: -0.05 };
  for (const p of patients) {
    if (p.deathDate) continue;
    const elig: string[] = [];
    if (p.sex === 'F' && p.age >= 50 && p.age <= 74) elig.push(CARE_GAP_MEASURES[0]);
    if (p.age >= 45 && p.age <= 75) elig.push(CARE_GAP_MEASURES[1]);
    if (p.diabetic) elig.push(CARE_GAP_MEASURES[2]);
    if (p.cvd) elig.push(CARE_GAP_MEASURES[3]);
    if (p.htn) elig.push(CARE_GAP_MEASURES[4]);
    if (p.age >= 65) elig.push(CARE_GAP_MEASURES[5]);
    const closeP = Math.min(0.95, Math.max(0.15, 0.97 - 0.22 * p.risk + adj[p.market] + (p.engaged ? 0 : -0.3)));
    for (const measure of elig) {
      gaps.push({ key: gaps.length + 1, patientKey: p.key, measure, status: rng.chance(closeP) ? 'Closed' : 'Open', market: p.market, clinicKey: p.pcpClinicKey, dueDate: '2026-12-31' });
    }
  }

  // ---- Scale factors and staffed beds (sized so the average daily census in Q3 2026 sits near each hospital's target occupancy)
  const last12 = (d: string) => d >= '2025-10-01' && d <= AS_OF;
  const ipScale = PRODUCTION.ipDischargesPerYear / stays.filter((s) => !s.inHouse && last12(s.discharge)).length;
  const census = new Map<string, number>();
  for (const s of stays) {
    const from = s.admit > '2026-07-01' ? s.admit : '2026-07-01';
    const to = s.discharge < '2026-10-01' ? s.discharge : '2026-10-01';
    const nights = Math.max(0, daysBetween(from, to));
    if (nights) census.set(s.hospitalCode, (census.get(s.hospitalCode) ?? 0) + nights);
  }
  const days = daysBetween('2026-07-01', '2026-10-01');
  for (const h of hospitals) h.beds = Math.max(25, Math.round(((census.get(h.code) ?? 0) * ipScale) / days / h.targetOcc / rng.range(0.98, 1.02)));

  return {
    hospitals, clinics, payers, patients, stays, ed, appts, claims, supply, gaps,
    scale: {
      patients: PRODUCTION.patients / VOLUMES.patients,
      ip: ipScale,
      ed: PRODUCTION.edVisitsPerYear / ed.filter((v) => last12(v.date)).length,
      appt: PRODUCTION.appointmentsPerYear / appts.length,
      claims: PRODUCTION.claimsPerYear / claims.filter((c) => last12(c.submitDate)).length,
    },
  };
}

/** Remove a deterministic set of generated readmissions so the 30-day rate lands on target per year (spec: 13–16%). */
function calibrateReadmissions(stays: Stay[], rng: Rng) {
  const windows = [
    { year: '2025' as const, from: '2025-01-01', to: '2025-08-31' },
    { year: '2026' as const, from: '2026-01-01', to: '2026-08-31' },
  ];
  for (const w of windows) {
    const target = TARGETS.readmitRate[w.year];
    for (let pass = 0; pass < 25; pass++) {
      const flags = readmitFlags(stays);
      const byKey = new Map(stays.map((s) => [s.key, s]));
      const idx = stays.filter((s) => s.discharge >= w.from && s.discharge <= w.to && flags.get(s.key)!.eligible);
      const readmitted = idx.filter((s) => flags.get(s.key)!.readmit);
      const excess = readmitted.length - target * idx.length;
      if (excess < 1) break;
      const victims = new Set(rng.shuffle(readmitted.map((s) => flags.get(s.key)!.readmitKey!)
        .filter((k) => { const x = byKey.get(k)!; return x.gen === 'readmit' && x.disposition !== 'Expired'; })).slice(0, Math.max(1, Math.floor(excess * 0.8))));
      if (!victims.size) break;
      for (let i = stays.length - 1; i >= 0; i--) if (victims.has(stays[i].key)) stays.splice(i, 1);
    }
  }
}

/** Scale supply unit costs so supply cost per surgical case in Q3 2026 lands on target, then set the on-contract share. */
function calibrateSupply(lines: Omit<SupplyLine, 'key' | 'id'>[], stays: Stay[], rng: Rng) {
  const q3 = new Set(stays.filter((s) => s.surgical && !s.inHouse && s.discharge >= '2026-07-01' && s.discharge <= AS_OF).map((s) => s.key));
  const cost = sum(lines.filter((l) => l.itemType === 'Supply' && q3.has(l.stayKey)).map((l) => l.cost));
  const k = (TARGETS.supplyCostPerCase * q3.size) / cost;
  for (const l of lines) if (l.itemType === 'Supply') { l.unitCost = round(l.unitCost * k, 2); l.cost = round(l.unitCost * l.qty, 2); }
  const total = sum(lines.map((l) => l.cost));
  let on = sum(lines.filter((l) => l.onContract).map((l) => l.cost));
  for (const i of rng.shuffle(lines.map((_, j) => j))) {
    const share = on / total;
    if (Math.abs(share - TARGETS.onContractSupply) < 0.004) break;
    const l = lines[i];
    if (share < TARGETS.onContractSupply && !l.onContract && l.vendor !== 'Ridgeline Specialty Rx') { l.onContract = true; on += l.cost; }
    else if (share > TARGETS.onContractSupply && l.onContract && l.category !== 'Implants') { l.onContract = false; on -= l.cost; }
  }
}
