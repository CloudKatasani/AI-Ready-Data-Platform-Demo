// Harbor & Pine generator config (spec section 6): entities, volumes, distributions and KPI target ranges.
import type { KpiRange } from '../../types';
import { AS_OF_DATE } from '../shared/catalog-kit';

export const AS_OF = AS_OF_DATE;

/** Production sizes the sample stands in for. */
export const PRODUCTION = { stores: 640, members: 5_200_000 };

export const REGIONS = [
  { name: 'Northeast', code: 'NE', stores: 18, comp: 0.028, towns: [['Framingham', 'MA'], ['Burlington', 'MA'], ['Nashua', 'NH'], ['Stamford', 'CT'], ['White Plains', 'NY'], ['Albany', 'NY'], ['Providence', 'RI'], ['Portland', 'ME']] },
  { name: 'Mid-Atlantic', code: 'MID', stores: 15, comp: 0.034, towns: [['King of Prussia', 'PA'], ['Paramus', 'NJ'], ['Bethesda', 'MD'], ['Cherry Hill', 'NJ'], ['Wilmington', 'DE'], ['Pittsburgh', 'PA'], ['Tysons', 'VA']] },
  { name: 'Midwest', code: 'MW', stores: 17, comp: 0.022, towns: [['Columbus', 'OH'], ['Naperville', 'IL'], ['Ann Arbor', 'MI'], ['Edina', 'MN'], ['Carmel', 'IN'], ['Overland Park', 'KS'], ['Madison', 'WI']] },
  { name: 'West', code: 'WST', stores: 14, comp: 0.048, towns: [['Pasadena', 'CA'], ['San Jose', 'CA'], ['Bellevue', 'WA'], ['Portland', 'OR'], ['Boulder', 'CO'], ['Scottsdale', 'AZ'], ['Irvine', 'CA']] },
] as const;

export const REGION_NAMES = REGIONS.map((r) => r.name);
/** Bronze and some Silver tables carry region codes; the row access policy maps them to region names. */
export const REGION_CODE_MAP: Record<string, string> = { NE: 'Northeast', MID: 'Mid-Atlantic', MW: 'Midwest', WST: 'West' };

export const FORMATS = [
  { name: 'Flagship', weight: 0.06, factor: 1.8, sqft: 38_000, basket: 1.15 },
  { name: 'Mall', weight: 0.44, factor: 1.0, sqft: 22_000, basket: 1.0 },
  { name: 'Lifestyle center', weight: 0.35, factor: 1.1, sqft: 26_000, basket: 1.03 },
  { name: 'Outlet', weight: 0.15, factor: 0.7, sqft: 18_000, basket: 0.85 },
] as const;

export const CATEGORIES = [
  { name: 'Furniture', code: 'FURN', skus: 140, units: 70, cost: 185, wos: 14, products: 30 },
  { name: 'Bedding & Bath', code: 'BEDB', skus: 380, units: 700, cost: 18, wos: 11, products: 60 },
  { name: 'Kitchen & Dining', code: 'KITC', skus: 460, units: 880, cost: 12, wos: 12, products: 70 },
  { name: 'Home Decor', code: 'DECR', skus: 520, units: 950, cost: 10, wos: 13, products: 80 },
  { name: 'Outdoor Living', code: 'OUTD', skus: 160, units: 95, cost: 70, wos: 9, products: 35 },
  { name: 'Seasonal', code: 'SEAS', skus: 120, units: 420, cost: 7, wos: 8, products: 25 },
] as const;
export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

/** Category seasonality by month (Jan..Dec). */
export const CAT_SEASON: Record<string, number[]> = {
  Furniture: [0.9, 0.85, 0.95, 1.0, 1.05, 1.0, 0.95, 1.0, 1.0, 1.0, 1.1, 1.2],
  'Bedding & Bath': [1.25, 0.9, 0.95, 0.95, 1.0, 0.95, 0.95, 1.2, 1.05, 0.95, 1.05, 1.2],
  'Kitchen & Dining': [0.85, 0.85, 0.9, 0.95, 1.0, 1.0, 0.95, 0.95, 0.95, 1.0, 1.3, 1.45],
  'Home Decor': [0.8, 0.85, 1.0, 1.05, 1.05, 0.95, 0.9, 0.95, 1.05, 1.15, 1.2, 1.3],
  'Outdoor Living': [0.25, 0.35, 0.8, 1.5, 1.9, 1.9, 1.6, 1.2, 0.7, 0.4, 0.25, 0.2],
  Seasonal: [0.4, 0.6, 0.8, 0.6, 0.6, 0.7, 0.9, 0.8, 1.2, 1.8, 2.2, 2.4],
};

