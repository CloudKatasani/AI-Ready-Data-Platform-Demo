// Westland County Services generator config (spec section 6): districts, offices, programs, 311 request types,
// departments, volumes, calibration targets and KPI target ranges.
import type { KpiRange } from '../../types';
import { AS_OF_DATE } from '../shared/catalog-kit';

export const AS_OF = AS_OF_DATE;
export const RESIDENTS = 1_100_000;
/** Residents with a constituent record in case management (the population DP-01 describes). */
export const CONSTITUENTS_TOTAL = 312_000;
/** Filled caseworker positions across all offices (eligibility + case management). */
export const CASEWORKERS_TOTAL = 2_600;
/** Production volumes used to scale the samples. */
export const APPS_PER_MONTH = 9_200;
export const SR_PER_DAY = 920;

export const DISTRICTS = [
  { name: 'North District', code: 'ND', weight: 0.27, residents: 297_000, offices: [{ code: 'ND-01', name: 'Northgate Service Center', city: 'Northgate' }, { code: 'ND-02', name: 'Pine Hollow Office', city: 'Pine Hollow' }] },
  { name: 'Central District', code: 'CD', weight: 0.31, residents: 341_000, offices: [{ code: 'CD-01', name: 'Civic Plaza Service Center', city: 'Westland City' }, { code: 'CD-02', name: 'Market Street Office', city: 'Westland City' }] },
  { name: 'South District', code: 'SD', weight: 0.22, residents: 242_000, offices: [{ code: 'SD-01', name: 'Southfield Service Center', city: 'Southfield' }, { code: 'SD-02', name: 'Bayview Office', city: 'Bayview' }] },
  { name: 'Riverside District', code: 'RD', weight: 0.2, residents: 220_000, offices: [{ code: 'RD-01', name: 'Riverside Service Center', city: 'Riverside' }, { code: 'RD-02', name: 'Mill Creek Office', city: 'Mill Creek' }] },
] as const;

export const DISTRICT_BY_CODE: Record<string, string> = { ND: 'North District', CD: 'Central District', SD: 'South District', RD: 'Riverside District' };

export const PROGRAMS = [
  { code: 'FA', name: 'Food Assistance', weight: 0.32, pays: true, median: 262, seasonal: false, renewalMonths: 12 },
  { code: 'CA', name: 'Cash Assistance', weight: 0.045, pays: true, median: 520, seasonal: false, renewalMonths: 6 },
  { code: 'MA', name: 'Medical Assistance', weight: 0.52, pays: false, median: 0, seasonal: false, renewalMonths: 12 },
  { code: 'CCS', name: 'Child Care Subsidy', weight: 0.04, pays: true, median: 790, seasonal: false, renewalMonths: 12 },
  { code: 'EA', name: 'Energy Assistance', weight: 0.075, pays: true, median: 205, seasonal: true, renewalMonths: 12 },
] as const;

export const SR_TYPES = [
  { type: 'Pothole', dept: 'Public Works', sla: 5, weight: 0.17, median: 2.6 },
  { type: 'Missed trash pickup', dept: 'Solid Waste', sla: 2, weight: 0.16, median: 0.9 },
  { type: 'Streetlight out', dept: 'Public Works', sla: 7, weight: 0.1, median: 3.6 },
  { type: 'Graffiti removal', dept: 'Parks & Facilities', sla: 5, weight: 0.07, median: 2.3 },
  { type: 'Noise complaint', dept: 'Code Enforcement', sla: 3, weight: 0.09, median: 1.2 },
  { type: 'Benefits inquiry', dept: 'Human Services', sla: 2, weight: 0.14, median: 0.8 },
  { type: 'Abandoned vehicle', dept: 'Code Enforcement', sla: 10, weight: 0.07, median: 5.0 },
  { type: 'Water leak', dept: 'Utilities & Water', sla: 1, weight: 0.06, median: 0.4 },
  { type: 'Tree / debris', dept: 'Parks & Facilities', sla: 7, weight: 0.07, median: 3.4 },
  { type: 'Housing inspection', dept: 'Code Enforcement', sla: 14, weight: 0.06, median: 7.2 },
] as const;

