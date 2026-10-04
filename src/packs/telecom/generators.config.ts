// Altair Communications generator config (spec section 6): entities, volumes, distributions and KPI target ranges.
import type { KpiRange } from '../../types';

export const AS_OF = '2026-09-30';
/** Production subscriber counts the 2,000-subscriber sample stands in for. */
export const MOBILE_TOTAL = 9_800_000;
export const BROADBAND_TOTAL = 2_100_000;
export const SUBSCRIBER_TOTAL = MOBILE_TOTAL + BROADBAND_TOTAL;
/** Production cell sites the 120-site sample stands in for. */
export const SITES_TOTAL = 15_600;

export const REGIONS = ['Northeast', 'Southeast', 'Central', 'West'] as const;

export const MARKETS = [
  { code: 'HBV', name: 'Harborview', region: 'Northeast', weight: 0.16, sites: 18 },
  { code: 'GRV', name: 'Granite Valley', region: 'Northeast', weight: 0.12, sites: 14 },
  { code: 'PLC', name: 'Palmetto Coast', region: 'Southeast', weight: 0.14, sites: 16 },
  { code: 'MGB', name: 'Magnolia Bay', region: 'Southeast', weight: 0.12, sites: 14 },
  { code: 'PRX', name: 'Prairie Crossing', region: 'Central', weight: 0.1, sites: 13 },
  { code: 'LKS', name: 'Lakeshore', region: 'Central', weight: 0.12, sites: 15 },
  { code: 'SRV', name: 'Sierra Vista', region: 'West', weight: 0.11, sites: 14 },
  { code: 'PCR', name: 'Pacific Rim', region: 'West', weight: 0.13, sites: 16 },
] as const;

/** Market code → region (Bronze and Silver carry the code; the row access policy works on REGION). */
export const MARKET_TO_REGION: Record<string, string> = Object.fromEntries(MARKETS.map((m) => [m.code, m.region]));

export type Segment = 'Postpaid' | 'Prepaid' | 'Broadband';

export const PLANS = [
  { code: 'UMAX', name: 'Unlimited Max', segment: 'Postpaid', lob: 'Mobile', price: 68, share: 0.3, dataGb: 26, costRatio: 0.36, subsidy: 11, churnK: 0.8 },
  { code: 'UPLS', name: 'Unlimited Plus', segment: 'Postpaid', lob: 'Mobile', price: 56, share: 0.3, dataGb: 19, costRatio: 0.38, subsidy: 9, churnK: 1.0 },
  { code: 'ESS15', name: 'Essentials 15GB', segment: 'Postpaid', lob: 'Mobile', price: 40, share: 0.22, dataGb: 9, costRatio: 0.41, subsidy: 6, churnK: 1.32 },
  { code: 'FAM', name: 'Family Share', segment: 'Postpaid', lob: 'Mobile', price: 36, share: 0.18, dataGb: 12, costRatio: 0.4, subsidy: 7, churnK: 0.72 },
  { code: 'PPFX', name: 'Prepaid Flex', segment: 'Prepaid', lob: 'Mobile', price: 35, share: 0.55, dataGb: 7, costRatio: 0.44, subsidy: 0, churnK: 0.95 },
  { code: 'PPBS', name: 'Prepaid Basic', segment: 'Prepaid', lob: 'Mobile', price: 25, share: 0.45, dataGb: 4, costRatio: 0.47, subsidy: 0, churnK: 1.06 },
  { code: 'F500', name: 'Fiber 500', segment: 'Broadband', lob: 'Broadband', price: 65, share: 0.62, dataGb: 0, costRatio: 0.42, subsidy: 0, churnK: 1.08 },
  { code: 'FGIG', name: 'Fiber Gig', segment: 'Broadband', lob: 'Broadband', price: 85, share: 0.38, dataGb: 0, costRatio: 0.4, subsidy: 0, churnK: 0.87 },
] as const;

/** Production base split by segment (sums to SUBSCRIBER_TOTAL). */
export const SEGMENT_BASE: Record<Segment, number> = { Postpaid: 6_900_000, Prepaid: 2_900_000, Broadband: 2_100_000 };

/** Monthly movement rates by segment (share of opening base). Churn = voluntary + port-outs (rule BR-004). */
export const MOVEMENT_RATES: Record<Segment, { voluntary: number; portOut: number; involuntary: number; grossAdds: number; migration: number }> = {
  Postpaid: { voluntary: 0.0055, portOut: 0.0045, involuntary: 0.0022, grossAdds: 0.0139, migration: 0.009 },
  Prepaid: { voluntary: 0.022, portOut: 0.0105, involuntary: 0.006, grossAdds: 0.0395, migration: 0.004 },
  Broadband: { voluntary: 0.0078, portOut: 0.0034, involuntary: 0.0015, grossAdds: 0.0141, migration: 0.006 },
};