/** Store-sales seasonality by month (Jan..Dec) and by day of week (Sun..Sat). */
export const SEASON = [0.82, 0.8, 0.92, 0.96, 1.02, 0.98, 0.95, 1.0, 0.9, 0.96, 1.18, 1.52];
export const DOW = [1.22, 0.78, 0.8, 0.84, 0.92, 1.12, 1.38];

/** Promotion calendar. TY events have their own lift; the same events ran last year (364 days earlier) where `ly` is set. */
export interface PromoSpec {
  id: string; name: string; type: 'Event' | 'Clearance' | 'Category event' | 'Loyalty offer';
  from: string; to: string; regions: string[]; lift: number; discountPct: number; vendorFundedPct: number;
  itemLift: number; redemption: number; categories: string[];
}
const ALL = ['Northeast', 'Mid-Atlantic', 'Midwest', 'West'];
export const PROMOS_2026: PromoSpec[] = [
  { id: 'PR-2601-01', name: 'Winter White Sale', type: 'Category event', from: '2026-01-08', to: '2026-01-25', regions: ALL, lift: 0.04, discountPct: 0.25, vendorFundedPct: 0.35, itemLift: 0.55, redemption: 0.12, categories: ['Bedding & Bath'] },
  { id: 'PR-2602-01', name: 'Presidents’ Day Furniture Event', type: 'Event', from: '2026-02-12', to: '2026-02-17', regions: ALL, lift: 0.05, discountPct: 0.2, vendorFundedPct: 0.4, itemLift: 0.6, redemption: 0.1, categories: ['Furniture'] },
  { id: 'PR-2604-01', name: 'Spring Refresh', type: 'Event', from: '2026-04-09', to: '2026-04-19', regions: ALL, lift: 0.05, discountPct: 0.2, vendorFundedPct: 0.35, itemLift: 0.5, redemption: 0.11, categories: ['Home Decor', 'Kitchen & Dining'] },
  { id: 'PR-2605-01', name: 'Memorial Day Sale', type: 'Event', from: '2026-05-21', to: '2026-05-26', regions: ALL, lift: 0.07, discountPct: 0.2, vendorFundedPct: 0.4, itemLift: 0.65, redemption: 0.13, categories: ['Furniture', 'Outdoor Living'] },
  { id: 'PR-2606-01', name: 'Summer Kickoff Outdoor', type: 'Category event', from: '2026-06-04', to: '2026-06-14', regions: ALL, lift: 0.04, discountPct: 0.15, vendorFundedPct: 0.5, itemLift: 0.6, redemption: 0.09, categories: ['Outdoor Living'] },
  // Q3 2026 ("last quarter")
  { id: 'PR-2607-01', name: '4th of July Home Sale', type: 'Event', from: '2026-07-01', to: '2026-07-06', regions: ALL, lift: 0.065, discountPct: 0.2, vendorFundedPct: 0.4, itemLift: 0.7, redemption: 0.14, categories: ['Furniture', 'Outdoor Living', 'Kitchen & Dining'] },
  { id: 'PR-2607-02', name: 'Summer Clearance', type: 'Clearance', from: '2026-07-13', to: '2026-07-26', regions: ALL, lift: 0.02, discountPct: 0.35, vendorFundedPct: 0.15, itemLift: 0.45, redemption: 0.08, categories: ['Outdoor Living', 'Seasonal'] },
  { id: 'PR-2608-01', name: 'Back to Campus', type: 'Category event', from: '2026-08-01', to: '2026-08-16', regions: ['Northeast', 'Mid-Atlantic', 'Midwest'], lift: 0.08, discountPct: 0.15, vendorFundedPct: 0.5, itemLift: 0.8, redemption: 0.16, categories: ['Bedding & Bath', 'Kitchen & Dining'] },
  { id: 'PR-2608-02', name: 'Outdoor Living Event', type: 'Category event', from: '2026-08-06', to: '2026-08-16', regions: ['West'], lift: 0.045, discountPct: 0.2, vendorFundedPct: 0.45, itemLift: 0.6, redemption: 0.12, categories: ['Outdoor Living'] },
  { id: 'PR-2609-01', name: 'Labor Day Weekend Sale', type: 'Event', from: '2026-08-28', to: '2026-09-07', regions: ALL, lift: 0.085, discountPct: 0.25, vendorFundedPct: 0.4, itemLift: 0.6, redemption: 0.15, categories: ['Furniture', 'Bedding & Bath', 'Home Decor'] },
  { id: 'PR-2609-02', name: 'Fall Bedding Refresh', type: 'Category event', from: '2026-09-11', to: '2026-09-20', regions: ['Northeast', 'Mid-Atlantic'], lift: 0.01, discountPct: 0.3, vendorFundedPct: 0.2, itemLift: 0.4, redemption: 0.07, categories: ['Bedding & Bath'] },
  { id: 'PR-2609-03', name: 'Harbor Club Double Points', type: 'Loyalty offer', from: '2026-09-17', to: '2026-09-27', regions: ['Midwest', 'West'], lift: 0.055, discountPct: 0.1, vendorFundedPct: 0.0, itemLift: 0.35, redemption: 0.18, categories: ['Home Decor', 'Kitchen & Dining', 'Bedding & Bath'] },
];
/** Prior-year events (2025): same calendar slot, lift as it landed last year. */
export const PROMOS_2025: PromoSpec[] = [
  { id: 'PR-2501-01', name: 'Winter White Sale', type: 'Category event', from: '2025-01-09', to: '2025-01-26', regions: ALL, lift: 0.04, discountPct: 0.25, vendorFundedPct: 0.35, itemLift: 0.5, redemption: 0.11, categories: ['Bedding & Bath'] },
  { id: 'PR-2502-01', name: 'Presidents’ Day Furniture Event', type: 'Event', from: '2025-02-13', to: '2025-02-18', regions: ALL, lift: 0.04, discountPct: 0.2, vendorFundedPct: 0.4, itemLift: 0.55, redemption: 0.1, categories: ['Furniture'] },
  { id: 'PR-2504-01', name: 'Spring Refresh', type: 'Event', from: '2025-04-10', to: '2025-04-20', regions: ALL, lift: 0.03, discountPct: 0.2, vendorFundedPct: 0.35, itemLift: 0.45, redemption: 0.1, categories: ['Home Decor', 'Kitchen & Dining'] },
  { id: 'PR-2505-01', name: 'Memorial Day Sale', type: 'Event', from: '2025-05-22', to: '2025-05-27', regions: ALL, lift: 0.06, discountPct: 0.2, vendorFundedPct: 0.4, itemLift: 0.6, redemption: 0.12, categories: ['Furniture', 'Outdoor Living'] },
  { id: 'PR-2507-01', name: '4th of July Home Sale', type: 'Event', from: '2025-07-02', to: '2025-07-07', regions: ALL, lift: 0.03, discountPct: 0.2, vendorFundedPct: 0.4, itemLift: 0.6, redemption: 0.12, categories: ['Furniture', 'Outdoor Living', 'Kitchen & Dining'] },
  { id: 'PR-2507-02', name: 'Summer Clearance', type: 'Clearance', from: '2025-07-14', to: '2025-07-27', regions: ALL, lift: 0.025, discountPct: 0.35, vendorFundedPct: 0.15, itemLift: 0.45, redemption: 0.08, categories: ['Outdoor Living', 'Seasonal'] },
  { id: 'PR-2508-01', name: 'Back to Campus', type: 'Category event', from: '2025-08-02', to: '2025-08-17', regions: ['Northeast', 'Mid-Atlantic', 'Midwest'], lift: 0.045, discountPct: 0.15, vendorFundedPct: 0.5, itemLift: 0.7, redemption: 0.14, categories: ['Bedding & Bath', 'Kitchen & Dining'] },
  { id: 'PR-2508-02', name: 'Labor Day Weekend Sale', type: 'Event', from: '2025-08-29', to: '2025-09-08', regions: ALL, lift: 0.08, discountPct: 0.25, vendorFundedPct: 0.3, itemLift: 0.65, redemption: 0.15, categories: ['Furniture', 'Bedding & Bath', 'Home Decor'] },
  { id: 'PR-2511-01', name: 'Black Friday Weekend', type: 'Event', from: '2025-11-27', to: '2025-11-30', regions: ALL, lift: 0.18, discountPct: 0.3, vendorFundedPct: 0.35, itemLift: 0.9, redemption: 0.2, categories: ['Furniture', 'Kitchen & Dining', 'Home Decor', 'Bedding & Bath'] },
  { id: 'PR-2512-01', name: 'Holiday Gifting Event', type: 'Event', from: '2025-12-08', to: '2025-12-21', regions: ALL, lift: 0.06, discountPct: 0.2, vendorFundedPct: 0.3, itemLift: 0.5, redemption: 0.12, categories: ['Seasonal', 'Kitchen & Dining', 'Home Decor'] },
];

