import type { Agent, ContextLayer, DataProduct, SemanticView, SensitiveClass, SfObject } from '../../types';
import { buildContractYaml, buildGates } from '../shared/product-kit';
import { GATE6_CHECK } from './catalog';

export const MASKING_POLICIES: Partial<Record<SensitiveClass, string>> = { PII: 'MP_MASK_PII', PCI: 'MP_MASK_PCI', NPI: 'MP_MASK_NPI' };
export const ROW_POLICY = 'RAP_REGION_ACCESS';

type Base = Omit<DataProduct, 'gates' | 'contractYaml'> & { consumersNamed: string[]; analystEval: number; agentEval: number; dq: number };

const BASE: Base[] = [
  { id: 'DP-01', name: 'Customer 360', domain: 'Retail banking', status: 'Certified', version: '3.1.0', owner: 'Retail Banking Analytics (C. Vandermeer)', steward: 'N. Pereira', sla: 'Daily by 06:30 ET',
    semanticView: 'SV_CUSTOMER_360', outputPort: 'DP_CUSTOMER_360', kpiIds: ['K-01', 'K-02', 'K-03', 'K-04', 'K-05'], qualityScore: 98.7, consumers: 236, queriesPerWeek: 4_110, freshness: '2 h ago', lastCertified: '2026-06-18',
    description: 'One trusted record per customer: market, segment, active and digital status, products held, deposits, loans and tenure.',
    purpose: 'Give relationship managers, marketing and service teams one certified customer view for outreach, reporting and agents.',
    sampleQuestions: ['How many active customers do we have, and how many are digitally active?', 'What was the average deposit balance per customer by region at the end of last quarter?'],
    upstream: ['CONFORMED_GOLD.DIM_CUSTOMER', 'CONFORMED_GOLD.FCT_DEPOSIT_BALANCE', 'CONFORMED_GOLD.FCT_DIGITAL_SESSION'], consumersNamed: ['Relationship managers', 'Marketing', 'Relationship Manager Assistant'], analystEval: 95, agentEval: 94, dq: 98.7 },
  { id: 'DP-02', name: 'Deposits & Liquidity', domain: 'Treasury', status: 'Certified', version: '2.2.1', owner: 'Treasury (A. Delacroix)', steward: 'S. Kowalewski', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_DEPOSITS_LIQUIDITY', outputPort: 'DP_DEPOSITS_LIQUIDITY', kpiIds: ['K-06', 'K-07', 'K-08', 'K-09', 'K-10', 'K-11', 'K-12'], qualityScore: 99.2, consumers: 74, queriesPerWeek: 1_380, freshness: '3 h ago', lastCertified: '2026-07-09',
    description: 'Month-end deposits by market, branch and product with funding cost, stressed outflows, and GL-based margin, LDR, LCR and efficiency.',
    purpose: 'ALCO reporting, liquidity stress monitoring and deposit pricing decisions.',
    sampleQuestions: ['Which 5 branches had the largest deposit outflows last quarter?', 'Compare net interest margin this quarter with the same quarter last year'],
    upstream: ['CONFORMED_GOLD.FCT_DEPOSIT_BALANCE', 'CONFORMED_GOLD.FCT_GL_MONTHLY', 'CONFORMED_GOLD.DIM_BRANCH'], consumersNamed: ['ALCO', 'Treasury', 'Risk & Liquidity Analyst'], analystEval: 94, agentEval: 95, dq: 99.2 },
  { id: 'DP-03', name: 'Loan Portfolio Risk', domain: 'Credit risk', status: 'Certified', version: '1.6.0', owner: 'Chief Credit Office (R. Thibodeaux)', steward: 'G. Ellery', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_LOAN_PORTFOLIO', outputPort: 'DP_LOAN_PORTFOLIO', kpiIds: ['K-13', 'K-14', 'K-15', 'K-16', 'K-17', 'K-18'], qualityScore: 99.0, consumers: 88, queriesPerWeek: 1_960, freshness: '1 h ago', lastCertified: '2026-05-21',
    description: 'Month-end loan snapshots with delinquency, non-accrual, non-performing status, charge-offs and CECL allowance.',
    purpose: 'Credit risk reporting, stress testing inputs and board risk dashboards.',
    sampleQuestions: ['What is our NPL ratio by loan segment, and how has it trended this year?', 'What is the 30+ days past due rate by market?'],
    upstream: ['CONFORMED_GOLD.FCT_LOAN_BALANCE', 'CONFORMED_GOLD.DIM_CUSTOMER', 'CONFORMED_GOLD.DIM_BRANCH'], consumersNamed: ['Credit risk', 'Stress testing', 'Risk & Liquidity Analyst'], analystEval: 96, agentEval: 95, dq: 99.0 },
  { id: 'DP-04', name: 'Card Transactions', domain: 'Cards', status: 'Certified', version: '2.0.3', owner: 'Card Services (L. Ferreira-Holt)', steward: 'P. Agbaje', sla: 'Every 15 min',
    semanticView: 'SV_CUSTOMER_360', outputPort: 'DP_CARD_TRANSACTIONS', kpiIds: ['K-19', 'K-20', 'K-21', 'K-22'], qualityScore: 98.1, consumers: 57, queriesPerWeek: 2_240, freshness: '9 min ago', lastCertified: '2026-08-04',
    description: 'Card authorisations with merchant category, channel, approval and confirmed fraud loss.',
    purpose: 'Fraud strategy, card portfolio performance and customer spend insight.',
    sampleQuestions: ['What is our card fraud loss rate in basis points this quarter?', 'Show daily card spending over the last 30 days'],
    upstream: ['CONFORMED_GOLD.FCT_CARD_TRANSACTION', 'CONFORMED_GOLD.DIM_CUSTOMER'], consumersNamed: ['Fraud strategy', 'Card marketing', 'Financial Crimes Copilot'], analystEval: 93, agentEval: 92, dq: 98.1 },
  { id: 'DP-05', name: 'AML Alerts & Cases', domain: 'Financial crimes', status: 'In certification', version: '1.0.0-rc', owner: 'BSA/AML Office (M. Quint)', steward: 'J. Rahman', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_AML_ALERTS', outputPort: 'DP_AML_ALERTS', kpiIds: ['K-23', 'K-24', 'K-25', 'K-26'], qualityScore: 95.1, consumers: 0, queriesPerWeek: 0, freshness: '4 h ago',
    description: 'Transaction-monitoring alerts with disposition, case escalation and SAR outcome by market and scenario.',
    purpose: 'Give the BSA/AML office and relationship managers a certified view of alert volumes, escalation and SAR conversion.',
    sampleQuestions: ['How many AML alerts were raised on our customers’ accounts this quarter, and how many were escalated to cases?', 'What is our AML alert-to-case rate this year?'],
    upstream: ['CONFORMED_GOLD.FCT_AML_ALERT', 'CONFORMED_GOLD.DIM_CUSTOMER'], consumersNamed: ['BSA/AML office', 'Retail banking', 'Relationship Manager Assistant'], analystEval: 91, agentEval: 93, dq: 95.1 },
  { id: 'DP-06', name: 'Customer Profitability', domain: 'Finance', status: 'Draft', version: '0.4.0', owner: 'Finance (E. Kesselring)', steward: null, sla: 'Monthly',
    outputPort: 'DP_CUSTOMER_PROFITABILITY', kpiIds: ['K-27', 'K-28'], qualityScore: 89.4, consumers: 5, queriesPerWeek: 40, freshness: '2 d ago',
    description: 'Trailing 12-month net contribution per customer after funds transfer pricing, cost to serve and expected credit loss.',
    purpose: 'Segment pricing and relationship strategy based on customer-level profitability.',
    sampleQuestions: ['Which customer segments are most profitable after expected credit losses?'],
    upstream: ['CONFORMED_GOLD.FCT_DEPOSIT_BALANCE', 'CONFORMED_GOLD.FCT_LOAN_BALANCE', 'CONFORMED_GOLD.FCT_CARD_TRANSACTION', 'CONFORMED_GOLD.DIM_CUSTOMER'], consumersNamed: ['Finance', 'Segment strategy'], analystEval: 0, agentEval: 0, dq: 89.4 },
];