export const SR_CHANNELS = ['Phone', 'Mobile app', 'Web', 'Walk-in'] as const;
export const SR_CHANNEL_WEIGHTS = [0.42, 0.29, 0.21, 0.08];
export const APP_CHANNELS = ['Online', 'In person', 'Phone', 'Mail'] as const;
export const APP_CHANNEL_WEIGHTS = [0.53, 0.24, 0.14, 0.09];
export const LANGUAGES = ['English', 'Spanish', 'Vietnamese', 'Somali', 'Tagalog'] as const;
export const LANGUAGE_WEIGHTS = [0.71, 0.19, 0.04, 0.03, 0.03];
export const FLAG_REASONS = ['Unreported income match', 'Duplicate participation', 'Address outside county', 'Identity verification', 'Employment data match'] as const;
export const ERROR_TYPES = ['Income verification', 'Household composition', 'Administrative error', 'Duplicate issuance'] as const;

/** Monthly budget (USD) and authorised FTE per department; administrative ones drive cost per case. */
export const DEPARTMENTS = [
  { name: 'Eligibility Services', admin: true, share: 0.46, fte: 1_580 },
  { name: 'Case Management', admin: true, share: 0.33, fte: 1_120 },
  { name: 'Administration & IT', admin: true, share: 0.21, fte: 390 },
  { name: 'Program Integrity', admin: false, monthly: 1_650_000, fte: 140 },
  { name: '311 Contact Center', admin: false, monthly: 2_150_000, fte: 210 },
  { name: 'Child Care Services', admin: false, monthly: 1_400_000, fte: 160 },
] as const;

/** County holidays (business days exclude weekends and these dates). */
export const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-11', '2025-11-27', '2025-11-28', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25',
]);

/** Calibration targets (inside the KPI ranges below). */
export const TARGETS = {
  avgProcessingDays: { '2025': 22.6, '2026': 20.4 },
  backlogShare: 0.032,
  flagRate: 0.024,
  costPerCase: 515,
  budgetExecution: 0.946,
};

export const VOLUMES = { constituents: 2000, applications: 4200, srPerDay: 46 };

export const KPI_RANGES: KpiRange[] = [
  { kpiId: 'K-01', min: 230_000, max: 290_000 }, // active constituents
  { kpiId: 'K-02', min: 20, max: 40 }, // multi-program enrollment %
  { kpiId: 'K-03', min: 70, max: 88 }, // constituent satisfaction %
  { kpiId: 'K-04', min: 40, max: 65 }, // digital self-service rate %
  { kpiId: 'K-05', min: 22_000, max: 36_000 }, // 311 service requests per month
  { kpiId: 'K-06', min: 2, max: 6 }, // 311 resolution time (days)
  { kpiId: 'K-07', min: 78, max: 93 }, // 311 on-time resolution %
  { kpiId: 'K-08', min: 2, max: 8 }, // 311 reopen rate %
  { kpiId: 'K-09', min: 7_000, max: 16_000 }, // case backlog
  { kpiId: 'K-10', min: 17, max: 26 }, // average processing days (business days)
  { kpiId: 'K-11', min: 5_000, max: 16_000 }, // applications over the 30-day standard (YTD)
  { kpiId: 'K-12', min: 82, max: 94 }, // timely processing rate %
  { kpiId: 'K-13', min: 60, max: 80 }, // approval rate %
  { kpiId: 'K-14', min: 100, max: 160 }, // average caseload per caseworker
  { kpiId: 'K-15', min: 7_500, max: 11_500 }, // applications received per month
  { kpiId: 'K-16', min: 250_000_000, max: 650_000_000 }, // benefits paid YTD
  { kpiId: 'K-17', min: 94, max: 98.5 }, // payment accuracy %
  { kpiId: 'K-18', min: 1.5, max: 6 }, // improper payment rate %
  { kpiId: 'K-19', min: 5_000_000, max: 35_000_000 }, // improper payments YTD (USD)
  { kpiId: 'K-20', min: 95, max: 99.5 }, // on-time payment rate %
  { kpiId: 'K-21', min: 380, max: 650 }, // administrative cost per case per year (USD)
  { kpiId: 'K-22', min: 1_200, max: 4_500 }, // cases flagged for review
  { kpiId: 'K-23', min: 1, max: 4.5 }, // integrity flag rate %
  { kpiId: 'K-24', min: 35, max: 65 }, // overpayment recovery rate %
  { kpiId: 'K-25', min: 88, max: 102 }, // budget execution %
  { kpiId: 'K-26', min: 6, max: 15 }, // caseworker vacancy %
];
