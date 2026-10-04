import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'utilities', industry: 'Utilities', company: 'Northvale Energy', dbPrefix: 'NVE', account: 'NVE_PROD',
  tagline: 'Investor-owned electric utility serving four operating companies across the Ohio Valley.',
  scale: [{ label: 'Customers', value: '1.39 M' }, { label: 'Operating companies', value: '4' }, { label: 'Circuits', value: '120' }],
  regions: ['North', 'Central', 'South', 'East'], icon: 'bolt', accent: '#C08A1E', seed: BASE_SEED + 0,
  sources: [
    { name: 'DB2 CIS', system: 'Customer information (IBM DB2 → GoldenGate CDC)' },
    { name: 'AMI head-end', system: '15-minute interval reads' },
    { name: 'OMS / ADMS', system: 'Outage management' },
    { name: 'ERP procurement', system: 'Purchase orders' },
    { name: 'Vegetation system', system: 'Span inspections' },
    { name: 'Documents', system: 'Tariff book, IEEE 1366 guide, policies' },
  ],
  headlineKpis: ['SAIDI', 'Avg monthly bill', 'Spend under contract %'], sensitiveClasses: ['PII'], ready: true,
};
