import type { Agent, ContextLayer, DataProduct, SemanticView, SfObject } from '../../types';
import { buildContractYaml, buildGates } from '../shared/product-kit';
import { GATE6_CHECK } from './catalog';

type Base = Omit<DataProduct, 'gates' | 'contractYaml'> & { consumersNamed: string[]; analystEval: number; agentEval: number; dq: number };

export const MASKING_POLICY = 'MP_MASK_PHI';
export const ROW_POLICY = 'RAP_MARKET_ACCESS';

const BASE: Base[] = [
  { id: 'DP-01', name: 'Patient 360', domain: 'Patient access', status: 'Certified', version: '2.1.0', owner: 'Patient Access (L. Fontaine)', steward: 'O. Pritchard', sla: 'Daily by 05:00 ET',
    semanticView: 'SV_PATIENT_REVENUE', outputPort: 'DP_PATIENT_360', kpiIds: ['K-01', 'K-02', 'K-03', 'K-04'], qualityScore: 98.4, consumers: 186, queriesPerWeek: 3_240, freshness: '1 h ago', lastCertified: '2026-06-18',
    description: 'One trusted record per patient: market, home hospital, coverage, portal enrolment, risk score and open account balances.',
    purpose: 'Give patient access, revenue cycle and care management one certified patient record for reporting, outreach and agents.',
    sampleQuestions: ['How many active patients are self-pay?', 'Which patients have an open balance over $5,000 older than 90 days?'],
    upstream: ['CONFORMED_GOLD.DIM_PATIENT', 'CONFORMED_GOLD.FCT_CLAIM', 'CONFORMED_GOLD.FCT_ENCOUNTER'], consumersNamed: ['Patient access', 'Care management', 'Revenue Cycle Copilot'], analystEval: 95, agentEval: 94, dq: 98.4 },
  { id: 'DP-02', name: 'Encounters & Throughput', domain: 'Hospital operations', status: 'Certified', version: '1.6.0', owner: 'Hospital Operations (M. Arriaga)', steward: 'O. Pritchard', sla: 'Hourly',
    semanticView: 'SV_THROUGHPUT', outputPort: 'DP_ENCOUNTERS_THROUGHPUT', kpiIds: ['K-11', 'K-12', 'K-13', 'K-14', 'K-15', 'K-16', 'K-17'], qualityScore: 98.9, consumers: 132, queriesPerWeek: 2_610, freshness: '24 min ago', lastCertified: '2026-05-12',
    description: 'Inpatient stays, ED visits and clinic appointments with length of stay, occupancy, ED wait and access measures.',
    purpose: 'Daily capacity huddles, throughput improvement and access reporting by hospital, market and clinic.',
    sampleQuestions: ['Which five hospitals had the highest bed occupancy last quarter?', 'What is our average ED wait time this month?'],
    upstream: ['CONFORMED_GOLD.FCT_ENCOUNTER', 'CONFORMED_GOLD.FCT_APPOINTMENT', 'CONFORMED_GOLD.DIM_FACILITY'], consumersNamed: ['Hospital operations', 'Capacity command center', 'Clinical Quality Analyst', 'Patient Access Assistant'], analystEval: 96, agentEval: 95, dq: 98.9 },
  { id: 'DP-03', name: 'Revenue Cycle', domain: 'Revenue cycle', status: 'Certified', version: '3.2.1', owner: 'Revenue Cycle (K. Kilbride)', steward: 'S. Farouk', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_PATIENT_REVENUE', outputPort: 'DP_REVENUE_CYCLE', kpiIds: ['K-05', 'K-06', 'K-07', 'K-08', 'K-09', 'K-10'], qualityScore: 98.1, consumers: 94, queriesPerWeek: 1_980, freshness: '3 h ago', lastCertified: '2026-07-08',
    description: 'Claims (837) and remits (835) with clean-claim, denial, payment and A/R status per claim.',
    purpose: 'Denial management, cash forecasting and A/R reporting for revenue cycle leadership and finance.',
    sampleQuestions: ['What was the claim denial rate last quarter by payer?', 'Show daily claim submissions for the last 30 days'],
    upstream: ['CONFORMED_GOLD.FCT_CLAIM', 'CONFORMED_GOLD.DIM_PAYER', 'CONFORMED_GOLD.DIM_PATIENT'], consumersNamed: ['Revenue cycle', 'Finance', 'Revenue Cycle Copilot'], analystEval: 94, agentEval: 94, dq: 98.1 },
  { id: 'DP-04', name: 'Quality & Readmissions', domain: 'Quality & safety', status: 'Certified', version: '2.0.0', owner: 'Quality & Patient Safety (Dr. R. Valcourt)', steward: 'J. Holloway', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_QUALITY', outputPort: 'DP_QUALITY_READMISSIONS', kpiIds: ['K-18', 'K-19', 'K-20', 'K-21'], qualityScore: 99.0, consumers: 77, queriesPerWeek: 1_120, freshness: '2 h ago', lastCertified: '2026-08-04',
    description: 'Index discharges with 30-day readmission outcome (CMS method), 7-day follow-up and in-hospital mortality.',
    purpose: 'Quality committee reporting, readmission reduction programs and value-based contract performance.',
    sampleQuestions: ['What is our 30-day all-cause readmission rate by service line?', 'What share of discharged patients had a follow-up visit within 7 days?'],
    upstream: ['CONFORMED_GOLD.FCT_READMISSION', 'CONFORMED_GOLD.DIM_FACILITY'], consumersNamed: ['Quality committee', 'Care transitions', 'Clinical Quality Analyst'], analystEval: 97, agentEval: 96, dq: 99.0 },
  { id: 'DP-05', name: 'Clinical Supply Chain', domain: 'Supply chain', status: 'In certification', version: '1.0.0-rc', owner: 'Clinical Supply Chain (P. Tanabe)', steward: 'T. Quarshie', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_SUPPLY_CHAIN', outputPort: 'DP_CLINICAL_SUPPLY_CHAIN', kpiIds: ['K-22', 'K-23', 'K-24'], qualityScore: 94.6, consumers: 0, queriesPerWeek: 0, freshness: '3 h ago',
    description: 'Point-of-use supply, implant and pharmacy cost per encounter, with contract compliance and surgical case costing.',
    purpose: 'Give supply chain, perioperative services and the Revenue Cycle Copilot a certified view of supply cost per case.',
    sampleQuestions: ['What is our supply cost per surgical case this quarter?', 'On-contract supply spend by category'],
    upstream: ['CONFORMED_GOLD.FCT_SUPPLY_USAGE', 'CONFORMED_GOLD.FCT_ENCOUNTER'], consumersNamed: ['Supply chain', 'Perioperative services', 'Revenue Cycle Copilot'], analystEval: 91, agentEval: 92, dq: 94.6 },
  { id: 'DP-06', name: 'Care Gaps & Population Health', domain: 'Population health', status: 'Draft', version: '0.4.0', owner: 'Population Health (Dr. A. Sabbagh)', steward: null, sla: 'Weekly',
    outputPort: 'DP_CARE_GAPS', kpiIds: ['K-25', 'K-26'], qualityScore: 88.4, consumers: 5, queriesPerWeek: 40, freshness: '2 d ago',
    description: 'Open and closed care gaps per attributed patient and measure, with risk score, for outreach.',
    purpose: 'Prioritise outreach to high-risk patients with open preventive and chronic-care gaps.',
    sampleQuestions: ['How many patients have open care gaps?'],
    upstream: ['CONFORMED_GOLD.DIM_PATIENT', 'CONFORMED_GOLD.FCT_APPOINTMENT', 'CURATED_SILVER.ENCOUNTER'], consumersNamed: ['Population health'], analystEval: 0, agentEval: 0, dq: 88.4 },
];

