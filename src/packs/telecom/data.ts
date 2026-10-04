// Altair Communications synthetic data (spec section 6). Generated once per pack load from a seeded PRNG,
// so every demo run shows the same numbers and the agents always agree with the Explorer.
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, iso, pad, person, round, sum, toDate } from '../../mock-snowflake/generators';
import {
  ALARMS, AS_OF, DEVICES, MARKETS, MOVEMENT_RATES, PLANS, REGION_CHURN, SEGMENT_BASE, SITES_TOTAL, SUBSCRIBER_TOTAL, TARGETS,
  VENDORS, VOLUMES, WORK_ORDER_TYPES, type Segment,
} from './generators.config';

export interface Subscriber {
  key: number; id: string; accountNo: string; first: string; last: string; email: string; street: string; msisdn: string | null;
  marketCode: string; market: string; region: string; planCode: string; planName: string; segment: Segment; lob: 'Mobile' | 'Broadband';
  status: 'Active' | 'Disconnected'; disconnectReason?: 'Voluntary' | 'Port-out' | 'Involuntary'; dormant: boolean;
  activationDate: string; tenureMonths: number; contractEnd: string | null; outOfContract: boolean; autopay: boolean; churnPropensity: number;
  deviceModel: string | null; deviceTier: string | null; financed: boolean; lastMonthIdx: number;
  priorPlanCode?: string; planChangedOn?: string;
}
export interface Invoice {
  key: number; id: string; subKey: number; subId: string; msisdn: string | null; month: string; date: string; marketCode: string; market: string; region: string;
  planCode: string; planName: string; segment: Segment; lob: 'Mobile' | 'Broadband'; deviceModel: string | null; deviceTier: string | null;
  rated: number; leakage: number; billed: number; roaming: number; deviceRevenue: number; costOfService: number; deviceSubsidy: number; autopay: boolean;
}
export interface UsageDay {
  date: string; subKey: number; region: string; marketCode: string; planCode: string; segment: Segment;
  dataGb: number; voiceMin: number; sms: number; roamingMb: number; callAttempts: number; droppedCalls: number;
}
export interface Site { key: number; id: string; name: string; marketCode: string; market: string; region: string; technology: '5G' | 'LTE'; siteType: 'Macro' | 'Small cell'; vendor: string; size: number }
export interface NetDay {
  date: string; siteKey: number; siteId: string; marketCode: string; region: string;
  attempts: number; dropped: number; setupFail: number; downtimeMin: number; dataTb: number; throughput: number; alarm: string | null;
}
export interface BaseRow {
  month: string; marketCode: string; market: string; region: string; planCode: string; planName: string; segment: Segment;
  opening: number; grossAdds: number; voluntary: number; portOuts: number; involuntary: number; migIn: number; migOut: number; closing: number;
}
export interface WorkOrder {
  key: number; id: string; type: string; marketCode: string; market: string; region: string; siteKey: number | null; siteId: string | null;
  subKey: number | null; opened: string; hours: number; ftf: boolean; repeat: boolean; tech: string;
}

export interface TelData {
  subscribers: Subscriber[];
  invoices: Invoice[];
  usage: UsageDay[];
  sites: Site[];
  network: NetDay[];
  base: BaseRow[];
  workOrders: WorkOrder[];
  /** Production subscribers per sample subscriber. */
  scale: number;
  /** Production sites per sample site. */
  siteScale: number;
}

export const MONTHS = Array.from({ length: 12 }, (_, i) => iso(new Date(Date.UTC(2025, 9 + i, 1))).slice(0, 7)); // 2025-10 .. 2026-09
const AREA: Record<string, number> = { HBV: 617, GRV: 603, PLC: 843, MGB: 251, PRX: 316, LKS: 414, SRV: 520, PCR: 503 };
const monthEnd = (m: string) => addDays(`${nextMonth(m)}-01`, -1);
function nextMonth(m: string) {
  const y = Number(m.slice(0, 4));
  const mm = Number(m.slice(5, 7));
  return mm === 12 ? `${y + 1}-01` : `${y}-${pad(mm + 1)}`;
}

