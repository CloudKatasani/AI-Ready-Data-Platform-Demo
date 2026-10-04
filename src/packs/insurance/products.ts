import type { Agent, ContextLayer, DataProduct, SemanticView, SfObject } from '../../types';
import { buildContractYaml, buildGates } from '../shared/product-kit';
import { GATE6_CHECK } from './catalog';

type Base = Omit<DataProduct, 'gates' | 'contractYaml'> & { consumersNamed: string[]; analystEval: number; agentEval: number; dq: number };

const MASKING = 'MP_MASK_PII, MP_MASK_PHI';
const ROW_POLICY = 'RAP_REGION_ACCESS';

const BASE: Base[] = [
  { id: 'DP-01', name: 'Policyholder 360', domain: 'Policyholder', status: 'Certified', version: '2.1.0', owner: 'Personal & Commercial Lines (C. Whitaker)', steward: 'H. Quansah', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_POLICYHOLDER_360', outputPort: 'DP_POLICYHOLDER_360', kpiIds: ['K-16', 'K-18', 'K-19', 'K-20'], qualityScore: 98.8, consumers: 188, queriesPerWeek: 2_960, freshness: '2 h ago', lastCertified: '2026-06-18',
    description: 'One trusted view of every policy and policyholder: line, region, agency, premium, tenure, renewal and claim count.',
    purpose: 'Give underwriting, service and marketing teams one certified policyholder record for retention, cross-sell and agents.',
    sampleQuestions: ['How many policies do we have in force?', 'What is our policy retention rate this year?'],
    upstream: ['CONFORMED_GOLD.DIM_POLICY', 'CONFORMED_GOLD.FCT_PREMIUM', 'CONFORMED_GOLD.FCT_CLAIM'], consumersNamed: ['Policyholder service', 'Marketing', 'Claims Analyst agent'], analystEval: 95, agentEval: 94, dq: 98.8 },
  { id: 'DP-02', name: 'Claims Experience', domain: 'Claims', status: 'Certified', version: '1.6.0', owner: 'Claims Analytics (L. Brennan)', steward: 'H. Quansah', sla: 'Hourly',
    semanticView: 'SV_CLAIMS_EXPERIENCE', outputPort: 'DP_CLAIMS_EXPERIENCE', kpiIds: ['K-01', 'K-02', 'K-03', 'K-04', 'K-05', 'K-06', 'K-07', 'K-08', 'K-09', 'K-10', 'K-11'], qualityScore: 99.0, consumers: 142, queriesPerWeek: 3_410, freshness: '41 min ago', lastCertified: '2026-05-21',
    description: 'Claims at claim grain with incurred, paid, reserve, LAE, recoveries, cat codes and cycle time, joined to earned premium for loss ratios.',
    purpose: 'Loss ratio and claims performance reporting by line, region and accident period, with catastrophe losses identified by the cat-code list.',
    sampleQuestions: ['What is the loss ratio by line of business this year, excluding catastrophe losses?', 'How many open claims do we have?'],
    upstream: ['CONFORMED_GOLD.FCT_CLAIM', 'CONFORMED_GOLD.FCT_CLAIM_TRANSACTION', 'CONFORMED_GOLD.DIM_LINE_OF_BUSINESS', 'CONFORMED_GOLD.DIM_CAT_EVENT'], consumersNamed: ['Claims operations', 'Underwriting', 'Underwriting Copilot agent'], analystEval: 96, agentEval: 95, dq: 99.0 },
  { id: 'DP-03', name: 'Premium & Billing', domain: 'Finance', status: 'Certified', version: '3.2.1', owner: 'Finance (N. Feld)', steward: 'P. Lindgren', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_POLICYHOLDER_360', outputPort: 'DP_PREMIUM_BILLING', kpiIds: ['K-12', 'K-13', 'K-14', 'K-15', 'K-17'], qualityScore: 98.4, consumers: 77, queriesPerWeek: 1_280, freshness: '3 h ago', lastCertified: '2026-04-09',
    description: 'Written, earned and billed premium at policy-month grain, with underwriting expense and delinquency.',
    purpose: 'Premium reporting, loss ratio denominators, expense ratio and billing delinquency.',
    sampleQuestions: ['What is earned premium year to date?', 'What is premium growth versus last year?'],
    upstream: ['CONFORMED_GOLD.FCT_PREMIUM', 'CONFORMED_GOLD.DIM_POLICY'], consumersNamed: ['Finance', 'Actuarial', 'Underwriting Copilot agent'], analystEval: 94, agentEval: 95, dq: 98.4 },
  { id: 'DP-04', name: 'Distribution Performance', domain: 'Distribution', status: 'Certified', version: '1.3.0', owner: 'Distribution (J. Castellano)', steward: 'R. Mendes', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_DISTRIBUTION', outputPort: 'DP_DISTRIBUTION_PERFORMANCE', kpiIds: ['K-21', 'K-22', 'K-23'], qualityScore: 98.1, consumers: 53, queriesPerWeek: 740, freshness: '4 h ago', lastCertified: '2026-07-14',
    description: 'Submission funnel by agency and channel: quotes, binds, new business premium and quote turnaround.',
    purpose: 'Agency management, producer reviews and new business planning.',
    sampleQuestions: ['What was our quote-to-bind ratio last quarter?', 'Which agencies take longer than 3 days to quote?'],
    upstream: ['CONFORMED_GOLD.FCT_SUBMISSION', 'CONFORMED_GOLD.DIM_PRODUCER'], consumersNamed: ['Distribution managers', 'Underwriting', 'Distribution Insights agent'], analystEval: 92, agentEval: 92, dq: 98.1 },
  { id: 'DP-05', name: 'Loss Reserves', domain: 'Reserving', status: 'In certification', version: '1.0.0-rc', owner: 'Actuarial (S. Varga)', steward: 'P. Lindgren', sla: 'Daily by 05:00 ET',
    semanticView: 'SV_LOSS_RESERVES', outputPort: 'DP_LOSS_RESERVES', kpiIds: ['K-24', 'K-25', 'K-26'], qualityScore: 94.0, consumers: 0, queriesPerWeek: 0, freshness: '5 h ago',
    description: 'Month-end case reserves and allocated IBNR per open claim, by line, region and accident year.',
    purpose: 'Give actuarial, claims and the Claims Analyst agent a certified reserve view (case, IBNR, reserve per open claim).',
    sampleQuestions: ['What is our total case reserve balance this month?', 'IBNR reserve by line of business'],
    upstream: ['CONFORMED_GOLD.FCT_RESERVE', 'CONFORMED_GOLD.FCT_CLAIM'], consumersNamed: ['Actuarial', 'Claims operations', 'Claims Analyst agent'], analystEval: 91, agentEval: 93, dq: 94.0 },
  { id: 'DP-06', name: 'Catastrophe Exposure', domain: 'Catastrophe risk', status: 'Draft', version: '0.4.0', owner: 'Catastrophe Risk (E. Moravec)', steward: null, sla: 'Weekly',
    outputPort: 'DP_CATASTROPHE_EXPOSURE', kpiIds: ['K-27', 'K-28'], qualityScore: 87.5, consumers: 5, queriesPerWeek: 42, freshness: '1 d ago',
    description: 'Property total insured value by catastrophe zone, joined to the cat-code list and catastrophe losses.',
    purpose: 'Monitor hurricane and wildfire accumulation against the underwriting concentration limit.',
    sampleQuestions: ['How much total insured value sits in hurricane and wildfire zones?'],
    upstream: ['CURATED_SILVER.CAT_EVENT', 'CONFORMED_GOLD.DIM_POLICY'], consumersNamed: ['Catastrophe risk'], analystEval: 0, agentEval: 0, dq: 87.5 },
];