export const SUPPLIERS = [
  { name: 'Cedar Hollow Furniture Co.', category: 'Furniture', otif: 0.93, asn: 0.95, lead: 45, unitCost: 210, units: 40 },
  { name: 'Ridgeback Imports', category: 'Furniture', otif: 0.81, asn: 0.88, lead: 52, unitCost: 160, units: 60 },
  { name: 'Lakeshore Linens', category: 'Bedding & Bath', otif: 0.95, asn: 0.97, lead: 24, unitCost: 19, units: 600 },
  { name: 'Meridian Home Textiles', category: 'Bedding & Bath', otif: 0.92, asn: 0.94, lead: 28, unitCost: 16, units: 700 },
  { name: 'Northwind Cookware', category: 'Kitchen & Dining', otif: 0.96, asn: 0.98, lead: 21, unitCost: 14, units: 800 },
  { name: 'Brightwater Ceramics', category: 'Kitchen & Dining', otif: 0.885, asn: 0.91, lead: 30, unitCost: 9, units: 900 },
  { name: 'Silverline Glassworks', category: 'Kitchen & Dining', otif: 0.94, asn: 0.96, lead: 26, unitCost: 11, units: 750 },
  { name: 'Atlas Rug Makers', category: 'Home Decor', otif: 0.91, asn: 0.93, lead: 35, unitCost: 48, units: 150 },
  { name: 'Copperfield Lighting', category: 'Home Decor', otif: 0.92, asn: 0.95, lead: 32, unitCost: 26, units: 260 },
  { name: 'Bayside Candle Co.', category: 'Home Decor', otif: 0.97, asn: 0.98, lead: 18, unitCost: 5, units: 1400 },
  { name: 'Pinecrest Outdoor', category: 'Outdoor Living', otif: 0.84, asn: 0.9, lead: 40, unitCost: 75, units: 180 },
  { name: 'Harvest Moon Seasonal', category: 'Seasonal', otif: 0.87, asn: 0.92, lead: 34, unitCost: 6, units: 1200 },
] as const;

