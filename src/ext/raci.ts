// E7 Operating model: roles, ~24 activities by layer and RACI by operating style.
import type { LayerId } from '../types';
import type { RoleKey } from './buildGuide';
import type { RaciStyle } from './state';

export type Raci = 'R' | 'A' | 'C' | 'I' | 'A/R' | '';

export const ROLES: { id: RoleKey; label: string; team: string; accountable: string; central: boolean }[] = [
  { id: 'platform_owner', label: 'Platform owner', team: 'Central data platform', accountable: 'Account, security baseline, cost guardrails, shared tooling', central: true },
  { id: 'data_engineer', label: 'Data engineer', team: 'Central or domain', accountable: 'Bronze to Gold pipelines, DQ rules, lineage', central: true },
  { id: 'analytics_engineer', label: 'Analytics engineer', team: 'Domain', accountable: 'Gold models, semantic views, verified queries', central: false },
  { id: 'product_owner', label: 'Data product owner', team: 'Domain (business)', accountable: 'Product scope, roadmap, contract, consumer satisfaction', central: false },
  { id: 'steward', label: 'Data steward', team: 'Domain (business)', accountable: 'Glossary terms, CDEs, DQ thresholds, access approvals', central: false },
  { id: 'sme', label: 'Domain SME', team: 'Business', accountable: 'Business rules, definitions, document sources for context', central: false },
  { id: 'ai_engineer', label: 'AI engineer', team: 'Central AI team', accountable: 'Agent specs, tools, evals, monitoring', central: true },
  { id: 'gov_lead', label: 'Governance lead', team: 'CDO office', accountable: 'Policies, tags, certification standard, audits', central: true },
  { id: 'consumer', label: 'Consumer', team: 'Business', accountable: 'Uses products and agents; gives feedback', central: false },
];

export const ROLE_LABEL: Record<RoleKey, string> = Object.fromEntries(ROLES.map((r) => [r.id, r.label])) as Record<RoleKey, string>;

type Row = [string, LayerId | 'setup', string, Partial<Record<RoleKey, Raci>>];

// Hub-and-spoke (default). Order of roles: platform_owner, data_engineer, analytics_engineer, product_owner, steward, sme, ai_engineer, gov_lead, consumer
const r = (po: Raci, de: Raci, ae: Raci, pr: Raci, st: Raci, sm: Raci, ai: Raci, gl: Raci, co: Raci = ''): Partial<Record<RoleKey, Raci>> =>
  ({ platform_owner: po, data_engineer: de, analytics_engineer: ae, product_owner: pr, steward: st, sme: sm, ai_engineer: ai, gov_lead: gl, consumer: co });

export const ACTIVITIES: Row[] = [
  ['Provision account, roles and warehouses', 'setup', 'build/setup/setup-roles', r('A/R', 'C', '', '', '', '', 'I', 'C')],
  ['Set cost guardrails and budgets', 'setup', 'cost', r('A/R', 'C', '', 'I', '', '', 'I', 'I')],
  ['Set up CDC to Bronze', 'bronze', 'build/bronze/bronze-cdc', r('A', 'R', 'I', 'I', '', '', '', 'C')],
  ['Tag sensitive columns at landing', 'bronze', 'explorer', r('I', 'R', '', '', 'C', '', '', 'A')],
  ['Build Silver entities and SCD2', 'silver', 'build/silver/silver-main', r('I', 'A/R', 'C', 'I', '', '', '', '')],
  ['Set DQ thresholds on CDEs', 'silver', 'health', r('', 'R', 'C', 'C', 'A', 'C', '', 'I')],
  ['Model conformed Gold', 'gold', 'build/gold/gold-dims', r('', 'R', 'A', 'C', 'I', 'C', '', '')],
  ['Reconcile Gold to source', 'gold', 'explorer', r('', 'R', 'A', 'I', 'C', '', '', '')],
  ['Define a business metric', 'semantic', 'semantic', r('', 'I', 'R', 'A', 'C', 'C', 'I', '')],
  ['Maintain verified queries', 'semantic', 'context/verified-queries', r('', '', 'R', 'A', 'C', 'C', 'C', '')],
  ['Approve a glossary term', 'glossary', 'glossary', r('', '', 'C', 'C', 'A/R', 'C', 'I', 'I')],
  ['Assign a steward to a CDE', 'glossary', 'glossary', r('', '', '', 'A', 'R', '', '', 'C')],
  ['Write business rules for context', 'context', 'context/rules', r('', '', 'C', 'A', 'C', 'R', 'C', '')],
  ['Index documents for search', 'context', 'context/search', r('C', '', '', 'A', 'C', 'R', 'R', '')],
  ['Write agent instructions', 'context', 'context/instructions', r('', '', '', 'A', 'C', 'C', 'R', 'C')],
  ['Publish a data contract', 'product', 'certify', r('', 'C', 'C', 'A/R', 'C', '', '', 'C', 'I')],
  ['Certify a data product', 'product', 'certify', r('I', 'C', 'C', 'R', 'C', '', 'I', 'A')],
  ['List a product in the Marketplace', 'product', 'marketplace', r('C', '', '', 'A/R', 'C', '', '', 'I', 'I')],
  ['Build and evaluate an agent', 'agent', 'agent-quality', r('', '', 'C', 'A', 'C', 'C', 'R', '')],
  ['Release an agent to production', 'agent', 'agents', r('C', '', 'C', 'A', 'C', 'I', 'R', 'C', 'I')],
  ['Triage agent feedback', 'agent', 'agent-quality/inbox', r('', '', 'C', 'A', 'R', 'C', 'C', '', 'C')],
  ['Approve an access request', 'gov', 'marketplace', r('', '', '', 'C', 'A/R', '', '', 'I', 'I')],
  ['Define masking and row access policies', 'gov', 'build/gov/gov-masking', r('C', 'C', '', '', 'C', '', '', 'A/R')],
  ['Respond to a data incident', 'gov', 'health/incidents', r('C', 'R', 'C', 'A', 'R', '', 'I', 'I', 'I')],
  ['Run an access and quality audit', 'gov', 'explorer/GOVERNANCE/ACCESS_HISTORY_V', r('C', '', '', 'I', 'C', '', '', 'A/R')],
];

