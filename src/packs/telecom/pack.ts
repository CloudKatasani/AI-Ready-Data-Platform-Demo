import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'telecom', industry: 'Telecom', company: 'Altair Communications', dbPrefix: 'ALT', account: 'ALT_PROD',
  tagline: 'Mobile and fiber broadband operator serving four US regions through eight markets.',
  scale: [{ label: 'Mobile subscribers', value: '9.8 M' }, { label: 'Broadband homes', value: '2.1 M' }, { label: 'Cell sites', value: '15,600' }],
  regions: ['Northeast', 'Southeast', 'Central', 'West'], icon: 'signal', accent: '#7A5AF8', seed: BASE_SEED + 1,
  sources: [
    { name: 'BSS billing', system: 'Rating, invoicing and payments (invoice CDC)' },
    { name: 'OSS network events', system: 'Cell-site alarms and daily KPI counters' },
    { name: 'CDR mediation', system: 'Voice, data and SMS detail records' },
    { name: 'CRM', system: 'Subscribers, plans and lifecycle events (CDC)' },
    { name: 'Field service', system: 'Installs and repair work orders' },
    { name: 'Documents', system: 'Network SLAs, CPNI rules, roaming agreements' },
  ],
  headlineKpis: ['ARPU', 'Churn rate', 'Net adds', 'Dropped call rate', 'Network availability %'], sensitiveClasses: ['PII', 'CPNI'], ready: false,
};
