// Healthcare generator config (spec section 6): entities, volumes, distributions and KPI target ranges.
import type { KpiRange } from '../../types';
import { AS_OF_DATE } from '../shared/catalog-kit';

export const AS_OF = AS_OF_DATE;

/** Production sizes the sample stands in for (system totals are scaled by production ÷ sample). */
export const PRODUCTION = {
  patients: 1_240_000,
  ipDischargesPerYear: 198_000,
  edVisitsPerYear: 655_000,
  appointmentsPerYear: 2_650_000,
  claimsPerYear: 3_480_000,
};

export const MARKETS = [
  { name: 'North', code: 'NTH', weight: 0.26, towns: ['Lakeshore', 'Pinehurst', 'Northgate'] },
  { name: 'Central', code: 'CEN', weight: 0.35, towns: ['Crestview', 'Midtown', 'Fairview'] },
  { name: 'Coastal', code: 'CST', weight: 0.19, towns: ['Bayside', 'Seacliff', 'Dunmore'] },
  { name: 'Valley', code: 'VAL', weight: 0.2, towns: ['Valley Springs', 'Orchard', 'Willow Creek'] },
] as const;

export const MARKET_CODE_MAP: Record<string, string> = Object.fromEntries(MARKETS.map((m) => [m.code, m.name]));

/** 14 hospitals. weight = share of inpatient volume within the system; factors shape LOS and ED wait. */
export const HOSPITALS = [
  { code: 'LKS', name: 'Crestview Lakeshore Medical Center', market: 'North', city: 'Lakeshore', weight: 0.11, losF: 1.04, edF: 1.12, targetOcc: 0.86, trauma: 'II' },
  { code: 'PNH', name: 'Crestview Pinehurst Hospital', market: 'North', city: 'Pinehurst', weight: 0.06, losF: 0.97, edF: 0.92, targetOcc: 0.74, trauma: 'IV' },
  { code: 'NGT', name: 'Crestview Northgate Community Hospital', market: 'North', city: 'Northgate', weight: 0.05, losF: 0.94, edF: 0.88, targetOcc: 0.71, trauma: 'None' },
  { code: 'HLD', name: 'Crestview Highland Hospital', market: 'North', city: 'Pinehurst', weight: 0.04, losF: 0.96, edF: 0.95, targetOcc: 0.76, trauma: 'None' },
  { code: 'RMC', name: 'Crestview Regional Medical Center', market: 'Central', city: 'Crestview', weight: 0.15, losF: 1.12, edF: 1.22, targetOcc: 0.91, trauma: 'I' },
  { code: 'MTN', name: 'Crestview Midtown Hospital', market: 'Central', city: 'Midtown', weight: 0.08, losF: 1.0, edF: 1.08, targetOcc: 0.84, trauma: 'III' },
  { code: 'FRV', name: 'Crestview Fairview Hospital', market: 'Central', city: 'Fairview', weight: 0.06, losF: 0.98, edF: 0.97, targetOcc: 0.79, trauma: 'IV' },
  { code: 'ELM', name: 'Crestview Elmwood Hospital', market: 'Central', city: 'Crestview', weight: 0.06, losF: 0.95, edF: 0.9, targetOcc: 0.75, trauma: 'None' },
  { code: 'BAY', name: 'Crestview Bayside Medical Center', market: 'Coastal', city: 'Bayside', weight: 0.1, losF: 1.06, edF: 1.15, targetOcc: 0.88, trauma: 'II' },
  { code: 'SCF', name: 'Crestview Seacliff Hospital', market: 'Coastal', city: 'Seacliff', weight: 0.05, losF: 0.97, edF: 1.0, targetOcc: 0.77, trauma: 'IV' },
  { code: 'DUN', name: 'Crestview Dunmore Hospital', market: 'Coastal', city: 'Dunmore', weight: 0.04, losF: 0.93, edF: 0.86, targetOcc: 0.69, trauma: 'None' },
  { code: 'VMC', name: 'Crestview Valley Medical Center', market: 'Valley', city: 'Valley Springs', weight: 0.11, losF: 1.05, edF: 1.1, targetOcc: 0.85, trauma: 'II' },
  { code: 'ORC', name: 'Crestview Orchard Hospital', market: 'Valley', city: 'Orchard', weight: 0.05, losF: 0.96, edF: 0.94, targetOcc: 0.78, trauma: 'IV' },
  { code: 'WCK', name: 'Crestview Willow Creek Hospital', market: 'Valley', city: 'Willow Creek', weight: 0.04, losF: 0.95, edF: 0.9, targetOcc: 0.72, trauma: 'None' },
] as const;

