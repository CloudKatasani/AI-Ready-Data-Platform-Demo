import type { AccessCode, Persona } from '../../types';
import { ANALYST_REGIONS } from './generators.config';

export const PERSONAS: Persona[] = [
  { roleId: 'ANALYST_SUBSCRIBER', archetype: 'A', name: 'Nadia Ferreira', title: 'Subscriber analyst', domain: 'Subscriber',
    cares: 'Active base, ARPU, autopay, usage and plan profitability. Sees PII and CPNI masked; rows limited to the Northeast and Southeast regions.',
    rowFilter: { column: 'REGION', allowed: ANALYST_REGIONS }, unmasked: [] },
  { roleId: 'NETOPS_MANAGER', archetype: 'B', name: 'Daniel Osei', title: 'Network operations manager', domain: 'Network',
    cares: 'Dropped call rate, availability, site SLAs, field repairs and churn driven by network experience.', unmasked: [] },
  { roleId: 'REVENUE_ASSURANCE', archetype: 'C', name: 'Rebecca Lindgren', title: 'Revenue assurance lead', domain: 'Revenue',
    cares: 'ARPU, service revenue, leakage between rating and billing, roaming revenue.', unmasked: [] },
  { roleId: 'DATA_STEWARD', archetype: 'D', name: 'Tomás Herrera', title: 'Data steward', domain: 'Governance',
    cares: 'Glossary health, CDE ownership, CPNI controls and certification. Sees all products with PII and CPNI unmasked.', unmasked: ['PII', 'CPNI'] },
];

/** Access matrix, initial state (spec section 8). */
export const INITIAL_ACCESS: Record<string, Record<string, AccessCode>> = {
  ANALYST_SUBSCRIBER: { 'DP-01': 'G', 'DP-02': 'R', 'DP-03': 'G', 'DP-04': 'R', 'DP-05': 'P', 'DP-06': '-', 'AG-01': 'G', 'AG-02': 'R', 'AG-03': 'R', 'AG-04': '-' },
  NETOPS_MANAGER: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'R', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': 'G', 'AG-01': 'R', 'AG-02': 'G', 'AG-03': 'R', 'AG-04': '-' },
  REVENUE_ASSURANCE: { 'DP-01': 'R', 'DP-02': 'R', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': '-', 'AG-01': 'R', 'AG-02': 'R', 'AG-03': 'G', 'AG-04': '-' },
  DATA_STEWARD: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': 'G', 'AG-01': 'G', 'AG-02': 'G', 'AG-03': 'G', 'AG-04': 'G' },
};
