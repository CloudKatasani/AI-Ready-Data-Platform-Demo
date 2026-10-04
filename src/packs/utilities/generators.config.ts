// Utilities generator config (spec section 6): entities, volumes, distributions and KPI target ranges.
import type { KpiRange } from '../../types';

export const AS_OF = '2026-09-30';
export const SERVED_TOTAL = 1_385_000;

export const OPCOS = [
  { name: 'Northvale Ohio', code: 'OH', region: 'North', weight: 0.42, circuits: 50, towns: [{ city: 'Lakeport', state: 'OH' }, { city: 'Ridgefield', state: 'OH' }] },
  { name: 'Northvale Indiana', code: 'IN', region: 'Central', weight: 0.26, circuits: 31, towns: [{ city: 'Ashbury', state: 'IN' }, { city: 'Brayton', state: 'IN' }] },
  { name: 'Northvale Kentucky', code: 'KY', region: 'South', weight: 0.14, circuits: 17, towns: [{ city: 'Cedar Falls', state: 'KY' }] },
  { name: 'Northvale Appalachia', code: 'AP', region: 'East', weight: 0.18, circuits: 22, towns: [{ city: 'Millbrook', state: 'WV' }, { city: 'Harlow', state: 'VA' }] },
] as const;

export const STATE_TO_OPCO: Record<string, string> = { OH: 'Northvale Ohio', IN: 'Northvale Indiana', KY: 'Northvale Kentucky', WV: 'Northvale Appalachia', VA: 'Northvale Appalachia' };

export const RATE_CLASSES = [
  { code: 'RS-1', label: 'Residential', segment: 'Residential', weight: 0.7, kwhDay: 30, residential: true },
  { code: 'RS-TOU', label: 'Residential time-of-use', segment: 'Residential', weight: 0.15, kwhDay: 28, residential: true },
  { code: 'GS-1', label: 'Small commercial', segment: 'Small business', weight: 0.11, kwhDay: 95, residential: false },
  { code: 'GS-2', label: 'Large commercial', segment: 'Commercial & industrial', weight: 0.04, kwhDay: 640, residential: false },
] as const;

export const SUPPLIERS = [
  { name: 'Keystone Transformer Co.', category: 'Transformers', otif: 0.95, contract: 0.93, spendMedian: 48000 },
  { name: 'Granite Line Hardware', category: 'Poles & crossarms', otif: 0.94, contract: 0.88, spendMedian: 9000 },
  { name: 'Apex Pole & Timber', category: 'Poles & crossarms', otif: 0.83, contract: 0.84, spendMedian: 14000 },
  { name: 'Brightline Meters', category: 'Meters', otif: 0.97, contract: 0.95, spendMedian: 21000 },
  { name: 'Summit Cable Works', category: 'Conductor & cable', otif: 0.86, contract: 0.82, spendMedian: 26000 },
  { name: 'Ridgeway Fleet Services', category: 'Fleet', otif: 0.93, contract: 0.55, spendMedian: 7000 },
  { name: 'Clearcut Vegetation LLC', category: 'Vegetation services', otif: 0.95, contract: 0.62, spendMedian: 16000 },
  { name: 'Ironwood Substation Supply', category: 'Substation equipment', otif: 0.96, contract: 0.9, spendMedian: 52000 },
] as const;

export const CAUSES = ['Tree contact', 'Equipment failure', 'Animal', 'Weather – wind', 'Lightning', 'Vehicle accident', 'Unknown'] as const;
export const CAUSE_WEIGHTS = [0.27, 0.22, 0.14, 0.12, 0.09, 0.06, 0.1];

/** Major event days (IEEE 1366 2.5 beta) seeded into the outage history. */
export const MAJOR_EVENT_DAYS = ['2025-04-03', '2025-07-29', '2025-12-11', '2026-02-16', '2026-06-22'];

/** Seasonal bill factors by month (Jan..Dec). */
export const SEASONAL = [1.15, 1.08, 0.95, 0.88, 0.9, 1.0, 1.08, 1.1, 0.98, 0.92, 0.97, 1.08];

/** Calibration targets (inside the KPI ranges below). */
export const TARGETS = {
  saifi: { '2025': 1.17, '2026': 1.08 },
  caidi: { '2025': 118, '2026': 112 },
  spendUnderContract: 0.81,
  residentialBillBase: 133,
};

export const VOLUMES = { customers: 2000, usageDays: 30, billMonths: 12, outages: 1800, poLines: 3000, spans: 600 };

export const KPI_RANGES: KpiRange[] = [
  { kpiId: 'K-01', min: 1_200_000, max: 1_385_000 }, // active customers
  { kpiId: 'K-02', min: 128, max: 146 }, // avg monthly residential bill
  { kpiId: 'K-03', min: 80_000_000, max: 200_000_000 }, // arrears balance (scaled USD)
  { kpiId: 'K-04', min: 40, max: 52 }, // digital adoption %
  { kpiId: 'K-05', min: 20, max: 40 }, // avg churn risk score
  { kpiId: 'K-06', min: 95, max: 140 }, // SAIDI
  { kpiId: 'K-07', min: 0.9, max: 1.3 }, // SAIFI
  { kpiId: 'K-08', min: 100, max: 125 }, // CAIDI
  { kpiId: 'K-09', min: 1_000_000, max: 2_000_000 }, // customers interrupted YTD
  { kpiId: 'K-10', min: 100_000_000, max: 220_000_000 }, // CMI YTD
  { kpiId: 'K-11', min: 40, max: 90 }, // daily consumption kWh per premise (all rate classes)
  { kpiId: 'K-12', min: 1.5, max: 30 }, // peak demand kW per premise
  { kpiId: 'K-13', min: 98.5, max: 99.9 }, // read success %
  { kpiId: 'K-14', min: 0.5, max: 4 }, // estimated reads %
  { kpiId: 'K-15', min: 50_000_000, max: 400_000_000 }, // total spend
  { kpiId: 'K-16', min: 78, max: 84 }, // spend under contract %
  { kpiId: 'K-17', min: 85, max: 97 }, // supplier OTIF %
  { kpiId: 'K-18', min: 15, max: 30 }, // PO cycle time days
  { kpiId: 'K-19', min: 10_000_000, max: 80_000_000 }, // maverick spend
  { kpiId: 'K-20', min: 30, max: 48 }, // DSO
  { kpiId: 'K-21', min: 1_200_000, max: 1_400_000 }, // bills issued per month (scaled)
  { kpiId: 'K-22', min: 1, max: 6 }, // estimated bill rate %
  { kpiId: 'K-23', min: 92, max: 99 }, // collections rate %
  { kpiId: 'K-24', min: 8, max: 25 }, // spans overdue %
  { kpiId: 'K-25', min: 50, max: 500 }, // tree-caused outages per quarter
  { kpiId: 'K-26', min: 75, max: 92 }, // trim cycle compliance %
];
