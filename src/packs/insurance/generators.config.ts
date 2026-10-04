// Sentinel Mutual generator config (spec section 6): entities, volumes, distributions and KPI target ranges.
import type { KpiRange } from '../../types';
import { AS_OF_DATE } from '../shared/catalog-kit';

export const AS_OF = AS_OF_DATE;

/** Production policies in force at the as-of date (the sample is scaled to this). */
export const POLICIES_IN_FORCE = 4_600_000;

export interface RegionSpec { name: string; weight: number; states: { code: string; city: string; w: number }[] }

export const REGIONS: RegionSpec[] = [
  { name: 'Northeast', weight: 0.24, states: [{ code: 'NY', city: 'Albany', w: 0.38 }, { code: 'PA', city: 'Harrisburg', w: 0.26 }, { code: 'MA', city: 'Worcester', w: 0.19 }, { code: 'NJ', city: 'Trenton', w: 0.17 }] },
  { name: 'Midwest', weight: 0.22, states: [{ code: 'OH', city: 'Columbus', w: 0.3 }, { code: 'IL', city: 'Peoria', w: 0.3 }, { code: 'MI', city: 'Lansing', w: 0.22 }, { code: 'WI', city: 'Madison', w: 0.18 }] },
  { name: 'South', weight: 0.32, states: [{ code: 'TX', city: 'Austin', w: 0.36 }, { code: 'FL', city: 'Tampa', w: 0.3 }, { code: 'GA', city: 'Savannah', w: 0.18 }, { code: 'NC', city: 'Raleigh', w: 0.16 }] },
  { name: 'West', weight: 0.22, states: [{ code: 'CA', city: 'Sacramento', w: 0.46 }, { code: 'AZ', city: 'Phoenix', w: 0.2 }, { code: 'WA', city: 'Spokane', w: 0.18 }, { code: 'CO', city: 'Denver', w: 0.16 }] },
];

export const REGION_NAMES = REGIONS.map((r) => r.name);
export const STATE_TO_REGION: Record<string, string> = Object.fromEntries(REGIONS.flatMap((r) => r.states.map((s) => [s.code, r.name])));

export interface LineSpec {
  code: string; name: string; segment: 'Personal' | 'Commercial'; weight: number; premium: number; claimWeight: number;
  severity: number; expenseRate: number; laeRate: number; closeMedian: number; injuryShare: number; subroShare: number;
  ibnrFactor: number; retention: number; rate2025: number; rate2026: number; property: boolean; tivMedian: number; causes: string[];
}

export const LINES: LineSpec[] = [
  { code: 'PA', name: 'Personal Auto', segment: 'Personal', weight: 0.42, premium: 1450, claimWeight: 0.042, severity: 7000, expenseRate: 0.215, laeRate: 0.11, closeMedian: 15, injuryShare: 0.22, subroShare: 0.3, ibnrFactor: 0.045, retention: 0.86, rate2025: 1.075, rate2026: 1.05, property: false, tivMedian: 0, causes: ['Collision', 'Comprehensive – theft', 'Bodily injury', 'Glass', 'Animal strike'] },
  { code: 'HO', name: 'Homeowners', segment: 'Personal', weight: 0.33, premium: 1650, claimWeight: 0.0231, severity: 12000, expenseRate: 0.25, laeRate: 0.1, closeMedian: 19, injuryShare: 0.04, subroShare: 0.06, ibnrFactor: 0.03, retention: 0.89, rate2025: 1.09, rate2026: 1.06, property: true, tivMedian: 380_000, causes: ['Water damage', 'Wind/hail', 'Fire', 'Theft', 'Liability'] },
  { code: 'CA', name: 'Commercial Auto', segment: 'Commercial', weight: 0.06, premium: 5200, claimWeight: 0.009, severity: 15000, expenseRate: 0.24, laeRate: 0.12, closeMedian: 25, injuryShare: 0.3, subroShare: 0.28, ibnrFactor: 0.08, retention: 0.84, rate2025: 1.09, rate2026: 1.07, property: false, tivMedian: 0, causes: ['Collision', 'Bodily injury', 'Cargo', 'Comprehensive – theft'] },
  { code: 'CP', name: 'Commercial Property', segment: 'Commercial', weight: 0.07, premium: 7800, claimWeight: 0.0042, severity: 35000, expenseRate: 0.27, laeRate: 0.08, closeMedian: 33, injuryShare: 0, subroShare: 0.08, ibnrFactor: 0.05, retention: 0.86, rate2025: 1.08, rate2026: 1.06, property: true, tivMedian: 2_400_000, causes: ['Fire', 'Wind/hail', 'Water damage', 'Equipment breakdown'] },
  { code: 'GL', name: 'General Liability', segment: 'Commercial', weight: 0.07, premium: 3900, claimWeight: 0.0028, severity: 30000, expenseRate: 0.28, laeRate: 0.16, closeMedian: 85, injuryShare: 0.7, subroShare: 0.03, ibnrFactor: 0.25, retention: 0.85, rate2025: 1.05, rate2026: 1.05, property: false, tivMedian: 0, causes: ['Premises liability', 'Products liability', 'Completed operations'] },
  { code: 'WC', name: "Workers' Compensation", segment: 'Commercial', weight: 0.05, premium: 6400, claimWeight: 0.005, severity: 20000, expenseRate: 0.22, laeRate: 0.13, closeMedian: 60, injuryShare: 1, subroShare: 0.12, ibnrFactor: 0.2, retention: 0.87, rate2025: 1.0, rate2026: 0.99, property: false, tivMedian: 0, causes: ['Strain/sprain', 'Slip and fall', 'Struck by object', 'Repetitive motion'] },
];

