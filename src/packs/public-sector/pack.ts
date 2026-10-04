import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'public-sector', industry: 'Public Sector', company: 'Westland County Services', dbPrefix: 'WCS', account: 'WCS_PROD',
  tagline: 'County human services and constituent services for 1.1 M residents across four service districts.',
  scale: [{ label: 'Residents', value: '1.1 M' }, { label: 'Service districts', value: '4' }, { label: 'Benefit programs', value: '5' }],
  regions: ['North District', 'Central District', 'South District', 'Riverside District'], icon: 'civic', accent: '#3E7C5A', seed: BASE_SEED + 7,
  sources: [
    { name: 'Case management', system: 'Constituents, cases and caseworker assignments (CDC)' },
    { name: 'Eligibility', system: 'Benefit applications and eligibility determinations' },
    { name: 'Benefits payments', system: 'Issued benefit payments and EBT / provider disbursements' },
    { name: '311 service requests', system: 'Constituent requests from phone, app, web and walk-in' },
    { name: 'Finance', system: 'Budget, expenditure and authorised positions' },
    { name: 'Documents', system: 'Program eligibility rules, records retention schedule, open-data policy' },
  ],
  headlineKpis: ['Case backlog', 'Average processing days', 'Improper payment rate'], sensitiveClasses: ['PII', 'GOV_ID'], ready: false,
};
