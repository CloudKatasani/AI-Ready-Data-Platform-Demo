import type { Agent, ContextLayer, DataProduct, SemanticView, SfObject } from '../../types';
import { buildContractYaml, buildGates } from '../shared/product-kit';
import { GATE6_CHECK } from './catalog';

type Base = Omit<DataProduct, 'gates' | 'contractYaml'> & { consumersNamed: string[]; analystEval: number; agentEval: number; dq: number };

export const MASKING = 'MP_MASK_PII, MP_MASK_CPNI';
export const ROW_POLICY = 'RAP_REGION_ACCESS';

const BASE: Base[] = [
  { id: 'DP-01', name: 'Subscriber 360', domain: 'Subscriber', status: 'Certified', version: '2.4.0', owner: 'Subscriber Analytics (K. Albright)', steward: 'R. Mensah', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_SUBSCRIBER_360', outputPort: 'DP_SUBSCRIBER_360', kpiIds: ['K-01', 'K-02', 'K-05'], qualityScore: 98.4, consumers: 236, queriesPerWeek: 4_110, freshness: '2 h ago', lastCertified: '2026-06-18',
    description: 'One trusted view of every mobile line and broadband home: plan, status, autopay, tenure, contract, ARPU, usage and churn propensity.',
    purpose: 'Give marketing, care and subscriber analytics one certified subscriber record for reporting, campaigns and agents.',
    sampleQuestions: ['How many active subscribers are enrolled in autopay?', 'What was postpaid ARPU last quarter by region?'],
    upstream: ['CONFORMED_GOLD.DIM_SUBSCRIBER', 'CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.FCT_DAILY_USAGE'], consumersNamed: ['Marketing', 'Customer care', 'Subscriber Insights agent'], analystEval: 95, agentEval: 94, dq: 98.4 },
  { id: 'DP-02', name: 'Network Performance', domain: 'Network', status: 'Certified', version: '1.6.0', owner: 'Network Operations (S. Varga)', steward: 'P. Okonkwo', sla: 'Hourly',
    semanticView: 'SV_NETWORK_PERFORMANCE', outputPort: 'DP_NETWORK_PERFORMANCE', kpiIds: ['K-10', 'K-11', 'K-12', 'K-13', 'K-14', 'K-15'], qualityScore: 99.2, consumers: 118, queriesPerWeek: 2_760, freshness: '24 min ago', lastCertified: '2026-05-22',
    description: 'Daily cell-site KPIs — call attempts, drops, setup failures, downtime, traffic and throughput — with market, region and technology.',
    purpose: 'Network operations reviews, SLA reporting and capacity planning by site, market and region.',
    sampleQuestions: ['Compare dropped call rate this quarter with last quarter', 'Top 10 cell sites by dropped call rate in the last 30 days'],
    upstream: ['CONFORMED_GOLD.FCT_NETWORK_DAILY', 'CONFORMED_GOLD.DIM_CELL_SITE'], consumersNamed: ['Network operations center', 'RAN engineering', 'Network Operations Analyst agent'], analystEval: 96, agentEval: 95, dq: 99.2 },
  { id: 'DP-03', name: 'Usage & Revenue', domain: 'Revenue', status: 'Certified', version: '1.3.2', owner: 'Revenue Assurance (L. Duarte)', steward: 'J. Whitfield', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_SUBSCRIBER_360', outputPort: 'DP_USAGE_REVENUE', kpiIds: ['K-03', 'K-04', 'K-06', 'K-07', 'K-08', 'K-09'], qualityScore: 98.1, consumers: 74, queriesPerWeek: 1_380, freshness: '3 h ago', lastCertified: '2026-04-09',
    description: 'Invoice-level rated and billed charges, service and roaming revenue, joined to usage from mediated CDRs.',
    purpose: 'Revenue assurance, ARPU reporting and usage analytics from one reconciled source.',
    sampleQuestions: ['What was postpaid ARPU last month?', 'Which markets had revenue leakage above 0.8% last quarter?'],
    upstream: ['CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.FCT_DAILY_USAGE', 'CONFORMED_GOLD.DIM_PLAN'], consumersNamed: ['Revenue assurance', 'Finance', 'Revenue Assurance Copilot'], analystEval: 93, agentEval: 93, dq: 98.1 },
  { id: 'DP-04', name: 'Churn & Retention', domain: 'Subscriber', status: 'Certified', version: '2.0.1', owner: 'Retention Analytics (K. Albright)', steward: 'R. Mensah', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_CHURN_RETENTION', outputPort: 'DP_CHURN_RETENTION', kpiIds: ['K-16', 'K-17', 'K-18', 'K-19', 'K-20', 'K-21'], qualityScore: 99.0, consumers: 152, queriesPerWeek: 2_310, freshness: '1 h ago', lastCertified: '2026-07-14',
    description: 'Monthly subscriber base movements by market and plan: gross adds, voluntary disconnects, port-outs, involuntary disconnects and plan migrations.',
    purpose: 'Board and regulator churn reporting, retention targeting and the link between network experience and churn.',
    sampleQuestions: ['What was postpaid churn last month by plan and region?', 'Postpaid net adds by month'],
    upstream: ['CONFORMED_GOLD.FCT_SUBSCRIBER_MONTHLY', 'CONFORMED_GOLD.DIM_PLAN', 'CONFORMED_GOLD.DIM_MARKET'], consumersNamed: ['Retention marketing', 'Finance', 'Network Operations Analyst agent'], analystEval: 96, agentEval: 95, dq: 99.0 },
  { id: 'DP-05', name: 'Device & Plan Profitability', domain: 'Revenue / Device', status: 'In certification', version: '1.0.0-rc', owner: 'Product Profitability (A. Ferreira)', steward: 'J. Whitfield', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_DEVICE_PLAN_PROFITABILITY', outputPort: 'DP_DEVICE_PLAN_PROFITABILITY', kpiIds: ['K-22', 'K-23', 'K-24'], qualityScore: 94.0, consumers: 0, queriesPerWeek: 0, freshness: '3 h ago',
    description: 'Invoice-level service revenue, cost of service and device subsidy by plan and handset, for gross margin analysis.',
    purpose: 'Give pricing, device and subscriber analysts a certified view of plan and device margin (and the Subscriber Insights agent).',
    sampleQuestions: ['What is gross margin per subscriber by plan this quarter?', 'Device subsidy per postpaid subscriber'],
    upstream: ['CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.DIM_SUBSCRIBER', 'CONFORMED_GOLD.DIM_PLAN'], consumersNamed: ['Pricing', 'Device portfolio', 'Subscriber Insights agent'], analystEval: 91, agentEval: 93, dq: 94.0 },
  { id: 'DP-06', name: 'Field Service Efficiency', domain: 'Field service', status: 'Draft', version: '0.4.0', owner: 'Field Operations (M. Castellanos)', steward: null, sla: 'Daily',
    outputPort: 'DP_FIELD_SERVICE_EFFICIENCY', kpiIds: ['K-25', 'K-26'], qualityScore: 88.5, consumers: 5, queriesPerWeek: 42, freshness: '1 d ago',
    description: 'Install and repair work orders with first-time fix, repeat visits and hours to resolve.',
    purpose: 'Improve first-time fix and repair times for home installs, broadband repairs and network site repairs.',
    sampleQuestions: ['What is the first-time fix rate for network repairs this quarter?'],
    upstream: ['CURATED_SILVER.WORK_ORDER', 'CONFORMED_GOLD.FCT_WORK_ORDER'], consumersNamed: ['Field operations'], analystEval: 0, agentEval: 0, dq: 88.5 },
];

export function buildProducts(db: string, objects: SfObject[], svs: SemanticView[], ctx: ContextLayer, agents: Agent[]): DataProduct[] {
  return BASE.map(({ consumersNamed, analystEval, agentEval, dq, ...p }) => {
    const port = objects.find((o) => o.schema === 'DATA_PRODUCTS' && o.name === p.outputPort);
    const sv = svs.find((s) => s.name === p.semanticView);
    const cde = (port?.columns ?? []).filter((c) => (c.tags ?? []).includes('CDE')).length;
    const sensitive = (port?.columns ?? []).filter((c) => (c.tags ?? []).some((t) => t !== 'CDE')).map((c) => (c.maskPendingFix === GATE6_CHECK ? `DIM_SUBSCRIBER.${c.name}` : c.name));
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