export const LINE_BY_CODE: Record<string, LineSpec> = Object.fromEntries(LINES.map((l) => [l.code, l]));

export const INJURIES = ['Cervical strain', 'Lumbar sprain', 'Fractured wrist', 'Concussion', 'Knee contusion', 'Rotator cuff tear', 'Forearm laceration', 'Whiplash', 'Ankle fracture', 'Herniated disc'];

/** Catastrophe events on the cat-code list (fictional event names). */
export const CAT_EVENTS = [
  { code: 'CAT-25-03', name: 'February ice storm', peril: 'Winter storm', start: '2025-02-11', end: '2025-02-14', states: ['NY', 'PA', 'OH', 'MI'], claims: 34 },
  { code: 'CAT-25-11', name: 'April hail outbreak', peril: 'Severe convective', start: '2025-04-18', end: '2025-04-21', states: ['TX', 'CO'], claims: 44 },
  { code: 'CAT-25-19', name: 'June derecho', peril: 'Severe convective', start: '2025-06-09', end: '2025-06-10', states: ['IL', 'WI', 'MI'], claims: 32 },
  { code: 'CAT-25-27', name: 'Gulf hurricane landfall', peril: 'Hurricane', start: '2025-09-03', end: '2025-09-06', states: ['FL', 'GA', 'NC'], claims: 58 },
  { code: 'CAT-25-34', name: 'October wildfire complex', peril: 'Wildfire', start: '2025-10-14', end: '2025-10-22', states: ['CA'], claims: 26 },
  { code: 'CAT-26-04', name: 'January nor’easter', peril: 'Winter storm', start: '2026-01-24', end: '2026-01-26', states: ['MA', 'NY', 'NJ'], claims: 36 },
  { code: 'CAT-26-12', name: 'May hail outbreak', peril: 'Severe convective', start: '2026-05-05', end: '2026-05-07', states: ['TX', 'CO'], claims: 40 },
  { code: 'CAT-26-18', name: 'Atlantic hurricane landfall', peril: 'Hurricane', start: '2026-08-27', end: '2026-08-30', states: ['FL', 'GA'], claims: 52 },
  { code: 'CAT-26-21', name: 'September wildfire', peril: 'Wildfire', start: '2026-09-08', end: '2026-09-15', states: ['CA', 'WA'], claims: 22 },
];

/** Probability that a property risk in a state sits in a hurricane or wildfire zone. */
export const CAT_ZONE_BY_STATE: Record<string, { zone: string; p: number; fallback: string }> = {
  FL: { zone: 'Hurricane', p: 0.72, fallback: 'Severe convective' }, GA: { zone: 'Hurricane', p: 0.32, fallback: 'Severe convective' },
  NC: { zone: 'Hurricane', p: 0.34, fallback: 'Severe convective' }, TX: { zone: 'Hurricane', p: 0.3, fallback: 'Severe convective' },
  CA: { zone: 'Wildfire', p: 0.44, fallback: 'Earthquake' }, CO: { zone: 'Wildfire', p: 0.26, fallback: 'Severe convective' },
  WA: { zone: 'Wildfire', p: 0.2, fallback: 'Earthquake' }, AZ: { zone: 'Wildfire', p: 0.22, fallback: 'Severe convective' },
  NY: { zone: 'Hurricane', p: 0.14, fallback: 'Winter storm' }, MA: { zone: 'Hurricane', p: 0.16, fallback: 'Winter storm' },
  NJ: { zone: 'Hurricane', p: 0.2, fallback: 'Winter storm' }, PA: { zone: 'Winter storm', p: 1, fallback: 'Winter storm' },
  OH: { zone: 'Severe convective', p: 1, fallback: 'Severe convective' }, IL: { zone: 'Severe convective', p: 1, fallback: 'Severe convective' },
  MI: { zone: 'Winter storm', p: 1, fallback: 'Winter storm' }, WI: { zone: 'Winter storm', p: 1, fallback: 'Winter storm' },
};
export const CAT_ZONES = ['Hurricane', 'Wildfire'];

