import type { Agent, ContextLayer, DataProduct, SemanticView, SfObject } from '../../types';
import { buildContractYaml, buildGates } from '../shared/product-kit';
import { GATE6_CHECK } from './catalog';

type Base = Omit<DataProduct, 'gates' | 'contractYaml'> & { consumersNamed: string[]; analystEval: number; agentEval: number; dq: number };

export const MASKING = 'MP_MASK_PII, MP_MASK_PCI';
export const ROW_POLICY = 'RAP_REGION_ACCESS';

const BASE: Base[] = [
  { id: 'DP-01', name: 'Customer & Loyalty 360', domain: 'Customer', status: 'Certified', version: '2.2.0', owner: 'Customer Insights (R. Okonkwo)', steward: 'L. Ferraro', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_CUSTOMER_LOYALTY', outputPort: 'DP_CUSTOMER_LOYALTY_360', kpiIds: ['K-01', 'K-02', 'K-03', 'K-04', 'K-05', 'K-25'], qualityScore: 98.4, consumers: 187, queriesPerWeek: 3_240, freshness: '2 h ago', lastCertified: '2026-06-18',
    description: 'One trusted record for every Harbor Club member: tier, spend, purchase frequency, channel mix and loyalty share of sales.',
    purpose: 'Give customer insights, CRM and marketing one certified member view for segmentation, outreach and agents.',
    sampleQuestions: ['How many active loyalty members are omnichannel shoppers?', 'What was the loyalty share of sales by region last quarter?'],
    upstream: ['CONFORMED_GOLD.DIM_CUSTOMER', 'CONFORMED_GOLD.FCT_SALES', 'CONFORMED_GOLD.DIM_STORE'], consumersNamed: ['CRM & loyalty marketing', 'Customer insights', 'Merchandising Copilot'], analystEval: 94, agentEval: 94, dq: 98.4 },
  { id: 'DP-02', name: 'Sales Performance', domain: 'Sales', status: 'Certified', version: '3.1.0', owner: 'Finance – FP&A (J. Whitaker)', steward: 'M. Haddad', sla: 'Hourly',
    semanticView: 'SV_STORE_SALES', outputPort: 'DP_SALES_PERFORMANCE', kpiIds: ['K-06', 'K-07', 'K-08', 'K-09', 'K-10', 'K-11'], qualityScore: 99.2, consumers: 342, queriesPerWeek: 6_910, freshness: '41 min ago', lastCertified: '2026-05-30',
    description: 'Daily store and e-commerce sales by store, with comparable-store flags, the promotion running and same-day-last-year alignment.',
    purpose: 'Weekly trading reviews, comparable store sales reporting and store performance management.',
    sampleQuestions: ['Which promotions lifted comparable sales above 5% last quarter?', 'Top 5 stores by net sales last week'],
    upstream: ['CONFORMED_GOLD.FCT_SALES', 'CONFORMED_GOLD.DIM_STORE', 'CONFORMED_GOLD.DIM_PROMOTION'], consumersNamed: ['Store operations', 'Finance – FP&A', 'Store Operations Analyst agent'], analystEval: 96, agentEval: 95, dq: 99.2 },
  { id: 'DP-03', name: 'Inventory Health', domain: 'Merchandising', status: 'Certified', version: '1.3.0', owner: 'Merchandise Planning (A. Brennan)', steward: 'P. Castellanos', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_SUPPLY_CHAIN', outputPort: 'DP_INVENTORY_HEALTH', kpiIds: ['K-12', 'K-13', 'K-14', 'K-15', 'K-16'], qualityScore: 97.8, consumers: 96, queriesPerWeek: 1_580, freshness: '3 h ago', lastCertified: '2026-04-14',
    description: 'Weekly stock position by store and category: sell-through, stock-outs, weeks of supply, turns and inventory at cost.',
    purpose: 'Replenishment, markdown and allocation decisions for merchandise planners.',
    sampleQuestions: ['What is our sell-through rate this quarter?', 'What is the out-of-stock rate by category last week?'],
    upstream: ['CONFORMED_GOLD.FCT_INVENTORY', 'CONFORMED_GOLD.DIM_STORE', 'CONFORMED_GOLD.DIM_PRODUCT'], consumersNamed: ['Merchandise planning', 'Allocation', 'Supply Chain Assistant'], analystEval: 93, agentEval: 92, dq: 97.8 },
  { id: 'DP-04', name: 'Supplier Performance', domain: 'Supply chain', status: 'Certified', version: '2.0.1', owner: 'Supply Chain (D. Mensah)', steward: 'P. Castellanos', sla: 'Daily by 07:00 ET',
    semanticView: 'SV_SUPPLY_CHAIN', outputPort: 'DP_SUPPLIER_PERFORMANCE', kpiIds: ['K-17', 'K-18', 'K-19', 'K-20', 'K-21'], qualityScore: 98.6, consumers: 58, queriesPerWeek: 720, freshness: '4 h ago', lastCertified: '2026-07-09',
    description: 'PO line delivery performance from supplier EDI: OTIF, fill rate, lead time, ASN accuracy and spend.',
    purpose: 'Vendor scorecards, chargebacks and supplier business reviews.',
    sampleQuestions: ['Which suppliers have OTIF below 90%?', 'Supplier fill rate by supplier'],
    upstream: ['CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY', 'CONFORMED_GOLD.DIM_SUPPLIER'], consumersNamed: ['Vendor management', 'Merchandise planning', 'Supply Chain Assistant'], analystEval: 92, agentEval: 92, dq: 98.6 },
  { id: 'DP-05', name: 'Promotion Effectiveness', domain: 'Merchandising', status: 'In certification', version: '1.0.0-rc', owner: 'Marketing & Promotions (S. Adeyemi)', steward: 'L. Ferraro', sla: 'Daily by 06:00 ET',
    semanticView: 'SV_PROMO_EFFECTIVENESS', outputPort: 'DP_PROMOTION_EFFECTIVENESS', kpiIds: ['K-22', 'K-23', 'K-24'], qualityScore: 94.6, consumers: 0, queriesPerWeek: 0, freshness: '2 h ago',
    description: 'Promotion redemptions with modelled baselines: lift, ROI, promotion cost and redemption rate by event, region and category.',
    purpose: 'Give marketing, merchandising and the Merchandising Copilot a certified read on which promotions pay back.',
    sampleQuestions: ['What was the ROI of each promotion last quarter?', 'What is the promotional lift by promotion?'],
    upstream: ['CONFORMED_GOLD.FCT_PROMO_SALES', 'CONFORMED_GOLD.DIM_PROMOTION', 'CONFORMED_GOLD.DIM_STORE'], consumersNamed: ['Marketing & promotions', 'Merchandising', 'Merchandising Copilot'], analystEval: 91, agentEval: 93, dq: 94.6 },
  { id: 'DP-06', name: 'Returns & Fraud', domain: 'Store operations', status: 'Draft', version: '0.4.0', owner: 'Loss Prevention (V. Novak)', steward: null, sla: 'Daily',
    outputPort: 'DP_RETURNS_FRAUD', kpiIds: ['K-26', 'K-27'], qualityScore: 89.5, consumers: 5, queriesPerWeek: 60, freshness: '1 d ago',
    description: 'Return-level view with receipt status, reasons and loss-prevention fraud flags, joined to sales for return rates.',
    purpose: 'Spot return abuse and track return rates by store and region.',
    sampleQuestions: ['What is the return rate by region this quarter?'],
    upstream: ['CURATED_SILVER.RETURN_TXN', 'CONFORMED_GOLD.FCT_SALES'], consumersNamed: ['Loss prevention'], analystEval: 0, agentEval: 0, dq: 89.5 },
];

export function buildProducts(db: string, objects: SfObject[], svs: SemanticView[], ctx: ContextLayer, agents: Agent[]): DataProduct[] {
  return BASE.map(({ consumersNamed, analystEval, agentEval, dq, ...p }) => {
    const port = objects.find((o) => o.schema === 'DATA_PRODUCTS' && o.name === p.outputPort);
    const sv = svs.find((s) => s.name === p.semanticView);
    const cde = (port?.columns ?? []).filter((c) => (c.tags ?? []).includes('CDE')).length;
    const sensitive = (port?.columns ?? []).filter((c) => (c.tags ?? []).some((t) => t !== 'CDE')).map((c) => (c.maskPendingFix === GATE6_CHECK ? `FCT_PROMO_SALES.${c.name}` : c.name));
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