export const FACILITY_TO_MARKET: Record<string, string> = Object.fromEntries(HOSPITALS.map((h) => [h.code, h.market]));

/** Inpatient service lines: share of admissions, median LOS (days), base 30-day readmission and mortality rates. */
export const SERVICE_LINES = [
  { name: 'Cardiology', code: 'CARD', weight: 0.16, los: 4.6, readmit: 0.19, mort: 0.024, surgical: 0.3, planned: 0.12 },
  { name: 'Pulmonology', code: 'PULM', weight: 0.12, los: 5.1, readmit: 0.18, mort: 0.032, surgical: 0, planned: 0.03 },
  { name: 'General Medicine', code: 'GMED', weight: 0.22, los: 4.4, readmit: 0.16, mort: 0.019, surgical: 0, planned: 0.03 },
  { name: 'Orthopedics', code: 'ORTH', weight: 0.11, los: 3.0, readmit: 0.045, mort: 0.004, surgical: 0.92, planned: 0.62 },
  { name: 'General Surgery', code: 'GSUR', weight: 0.12, los: 5.2, readmit: 0.12, mort: 0.011, surgical: 0.78, planned: 0.32 },
  { name: 'Oncology', code: 'ONC', weight: 0.08, los: 6.2, readmit: 0.18, mort: 0.038, surgical: 0.2, planned: 0.36 },
  { name: 'Neurosciences', code: 'NEUR', weight: 0.07, los: 5.0, readmit: 0.13, mort: 0.028, surgical: 0.16, planned: 0.08 },
  { name: "Women's & Infants", code: 'WOMN', weight: 0.12, los: 2.4, readmit: 0.07, mort: 0.001, surgical: 0.28, planned: 0.4 },
] as const;
export type ServiceLineName = (typeof SERVICE_LINES)[number]['name'];

export const PAYERS = [
  { id: 'MCR-01', name: 'Medicare Traditional', payerClass: 'Medicare', clean: 0.92, denial: 0.82, lag: 18, ratio: 0.31 },
  { id: 'MCR-02', name: 'Tidewell Medicare Advantage', payerClass: 'Medicare', clean: 0.88, denial: 1.3, lag: 31, ratio: 0.33 },
  { id: 'MCD-01', name: 'State Medicaid (FFS)', payerClass: 'Medicaid', clean: 0.86, denial: 1.05, lag: 36, ratio: 0.24 },
  { id: 'MCD-02', name: 'Larkspur Medicaid Managed Care', payerClass: 'Medicaid', clean: 0.85, denial: 1.35, lag: 40, ratio: 0.26 },
  { id: 'COM-01', name: 'Northwind Health PPO', payerClass: 'Commercial', clean: 0.91, denial: 0.9, lag: 24, ratio: 0.5 },
  { id: 'COM-02', name: 'Alderbrook Health HMO', payerClass: 'Commercial', clean: 0.89, denial: 1.15, lag: 28, ratio: 0.46 },
  { id: 'COM-03', name: 'Meridale Employer Plan', payerClass: 'Commercial', clean: 0.9, denial: 0.95, lag: 26, ratio: 0.48 },
  { id: 'SELF', name: 'Self-pay', payerClass: 'Self-pay', clean: 0.97, denial: 0, lag: 58, ratio: 0.22 },
] as const;

export const DENIAL_REASONS = ['Authorization', 'Eligibility', 'Coding', 'Medical necessity', 'Missing information', 'Timely filing', 'Duplicate'] as const;
export const DENIAL_WEIGHTS = [0.24, 0.22, 0.18, 0.16, 0.12, 0.04, 0.04];
export const CARC: Record<string, string> = { Authorization: '197', Eligibility: '27', Coding: '16', 'Medical necessity': '50', 'Missing information': '252', 'Timely filing': '29', Duplicate: '18' };

