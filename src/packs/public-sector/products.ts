import type { Agent, ContextLayer, DataProduct, SemanticView, SfObject } from '../../types';
import { buildContractYaml, buildGates } from '../shared/product-kit';
import { GATE6_CHECK } from './catalog';

type Base = Omit<DataProduct, 'gates' | 'contractYaml'> & { consumersNamed: string[]; analystEval: number; agentEval: number; dq: number };

export const ROW_POLICY = 'RAP_DISTRICT_ACCESS';
export const MASKING = { PII: 'MP_MASK_PII', GOV_ID: 'MP_MASK_GOV_ID' } as const;

const BASE: Base[] = [
  { id: 'DP-01', name: 'Constituent 360', domain: 'Constituent', status: 'Certified', version: '2.1.0', owner: 'Constituent Services (N. Bergstrom)', steward: 'O. Fitzgerald', sla: 'Daily by 06:30 local',
    semanticView: 'SV_CONSTITUENT_360', outputPort: 'DP_CONSTITUENT_360', kpiIds: ['K-01', 'K-02', 'K-04'], qualityScore: 98.4, consumers: 176, queriesPerWeek: 2_940, freshness: '2 h ago', lastCertified: '2026-06-18',
    description: 'One trusted view of every constituent: district, office, programs enrolled, renewals due and recent contact.',
    purpose: 'Give caseworkers, constituent services and agents one certified constituent record for outreach, renewals and service planning.',
    sampleQuestions: ['How many active constituents are enrolled in more than one program?', 'Which constituents in three or more programs have a renewal due in the next 30 days?'],
    upstream: ['CONFORMED_GOLD.DIM_CONSTITUENT', 'CONFORMED_GOLD.FCT_CASE', 'CONFORMED_GOLD.FCT_SERVICE_REQUEST'], consumersNamed: ['Constituent services', 'Caseworker units', 'Constituent Services Assistant'], analystEval: 94, agentEval: 93, dq: 98.4 },
  { id: 'DP-02', name: 'Case Management', domain: 'Program operations', status: 'Certified', version: '1.6.0', owner: 'Human Services Operations (L. Ortega)', steward: 'K. Yamamoto', sla: 'Every 15 min',
    semanticView: 'SV_CASE_MANAGEMENT', outputPort: 'DP_CASE_MANAGEMENT', kpiIds: ['K-09', 'K-10', 'K-11', 'K-12', 'K-13', 'K-14', 'K-15'], qualityScore: 99.0, consumers: 88, queriesPerWeek: 1_860, freshness: '14 min ago', lastCertified: '2026-05-21',
    description: 'Applications, processing days against the 30-day standard, case backlog and caseload by program, office and district.',
    purpose: 'Operational and state reporting on eligibility timeliness, backlog and caseworker workload.',
    sampleQuestions: ['How many benefit applications exceed the 30-day processing standard?', 'Which five offices have the largest case backlog?'],
    upstream: ['CONFORMED_GOLD.FCT_APPLICATION', 'CONFORMED_GOLD.FCT_CASE', 'CONFORMED_GOLD.DIM_OFFICE'], consumersNamed: ['Program operations', 'State reporting', 'Program Analyst agent'], analystEval: 96, agentEval: 95, dq: 99.0 },
  { id: 'DP-03', name: 'Benefits Payments', domain: 'Payments', status: 'Certified', version: '1.3.2', owner: 'Finance – Benefit Disbursement (A. Kowalczyk)', steward: 'J. Alvarez', sla: 'Daily by 07:00 local',
    semanticView: 'SV_BENEFIT_PAYMENTS', outputPort: 'DP_BENEFIT_PAYMENTS', kpiIds: ['K-16', 'K-17', 'K-18', 'K-19', 'K-20'], qualityScore: 98.7, consumers: 54, queriesPerWeek: 920, freshness: '3 h ago', lastCertified: '2026-07-09',
    description: 'Every benefit payment issued, with quality-control accuracy, improper amounts and issuance timeliness.',
    purpose: 'Payment accuracy reporting, improper payment tracking and disbursement reconciliation.',
    sampleQuestions: ['What is the improper payment rate year to date?', 'What is our payment accuracy rate by program this year?'],
    upstream: ['CONFORMED_GOLD.FCT_PAYMENT', 'CONFORMED_GOLD.DIM_PROGRAM'], consumersNamed: ['Finance', 'Quality control', 'Fraud & Integrity Copilot'], analystEval: 93, agentEval: 92, dq: 98.7 },
  { id: 'DP-04', name: 'Service Requests (311)', domain: 'Constituent', status: 'Certified', version: '2.0.1', owner: '311 Contact Center (D. Harrow)', steward: 'O. Fitzgerald', sla: 'Every 5 min',
    semanticView: 'SV_CONSTITUENT_360', outputPort: 'DP_SERVICE_REQUESTS_311', kpiIds: ['K-03', 'K-05', 'K-06', 'K-07', 'K-08'], qualityScore: 99.2, consumers: 132, queriesPerWeek: 2_310, freshness: '6 min ago', lastCertified: '2026-08-04',
    description: '311 requests by type, department, channel and district, with resolution time, SLA and survey results.',
    purpose: 'Service-level management, open-data publication and constituent satisfaction tracking.',
    sampleQuestions: ['What was the average 311 resolution time last quarter by district?', 'Show daily 311 service requests for the last 30 days'],
    upstream: ['CONFORMED_GOLD.FCT_SERVICE_REQUEST', 'CONFORMED_GOLD.DIM_DATE'], consumersNamed: ['311 operations', 'Open-data portal', 'Constituent Services Assistant'], analystEval: 95, agentEval: 93, dq: 99.2 },
  { id: 'DP-05', name: 'Program Integrity', domain: 'Payments / Integrity', status: 'In certification', version: '1.0.0-rc', owner: 'Program Integrity Unit (V. Szabo)', steward: 'J. Alvarez', sla: 'Daily by 07:00 local',
    semanticView: 'SV_PROGRAM_INTEGRITY', outputPort: 'DP_PROGRAM_INTEGRITY', kpiIds: ['K-22', 'K-23', 'K-24'], qualityScore: 94.6, consumers: 0, queriesPerWeek: 0, freshness: '3 h ago',
    description: 'Integrity flags, reviews, overpayments established and recoveries on paying cases.',
    purpose: 'Give integrity staff, caseworker analysts and agents a certified view of cases under review and overpayment recovery.',
    sampleQuestions: ["Which of my district's cases are flagged for program integrity review?", 'Overpayment recovery rate year to date'],
    upstream: ['CONFORMED_GOLD.FCT_PAYMENT', 'CONFORMED_GOLD.FCT_CASE'], consumersNamed: ['Program integrity unit', 'Caseworker analysts', 'Constituent Services Assistant'], analystEval: 91, agentEval: 92, dq: 94.6 },
  { id: 'DP-06', name: 'Workforce & Budget', domain: 'Finance', status: 'Draft', version: '0.4.0', owner: 'Budget Office (E. Marchetti)', steward: null, sla: 'Monthly',
    outputPort: 'DP_WORKFORCE_BUDGET', kpiIds: ['K-21', 'K-25', 'K-26'], qualityScore: 88.5, consumers: 3, queriesPerWeek: 28, freshness: '1 d ago',
    description: 'Budget, expenditure, authorised and filled positions by department, with cost per case.',
    purpose: 'Link staffing and spend to caseload so program operations can plan hiring and budget requests.',
    sampleQuestions: ['What is our cost per case and caseworker vacancy rate?'],
    upstream: ['CONFORMED_GOLD.FCT_BUDGET', 'CONFORMED_GOLD.FCT_CASE'], consumersNamed: ['Budget office'], analystEval: 0, agentEval: 0, dq: 88.5 },
];

export function buildProducts(db: string, objects: SfObject[], svs: SemanticView[], ctx: ContextLayer, agents: Agent[]): DataProduct[] {
  return BASE.map(({ consumersNamed, analystEval, agentEval, dq, ...p }) => {
    const port = objects.find((o) => o.schema === 'DATA_PRODUCTS' && o.name === p.outputPort);
    const sv = svs.find((s) => s.name === p.semanticView);
    const cols = port?.columns ?? [];
    const cde = cols.filter((c) => (c.tags ?? []).includes('CDE')).length;
    const sensitive = cols.filter((c) => (c.tags ?? []).some((t) => t !== 'CDE')).map((c) => (c.maskPendingFix === GATE6_CHECK ? `FCT_PAYMENT.${c.name}` : c.name));
    const classes = [...new Set(cols.flatMap((c) => (c.tags ?? []).filter((t): t is 'PII' | 'GOV_ID' => t === 'PII' || t === 'GOV_ID')))];
    const masking = (classes.length ? classes : ['PII' as const]).map((c) => MASKING[c]).join(', ');
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
