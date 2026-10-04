import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'retail', industry: 'Retail', company: 'Harbor & Pine', dbPrefix: 'HPR', account: 'HPR_PROD',
  tagline: 'Omnichannel home and lifestyle retailer: 640 stores in four regions plus web and app.',
  scale: [{ label: 'Stores', value: '640' }, { label: 'Loyalty members', value: '5.2 M' }, { label: 'Channels', value: 'Stores + e-commerce' }],
  regions: ['Northeast', 'Mid-Atlantic', 'Midwest', 'West'], icon: 'bag', accent: '#0E9384', seed: BASE_SEED + 2,
  sources: [
    { name: 'POS transactions', system: 'Store sales and returns (transaction headers)' },
    { name: 'E-commerce orders', system: 'Web and app orders' },
    { name: 'Loyalty', system: 'Harbor Club members, tiers and points' },
    { name: 'WMS inventory', system: 'Stock on hand by location' },
    { name: 'Supplier EDI', system: 'EDI 850 purchase orders and 856 ASNs' },
    { name: 'Documents', system: 'Promotion calendar, returns policy, markdown rules' },
  ],
  headlineKpis: ['Comparable store sales %', 'Sell-through %', 'Return rate'], sensitiveClasses: ['PII', 'PCI'], ready: false,
};
