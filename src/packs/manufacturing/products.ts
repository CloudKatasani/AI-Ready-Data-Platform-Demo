import type { Agent, ContextLayer, DataProduct, SemanticView, SensitiveClass, SfObject } from '../../types';
import { buildContractYaml, buildGates } from '../shared/product-kit';
import { GATE6_CHECK } from './catalog';

type Base = Omit<DataProduct, 'gates' | 'contractYaml'> & { consumersNamed: string[]; analystEval: number; agentEval: number; dq: number };

export const MASKING_POLICIES: Partial<Record<SensitiveClass, string>> = { PII: 'MP_MASK_PII', TRADE_SECRET: 'MP_MASK_TRADE_SECRET' };
export const ROW_POLICY = 'RAP_BU_ACCESS';

const BASE: Base[] = [
  { id: 'DP-01', name: 'Production & OEE', domain: 'Operations', status: 'Certified', version: '2.1.0', owner: 'Manufacturing Excellence (D. Kowalczyk)', steward: 'M. Lindgren', sla: 'Every 15 min',
    semanticView: 'SV_PLANT_PERFORMANCE', outputPort: 'DP_PRODUCTION_OEE', kpiIds: ['K-01', 'K-02', 'K-03', 'K-04', 'K-05', 'K-06', 'K-07'], qualityScore: 98.9, consumers: 236, queriesPerWeek: 4_410, freshness: '14 min ago', lastCertified: '2026-06-18',
    description: 'OEE and its availability, performance and quality components at line × shift grain, with output, downtime reasons and shift leads.',
    purpose: 'Give plant, business-unit and corporate operations one certified OEE for tier meetings, capacity planning and agents.',
    sampleQuestions: ['Which lines had OEE below 65% last week, and what drove the losses?', 'What was OEE by business unit last quarter?'],
    upstream: ['CONFORMED_GOLD.FCT_LINE_PRODUCTION', 'CONFORMED_GOLD.DIM_LINE', 'CONFORMED_GOLD.DIM_OPERATOR'], consumersNamed: ['Plant managers', 'Operations excellence', 'Plant Performance Analyst', 'Quality Copilot'], analystEval: 96, agentEval: 95, dq: 98.9 },
  { id: 'DP-02', name: 'Quality & Defects', domain: 'Quality', status: 'Certified', version: '1.6.2', owner: 'Quality (S. Haddad)', steward: 'P. Nakamura', sla: 'Hourly',
    semanticView: 'SV_PLANT_PERFORMANCE', outputPort: 'DP_QUALITY_DEFECTS', kpiIds: ['K-08', 'K-09', 'K-10', 'K-11', 'K-12', 'K-13'], qualityScore: 98.2, consumers: 118, queriesPerWeek: 1_960, freshness: '41 min ago', lastCertified: '2026-05-07',
    description: 'Inspection lots with first-pass result, defect codes, NCRs and cost of poor quality, joined to lines and plants.',
    purpose: 'ISO 9001 quality reporting, material review boards and defect-reduction projects.',
    sampleQuestions: ['Compare first-pass yield and scrap rate this quarter with last quarter', 'Top 5 defect codes by cost of poor quality last quarter'],
    upstream: ['CONFORMED_GOLD.FCT_QUALITY_INSPECTION', 'CONFORMED_GOLD.DIM_LINE'], consumersNamed: ['Plant quality engineers', 'Material review board', 'Quality Copilot'], analystEval: 94, agentEval: 95, dq: 98.2 },
  { id: 'DP-03', name: 'Asset Maintenance', domain: 'Maintenance', status: 'Certified', version: '1.3.0', owner: 'Reliability Engineering (B. Osei)', steward: 'K. Mensah', sla: 'Every 30 min',
    semanticView: 'SV_ASSET_MAINTENANCE', outputPort: 'DP_ASSET_MAINTENANCE', kpiIds: ['K-14', 'K-15', 'K-16', 'K-17'], qualityScore: 97.6, consumers: 74, queriesPerWeek: 1_120, freshness: '22 min ago', lastCertified: '2026-04-22',
    description: 'Corrective and preventive work orders per asset, with criticality, failure causes and repair hours.',
    purpose: 'Reliability reviews, PM planning and spare-parts readiness.',
    sampleQuestions: ['Which assets have MTBF below 150 hours this quarter?', 'What share of maintenance work was planned this quarter?'],
    upstream: ['CONFORMED_GOLD.FCT_MAINTENANCE_EVENT', 'CONFORMED_GOLD.DIM_ASSET'], consumersNamed: ['Maintenance planners', 'Reliability engineering', 'Maintenance Planner agent'], analystEval: 93, agentEval: 92, dq: 97.6 },
  { id: 'DP-04', name: 'Supplier Performance', domain: 'Supply chain', status: 'Certified', version: '2.0.1', owner: 'Supply Chain (T. Brandt)', steward: 'J. Okonkwo', sla: 'Daily by 05:00 local',
    semanticView: 'SV_SUPPLIER_PERFORMANCE', outputPort: 'DP_SUPPLIER_PERFORMANCE', kpiIds: ['K-18', 'K-19', 'K-20'], qualityScore: 98.4, consumers: 57, queriesPerWeek: 640, freshness: '4 h ago', lastCertified: '2026-07-14',
    description: 'Inbound receipts with OTIF, incoming-inspection rejects (PPM) and lead time per supplier and plant.',
    purpose: 'Supplier scorecards, SCAR decisions and sourcing reviews.',
    sampleQuestions: ['What was supplier OTIF last quarter?', 'Which suppliers had OTIF below 90% last quarter?'],
    upstream: ['CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY', 'CONFORMED_GOLD.DIM_SUPPLIER'], consumersNamed: ['Commodity managers', 'Supplier quality', 'Maintenance Planner agent'], analystEval: 92, agentEval: 92, dq: 98.4 },
  { id: 'DP-05', name: 'Order to Delivery', domain: 'Order fulfilment', status: 'In certification', version: '1.0.0-rc', owner: 'Customer Operations (A. Varga)', steward: 'J. Okonkwo', sla: 'Hourly',
    semanticView: 'SV_ORDER_DELIVERY', outputPort: 'DP_ORDER_TO_DELIVERY', kpiIds: ['K-21', 'K-22', 'K-23', 'K-24'], qualityScore: 95.1, consumers: 0, queriesPerWeek: 0, freshness: '1 h ago',
    description: 'Customer order lines from order to proof of delivery: promised and delivered dates, on-time and in-full flags, lead time.',
    purpose: 'Give customer operations and the Plant Performance Analyst a certified on-time delivery and fill-rate view.',
    sampleQuestions: ['What was our on-time delivery rate last month?', 'What is the order fill rate this quarter?'],
    upstream: ['CONFORMED_GOLD.FCT_ORDER', 'CONFORMED_GOLD.DIM_DATE'], consumersNamed: ['Customer operations', 'Sales & operations planning', 'Plant Performance Analyst'], analystEval: 92, agentEval: 93, dq: 95.1 },
  { id: 'DP-06', name: 'Energy & Emissions', domain: 'Sustainability', status: 'Draft', version: '0.4.0', owner: 'EHS & Sustainability (C. Brennan)', steward: null, sla: 'Daily',
    outputPort: 'DP_ENERGY_EMISSIONS', kpiIds: ['K-25', 'K-26'], qualityScore: 89.6, consumers: 6, queriesPerWeek: 48, freshness: '1 d ago',
    description: 'Metered energy per line and day, energy per good unit and location-based scope 2 emissions.',
    purpose: 'Energy-efficiency projects and scope 2 reporting.',
    sampleQuestions: ['What was energy per unit and scope 2 emissions by business unit last quarter?'],
    upstream: ['CONFORMED_GOLD.FCT_LINE_PRODUCTION', 'CONFORMED_GOLD.DIM_LINE'], consumersNamed: ['EHS & sustainability'], analystEval: 0, agentEval: 0, dq: 89.6 },
];

export function buildProducts(db: string, objects: SfObject[], svs: SemanticView[], ctx: ContextLayer, agents: Agent[]): DataProduct[] {
  return BASE.map(({ consumersNamed, analystEval, agentEval, dq, ...p }) => {
    const port = objects.find((o) => o.schema === 'DATA_PRODUCTS' && o.name === p.outputPort);
    const sv = svs.find((s) => s.name === p.semanticView);
    const cols = port?.columns ?? [];
    const cde = cols.filter((c) => (c.tags ?? []).includes('CDE')).length;
    const sensitiveCols = cols.filter((c) => (c.tags ?? []).some((t) => t !== 'CDE'));
    const sensitive = sensitiveCols.map((c) => (c.maskPendingFix === GATE6_CHECK ? `FCT_ORDER.${c.name}` : c.name));
    const classes = [...new Set(sensitiveCols.flatMap((c) => (c.tags ?? []).filter((t) => t !== 'CDE') as SensitiveClass[]))];
    const masking = classes.length ? classes.map((c) => MASKING_POLICIES[c] ?? 'MP_MASK_PII').join(', ') : 'MP_MASK_PII';
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