export const DCS = ['DC East – Allentown PA', 'DC Central – Joliet IL', 'DC West – Ontario CA'] as const;

export const RETURN_REASONS = ['Changed mind', 'Damaged in transit', 'Defective', 'Not as described', 'Wrong item shipped', 'Size / fit'] as const;
export const RETURN_REASON_WEIGHTS = [0.34, 0.18, 0.14, 0.14, 0.08, 0.12];

/** Calibration targets (inside the KPI ranges below). */
export const TARGETS = { compYtd: 0.034 };

export const VOLUMES = { members: 2000, poLines: 3000, promoSalesPerDay: 20, returns: 2600 };
/** Sample-to-production multipliers for counts that are shown as system totals. */
export const SCALES = { promoSales: 200, returns: 520, po: 60 };

export const KPI_RANGES: KpiRange[] = [
  { kpiId: 'K-01', min: 3_300_000, max: 4_200_000 }, // active loyalty members
  { kpiId: 'K-02', min: 55, max: 68 }, // loyalty share of sales %
  { kpiId: 'K-03', min: 220, max: 400 }, // avg annual spend per active member
  { kpiId: 'K-04', min: 55, max: 75 }, // repeat purchase rate %
  { kpiId: 'K-05', min: 22, max: 36 }, // omnichannel member share %
  { kpiId: 'K-06', min: 1, max: 7 }, // comparable store sales %
  { kpiId: 'K-07', min: 2_400_000_000, max: 3_600_000_000 }, // net sales YTD
  { kpiId: 'K-08', min: 70, max: 95 }, // basket size USD
  { kpiId: 'K-09', min: 2.0, max: 3.0 }, // units per transaction
  { kpiId: 'K-10', min: 18, max: 28 }, // e-commerce share %
  { kpiId: 'K-11', min: 7, max: 14 }, // discount rate %
  { kpiId: 'K-12', min: 45, max: 68 }, // sell-through %
  { kpiId: 'K-13', min: 3.2, max: 5.5 }, // inventory turns
  { kpiId: 'K-14', min: 3, max: 8 }, // out-of-stock rate %
  { kpiId: 'K-15', min: 8, max: 16 }, // weeks of supply
  { kpiId: 'K-16', min: 300_000_000, max: 650_000_000 }, // inventory at cost
  { kpiId: 'K-17', min: 85, max: 96 }, // supplier OTIF %
  { kpiId: 'K-18', min: 93, max: 99.5 }, // fill rate %
  { kpiId: 'K-19', min: 20, max: 40 }, // lead time days
  { kpiId: 'K-20', min: 90, max: 99 }, // ASN accuracy %
  { kpiId: 'K-21', min: 1_000_000_000, max: 2_600_000_000 }, // PO spend 12 months
  { kpiId: 'K-22', min: 0.7, max: 2.2 }, // promotion ROI
  { kpiId: 'K-23', min: 25, max: 75 }, // promotional lift %
  { kpiId: 'K-24', min: 8, max: 18 }, // redemption rate %
  { kpiId: 'K-25', min: 650, max: 1_200 }, // avg predicted CLV
  { kpiId: 'K-26', min: 8, max: 12 }, // return rate %
  { kpiId: 'K-27', min: 2, max: 5.5 }, // suspicious return rate %
];