export const CLINIC_SPECIALTIES = [
  { name: 'Primary Care', weight: 0.45, noShow: 0.1, lag: 14 },
  { name: 'Pediatrics', weight: 0.1, noShow: 0.09, lag: 9 },
  { name: 'OB/GYN', weight: 0.08, noShow: 0.08, lag: 13 },
  { name: 'Cardiology', weight: 0.08, noShow: 0.07, lag: 21 },
  { name: 'Orthopedics', weight: 0.07, noShow: 0.07, lag: 18 },
  { name: 'Oncology', weight: 0.05, noShow: 0.04, lag: 8 },
  { name: 'Neurology', weight: 0.05, noShow: 0.09, lag: 30 },
  { name: 'Behavioral Health', weight: 0.06, noShow: 0.17, lag: 24 },
  { name: 'Endocrinology', weight: 0.06, noShow: 0.1, lag: 27 },
] as const;

export const SUPPLY_ITEMS = [
  { id: 'IMP-4410', desc: 'Total knee implant system', category: 'Implants', vendor: 'Corvane Orthopedics', cost: 4300, lines: ['Orthopedics'] },
  { id: 'IMP-4420', desc: 'Total hip implant system', category: 'Implants', vendor: 'Corvane Orthopedics', cost: 4800, lines: ['Orthopedics'] },
  { id: 'IMP-4470', desc: 'Spinal fixation screw set', category: 'Implants', vendor: 'Corvane Orthopedics', cost: 3600, lines: ['Orthopedics', 'Neurosciences'] },
  { id: 'CRD-2210', desc: 'Drug-eluting coronary stent', category: 'Cardiac devices', vendor: 'Halvard Cardio Devices', cost: 1350, lines: ['Cardiology'] },
  { id: 'CRD-2290', desc: 'Diagnostic catheter kit', category: 'Cardiac devices', vendor: 'Halvard Cardio Devices', cost: 420, lines: ['Cardiology'] },
  { id: 'SUR-3105', desc: 'Endoscopic linear stapler', category: 'Surgical instruments', vendor: 'Brightwater Surgical', cost: 640, lines: ['General Surgery', 'Oncology', "Women's & Infants"] },
  { id: 'SUR-3140', desc: 'Hernia mesh, large', category: 'Surgical instruments', vendor: 'Brightwater Surgical', cost: 880, lines: ['General Surgery'] },
  { id: 'SUR-3180', desc: 'Custom procedure pack', category: 'Procedure packs', vendor: 'Pallisade Medical Supply', cost: 210, lines: ['*surgical'] },
  { id: 'MSR-1001', desc: 'Absorbable suture, box', category: 'Med-surg consumables', vendor: 'Pallisade Medical Supply', cost: 62, lines: ['*'] },
  { id: 'MSR-1020', desc: 'IV start kit', category: 'Med-surg consumables', vendor: 'Pallisade Medical Supply', cost: 14, lines: ['*'] },
  { id: 'MSR-1044', desc: 'Foam dressing 6x6', category: 'Wound care', vendor: 'Tessaro Wound Care', cost: 28, lines: ['*'] },
  { id: 'MSR-1090', desc: 'Negative pressure wound kit', category: 'Wound care', vendor: 'Tessaro Wound Care', cost: 310, lines: ['General Surgery', 'Orthopedics'] },
] as const;

export const DRUGS = [
  { ndc: '00409-4888', name: 'Enoxaparin 40 mg', cost: 18, formulary: true, vendor: 'Quenton Pharma Distribution' },
  { ndc: '00338-0049', name: 'Sodium chloride 0.9% 1 L', cost: 3, formulary: true, vendor: 'Quenton Pharma Distribution' },
  { ndc: '00143-9924', name: 'Ceftriaxone 1 g', cost: 9, formulary: true, vendor: 'Quenton Pharma Distribution' },
  { ndc: '63323-0262', name: 'Heparin 5,000 units', cost: 6, formulary: true, vendor: 'Quenton Pharma Distribution' },
  { ndc: '00781-3207', name: 'Piperacillin-tazobactam 3.375 g', cost: 22, formulary: true, vendor: 'Quenton Pharma Distribution' },
  { ndc: '50242-0060', name: 'Pegfilgrastim biosimilar', cost: 2900, formulary: false, vendor: 'Ridgeline Specialty Rx' },
  { ndc: '00002-8215', name: 'Insulin lispro 100 u/mL', cost: 34, formulary: true, vendor: 'Quenton Pharma Distribution' },
  { ndc: '00074-4341', name: 'Apixaban 5 mg', cost: 11, formulary: true, vendor: 'Ridgeline Specialty Rx' },
] as const;

