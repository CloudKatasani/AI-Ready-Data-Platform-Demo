import type { Agent, ContextLayer, DataProduct, SemanticView, SfObject } from '../../types';
import { buildContractYaml, buildGates } from '../shared/product-kit';
import { GATE6_CHECK } from './catalog';

type Base = Omit<DataProduct, 'gates' | 'contractYaml'> & { consumersNamed: string[]; analystEval: number; agentEval: number; dq: number };

const BASE: Base[] = [
  { id: 'DP-01', name: 'Customer 360', domain: 'Customer', status: 'Certified', version: '2.3.0', owner: 'Customer Analytics (M. Reyes)', steward: 'A. Patel', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_CUSTOMER_360', outputPort: 'DP_CUSTOMER_360', kpiIds: ['K-01', 'K-02', 'K-03', 'K-04', 'K-05'], qualityScore: 98.6, consumers: 214, queriesPerWeek: 3_820, freshness: '2 h ago', lastCertified: '2026-06-12',
    description: 'One trusted view of every customer: account, rate class, bills, arrears, digital enrolment and churn risk.',
    purpose: 'Give customer, billing and marketing teams one certified customer record for reporting, outreach and agents.',
    sampleQuestions: ['How many active customers are enrolled in paperless billing?', 'What was the average monthly residential bill last quarter by region?'],
    upstream: ['CONFORMED_GOLD.DIM_CUSTOMER', 'CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.FCT_DAILY_USAGE'], consumersNamed: ['Customer care', 'Marketing', 'Customer Insights agent'], analystEval: 95, agentEval: 94, dq: 98.6 },
  { id: 'DP-02', name: 'System Reliability', domain: 'Grid ops', status: 'Certified', version: '1.4.1', owner: 'Distribution Reliability (T. Baptiste)', steward: 'H. Sullivan', sla: 'Hourly',
    semanticView: 'SV_RELIABILITY', outputPort: 'DP_SYSTEM_RELIABILITY', kpiIds: ['K-06', 'K-07', 'K-08', 'K-09', 'K-10', 'K-25'], qualityScore: 99.1, consumers: 96, queriesPerWeek: 2_140, freshness: '38 min ago', lastCertified: '2026-05-28',
    description: 'IEEE 1366 reliability indices at event grain, with circuits, causes and major event day flags.',
    purpose: 'Regulatory reliability reporting and operational review of outages by opco, circuit and cause.',
    sampleQuestions: ['What is SAIDI year to date excluding major event days, by operating company?', 'Top 5 circuits by customers interrupted in the last 30 days'],
    upstream: ['CONFORMED_GOLD.FCT_OUTAGE', 'CONFORMED_GOLD.DIM_CIRCUIT'], consumersNamed: ['Regulatory affairs', 'Distribution operations', 'Reliability Analyst agent'], analystEval: 97, agentEval: 96, dq: 99.1 },
  { id: 'DP-03', name: 'AMI Usage', domain: 'Customer / Grid', status: 'Certified', version: '1.1.0', owner: 'Metering Services (G. Hughes)', steward: 'O. Chen', sla: 'Every 15 min',
    semanticView: 'SV_CUSTOMER_360', outputPort: 'DP_AMI_USAGE', kpiIds: ['K-11', 'K-12', 'K-13', 'K-14'], qualityScore: 97.4, consumers: 61, queriesPerWeek: 1_410, freshness: '12 min ago', lastCertified: '2026-04-03',
    description: 'Daily consumption, peak demand and read quality for every AMI premise.',
    purpose: 'Load research, rate design and meter operations.',
    sampleQuestions: ['Show peak demand by rate class for last week', 'What is the AMI read success rate this month?'],
    upstream: ['CONFORMED_GOLD.FCT_DAILY_USAGE', 'CONFORMED_GOLD.DIM_PREMISE'], consumersNamed: ['Load research', 'Metering operations', 'Customer Insights agent'], analystEval: 93, agentEval: 94, dq: 97.4 },
  { id: 'DP-04', name: 'Procurement Spend', domain: 'Supply chain', status: 'Certified', version: '3.0.2', owner: 'Supply Chain Analytics (S. Moreau)', steward: 'L. Kowalski', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_PROCUREMENT', outputPort: 'DP_PROCUREMENT_SPEND', kpiIds: ['K-15', 'K-16', 'K-17', 'K-18', 'K-19'], qualityScore: 98.9, consumers: 48, queriesPerWeek: 690, freshness: '3 h ago', lastCertified: '2026-07-21',
    description: 'PO line spend with contract compliance, supplier OTIF and cycle time.',
    purpose: 'Category management, supplier performance reviews and contract compliance reporting.',
    sampleQuestions: ['What percentage of Q3 spend was under contract?', 'Which suppliers have OTIF below 90%?'],
    upstream: ['CONFORMED_GOLD.FCT_PO_SPEND', 'CONFORMED_GOLD.DIM_SUPPLIER'], consumersNamed: ['Category managers', 'Finance', 'Procurement Copilot'], analystEval: 92, agentEval: 92, dq: 98.9 },
  { id: 'DP-05', name: 'Billing & Receivables', domain: 'Customer / Finance', status: 'In certification', version: '1.0.0-rc', owner: 'Revenue Operations (D. Ramirez)', steward: 'A. Patel', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_BILLING_AR', outputPort: 'DP_BILLING_RECEIVABLES', kpiIds: ['K-20', 'K-21', 'K-22', 'K-23'], qualityScore: 94.2, consumers: 0, queriesPerWeek: 0, freshness: '2 h ago',
    description: 'Statements, receivables, DSO and collections for revenue operations.',
    purpose: 'Give revenue operations and the Customer Insights agent a certified receivables view (DSO, collections).',
    sampleQuestions: ['What is our days sales outstanding this month?', 'Collections rate last quarter'],
    upstream: ['CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.DIM_CUSTOMER'], consumersNamed: ['Revenue operations', 'Treasury', 'Customer Insights agent'], analystEval: 91, agentEval: 93, dq: 94.2 },
  { id: 'DP-06', name: 'Vegetation Risk', domain: 'Grid ops', status: 'Draft', version: '0.3.0', owner: 'Vegetation Management (J. Lindqvist)', steward: null, sla: 'Weekly',
    outputPort: 'DP_VEGETATION_RISK', kpiIds: ['K-24', 'K-25', 'K-26'], qualityScore: 88.0, consumers: 4, queriesPerWeek: 35, freshness: '1 d ago',
    description: 'Span-level trim status joined to tree-caused outages, to prioritise vegetation work.',
    purpose: 'Prioritise trimming where overdue spans coincide with tree-caused outages.',
    sampleQuestions: ['How many spans are overdue for trimming?'],
    upstream: ['CURATED_SILVER.VEGETATION_SPAN', 'CONFORMED_GOLD.FCT_OUTAGE'], consumersNamed: ['Vegetation management'], analystEval: 0, agentEval: 0, dq: 88.0 },
];

