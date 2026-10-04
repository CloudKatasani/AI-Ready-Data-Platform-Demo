// Ridgeline Bank generator config (spec section 6): entities, volumes, distributions and KPI target ranges.
import type { KpiRange } from '../../types';

export const AS_OF = '2026-09-30';

/** Production sizes the 2,000-customer sample stands in for. */
export const PRODUCTION = { customers: 3_200_000, loans: 412_000, alertsPerMonth: 4_100 };

export const REGIONS = [
  { name: 'Mountain', code: 'MTN', weight: 0.24, growth: 0.055, branches: [
    { code: 'MTN-101', name: 'Denver Union Station', city: 'Denver', state: 'CO' }, { code: 'MTN-102', name: 'Boulder Pearl Street', city: 'Boulder', state: 'CO' },
    { code: 'MTN-103', name: 'Colorado Springs Garden', city: 'Colorado Springs', state: 'CO' }, { code: 'MTN-104', name: 'Salt Lake Temple Square', city: 'Salt Lake City', state: 'UT' }] },
  { name: 'Plains', code: 'PLN', weight: 0.2, growth: 0.03, branches: [
    { code: 'PLN-201', name: 'Omaha Old Market', city: 'Omaha', state: 'NE' }, { code: 'PLN-202', name: 'Wichita Riverside', city: 'Wichita', state: 'KS' },
    { code: 'PLN-203', name: 'Kansas City Crossroads', city: 'Kansas City', state: 'MO' }, { code: 'PLN-204', name: 'Sioux Falls Falls Park', city: 'Sioux Falls', state: 'SD' }] },
  { name: 'Great Lakes', code: 'GLK', weight: 0.32, growth: 0.012, branches: [
    { code: 'GLK-301', name: 'Chicago West Loop', city: 'Chicago', state: 'IL' }, { code: 'GLK-302', name: 'Milwaukee Third Ward', city: 'Milwaukee', state: 'WI' },
    { code: 'GLK-303', name: 'Detroit Corktown', city: 'Detroit', state: 'MI' }, { code: 'GLK-304', name: 'Grand Rapids Heritage Hill', city: 'Grand Rapids', state: 'MI' }] },
  { name: 'Southeast', code: 'SE', weight: 0.24, growth: 0.072, branches: [
    { code: 'SE-401', name: 'Atlanta Midtown', city: 'Atlanta', state: 'GA' }, { code: 'SE-402', name: 'Charlotte South End', city: 'Charlotte', state: 'NC' },
    { code: 'SE-403', name: 'Nashville Gulch', city: 'Nashville', state: 'TN' }, { code: 'SE-404', name: 'Raleigh Glenwood', city: 'Raleigh', state: 'NC' }] },
] as const;

export const REGION_BY_CODE: Record<string, string> = { MTN: 'Mountain', PLN: 'Plains', GLK: 'Great Lakes', SE: 'Southeast' };

/** Q3 2026 deposit drift per branch (Jun → Sep); a few branches lose deposits to rate shoppers. */
export const BRANCH_Q3_DRIFT: Record<string, number> = {
  'MTN-101': 0.018, 'MTN-102': -0.034, 'MTN-103': 0.012, 'MTN-104': 0.026,
  'PLN-201': 0.004, 'PLN-202': -0.021, 'PLN-203': 0.009, 'PLN-204': 0.015,
  'GLK-301': -0.047, 'GLK-302': -0.012, 'GLK-303': -0.028, 'GLK-304': 0.006,
  'SE-401': 0.031, 'SE-402': 0.022, 'SE-403': -0.009, 'SE-404': 0.027,
};

export const SEGMENTS = [
  { name: 'Mass retail', weight: 0.7, costToServe: 185, fees: 95 },
  { name: 'Affluent', weight: 0.14, costToServe: 270, fees: 240 },
  { name: 'Small business', weight: 0.11, costToServe: 820, fees: 560 },
  { name: 'Commercial', weight: 0.05, costToServe: 2_900, fees: 3_400 },
] as const;