/** Region churn modifiers (West is the most competitive market). */
export const REGION_CHURN: Record<string, number> = { Northeast: 0.93, Southeast: 1.02, Central: 0.94, West: 1.12 };

export const DEVICES = [
  { model: 'Aurora X15 Pro', tier: 'Flagship', weight: 0.24 },
  { model: 'Aurora X15', tier: 'Flagship', weight: 0.2 },
  { model: 'Pixelon 9', tier: 'Flagship', weight: 0.14 },
  { model: 'Nimbus A54', tier: 'Mid-range', weight: 0.2 },
  { model: 'Nimbus A25', tier: 'Value', weight: 0.12 },
  { model: 'Corvo Lite', tier: 'Value', weight: 0.1 },
] as const;

export const VENDORS = ['Kestrel Networks', 'Norrland Radio'] as const;
export const ALARMS = [
  { code: 'RU_LINK_DOWN', severity: 'Critical' },
  { code: 'PWR_MAINS_FAIL', severity: 'Major' },
  { code: 'BACKHAUL_LOSS', severity: 'Critical' },
  { code: 'VSWR_HIGH', severity: 'Minor' },
  { code: 'CELL_DEGRADED', severity: 'Major' },
] as const;

export const WORK_ORDER_TYPES = [
  { type: 'New install', weight: 0.34, ftf: 0.885, hours: 3.4, truckRoll: true },
  { type: 'Broadband repair', weight: 0.41, ftf: 0.8, hours: 5.2, truckRoll: true },
  { type: 'Network site repair', weight: 0.25, ftf: 0.755, hours: 7.8, truckRoll: true },
] as const;

/** Calibration targets (inside the KPI ranges below). */
export const TARGETS = {
  leakagePct: 0.0072,
  leakageHotMarket: 'LKS',
  availability: 0.99952,
  dcrQ2: 0.0086,
  dcrQ3: 0.0079,
  dataGbPerSub: 15.6,
};

export const VOLUMES = { subscribers: 2000, usageDays: 30, billMonths: 12, sites: 120, workOrders: 3000 };

export const KPI_RANGES: KpiRange[] = [
  { kpiId: 'K-01', min: 8_800_000, max: 10_200_000 }, // active mobile subscribers (scaled)
  { kpiId: 'K-02', min: 48, max: 58 }, // postpaid ARPU USD / month
  { kpiId: 'K-03', min: 12, max: 22 }, // data usage per mobile subscriber GB / month
  { kpiId: 'K-04', min: 300, max: 550 }, // voice minutes of use per subscriber / month
  { kpiId: 'K-05', min: 55, max: 78 }, // autopay enrolment %
  { kpiId: 'K-06', min: 450_000_000, max: 750_000_000 }, // service revenue per month (scaled USD)
  { kpiId: 'K-07', min: 0.3, max: 1.5 }, // revenue leakage %
  { kpiId: 'K-08', min: 2.5, max: 8 }, // roaming revenue share %
  { kpiId: 'K-09', min: 1_500_000, max: 9_000_000 }, // unbilled rated usage per month (scaled USD)
  { kpiId: 'K-10', min: 0.5, max: 1.5 }, // dropped call rate %
  { kpiId: 'K-11', min: 99.9, max: 99.99 }, // network availability %
  { kpiId: 'K-12', min: 98.5, max: 99.8 }, // call setup success rate %
  { kpiId: 'K-13', min: 80, max: 220 }, // avg downlink throughput Mbps
  { kpiId: 'K-14', min: 70, max: 97 }, // site SLA compliance %
  { kpiId: 'K-15', min: 110, max: 220 }, // mobile data traffic PB / month
  { kpiId: 'K-16', min: 0.8, max: 1.2 }, // postpaid churn %
  { kpiId: 'K-17', min: 2.5, max: 4.5 }, // prepaid churn %
  { kpiId: 'K-18', min: -10_000, max: 40_000 }, // postpaid net adds / month
  { kpiId: 'K-19', min: 70_000, max: 130_000 }, // postpaid gross adds / month
  { kpiId: 'K-20', min: 35, max: 60 }, // port-out share of churn %
  { kpiId: 'K-21', min: 0.8, max: 1.6 }, // broadband churn %
  { kpiId: 'K-22', min: 38, max: 62 }, // plan gross margin %
  { kpiId: 'K-23', min: 4, max: 14 }, // device subsidy per subscriber USD / month
  { kpiId: 'K-24', min: 15, max: 35 }, // gross margin per subscriber USD / month
  { kpiId: 'K-25', min: 75, max: 90 }, // first-time fix rate %
  { kpiId: 'K-26', min: 3, max: 12 }, // avg hours to resolve a work order
];

/** Regions visible to the subscriber analyst (archetype A) under RAP_REGION_ACCESS. */
export const ANALYST_REGIONS = ['Northeast', 'Southeast'];
