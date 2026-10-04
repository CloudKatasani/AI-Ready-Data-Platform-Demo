import type { AccessCode, Persona } from '../../types';

export const PERSONAS: Persona[] = [
  { roleId: 'ANALYST_CUSTOMER', archetype: 'A', name: 'Priya Iyer', title: 'Customer analyst', domain: 'Customer',
    cares: 'Bills, arrears, digital adoption, churn. Sees PII masked; rows limited to the Ohio and Indiana opcos.',
    rowFilter: { column: 'OPCO', allowed: ['Northvale Ohio', 'Northvale Indiana'] }, unmasked: [] },
  { roleId: 'OPS_RELIABILITY', archetype: 'B', name: 'Marcus Okafor', title: 'Reliability manager', domain: 'Grid operations',
    cares: 'SAIDI, SAIFI, CAIDI, outage causes, vegetation risk.', unmasked: [] },
  { roleId: 'PROCUREMENT_MGR', archetype: 'C', name: 'Elena Novak', title: 'Procurement manager', domain: 'Supply chain',
    cares: 'Spend under contract, supplier OTIF, PO cycle time.', unmasked: [] },
  { roleId: 'DATA_STEWARD', archetype: 'D', name: 'Hannah Sullivan', title: 'Data steward', domain: 'Governance',
    cares: 'Glossary health, CDE ownership, certification. Sees all products and unmasked PII.', unmasked: ['PII'] },
];

/** Access matrix, initial state (spec section 8). */
export const INITIAL_ACCESS: Record<string, Record<string, AccessCode>> = {
  ANALYST_CUSTOMER: { 'DP-01': 'G', 'DP-02': 'R', 'DP-03': 'G', 'DP-04': 'R', 'DP-05': 'P', 'DP-06': '-', 'AG-01': 'G', 'AG-02': 'R', 'AG-03': 'R', 'AG-04': '-' },
  OPS_RELIABILITY: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'R', 'DP-05': 'R', 'DP-06': 'G', 'AG-01': 'R', 'AG-02': 'G', 'AG-03': 'R', 'AG-04': '-' },
  PROCUREMENT_MGR: { 'DP-01': 'R', 'DP-02': 'R', 'DP-03': 'R', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': '-', 'AG-01': 'R', 'AG-02': 'R', 'AG-03': 'G', 'AG-04': '-' },
  DATA_STEWARD: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': 'G', 'AG-01': 'G', 'AG-02': 'G', 'AG-03': 'G', 'AG-04': 'G' },
};
