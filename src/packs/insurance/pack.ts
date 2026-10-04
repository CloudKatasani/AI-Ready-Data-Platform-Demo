import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'insurance', industry: 'Insurance', company: 'Sentinel Mutual', dbPrefix: 'SMI', account: 'SMI_PROD',
  tagline: 'Property and casualty carrier.',
  scale: [{ label: 'Policies', value: '4.6 M' }, { label: 'Lines', value: 'P&C' }],
  regions: [], icon: 'shield', accent: '#DD2590', seed: BASE_SEED + 4,
  sources: [
    { name: 'Policy administration', system: 'Policies, coverages, endorsements' },
    { name: 'Claims', system: 'FNOL, reserves and payments' },
    { name: 'Billing', system: 'Premium invoices and payments' },
    { name: 'Agent & broker portal', system: 'Producers and submissions' },
    { name: 'Catastrophe feeds', system: 'Event footprints and cat codes' },
    { name: 'Documents', system: 'Underwriting guidelines, NAIC reporting, reserving policy' },
  ],
  headlineKpis: ['Loss ratio', 'Combined ratio', 'Claims cycle time'], sensitiveClasses: ['PII', 'PHI'], ready: false,
};