export function buildProducts(db: string, objects: SfObject[], svs: SemanticView[], ctx: ContextLayer, agents: Agent[]): DataProduct[] {
  return BASE.map(({ consumersNamed, analystEval, agentEval, dq, ...p }) => {
    const port = objects.find((o) => o.schema === 'DATA_PRODUCTS' && o.name === p.outputPort);
    const sv = svs.find((s) => s.name === p.semanticView);
    const cde = (port?.columns ?? []).filter((c) => (c.tags ?? []).includes('CDE')).length;
    const sensitive = (port?.columns ?? []).filter((c) => (c.tags ?? []).some((t) => t !== 'CDE')).map((c) => (c.maskPendingFix === GATE6_CHECK ? `FCT_RESERVE.${c.name}` : c.name));
    const agent = agents.find((a) => a.productIds.includes(p.id));
    const gates = buildGates(
      {
        owner: p.owner, steward: p.steward, domain: p.domain, consumers: consumersNamed, sla: p.sla, cdeCount: cde, dqScore: dq,
        metrics: sv?.metrics.length ?? 0, verifiedQueries: sv ? ctx.verifiedQueries.filter((v) => v.semanticView === sv.name).length : 0,
        analystEval, sensitiveColumns: sensitive, rowPolicy: ROW_POLICY, maskingPolicy: MASKING, upstream: p.upstream,
        agentEval: agent?.evalAccuracy ?? agentEval, rules: ctx.rules.filter((r) => sv && r.metric.startsWith(sv.name)).length, synonyms: ctx.synonyms.length,
      },
      p.status === 'In certification' ? { pendingFrom: 4 } : p.status === 'Draft' ? { upTo: 2 } : {},
    );
    return { ...p, gates, contractYaml: buildContractYaml(db, p, port, { masking: MASKING, row: ROW_POLICY }) };
  });
}
