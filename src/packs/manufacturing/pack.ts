import type { PackProfile } from '../../types';
import { BASE_SEED } from '../../mock-snowflake/rng';

export const PROFILE: PackProfile = {
  id: 'manufacturing', industry: 'Manufacturing', company: 'Forgepoint Industries', dbPrefix: 'FPI', account: 'FPI_PROD',
  tagline: 'Diversified industrial manufacturer running 22 plants across four business units, from servo motors to aerospace components.',
  scale: [{ label: 'Plants', value: '22' }, { label: 'Business units', value: '4' }, { label: 'Production lines', value: '80' }, { label: 'Employees', value: '14.6 K' }],
  regions: ['Motion Systems', 'Fluid Power', 'Industrial Controls', 'Aerospace Components'], icon: 'gear', accent: '#667085', seed: BASE_SEED + 6,
  sources: [
    { name: 'MES', system: 'Shift production records, downtime reasons and operator roster' },
    { name: 'ERP (orders, BOM)', system: 'Sales orders, delivery dates, costed BOMs' },
    { name: 'IoT sensor historian', system: 'Machine telemetry: vibration, temperature, load and power' },
    { name: 'QMS', system: 'Inspection lots, usage decisions and NCRs' },
    { name: 'Supplier portal', system: 'ASNs, goods receipts and incoming-inspection rejects' },
    { name: 'Documents', system: 'ISO 9001 procedures, OEE definitions, maintenance standards' },
  ],
  headlineKpis: ['OEE', 'First-pass yield', 'On-time delivery'], sensitiveClasses: ['PII', 'TRADE_SECRET'], ready: false,
};