export function buildProducts(db: string, objects: SfObject[], svs: SemanticView[], ctx: ContextLayer, agents: Agent[]): DataProduct[] {
  return BASE.map(({ consumersNamed, analystEval, agentEval, dq, ...p }) => {
    const port = objects.find((o) => o.schema === 'DATA_PRODUCTS' && o.name === p.outputPort);
    const sv = svs.find((s) => s.name === p.semanticView);
    const cde = (port?.columns ?? []).filter((c) => (c.tags ?? []).includes('CDE')).length;
    const sensitive = (port?.columns ?? []).filter((c) => (c.tags ?? []).some((t) => t !== 'CDE')).map((c) => (c.maskPendingFix === GATE6_CHECK ? `FCT_SUPPLY_USAGE.${c.name}` : c.name));
    const agent = agents.find((a) => a.productIds.includes(p.id));
    const gates = buildGates(
      {
        owner: p.owner, steward: p.steward, domain: p.domain, consumers: consumersNamed, sla: p.sla, cdeCount: cde, dqScore: dq,
        metrics: sv?.metrics.length ?? 0, verifiedQueries: sv ? ctx.verifiedQueries.filter((v) => v.semanticView === sv.name).length : 0,
        analystEval, sensitiveColumns: sensitive, rowPolicy: ROW_POLICY, maskingPolicy: MASKING_POLICY, upstream: p.upstream,
        agentEval: agent?.evalAccuracy ?? agentEval, rules: ctx.rules.filter((r) => sv && r.metric.startsWith(sv.name)).length, synonyms: ctx.synonyms.length,
      },
      p.status === 'In certification' ? { pendingFrom: 4 } : p.status === 'Draft' ? { upTo: 2 } : {},
    );
    return { ...p, gates, contractYaml: buildContractYaml(db, p, port, { masking: MASKING_POLICY, row: ROW_POLICY }) };
  });
}