export const DEPOSIT_PRODUCTS = [
  { code: 'DDA', label: 'Checking', rate: 0.0012, runoff: 0.04, median: 4_200 },
  { code: 'SAV', label: 'Savings', rate: 0.0085, runoff: 0.05, median: 9_500 },
  { code: 'MMDA', label: 'Money market', rate: 0.031, runoff: 0.1, median: 42_000 },
  { code: 'CD', label: 'Certificate of deposit', rate: 0.0415, runoff: 0.03, median: 31_000 },
  { code: 'BDDA', label: 'Business checking', rate: 0.0025, runoff: 0.25, median: 38_000 },
  { code: 'SWEEP', label: 'Commercial sweep', rate: 0.034, runoff: 0.4, median: 310_000 },
] as const;

export const LOAN_SEGMENTS = [
  { name: 'Commercial real estate', code: 'CRE', weight: 0.07, median: 640_000, yield: 0.0645, stress: 1.55, reserve: 0.017, nco: 0.025, riskWeight: 1.0 },
  { name: 'Commercial & industrial', code: 'CI', weight: 0.13, median: 210_000, yield: 0.0725, stress: 1.3, reserve: 0.015, nco: 0.03, riskWeight: 1.0 },
  { name: 'Residential mortgage', code: 'RESI', weight: 0.24, median: 205_000, yield: 0.0445, stress: 0.72, reserve: 0.0045, nco: 0.008, riskWeight: 0.5 },
  { name: 'Home equity', code: 'HELOC', weight: 0.14, median: 52_000, yield: 0.079, stress: 0.95, reserve: 0.009, nco: 0.02, riskWeight: 1.0 },
  { name: 'Consumer & auto', code: 'CONS', weight: 0.42, median: 19_000, yield: 0.0865, stress: 1.2, reserve: 0.024, nco: 0.06, riskWeight: 1.0 },
] as const;

export const MERCHANT_CATEGORIES = [
  { name: 'Grocery', weight: 0.22, median: 46, fraud: 0.4 },
  { name: 'Restaurants', weight: 0.18, median: 31, fraud: 0.5 },
  { name: 'Fuel', weight: 0.11, median: 44, fraud: 0.9 },
  { name: 'Online retail', weight: 0.14, median: 58, fraud: 2.6 },
  { name: 'Travel & airlines', weight: 0.05, median: 185, fraud: 2.0 },
  { name: 'Electronics', weight: 0.04, median: 165, fraud: 3.2 },
  { name: 'Healthcare', weight: 0.06, median: 92, fraud: 0.3 },
  { name: 'Utilities & telecom', weight: 0.08, median: 88, fraud: 0.2 },
  { name: 'Entertainment', weight: 0.07, median: 38, fraud: 1.1 },
  { name: 'Digital wallets & P2P', weight: 0.05, median: 64, fraud: 3.0 },
] as const;

export const AML_SCENARIOS = [
  { code: 'STRUCT', name: 'Structuring below CTR threshold', weight: 0.21 },
  { code: 'RAPID', name: 'Rapid movement of funds', weight: 0.24 },
  { code: 'HRGEO', name: 'Wire to high-risk geography', weight: 0.12 },
  { code: 'CASH', name: 'Unusual cash activity', weight: 0.18 },
  { code: 'DORM', name: 'Dormant account reactivation', weight: 0.09 },
  { code: 'PEER', name: 'Peer-group deviation', weight: 0.16 },
] as const;

/** Month-end series run Jul 2025 – Sep 2026 (15 months) so Q3 2026 can be compared with Q3 2025. */
export const MONTHS = Array.from({ length: 15 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 6 + i, 1));
  return d.toISOString().slice(0, 7);
});