export function generateTelecom(seed: number): TelData {
  const rng = new Rng(seed);

  // ---- Subscribers (2,000 standing in for 11.9 M mobile lines and broadband homes)
  const segW: Segment[] = ['Postpaid', 'Prepaid', 'Broadband'];
  const segWeights = segW.map((s) => SEGMENT_BASE[s]);
  const subscribers: Subscriber[] = [];
  for (let i = 0; i < VOLUMES.subscribers; i++) {
    const mk = rng.weighted(MARKETS, MARKETS.map((m) => m.weight));
    const seg = rng.weighted(segW, segWeights);
    const plans = PLANS.filter((p) => p.segment === seg);
    const plan = rng.weighted(plans, plans.map((p) => p.share));
    const p = person(rng, i, 'mailbox-example.net');
    const mobile = plan.lob === 'Mobile';
    const tenure = Math.max(1, Math.min(180, Math.round(rng.lognormal(30, 0.8))));
    const activationDate = addDays(AS_OF, -Math.round(tenure * 30.4) - rng.int(0, 20));
    const dev = mobile ? rng.weighted(DEVICES, DEVICES.map((x) => x.weight)) : null;
    const financed = seg === 'Postpaid' && rng.chance(0.7);
    const contractEnd = financed ? addDays(activationDate, (rng.chance(0.6) ? 24 : 36) * 30 + rng.int(0, 400)) : null;
    const outOfContract = seg === 'Postpaid' && (!contractEnd || contractEnd < AS_OF);
    const disconnected = rng.chance(seg === 'Prepaid' ? 0.06 : 0.035);
    const dormant = !disconnected && rng.chance(seg === 'Prepaid' ? 0.05 : 0.004);
    const autopay = rng.chance(seg === 'Postpaid' ? 0.78 : seg === 'Prepaid' ? 0.4 : 0.72);
    const hasHistory = seg === 'Postpaid' && rng.chance(0.08);
    const reasonRoll = rng.float();
    const churnPropensity = Math.min(99, Math.max(1, Math.round(rng.lognormal(22, 0.55) + (outOfContract ? 14 : 0) + (plan.code === 'ESS15' ? 8 : 0) + (seg === 'Prepaid' ? 9 : 0) + (mk.region === 'West' ? 4 : 0))));
    const id = 7_100_000 + i * 13 + rng.int(0, 12);
    subscribers.push({
      key: i + 1, id: `S${id}`, accountNo: `A${pad(40_000_000 + i * 7, 9)}`, first: p.first, last: p.last, email: p.email, street: p.street,
      msisdn: mobile ? `+1${AREA[mk.code]}555${pad((i * 37) % 10_000, 4)}` : null,
      marketCode: mk.code, market: mk.name, region: mk.region, planCode: plan.code, planName: plan.name, segment: seg, lob: plan.lob,
      status: disconnected ? 'Disconnected' : 'Active', disconnectReason: disconnected ? (reasonRoll < 0.5 ? 'Voluntary' : reasonRoll < 0.85 ? 'Port-out' : 'Involuntary') : undefined,
      dormant, activationDate, tenureMonths: tenure, contractEnd, outOfContract, autopay, churnPropensity,
      deviceModel: dev?.model ?? null, deviceTier: dev?.tier ?? null, financed,
      lastMonthIdx: disconnected ? rng.int(1, 10) : dormant ? 9 : 11,
      priorPlanCode: hasHistory ? (plan.code === 'UMAX' ? 'UPLS' : plan.code === 'UPLS' ? 'ESS15' : 'UPLS') : undefined,
      planChangedOn: hasHistory ? addDays('2025-06-01', rng.int(0, 450)) : undefined,
    });
  }

  // ---- Invoices: subscriber × month, Oct 2025 – Sep 2026 (BSS billing)
  const invoices: Invoice[] = [];
  const monthEnds = MONTHS.map(monthEnd);
  for (const s of subscribers) {
    const plan = PLANS.find((x) => x.code === s.planCode)!;
    const own = rng.lognormal(1, 0.07);
    const cycleDay = [1, 8, 15, 22][s.key % 4];
    const tierK = s.deviceTier === 'Flagship' ? 1.4 : s.deviceTier === 'Mid-range' ? 1 : 0.6;
    const installment = s.financed ? round(rng.range(18, 46) * tierK, 2) : 0;
    MONTHS.forEach((m, i) => {
      if (i > s.lastMonthIdx || s.activationDate > monthEnds[i]) return;
      const summer = m.endsWith('-07') || m.endsWith('-08') ? 1.5 : 1;
      const overage = plan.code === 'ESS15' && rng.chance(0.15) ? rng.range(10, 25) : 0;
      const roamP = s.segment === 'Postpaid' ? 0.08 * summer : s.segment === 'Prepaid' ? 0.02 * summer : 0;
      const roaming = rng.chance(roamP) ? round(rng.range(12, 40), 2) : 0;
      const rated = round(plan.price * own * rng.normal(1, 0.03) + overage + roaming, 2);
      const leakP = s.marketCode === TARGETS.leakageHotMarket ? 0.11 : 0.045;
      const leakage = rng.chance(leakP) ? round(rated * rng.range(0.05, 0.3), 2) : 0;
      invoices.push({
        key: invoices.length + 1, id: `INV-${m.replace('-', '')}-${s.id.slice(1)}`, subKey: s.key, subId: s.id, msisdn: s.msisdn, month: m, date: `${m}-${pad(cycleDay)}`,
        marketCode: s.marketCode, market: s.market, region: s.region, planCode: s.planCode, planName: s.planName, segment: s.segment, lob: s.lob,
        deviceModel: s.deviceModel, deviceTier: s.deviceTier, rated, leakage, billed: 0, roaming, deviceRevenue: installment,
        costOfService: 0, deviceSubsidy: s.segment === 'Postpaid' && s.deviceModel ? round(plan.subsidy * tierK * rng.range(0.85, 1.15), 2) : 0, autopay: s.autopay,
      });
    });
  }
  calibrateLeakage(invoices);
  for (const v of invoices) {
    const plan = PLANS.find((x) => x.code === v.planCode)!;
    v.billed = round(v.rated - v.leakage, 2);
    v.costOfService = round(v.billed * plan.costRatio * rng.range(0.92, 1.08), 2);
  }

  // ---- Daily usage from CDR mediation: mobile subscribers × 30 days (Sep 2026)
  const days = dateRange(addDays(AS_OF, -VOLUMES.usageDays + 1), AS_OF);
  const usage: UsageDay[] = [];
  const isWeekend = (d: string) => { const dow = toDate(d).getUTCDay(); return dow === 0 || dow === 6; };
  const dayWeekend = days.map(isWeekend);
  for (const s of subscribers) {
    if (s.lob !== 'Mobile' || s.lastMonthIdx < 11 || s.dormant) continue;
    const plan = PLANS.find((x) => x.code === s.planCode)!;
    const own = rng.lognormal(1, 0.45);
    const talk = rng.lognormal(s.segment === 'Postpaid' ? 13.5 : 9, 0.4);
    const travelDay = rng.chance(0.06) ? rng.int(0, 29) : -1;
    days.forEach((d, di) => {
      const weekend = dayWeekend[di];
      const attempts = Math.max(0, Math.round((talk / 3.2) * (weekend ? 0.8 : 1.08) * rng.range(0.6, 1.4)));
      const dropped = attempts && rng.chance(attempts * 0.0082) ? 1 : 0;
      const roam = travelDay >= 0 && di >= travelDay && di < travelDay + 5;
      usage.push({
        date: d, subKey: s.key, region: s.region, marketCode: s.marketCode, planCode: s.planCode, segment: s.segment,
        dataGb: round((plan.dataGb / 30) * own * (weekend ? 1.12 : 0.95) * rng.range(0.7, 1.3), 3),
        voiceMin: round(talk * (weekend ? 0.8 : 1.08) * rng.range(0.6, 1.4), 1),
        sms: rng.int(0, 12), roamingMb: roam ? round(rng.range(80, 900), 0) : 0, callAttempts: attempts, droppedCalls: dropped,
      });
    });
  }

  // ---- Cell sites (120 standing in for 15,600) and daily network KPIs, Jan – Sep 2026 (OSS)
  const sites: Site[] = [];
  for (const m of MARKETS) {
    for (let i = 0; i < m.sites; i++) {
      const tech = rng.chance(0.62) ? '5G' : 'LTE';
      sites.push({
        key: sites.length + 1, id: `${m.code}-${pad(100 + i * 37 + rng.int(0, 30), 4)}`, name: `${m.name} ${['North', 'Harbor', 'Ridge', 'Central', 'Mill', 'Airport', 'Park', 'Station'][i % 8]} ${1 + Math.floor(i / 8)}`,
        marketCode: m.code, market: m.name, region: m.region, technology: tech, siteType: rng.chance(0.82) ? 'Macro' : 'Small cell',
        vendor: VENDORS[m.region === 'West' || m.region === 'Central' ? 1 : 0], size: rng.lognormal(1, 0.35),
      });
    }
  }
  const netDays = dateRange('2026-01-01', AS_OF);
  const network: NetDay[] = [];
  const netWeekend = netDays.map(isWeekend);
  const siteDcr = sites.map(() => rng.lognormal(1, 0.35));
  for (const s of sites) {
    const tput = (s.technology === '5G' ? 168 : 92) * rng.range(0.85, 1.15);
    netDays.forEach((d, di) => {
      const attempts = Math.round(24_000 * s.size * (netWeekend[di] ? 0.82 : 1.06) * rng.range(0.92, 1.08));
      const outage = rng.chance(0.011);
      const alarm = outage ? rng.pick(ALARMS).code : rng.chance(0.004) ? 'VSWR_HIGH' : null;
      network.push({
        date: d, siteKey: s.key, siteId: s.id, marketCode: s.marketCode, region: s.region, attempts,
        dropped: attempts * 0.008 * siteDcr[s.key - 1] * rng.range(0.85, 1.15), setupFail: Math.round(attempts * 0.0062 * rng.range(0.7, 1.3)),
        downtimeMin: outage ? Math.min(600, rng.lognormal(38, 0.8)) : 0, dataTb: s.size * (s.technology === '5G' ? 1.25 : 0.85) * rng.range(0.9, 1.1),
        throughput: round(tput * rng.range(0.9, 1.1), 1), alarm,
      });
    });
  }
  const scale = SUBSCRIBER_TOTAL / VOLUMES.subscribers;
  const siteScale = SITES_TOTAL / VOLUMES.sites;
  calibrateNetwork(network, sites.length, usage, scale, siteScale);

  // ---- Subscriber base movements (production grain): month × market × plan
  const base: BaseRow[] = [];
  const opening = new Map<string, number>();
  for (const m of MARKETS) for (const p of PLANS) opening.set(`${m.code}|${p.code}`, Math.round(SEGMENT_BASE[p.segment] * p.share * m.weight));
  const migW: Record<string, number> = { UMAX: 0.42, UPLS: 0.33, ESS15: 0.1, FAM: 0.15, PPFX: 0.7, PPBS: 0.3, F500: 0.3, FGIG: 0.7 };
  MONTHS.forEach((month, mi) => {
    const season = 1 + 0.04 * Math.sin((mi / 12) * 2 * Math.PI);
    for (const m of MARKETS) {
      const rows: BaseRow[] = PLANS.map((p) => {
        const r = MOVEMENT_RATES[p.segment];
        const o = opening.get(`${m.code}|${p.code}`)!;
        const k = p.churnK * REGION_CHURN[m.region] * season;
        return {
          month, marketCode: m.code, market: m.name, region: m.region, planCode: p.code, planName: p.name, segment: p.segment, opening: o,
          grossAdds: Math.round(o * r.grossAdds * (p.code === 'UMAX' ? 1.12 : p.code === 'ESS15' ? 0.9 : 1) * rng.range(0.93, 1.07)),
          voluntary: Math.round(o * r.voluntary * k * rng.range(0.94, 1.06)), portOuts: Math.round(o * r.portOut * k * rng.range(0.94, 1.06)),
          involuntary: Math.round(o * r.involuntary * rng.range(0.9, 1.1)), migOut: Math.round(o * r.migration * rng.range(0.85, 1.15)), migIn: 0, closing: 0,
        };
      });
      for (const seg of ['Postpaid', 'Prepaid', 'Broadband'] as Segment[]) {
        const rs = rows.filter((x) => x.segment === seg);
        const total = sum(rs.map((x) => x.migOut));
        const wsum = sum(rs.map((x) => migW[x.planCode]));
        let left = total;
        rs.forEach((x, i) => {
          x.migIn = i === rs.length - 1 ? left : Math.round((total * migW[x.planCode]) / wsum);
          left -= x.migIn;
        });
      }
      for (const x of rows) {
        x.closing = x.opening + x.grossAdds + x.migIn - x.migOut - x.voluntary - x.portOuts - x.involuntary;
        opening.set(`${m.code}|${x.planCode}`, x.closing);
        base.push(x);
      }
    }
  });

  // ---- Field service work orders, Jan – Sep 2026
  const woDays = dateRange('2026-01-01', AS_OF);
  const workOrders: WorkOrder[] = [];
  const subsByMarket = new Map<string, Subscriber[]>();
  const sitesByMarket = new Map<string, Site[]>();
  for (const s of subscribers) if (s.lob === 'Broadband') subsByMarket.set(s.marketCode, [...(subsByMarket.get(s.marketCode) ?? []), s]);
  for (const s of sites) sitesByMarket.set(s.marketCode, [...(sitesByMarket.get(s.marketCode) ?? []), s]);
  for (let i = 0; i < VOLUMES.workOrders; i++) {
    const t = rng.weighted(WORK_ORDER_TYPES, WORK_ORDER_TYPES.map((x) => x.weight));
    const m = rng.weighted(MARKETS, MARKETS.map((x) => x.weight));
    const site = t.type === 'Network site repair' ? rng.pick(sitesByMarket.get(m.code)!) : null;
    const sub = site ? null : rng.pick(subsByMarket.get(m.code) ?? subscribers);
    const ftf = rng.chance(t.ftf * (m.region === 'Southeast' ? 0.97 : m.region === 'Central' ? 1.02 : 1));
    workOrders.push({
      key: i + 1, id: `WO-${pad(260_000 + i * 3, 7)}`, type: t.type, marketCode: m.code, market: m.name, region: m.region,
      siteKey: site?.key ?? null, siteId: site?.id ?? null, subKey: sub?.key ?? null, opened: rng.pick(woDays),
      hours: round(Math.max(0.5, rng.lognormal(t.hours * 0.85, 0.5)), 1), ftf, repeat: !ftf && rng.chance(0.85), tech: `TCH-${pad(rng.int(1, 240), 4)}`,
    });
  }
  workOrders.sort((a, b) => (a.opened < b.opened ? -1 : a.opened > b.opened ? 1 : a.key - b.key));
  workOrders.forEach((w, i) => (w.key = i + 1));

  return { subscribers, invoices, usage, sites, network, base, workOrders, scale, siteScale };
}

