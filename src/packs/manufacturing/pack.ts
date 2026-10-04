import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'manufacturing', industry: 'Manufacturing', company: 'Forgepoint Industries', dbPrefix: 'FPI', account: 'FPI_PROD',
  tagline: 'Diversified industrial manufacturer.',
  scale: [{ label: 'Plants', value: '22' }, { label: 'Business units', value: '4' }],
  regions: [], icon: 'gear', accent: '#667085', seed: BASE_SEED + 6,
  sources: [
    { name: 'MES', system: 'Production orders and line events' },
    { name: 'ERP (orders, BOM)', system: 'Sales orders, BOMs, purchasing' },
    { name: 'IoT sensor historian', system: 'Machine telemetry' },
    { name: 'QMS', system: 'Inspections and nonconformances' },
    { name: 'Supplier portal', system: 'Supplier deliveries and scorecards' },
    { name: 'Documents', system: 'ISO 9001 procedures, OEE definitions, maintenance standards' },
  ],
  headlineKpis: ['OEE', 'First-pass yield', 'On-time delivery'], sensitiveClasses: ['PII', 'TRADE_SECRET'], ready: false,
};
