import type { AccessCode, Persona } from '../../types';

export const PERSONAS: Persona[] = [
  { roleId: 'ANALYST_RETAIL', archetype: 'A', name: 'Imogen Forsythe', title: 'Retail banking analyst', domain: 'Retail banking',
    cares: 'Active and digital customers, deposit relationships, card spend and AML alerts on her customers. Sees PII, PCI and NPI masked; rows limited to the Mountain and Plains markets.',
    rowFilter: { column: 'REGION', allowed: ['Mountain', 'Plains'] }, unmasked: [] },
  { roleId: 'TREASURY_MGR', archetype: 'B', name: 'Daniel Ashworth', title: 'Treasury manager', domain: 'Treasury & risk',
    cares: 'Deposits, loan-to-deposit ratio, liquidity coverage, net interest margin and credit quality.', unmasked: [] },
  { roleId: 'AML_INVESTIGATIONS', archetype: 'C', name: 'Teresa Vance', title: 'AML investigations lead', domain: 'Financial crimes',
    cares: 'Alert volumes, alert-to-case rate, SAR filings and card fraud losses.', unmasked: [] },
  { roleId: 'DATA_STEWARD', archetype: 'D', name: 'Graham Ellery', title: 'Data steward', domain: 'Governance',
    cares: 'Glossary health, CDE ownership, certification. Sees all products with PII, PCI and NPI unmasked.', unmasked: ['PII', 'PCI', 'NPI'] },
];

/** Access matrix, initial state (spec section 8). */
export const INITIAL_ACCESS: Record<string, Record<string, AccessCode>> = {
  ANALYST_RETAIL: { 'DP-01': 'G', 'DP-02': 'R', 'DP-03': 'R', 'DP-04': 'G', 'DP-05': 'P', 'DP-06': '-', 'AG-01': 'G', 'AG-02': 'R', 'AG-03': 'R', 'AG-04': '-' },
  TREASURY_MGR: { 'DP-01': 'R', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'R', 'DP-05': 'R', 'DP-06': 'G', 'AG-01': 'R', 'AG-02': 'G', 'AG-03': 'R', 'AG-04': '-' },
  AML_INVESTIGATIONS: { 'DP-01': 'R', 'DP-02': 'R', 'DP-03': 'R', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': '-', 'AG-01': 'R', 'AG-02': 'R', 'AG-03': 'G', 'AG-04': '-' },
  DATA_STEWARD: { 'DP-01': 'G', 'DP-02': 'G', 'DP-03': 'G', 'DP-04': 'G', 'DP-05': 'G', 'DP-06': 'G', 'AG-01': 'G', 'AG-02': 'G', 'AG-03': 'G', 'AG-04': 'G' },
};
