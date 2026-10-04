import type { AccessCode, Persona } from '../../types';

export const PERSONAS: Persona[] = [
  { roleId: 'CUSTOMER_INSIGHTS_ANALYST', archetype: 'A', name: 'Maya Castellano', title: 'Customer insights analyst', domain: 'Customer',
    cares: 'Loyalty members, loyalty share of sales, promotion response. Sees PII and PCI masked; rows limited to the Northeast and Mid-Atlantic regions.',
    rowFilter: { column: 'REGION', allowed: ['Northeast', 'Mid-Atlantic'] }, unmasked: [] },
  { roleId: 'STORE_OPS_MANAGER', archetype: 'B', name: 'Darnell Brooks', title: 'Store operations manager', domain: 'Store operations',
    cares: 'Comparable store sales, baskets, store rankings, returns and return fraud.', unmasked: [] },
  { roleId: 'MERCH_PLANNER', archetype: 'C', name: 'Ingrid Solberg', title: 'Merchandise planner', domain: 'Merchandising & supply chain',
    cares: 'Sell-through, stock-outs, weeks of supply, supplier OTIF and fill rate.', unmasked: [] },
  { roleId: 'DATA_STEWARD', archetype: 'D', name: 'Tobias Achterberg', title: 'Data steward', domain: 'Governance',
    cares: 'Glossary health, CDE ownership, certification. Sees all products with PII and PCI unmasked.', unmasked: ['PII', 'PCI'] },
];

/** Access matrix, initial state (spec section 8). */
export const INITIAL_ACCESS: Record<string, Record<string, AccessCode>> = {
  CUSTOMER_INSIGHTS_ANALYST: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'R', 'DP-04': 'R', 'DP-05': 'P', 'DP-06': '-', 'AG-01': 'G', 'AG-02': 'R', 'AG-03': 'R', 'AG-04': '-' },
  STORE_OPS_MANAGER: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'R', 'DP-05': 'R', 'DP-06': 'G', 'AG-01': 'R', 'AG-02': 'G', 'AG-03': 'R', 'AG-04': '-' },
  MERCH_PLANNER: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'R', 'DP-06': '-', 'AG-01': 'R', 'AG-02': 'R', 'AG-03': 'G', 'AG-04': '-' },
  DATA_STEWARD: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': 'G', 'AG-01': 'G', 'AG-02': 'G', 'AG-03': 'G', 'AG-04': 'G' },
};