export const AGENCY_PREFIXES = ['Harbor Point', 'Keystone', 'Cedar Ridge', 'Lakeshore', 'Summit Valley', 'Pioneer', 'Bluewater', 'Granite Hill', 'Prairie Wind', 'Riverbend', 'Old Mill', 'Copperline', 'Northgate', 'Sagebrush', 'Magnolia', 'Tidewater', 'Ironbridge', 'Westbrook', 'Silver Creek', 'Brookside', 'Red Canyon', 'Heartland', 'Crescent Bay', 'Fairhaven'];
export const AGENCY_SUFFIXES = ['Insurance Agency', 'Insurance Group', 'Risk Partners', 'Insurance Services'];

/** Calibration targets (inside the KPI ranges below). Loss ratios are accident-year, Jan–Sep, on earned premium. */
export const TARGETS: { lossRatioExCat: Record<string, Record<string, number>>; catLossRatio: Record<string, number>; catConcentration: number } = {
  lossRatioExCat: {
    '2025': { PA: 0.68, HO: 0.6, CA: 0.74, CP: 0.56, GL: 0.62, WC: 0.66 },
    '2026': { PA: 0.655, HO: 0.575, CA: 0.715, CP: 0.54, GL: 0.6, WC: 0.635 },
  },
  catLossRatio: { '2025': 0.072, '2026': 0.058 },
  catConcentration: 0.33,
};

export const VOLUMES = { policies: 2000, claims: 4200, submissions: 6000, agencies: 48 };

/** Production claims represented by one sample claim; production submissions by one sample submission. */
export const CLAIM_SCALE = 190;
export const SUBMISSION_SCALE = 850;

export const KPI_RANGES: KpiRange[] = [
  { kpiId: 'K-01', min: 58, max: 68 }, // loss ratio ex-cat %
  { kpiId: 'K-02', min: 95, max: 106 }, // combined ratio %
  { kpiId: 'K-03', min: 20, max: 40 }, // claims cycle time days
  { kpiId: 'K-04', min: 14_000, max: 24_000 }, // average severity USD
  { kpiId: 'K-05', min: 20, max: 40 }, // subrogation recovery rate %
  { kpiId: 'K-06', min: 7, max: 11.5 }, // claim frequency per 100 policies (annualised)
  { kpiId: 'K-07', min: 40_000, max: 180_000 }, // open claims (scaled)
  { kpiId: 'K-08', min: 3, max: 10 }, // catastrophe loss ratio points
  { kpiId: 'K-09', min: 6, max: 10 }, // LAE ratio %
  { kpiId: 'K-10', min: 4_500_000_000, max: 8_000_000_000 }, // incurred losses YTD USD
  { kpiId: 'K-11', min: 2_500_000_000, max: 7_000_000_000 }, // paid losses YTD USD
  { kpiId: 'K-12', min: 7_500_000_000, max: 11_000_000_000 }, // earned premium YTD USD
  { kpiId: 'K-13', min: 7_500_000_000, max: 11_500_000_000 }, // written premium YTD USD
  { kpiId: 'K-14', min: 3, max: 9 }, // premium growth %
  { kpiId: 'K-15', min: 22, max: 28 }, // expense ratio %
  { kpiId: 'K-16', min: 2_300, max: 3_300 }, // average premium per policy USD
  { kpiId: 'K-17', min: 2, max: 6 }, // billing delinquency rate %
  { kpiId: 'K-18', min: 82, max: 90 }, // policy retention %
  { kpiId: 'K-19', min: 4_400_000, max: 4_800_000 }, // policies in force
  { kpiId: 'K-20', min: 5, max: 10 }, // average policyholder tenure years
  { kpiId: 'K-21', min: 18, max: 30 }, // quote-to-bind %
  { kpiId: 'K-22', min: 800_000_000, max: 1_700_000_000 }, // new business premium YTD USD
  { kpiId: 'K-23', min: 1, max: 4 }, // quote turnaround days
  { kpiId: 'K-24', min: 800_000_000, max: 3_000_000_000 }, // case reserve balance USD
  { kpiId: 'K-25', min: 700_000_000, max: 1_600_000_000 }, // IBNR reserve USD
  { kpiId: 'K-26', min: 8_000, max: 35_000 }, // average case reserve per open claim USD
  { kpiId: 'K-27', min: 200_000_000_000, max: 900_000_000_000 }, // insured value in hurricane & wildfire zones USD
  { kpiId: 'K-28', min: 28, max: 38 }, // cat-zone concentration %
];
