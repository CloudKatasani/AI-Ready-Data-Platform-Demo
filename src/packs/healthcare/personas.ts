import type { AccessCode, Persona } from '../../types';

export const PERSONAS: Persona[] = [
  { roleId: 'ANALYST_REVCYCLE', archetype: 'A', name: 'Maya Thornton', title: 'Revenue cycle analyst', domain: 'Revenue cycle',
    cares: 'Denials, clean claims, days in A/R, aged balances, supply cost per case. Sees PHI masked; rows limited to the North and Central markets.',
    rowFilter: { column: 'MARKET', allowed: ['North', 'Central'] }, unmasked: [] },
  { roleId: 'OPS_DIRECTOR', archetype: 'B', name: 'Gabriel Ruiz', title: 'Hospital operations director', domain: 'Hospital operations',
    cares: 'Length of stay, bed occupancy, readmissions and care gaps that drive avoidable bed days.', unmasked: [] },
  { roleId: 'QUALITY_LEAD', archetype: 'C', name: 'Dr. Leah Marsh', title: 'Quality and safety lead', domain: 'Quality & safety',
    cares: 'Readmissions, 7-day follow-up, mortality and timely access (ED waits, no-shows).', unmasked: [] },
  { roleId: 'DATA_STEWARD', archetype: 'D', name: 'Owen Pritchard', title: 'Data steward', domain: 'Governance',
    cares: 'Glossary health, CDE ownership, certification. Sees all products and unmasked PHI.', unmasked: ['PHI'] },
];

/** Access matrix, initial state (spec section 8). */
export const INITIAL_ACCESS: Record<string, Record<string, AccessCode>> = {
  ANALYST_REVCYCLE: { 'DP-01': 'G', 'DP-02': 'R', 'DP-03': 'G', 'DP-04': 'R', 'DP-05': 'P', 'DP-06': '-', 'AG-01': 'G', 'AG-02': 'R', 'AG-03': 'R', 'AG-04': '-' },
  OPS_DIRECTOR: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'R', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': 'G', 'AG-01': 'R', 'AG-02': 'G', 'AG-03': 'R', 'AG-04': '-' },
  QUALITY_LEAD: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'R', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': '-', 'AG-01': 'R', 'AG-02': 'R', 'AG-03': 'G', 'AG-04': '-' },
  DATA_STEWARD: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': 'G', 'AG-01': 'G', 'AG-02': 'G', 'AG-03': 'G', 'AG-04': 'G' },
};