export const VENDOR_CONTRACT: Record<string, number> = {
  'Corvane Orthopedics': 0.95, 'Halvard Cardio Devices': 0.9, 'Brightwater Surgical': 0.84, 'Pallisade Medical Supply': 0.9,
  'Tessaro Wound Care': 0.62, 'Quenton Pharma Distribution': 0.93, 'Ridgeline Specialty Rx': 0.58,
};

export const CARE_GAP_MEASURES = [
  'Breast cancer screening', 'Colorectal cancer screening', 'Diabetes HbA1c control (<8%)', 'Statin therapy for cardiovascular disease',
  'Controlling high blood pressure', 'Annual wellness visit',
] as const;

/** Calibration targets (inside the KPI ranges below). */
export const TARGETS = {
  readmitRate: { '2025': 0.153, '2026': 0.146 },
  supplyCostPerCase: 3_450,
  onContractSupply: 0.86,
};

export const VOLUMES = { patients: 2000, clinics: 210, edVisits: 7600, appointments: 12_500 };

export const KPI_RANGES: KpiRange[] = [
  { kpiId: 'K-01', min: 850_000, max: 1_150_000 }, // active patients (scaled)
  { kpiId: 'K-02', min: 3.5, max: 9 }, // self-pay share of active patients %
  { kpiId: 'K-03', min: 52, max: 72 }, // patient portal adoption %
  { kpiId: 'K-04', min: 0.8, max: 1.3 }, // average patient risk score
  { kpiId: 'K-05', min: 36, max: 52 }, // days in A/R
  { kpiId: 'K-06', min: 7, max: 12.5 }, // claim denial rate %
  { kpiId: 'K-07', min: 84, max: 93 }, // clean claim rate %
  { kpiId: 'K-08', min: 93, max: 99 }, // net collection rate %
  { kpiId: 'K-09', min: 12, max: 32 }, // A/R over 90 days %
  { kpiId: 'K-10', min: 220_000, max: 360_000 }, // claims submitted per month (scaled)
  { kpiId: 'K-11', min: 4.2, max: 5.4 }, // average length of stay (days)
  { kpiId: 'K-12', min: 72, max: 92 }, // bed occupancy %
  { kpiId: 'K-13', min: 25, max: 45 }, // ED wait time, door to provider (min)
  { kpiId: 'K-14', min: 1, max: 4.5 }, // ED left without being seen %
  { kpiId: 'K-15', min: 13_000, max: 19_000 }, // inpatient discharges per month (scaled)
  { kpiId: 'K-16', min: 8, max: 15 }, // no-show rate %
  { kpiId: 'K-17', min: 10, max: 26 }, // new patient appointment lag (days)
  { kpiId: 'K-18', min: 13, max: 16 }, // 30-day all-cause readmission rate %
  { kpiId: 'K-19', min: 40, max: 65 }, // 7-day post-discharge follow-up rate %
  { kpiId: 'K-20', min: 1.2, max: 3 }, // inpatient mortality %
  { kpiId: 'K-21', min: 15_000, max: 26_000 }, // 30-day readmissions YTD (scaled)
  { kpiId: 'K-22', min: 2_600, max: 4_400 }, // supply cost per surgical case (USD)
  { kpiId: 'K-23', min: 50_000_000, max: 200_000_000 }, // clinical supply & pharmacy spend per quarter (scaled USD)
  { kpiId: 'K-24', min: 80, max: 92 }, // on-contract supply spend %
  { kpiId: 'K-25', min: 55, max: 75 }, // care gap closure rate %
  { kpiId: 'K-26', min: 35, max: 60 }, // patients with open care gaps %
];
