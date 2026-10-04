import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'banking', industry: 'Banking', company: 'Ridgeline Bank', dbPrefix: 'RLB', account: 'RLB_PROD',
  tagline: 'Regional commercial and retail bank serving the Mountain, Plains, Great Lakes and Southeast markets.',
  scale: [{ label: 'Assets', value: '$84 B' }, { label: 'Customers', value: '3.2 M' }, { label: 'Markets', value: '4' }],
  regions: ['Mountain', 'Plains', 'Great Lakes', 'Southeast'], icon: 'bank', accent: '#2E90FA', seed: BASE_SEED + 3,
  sources: [
    { name: 'Core banking', system: 'Customers, deposit and loan accounts (mainframe core → CDC)' },
    { name: 'Card processing', system: 'Card authorisations, settlements and fraud flags' },
    { name: 'Digital banking events', system: 'Mobile app and online banking sessions' },
    { name: 'AML case management', system: 'Transaction-monitoring alerts, cases and SAR filings' },
    { name: 'General ledger', system: 'Monthly balances, income and expense by market' },
    { name: 'Documents', system: 'Basel III and stress-test definitions, BSA/AML policy, fair-lending rules' },
  ],
  headlineKpis: ['Net interest margin', 'NPL ratio', 'Loan-to-deposit ratio'], sensitiveClasses: ['PII', 'PCI', 'NPI'], ready: false,
};
