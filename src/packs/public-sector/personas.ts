import type { AccessCode, Persona } from '../../types';

export const PERSONAS: Persona[] = [
  { roleId: 'CASEWORKER_ANALYST', archetype: 'A', name: 'Rosa Delgado', title: 'Caseworker analyst', domain: 'Human services',
    cares: 'Constituents, renewals, 311 follow-up and integrity reviews. Sees names and government IDs masked; rows limited to North and Central districts.',
    rowFilter: { column: 'DISTRICT', allowed: ['North District', 'Central District'] }, unmasked: [] },
  { roleId: 'PROGRAM_OPS_MGR', archetype: 'B', name: 'Daniel Whitaker', title: 'Program operations manager', domain: 'Program operations',
    cares: 'Processing timeliness, case backlog, caseload, cost per case and staffing.', unmasked: [] },
  { roleId: 'FINANCE_OFFICER', archetype: 'C', name: 'Grace Mensah', title: 'Finance officer', domain: 'Finance',
    cares: 'Benefits paid, payment accuracy, improper payments and 311 service costs.', unmasked: [] },
  { roleId: 'DATA_STEWARD', archetype: 'D', name: 'Owen Fitzgerald', title: 'Data steward', domain: 'Governance',
    cares: 'Glossary health, CDE ownership, certification. Sees all products with PII and government IDs unmasked.', unmasked: ['PII', 'GOV_ID'] },
];

/** Access matrix, initial state (spec section 8). */
export const INITIAL_ACCESS: Record<string, Record<string, AccessCode>> = {
  CASEWORKER_ANALYST: { 'DP-01': 'G', 'DP-02': 'R', 'DP-03': 'R', 'DP-04': 'G', 'DP-05': 'P', 'DP-06': '-', 'AG-01': 'G', 'AG-02': 'R', 'AG-03': 'R', 'AG-04': '-' },
  PROGRAM_OPS_MGR: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'R', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': 'G', 'AG-01': 'R', 'AG-02': 'G', 'AG-03': 'R', 'AG-04': '-' },
  FINANCE_OFFICER: { 'DP-01': 'R', 'DP-02': 'R', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': '-', 'AG-01': 'R', 'AG-02': 'R', 'AG-03': 'G', 'AG-04': '-' },
  DATA_STEWARD: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': 'G', 'AG-01': 'G', 'AG-02': 'G', 'AG-03': 'G', 'AG-04': 'G' },
};
