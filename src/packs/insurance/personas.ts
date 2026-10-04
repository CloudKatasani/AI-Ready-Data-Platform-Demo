import type { AccessCode, Persona } from '../../types';

export const PERSONAS: Persona[] = [
  { roleId: 'CLAIMS_ANALYST', archetype: 'A', name: 'Paloma Esterhazy', title: 'Claims analyst', domain: 'Claims',
    cares: 'Severity, open inventory, payments, cycle time, reserves. Sees PII and PHI masked; rows limited to the Northeast and Midwest regions.',
    rowFilter: { column: 'REGION', allowed: ['Northeast', 'Midwest'] }, unmasked: [] },
  { roleId: 'CLAIMS_OPS_MGR', archetype: 'B', name: 'Desmond Achterberg', title: 'Claims operations manager', domain: 'Claims operations',
    cares: 'Loss ratio by line, combined ratio, catastrophe losses and exposure.', unmasked: [] },
  { roleId: 'UW_MANAGER', archetype: 'C', name: 'Mei Lin Zhao', title: 'Underwriting manager', domain: 'Underwriting & distribution',
    cares: 'Quote-to-bind, new business premium, agency turnaround, premium.', unmasked: [] },
  { roleId: 'DATA_STEWARD', archetype: 'D', name: 'Harriet Quansah', title: 'Data steward', domain: 'Governance',
    cares: 'Glossary health, CDE ownership, certification. Sees all products with PII and PHI unmasked.', unmasked: ['PII', 'PHI'] },
];

/** Access matrix, initial state (spec section 8). */
export const INITIAL_ACCESS: Record<string, Record<string, AccessCode>> = {
  CLAIMS_ANALYST: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'R', 'DP-04': 'R', 'DP-05': 'P', 'DP-06': '-', 'AG-01': 'G', 'AG-02': 'R', 'AG-03': 'R', 'AG-04': '-' },
  CLAIMS_OPS_MGR: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'R', 'DP-05': 'R', 'DP-06': 'G', 'AG-01': 'R', 'AG-02': 'G', 'AG-03': 'R', 'AG-04': '-' },
  UW_MANAGER: { 'DP-01': 'R', 'DP-02': 'R', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': '-', 'AG-01': 'R', 'AG-02': 'R', 'AG-03': 'G', 'AG-04': '-' },
  DATA_STEWARD: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': 'G', 'AG-01': 'G', 'AG-02': 'G', 'AG-03': 'G', 'AG-04': 'G' },
};