/** Shift R and A between central and domain roles for the other operating styles. */
export function raciFor(style: RaciStyle): Row[] {
  if (style === 'hub') return ACTIVITIES;
  return ACTIVITIES.map(([name, layer, route, cells]) => {
    const c = { ...cells };
    if (style === 'centralized') {
      // Central teams build and own: analytics engineering moves into the data engineering team; central gov lead approves.
      if (c.analytics_engineer === 'R' || c.analytics_engineer === 'A') { c.data_engineer = c.analytics_engineer; c.analytics_engineer = 'C'; }
      if (c.product_owner === 'A' && ['semantic', 'context', 'agent'].includes(layer)) { c.ai_engineer = c.ai_engineer === 'R' ? 'A/R' : 'A'; c.product_owner = 'C'; }
      if (c.steward === 'A/R' && layer === 'gov') { c.gov_lead = 'A'; c.steward = 'R'; }
    } else {
      // Federated (data mesh): domains own build and approval; central roles advise.
      if (c.data_engineer === 'A/R') { c.data_engineer = 'R'; c.product_owner = 'A'; }
      if (c.platform_owner === 'A' && layer !== 'setup') { c.platform_owner = 'C'; c.product_owner = 'A'; }
      if (c.gov_lead === 'A' && layer !== 'gov') { c.gov_lead = 'C'; c.product_owner = c.product_owner === 'R' ? 'A/R' : 'A'; }
      if (c.ai_engineer === 'R' && layer === 'agent') { c.ai_engineer = 'C'; c.analytics_engineer = 'R'; }
    }
    return [name, layer, route, c] as Row;
  });
}

export const STYLES: { id: RaciStyle; label: string; when: string }[] = [
  { id: 'centralized', label: 'Centralized', when: 'Fits early platforms and regulated firms with a small data team: one team builds and approves everything, domains consult.' },
  { id: 'hub', label: 'Hub and spoke', when: 'Fits most enterprises: a central platform and governance hub, with domains owning products, terms and rules.' },
  { id: 'federated', label: 'Federated (data mesh)', when: 'Fits mature organisations with strong domain teams: domains build and own end to end; the centre sets standards.' },
];

/** Persona archetype → operating-model role. */
export const ARCHETYPE_ROLE: Record<string, RoleKey> = { A: 'consumer', B: 'product_owner', C: 'product_owner', D: 'steward' };

export function raciMarkdown(style: RaciStyle, labels: Record<string, string>): string {
  const rows = raciFor(style);
  return `| Activity | ${ROLES.map((x) => labels[x.id] ?? x.label).join(' | ')} |\n| --- | ${ROLES.map(() => '---').join(' | ')} |\n${rows.map(([n, , , c]) => `| ${n} | ${ROLES.map((x) => c[x.id] || '—').join(' | ')} |`).join('\n')}\n`;
}

/** The RACI activity a certification gate belongs to, by its name. */
export function activityForGate(gateName: string): string {
  const n = gateName.toLowerCase();
  if (n.includes('contract')) return 'Publish a data contract';
  if (n.includes('quality') || n.includes('dq') || n.includes('fresh')) return 'Set DQ thresholds on CDEs';
  if (n.includes('owner') || n.includes('steward')) return 'Assign a steward to a CDE';
  if (n.includes('semantic') || n.includes('metric')) return 'Define a business metric';
  if (n.includes('glossary') || n.includes('term')) return 'Approve a glossary term';
  if (n.includes('access') || n.includes('security') || n.includes('privacy') || n.includes('pii') || n.includes('masking')) return 'Define masking and row access policies';
  return 'Certify a data product';
}
