// Pack registry (spec section 4). Packs are code-split and lazy-loaded; only the active pack's data is generated.
import type { IndustryPack, PackId, PackProfile } from '../types';
import { BASE_SEED } from '../mock-snowflake/rng';
import { PROFILE as UTILITIES } from './utilities/pack';

const p = (x: Omit<PackProfile, 'seed' | 'ready' | 'regions'> & { idx: number; regions?: string[] }): PackProfile => ({
  regions: [], ...x, seed: BASE_SEED + x.idx, ready: false,
});

/** Profiles are tiny and always available (start screen, pack selector). Full packs load on demand. */
export const PROFILES: PackProfile[] = [
  UTILITIES,
  p({ idx: 1, id: 'telecom', industry: 'Telecom', company: 'Altair Communications', dbPrefix: 'ALT', account: 'ALT_PROD', icon: 'signal', accent: '#7A5AF8',
    tagline: 'Mobile and broadband operator.', scale: [{ label: 'Mobile subscribers', value: '9.8 M' }, { label: 'Broadband homes', value: '2.1 M' }],
    sources: [{ name: 'BSS billing', system: '' }, { name: 'OSS network events', system: '' }, { name: 'CDR mediation', system: '' }, { name: 'CRM', system: '' }, { name: 'Field service', system: '' }],
    headlineKpis: ['ARPU', 'Churn rate', 'Network availability %'], sensitiveClasses: ['PII', 'CPNI'] }),
  p({ idx: 2, id: 'retail', industry: 'Retail', company: 'Harbor & Pine', dbPrefix: 'HPR', account: 'HPR_PROD', icon: 'bag', accent: '#0E9384',
    tagline: 'Omnichannel home and lifestyle retailer.', scale: [{ label: 'Stores', value: '640' }, { label: 'Channels', value: 'Stores + e-commerce' }],
    sources: [{ name: 'POS transactions', system: '' }, { name: 'E-commerce orders', system: '' }, { name: 'Loyalty', system: '' }, { name: 'WMS inventory', system: '' }, { name: 'Supplier EDI', system: '' }],
    headlineKpis: ['Comparable store sales %', 'Sell-through %', 'Return rate'], sensitiveClasses: ['PII', 'PCI'] }),
  p({ idx: 3, id: 'banking', industry: 'Banking', company: 'Ridgeline Bank', dbPrefix: 'RLB', account: 'RLB_PROD', icon: 'bank', accent: '#2E90FA',
    tagline: 'Regional commercial and retail bank.', scale: [{ label: 'Assets', value: '$84 B' }, { label: 'Customers', value: '3.2 M' }],
    sources: [{ name: 'Core banking', system: '' }, { name: 'Card processing', system: '' }, { name: 'Digital banking events', system: '' }, { name: 'AML case management', system: '' }, { name: 'General ledger', system: '' }],
    headlineKpis: ['Net interest margin', 'NPL ratio', 'Loan-to-deposit ratio'], sensitiveClasses: ['PII', 'PCI', 'NPI'] }),
  p({ idx: 4, id: 'insurance', industry: 'Insurance', company: 'Sentinel Mutual', dbPrefix: 'SMI', account: 'SMI_PROD', icon: 'shield', accent: '#DD2590',
    tagline: 'Property and casualty carrier.', scale: [{ label: 'Policies', value: '4.6 M' }, { label: 'Lines', value: 'P&C' }],
    sources: [{ name: 'Policy administration', system: '' }, { name: 'Claims', system: '' }, { name: 'Billing', system: '' }, { name: 'Agent & broker portal', system: '' }, { name: 'Catastrophe feeds', system: '' }],
    headlineKpis: ['Loss ratio', 'Combined ratio', 'Claims cycle time'], sensitiveClasses: ['PII', 'PHI'] }),
  p({ idx: 5, id: 'healthcare', industry: 'Healthcare', company: 'Crestview Health System', dbPrefix: 'CVH', account: 'CVH_PROD', icon: 'cross', accent: '#E04F5F',
    tagline: 'Integrated delivery network.', scale: [{ label: 'Hospitals', value: '14' }, { label: 'Clinics', value: '210' }],
    sources: [{ name: 'EHR (ADT, encounters)', system: '' }, { name: 'Claims & remits (837/835)', system: '' }, { name: 'Scheduling', system: '' }, { name: 'Pharmacy', system: '' }, { name: 'Supply chain', system: '' }],
    headlineKpis: ['30-day readmission rate', 'Average length of stay', 'Days in A/R'], sensitiveClasses: ['PHI'] }),
  p({ idx: 6, id: 'manufacturing', industry: 'Manufacturing', company: 'Forgepoint Industries', dbPrefix: 'FPI', account: 'FPI_PROD', icon: 'gear', accent: '#667085',
    tagline: 'Diversified industrial manufacturer.', scale: [{ label: 'Plants', value: '22' }, { label: 'Business units', value: '4' }],
    sources: [{ name: 'MES', system: '' }, { name: 'ERP (orders, BOM)', system: '' }, { name: 'IoT sensor historian', system: '' }, { name: 'QMS', system: '' }, { name: 'Supplier portal', system: '' }],
    headlineKpis: ['OEE', 'First-pass yield', 'On-time delivery'], sensitiveClasses: ['PII', 'TRADE_SECRET'] }),
  p({ idx: 7, id: 'public-sector', industry: 'Public Sector', company: 'Westland County Services', dbPrefix: 'WCS', account: 'WCS_PROD', icon: 'civic', accent: '#3E7C5A',
    tagline: 'County human services and constituent services.', scale: [{ label: 'Residents', value: '1.1 M' }],
    sources: [{ name: 'Case management', system: '' }, { name: 'Eligibility', system: '' }, { name: 'Benefits payments', system: '' }, { name: '311 service requests', system: '' }, { name: 'Finance', system: '' }],
    headlineKpis: ['Case backlog', 'Average processing days', 'Improper payment rate'], sensitiveClasses: ['PII', 'GOV_ID'] }),
];

export const PACK_IDS = PROFILES.map((x) => x.id);
export const profileOf = (id: string) => PROFILES.find((x) => x.id === id);

const LOADERS: Partial<Record<PackId, () => Promise<{ buildPack: () => IndustryPack }>>> = {
  utilities: () => import('./utilities'),
};

const cache = new Map<PackId, Promise<IndustryPack>>();

export function isPackReady(id: PackId) {
  return Boolean(LOADERS[id]);
}

export function loadPack(id: PackId): Promise<IndustryPack> {
  const loader = LOADERS[id];
  if (!loader) return Promise.reject(new Error(`Pack ${id} is not built yet`));
  let p = cache.get(id);
  if (!p) {
    p = loader().then((m) => m.buildPack());
    cache.set(id, p);
  }
  return p;
}
