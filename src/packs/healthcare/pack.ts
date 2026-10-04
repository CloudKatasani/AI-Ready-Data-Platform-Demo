import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'healthcare', industry: 'Healthcare', company: 'Crestview Health System', dbPrefix: 'CVH', account: 'CVH_PROD',
  tagline: 'Integrated delivery network.',
  scale: [{ label: 'Hospitals', value: '14' }, { label: 'Clinics', value: '210' }],
  regions: [], icon: 'cross', accent: '#E04F5F', seed: BASE_SEED + 5,
  sources: [
    { name: 'EHR (ADT, encounters)', system: 'Admissions, discharges, transfers, encounters' },
    { name: 'Claims & remits (837/835)', system: 'Billed claims and remittances' },
    { name: 'Scheduling', system: 'Appointments and slots' },
    { name: 'Pharmacy', system: 'Dispenses and formulary' },
    { name: 'Supply chain', system: 'Item master and usage' },
    { name: 'Documents', system: 'HIPAA minimum necessary, CMS measure specs, readmission definitions' },
  ],
  headlineKpis: ['30-day readmission rate', 'Average length of stay', 'Days in A/R'], sensitiveClasses: ['PHI'], ready: false,
};