/** Calibration targets (inside the KPI ranges below). */
export const TARGETS = {
  totalDeposits: 70_400_000_000,
  totalLoans: 60_800_000_000,
  /** NPL ratio by month, Jul 2025 → Sep 2026 (rising slowly through 2026). */
  npl: [0.96, 0.97, 0.99, 1.0, 1.02, 1.03, 1.05, 1.06, 1.07, 1.09, 1.11, 1.12, 1.14, 1.16, 1.18],
  /** Extra balance share 30–89 days past due on top of NPL. */
  earlyDelinquency: 1.15,
  /** Share of non-performing balance on non-accrual while still under 90 days past due. */
  nonAccrualUnder90: 0.22,
  fraudBps: 8.3,
  alertToCase: 0.124,
  lcr: 1.31,
  efficiency: { Mountain: 0.565, Plains: 0.588, 'Great Lakes': 0.624, Southeast: 0.552 } as Record<string, number>,
  /** Deposit pricing multiplier (rate cuts lower deposit costs through 2026). */
  depositBeta: [1.1, 1.09, 1.08, 1.06, 1.05, 1.03, 1.02, 1.01, 1.0, 0.99, 0.98, 0.97, 0.96, 0.95, 0.94],
  securities: 17_200_000_000, securitiesYield: 0.0338, cash: 3_100_000_000, cashYield: 0.0435, borrowings: 5_400_000_000, borrowingRate: 0.0488,
  nonInterestIncomePct: 0.0098,
};

export const VOLUMES = { customers: 2000, loans: 1400, cardActivity: 0.2, alerts: 1450 };

export const KPI_RANGES: KpiRange[] = [
  { kpiId: 'K-01', min: 2_500_000, max: 3_100_000 }, // active customers
  { kpiId: 'K-02', min: 56, max: 72 }, // digital active rate %
  { kpiId: 'K-03', min: 2.2, max: 3.2 }, // products per customer
  { kpiId: 'K-04', min: 16_000, max: 30_000 }, // avg deposit balance per active customer USD
  { kpiId: 'K-05', min: 6, max: 12 }, // customer attrition rate %
  { kpiId: 'K-06', min: 66_000_000_000, max: 74_000_000_000 }, // total deposits USD
  { kpiId: 'K-07', min: 1, max: 6 }, // deposit growth YTD %
  { kpiId: 'K-08', min: 78, max: 92 }, // loan-to-deposit ratio %
  { kpiId: 'K-09', min: 1.4, max: 2.6 }, // cost of deposits %
  { kpiId: 'K-10', min: 115, max: 145 }, // liquidity coverage ratio %
  { kpiId: 'K-11', min: 2.9, max: 3.6 }, // net interest margin %
  { kpiId: 'K-12', min: 54, max: 66 }, // cost-to-income ratio %
  { kpiId: 'K-13', min: 56_000_000_000, max: 66_000_000_000 }, // total loans USD
  { kpiId: 'K-14', min: 0.8, max: 1.4 }, // NPL ratio %
  { kpiId: 'K-15', min: 1.5, max: 3.2 }, // 30+ days past due rate %
  { kpiId: 'K-16', min: 0.2, max: 0.7 }, // net charge-off ratio % (annualised)
  { kpiId: 'K-17', min: 110, max: 220 }, // allowance coverage of NPLs %
  { kpiId: 'K-18', min: 5.2, max: 6.8 }, // loan yield %
  { kpiId: 'K-19', min: 2_000_000_000, max: 3_800_000_000 }, // card purchase volume per quarter USD
  { kpiId: 'K-20', min: 5, max: 12 }, // card fraud loss bps
  { kpiId: 'K-21', min: 95, max: 98.5 }, // authorisation approval rate %
  { kpiId: 'K-22', min: 40, max: 80 }, // average ticket USD
  { kpiId: 'K-23', min: 9_000, max: 16_000 }, // AML alerts raised per quarter
  { kpiId: 'K-24', min: 8, max: 18 }, // AML alert-to-case rate %
  { kpiId: 'K-25', min: 20, max: 45 }, // SAR conversion rate %
  { kpiId: 'K-26', min: 7, max: 20 }, // avg alert disposition days
  { kpiId: 'K-27', min: 400, max: 1_800 }, // avg net profit per customer USD (12 months)
  { kpiId: 'K-28', min: 18, max: 40 }, // unprofitable customer share %
];
