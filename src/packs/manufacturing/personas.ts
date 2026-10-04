import type { AccessCode, Persona } from '../../types';

export const PERSONAS: Persona[] = [
  { roleId: 'PLANT_ANALYST', archetype: 'A', name: 'Ravi Menon', title: 'Plant performance analyst', domain: 'Operations',
    cares: 'OEE, output, downtime and crews. Sees PII and trade secrets masked; rows limited to the Motion Systems and Fluid Power business units.',
    rowFilter: { column: 'BUSINESS_UNIT', allowed: ['Motion Systems', 'Fluid Power'] }, unmasked: [] },
  { roleId: 'PRODUCTION_MGR', archetype: 'B', name: 'Carla Jiménez', title: 'Production manager', domain: 'Operations & quality',
    cares: 'OEE losses, first-pass yield, scrap, cost of poor quality, energy per unit.', unmasked: [] },
  { roleId: 'SUPPLY_CHAIN_MGR', archetype: 'C', name: 'Tomasz Brandt', title: 'Supply chain manager', domain: 'Supply chain',
    cares: 'Supplier OTIF and PPM, lead times, spare-parts readiness for maintenance.', unmasked: [] },
  { roleId: 'DATA_STEWARD', archetype: 'D', name: 'Grace Whitfield', title: 'Data steward', domain: 'Governance',
    cares: 'Glossary health, CDE ownership, certification. Sees all products, unmasked PII and trade secrets.', unmasked: ['PII', 'TRADE_SECRET'] },
];

/** Access matrix, initial state (spec section 8). */
export const INITIAL_ACCESS: Record<string, Record<string, AccessCode>> = {
  PLANT_ANALYST: { 'DP-01': 'G', 'DP-02': 'R', 'DP-03': 'R', 'DP-04': 'R', 'DP-05': 'P', 'DP-06': '-', 'AG-01': 'G', 'AG-02': 'R', 'AG-03': 'R', 'AG-04': '-' },
  PRODUCTION_MGR: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'R', 'DP-05': 'R', 'DP-06': 'G', 'AG-01': 'R', 'AG-02': 'G', 'AG-03': 'R', 'AG-04': '-' },
  SUPPLY_CHAIN_MGR: { 'DP-01': 'R', 'DP-02': 'R', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': '-', 'AG-01': 'R', 'AG-02': 'R', 'AG-03': 'G', 'AG-04': '-' },
  DATA_STEWARD: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': 'G', 'AG-01': 'G', 'AG-02': 'G', 'AG-03': 'G', 'AG-04': 'G' },
};