export function buildProducts(db: string, objects: SfObject[], svs: SemanticView[], ctx: ContextLayer, agents: Agent[]): DataProduct[] {
  return BASE.map(({ consumersNamed, analystEval, agentEval, dq, ...p }) => {
    const port = objects.find((o) => o.schema === 'DATA_PRODUCTS' && o.name === p.outputPort);
    const sv = svs.find((s) => s.name === p.semanticView);
    const cde = (port?.columns ?? []).filter((c) => (c.tags ?? []).includes('CDE')).length;
    const sensitive = (port?.columns ?? []).filter((c) => (c.tags ?? []).some((t) => t !== 'CDE')).map((c) => (c.maskPendingFix === GATE6_CHECK ? `FCT_BILLING.${c.name}` : c.name));
    const agent = agents.find((a) => a.productIds.includes(p.id));
    const gates = buildGates(
      {
        owner: p.owner, steward: p.steward, domain: p.domain, consumers: consumersNamed, sla: p.sla, cdeCount: cde, dqScore: dq,
        metrics: sv?.metrics.length ?? 0, verifiedQueries: sv ? ctx.verifiedQueries.filter((v) => v.semanticView === sv.name).length : 0,
        analystEval, sensitiveColumns: sensitive, rowPolicy: 'RAP_OPCO_ACCESS', maskingPolicy: 'MP_MASK_PII', upstream: p.upstream,
        agentEval: agent?.evalAccuracy ?? agentEval, rules: ctx.rules.filter((r) => sv && r.metric.startsWith(sv.name)).length, synonyms: ctx.synonyms.length,
      },
      p.status === 'In certification' ? { pendingFrom: 4 } : p.status === 'Draft' ? { upTo: 2 } : {},
    );
    return { ...p, gates, contractYaml: buildContractYaml(db, p, port, { masking: 'MP_MASK_PII', row: 'RAP_OPCO_ACCESS' }) };
  });
}
