import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'telecom', industry: 'Telecom', company: 'Altair Communications', dbPrefix: 'ALT', account: 'ALT_PROD',
  tagline: 'Mobile and broadband operator.',
  scale: [{ label: 'Mobile subscribers', value: '9.8 M' }, { label: 'Broadband homes', value: '2.1 M' }],
  regions: [], icon: 'signal', accent: '#7A5AF8', seed: BASE_SEED + 1,
  sources: [
    { name: 'BSS billing', system: 'Rating, invoicing and payments' },
    { name: 'OSS network events', system: 'Cell and node alarms, KPIs' },
    { name: 'CDR mediation', system: 'Call and data detail records' },
    { name: 'CRM', system: 'Accounts, contacts, cases' },
    { name: 'Field service', system: 'Installs and repair work orders' },
    { name: 'Documents', system: 'Network SLAs, CPNI rules, roaming agreements' },
  ],
  headlineKpis: ['ARPU', 'Churn rate', 'Network availability %'], sensitiveClasses: ['PII', 'CPNI'], ready: false,
};