/** Scale leakage amounts so revenue leakage (rated − billed) ÷ rated lands on target. */
function calibrateLeakage(invoices: Invoice[]) {
  const rated = sum(invoices.map((v) => v.rated));
  const leak = sum(invoices.map((v) => v.leakage));
  const k = (TARGETS.leakagePct * rated) / leak;
  for (const v of invoices) v.leakage = round(Math.min(v.rated * 0.5, v.leakage * k), 2);
}

/** Dropped-call rate per quarter, availability per quarter and data traffic calibrated to targets. */
function calibrateNetwork(net: NetDay[], siteCount: number, usage: UsageDay[], scale: number, siteScale: number) {
  const q = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
  const dcr: Record<number, number> = { 1: 0.0089, 2: TARGETS.dcrQ2, 3: TARGETS.dcrQ3 };
  const avail: Record<number, number> = { 1: 0.99944, 2: 0.99946, 3: TARGETS.availability };
  for (const qq of [1, 2, 3]) {
    const xs = net.filter((x) => q(x.date) === qq);
    const k = (dcr[qq] * sum(xs.map((x) => x.attempts))) / sum(xs.map((x) => x.dropped));
    for (const x of xs) x.dropped = Math.round(x.dropped * k);
    const days = new Set(xs.map((x) => x.date)).size;
    const allowed = (1 - avail[qq]) * siteCount * days * 1440;
    const kd = allowed / sum(xs.map((x) => x.downtimeMin));
    for (const x of xs) x.downtimeMin = Math.round(x.downtimeMin * kd);
  }
  // Network-side data traffic agrees with subscriber usage: Sep sample GB × scale ≈ site TB × site scale.
  const sepTargetTb = (sum(usage.map((u) => u.dataGb)) * scale) / 1000;
  const sep = net.filter((x) => x.date >= '2026-09-01');
  const kt = sepTargetTb / (sum(sep.map((x) => x.dataTb)) * siteScale);
  for (const x of net) x.dataTb = round(x.dataTb * kt, 3);
}