export function buildProducts(db: string, objects: SfObject[], svs: SemanticView[], ctx: ContextLayer, agents: Agent[]): DataProduct[] {
  return BASE.map(({ consumersNamed, analystEval, agentEval, dq, ...p }) => {
    const port = objects.find((o) => o.schema === 'DATA_PRODUCTS' && o.name === p.outputPort);
    const sv = svs.find((s) => s.name === p.semanticView);
    const cols = port?.columns ?? [];
    const cde = cols.filter((c) => (c.tags ?? []).includes('CDE')).length;
    const sensitiveCols = cols.filter((c) => (c.tags ?? []).some((t) => t !== 'CDE'));
    const sensitive = sensitiveCols.map((c) => (c.maskPendingFix === GATE6_CHECK ? `FCT_AML_ALERT.${c.name}` : c.name));
    const classes = [...new Set(sensitiveCols.flatMap((c) => (c.tags ?? []).filter((t) => t !== 'CDE')))] as SensitiveClass[];
    const masking = classes.map((c) => MASKING_POLICIES[c]).filter(Boolean).join(', ') || 'MP_MASK_PII';
    const agent = agents.find((a) => a.productIds.includes(p.id));
    const gates = buildGates(
      {
        owner: p.owner, steward: p.steward, domain: p.domain, consumers: consumersNamed, sla: p.sla, cdeCount: cde, dqScore: dq,
        metrics: sv?.metrics.length ?? 0, verifiedQueries: sv ? ctx.verifiedQueries.filter((v) => v.semanticView === sv.name).length : 0,
        analystEval, sensitiveColumns: sensitive, rowPolicy: ROW_POLICY, maskingPolicy: masking, upstream: p.upstream,
        agentEval: agent?.evalAccuracy ?? agentEval, rules: ctx.rules.filter((r) => sv && r.metric.startsWith(sv.name)).length, synonyms: ctx.synonyms.length,
      },
      p.status === 'In certification' ? { pendingFrom: 4 } : p.status === 'Draft' ? { upTo: 2 } : {},
    );
    return { ...p, gates, contractYaml: buildContractYaml(db, p, port, { masking, row: ROW_POLICY }) };
  });
}
