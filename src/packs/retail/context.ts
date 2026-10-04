import type { ContextLayer, VerifiedQuery } from '../../types';

const DB = 'HPR_AI_PLATFORM';

type VqSpec = [question: string, metrics: string, dims: string, where?: string];

const vq = (sv: string, items: VqSpec[], start: number, by: string[]): VerifiedQuery[] =>
  items.map(([question, metrics, dims, where], i) => ({
    id: `VQ-${String(start + i).padStart(3, '0')}`,
    semanticView: sv,
    question,
    sql: `SELECT *\n  FROM SEMANTIC_VIEW(\n    ${DB}.SEMANTIC.${sv}\n    METRICS ${metrics}${dims ? `\n    DIMENSIONS ${dims}` : ''}${where ? `\n    WHERE ${where}` : ''}\n  );`,
    verifiedBy: by[i % by.length],
    verifiedOn: `2026-0${7 + (i % 3)}-${String(3 + ((i * 5) % 25)).padStart(2, '0')}`,
  }));

const VQ_CUSTOMER: VqSpec[] = [
  ['What was the loyalty share of sales by region last quarter?', 'loyalty_share_pct', 'store.region', "date.sales_date BETWEEN '2026-07-01' AND '2026-09-30'"],
  ['How many active loyalty members do we have?', 'active_members', ''],
  ['How many active loyalty members are omnichannel shoppers?', 'active_members, omnichannel_share_pct', 'member.is_omnichannel'],
  ['Active members by tier', 'active_members', 'member.tier'],
  ['Average annual spend per active member by region', 'avg_spend_per_member', 'member.home_region'],
  ['What is the repeat purchase rate for active members?', 'repeat_purchase_rate', ''],
  ['Repeat purchase rate by tier', 'repeat_purchase_rate', 'member.tier'],
  ['Which Elite members have not purchased in the last 90 days?', 'avg_spend_per_member', 'member.member_id, member.member_name', "member.tier = 'Elite' AND member.last_purchase_date < '2026-07-02'"],
  ['Omnichannel share by home store region', 'omnichannel_share_pct', 'member.home_region'],
  ['Loyalty share of sales by month this year', 'loyalty_share_pct', 'date.sales_month', "date.sales_date >= '2026-01-01'"],
  ['Loyalty share of sales for e-commerce versus stores', 'loyalty_share_pct', 'sales.channel'],
  ['Average predicted lifetime value by tier', 'avg_predicted_clv', 'member.tier'],
  ['Active members by home store format', 'active_members', 'store.format'],
  ['Daily loyalty sales for the last 30 days', 'loyalty_share_pct', 'date.sales_date', "date.sales_date >= '2026-09-01'"],
];
const VQ_SALES: VqSpec[] = [
  ['Which promotions lifted comparable sales above 5% last quarter?', 'comp_sales_pct', 'promo.promo_name', "date.sales_date BETWEEN '2026-07-01' AND '2026-09-30' AND sales.is_comp_store"],
  ['What are comparable store sales year to date?', 'comp_sales_pct', '', "date.sales_date BETWEEN '2026-01-01' AND '2026-09-30'"],
  ['Comparable store sales by region year to date', 'comp_sales_pct', 'store.region', "date.sales_date >= '2026-01-01'"],
  ['Comp sales by month this year', 'comp_sales_pct', 'date.sales_month', "date.sales_date >= '2026-01-01'"],
  ['Top 5 stores by net sales last week', 'net_sales', 'store.store_name', "date.sales_date BETWEEN '2026-09-21' AND '2026-09-27'"],
  ['Net sales by region this quarter', 'net_sales', 'store.region', "date.fiscal_quarter = '2026-Q3'"],
  ['Compare basket size this quarter with the same quarter last year', 'basket_size, units_per_transaction', 'date.fiscal_year', "MONTH(date.sales_date) BETWEEN 7 AND 9"],
  ['Average basket size by store format', 'basket_size', 'store.format'],
  ['E-commerce share of sales by region', 'ecommerce_share_pct', 'store.region'],
  ['Transactions by day of week last month', 'transactions', 'date.day_of_week', "date.sales_date >= '2026-09-01'"],
  ['Discount rate during promotions versus non-promotion days', 'discount_rate_pct', 'promo.promo_name'],
  ['Comparable store sales for e-commerce versus store channel', 'comp_sales_pct', 'sales.channel', "date.sales_date >= '2026-07-01'"],
  ['Units per transaction by region last quarter', 'units_per_transaction', 'store.region', "date.fiscal_quarter = '2026-Q3'"],
  ['Net sales on the Labor Day weekend compared with last year', 'net_sales, comp_sales_pct', '', "promo.promo_name = 'Labor Day Weekend Sale'"],
];
const VQ_SUPPLY: VqSpec[] = [
  ['What is our sell-through rate this quarter?', 'sell_through_pct', 'inv.category', "date.week_ending BETWEEN '2026-07-01' AND '2026-09-30'"],
  ['Which suppliers have OTIF below 90%?', 'otif_pct', 'supplier.supplier_name', 'otif_pct < 90'],
  ['What is the out-of-stock rate by category last week?', 'oos_rate_pct', 'inv.category', "date.week_ending = '2026-09-27'"],
  ['Inventory turns by category', 'inventory_turns', 'inv.category'],
  ['Weeks of supply by region', 'weeks_of_supply', 'store.region', "date.week_ending = '2026-09-27'"],
  ['Inventory at cost by category', 'inventory_cost', 'inv.category', "date.week_ending = '2026-09-27'"],
  ['Supplier fill rate by supplier', 'fill_rate_pct', 'supplier.supplier_name'],
  ['Average supplier lead time by category', 'avg_lead_time_days', 'po.category'],
  ['ASN accuracy by supplier', 'asn_accuracy_pct', 'supplier.supplier_name'],
  ['OTIF by distribution center', 'otif_pct', 'po.dc_name'],
  ['Purchase order spend by supplier in the last 12 months', 'po_spend', 'supplier.supplier_name'],
  ['Out-of-stock rate trend by week', 'oos_rate_pct', 'date.week_ending'],
  ['Sell-through for Outdoor Living this quarter', 'sell_through_pct', '', "inv.category = 'Outdoor Living' AND date.week_ending >= '2026-07-01'"],
];
/** Exactly 7: DP-05 certification gate 4 needs 10 verified queries (spec section 7.6). */
const VQ_PROMO: VqSpec[] = [
  ['What was the ROI of each promotion last quarter?', 'promo_roi', 'promo.promo_name', "date.fiscal_quarter = '2026-Q3'"],
  ['What is the promotional lift by promotion?', 'promo_lift_pct', 'promo.promo_name'],
  ['Redemption rate by promotion last quarter', 'redemption_rate_pct', 'promo.promo_name', "date.fiscal_quarter = '2026-Q3'"],
  ['Promotion cost by region', 'promo_cost', 'store.region'],
  ['Incremental margin by promotion type', 'incremental_margin', 'promo.promo_type'],
  ['Promotional lift by category', 'promo_lift_pct', 'promo_sales.category'],
  ['Promotion ROI for loyalty offers versus events', 'promo_roi', 'promo.promo_type'],
];

const verifiedQueries: VerifiedQuery[] = [
  ...vq('SV_CUSTOMER_LOYALTY', VQ_CUSTOMER, 1, ['L. Ferraro', 'R. Okonkwo']),
  ...vq('SV_STORE_SALES', VQ_SALES, 15, ['M. Haddad', 'J. Whitaker']),
  ...vq('SV_SUPPLY_CHAIN', VQ_SUPPLY, 29, ['P. Castellanos', 'D. Mensah']),
  ...vq('SV_PROMO_EFFECTIVENESS', VQ_PROMO, 42, ['L. Ferraro']),
];

export const CONTEXT: ContextLayer = {
  searchService: 'CS_RETAIL_DOCS',
  instructions: [
    { id: 'AI-01', agentId: 'AG-01', type: 'persona', version: '1.4', text: 'You are Harbor & Pine’s Merchandising Copilot. You help customer insights and merchandising teams understand Harbor Club members, loyalty sales, promotions and sales trends.' },
    { id: 'AI-02', agentId: 'AG-01', type: 'response', version: '1.4', text: 'Report percentages to one decimal and currency to the cent for averages, millions for totals. Say which period, which members (active, tier) and which regions a number covers.' },
    { id: 'AI-03', agentId: 'AG-01', type: 'guardrail', version: '1.4', text: 'Never reveal member names, emails, phone numbers or payment card digits unless the user’s role may see unmasked PII and PCI. Never answer from a product the user cannot access.' },
    { id: 'AI-04', agentId: 'AG-01', type: 'orchestration', version: '1.4', text: 'Use Cortex Analyst on SV_CUSTOMER_LOYALTY for members, SV_STORE_SALES for sales trends and SV_PROMO_EFFECTIVENESS for promotion ROI. Use CS_RETAIL_DOCS for the promotion calendar.' },
    { id: 'AI-05', agentId: 'AG-02', type: 'persona', version: '2.1', text: 'You are the Store Operations Analyst. You answer questions about store sales, comparable store sales, baskets, promotions in stores and returns.' },
    { id: 'AI-06', agentId: 'AG-02', type: 'response', version: '2.1', text: 'Always report comparable store sales on comparable stores only, against the same weekday last year, and say how many comp stores are in the base. Percentages to one decimal.' },
    { id: 'AI-07', agentId: 'AG-02', type: 'guardrail', version: '2.1', text: 'Flag any answer that uses a product that is not certified. Do not accuse individual customers of fraud; report flagged returns as counts.' },
    { id: 'AI-08', agentId: 'AG-02', type: 'orchestration', version: '2.1', text: 'Use Cortex Analyst on SV_STORE_SALES. Cite the comparable sales guide in CS_RETAIL_DOCS whenever comp sales are reported, and the returns policy for return questions.' },
    { id: 'AI-09', agentId: 'AG-03', type: 'persona', version: '1.2', text: 'You are the Supply Chain Assistant. You help merchandise planners and supply chain managers track inventory health and supplier delivery.' },
    { id: 'AI-10', agentId: 'AG-03', type: 'response', version: '1.2', text: 'Show rates to one decimal, turns to two decimals and inventory in millions of dollars. Name the week or period.' },
    { id: 'AI-11', agentId: 'AG-03', type: 'guardrail', version: '1.2', text: 'Do not disclose negotiated supplier costs per unit; report totals and rates only.' },
    { id: 'AI-12', agentId: 'AG-03', type: 'orchestration', version: '1.2', text: 'Use Cortex Analyst on SV_SUPPLY_CHAIN. Use the markdown rules and the vendor compliance guide in CS_RETAIL_DOCS for definitions and thresholds.' },
    { id: 'AI-13', agentId: 'AG-04', type: 'persona', version: '0.9', text: 'You are the Data Steward Assistant. You help stewards find governance gaps in the glossary, CDE register and product registry.' },
    { id: 'AI-14', agentId: 'AG-04', type: 'response', version: '0.9', text: 'Answer with a table of items and a recommended next action for each.' },
    { id: 'AI-15', agentId: 'AG-04', type: 'guardrail', version: '0.9', text: 'Read metadata only; never query member-level or payment data.' },
    { id: 'AI-16', agentId: 'AG-04', type: 'orchestration', version: '0.9', text: 'Use the SQL tool over GLOSSARY, GOVERNANCE and DATA_PRODUCTS.DP_REGISTRY. Read certification state live.' },
  ],
  rules: [
    { id: 'BR-001', domain: 'Customer', text: 'An Active Member has an account status of Active and at least one purchase, in store or online, in the last 12 months.', metric: 'SV_CUSTOMER_LOYALTY.active_members', sourceDoc: 'Harbor Club programme standard' },
    { id: 'BR-002', domain: 'Customer', text: 'Loyalty share of sales counts only net sales where a member was scanned at the till or signed in online; receipts linked later are excluded.', metric: 'SV_CUSTOMER_LOYALTY.loyalty_share_pct', sourceDoc: 'Harbor Club programme standard' },
    { id: 'BR-003', domain: 'Customer', text: 'Repeat purchase rate counts purchase days, not transactions: two baskets on the same day are one purchase.', metric: 'SV_CUSTOMER_LOYALTY.repeat_purchase_rate', sourceDoc: 'Harbor Club programme standard' },
    { id: 'BR-004', domain: 'Customer', text: 'A lapsing Elite member is an active Elite member with no purchase in the last 90 days.', metric: 'SV_CUSTOMER_LOYALTY.avg_spend_per_member', sourceDoc: 'Harbor Club programme standard' },
    { id: 'BR-005', domain: 'Sales', text: 'Net sales are gross sales minus discounts and returns, excluding sales tax and gift card sales.', metric: 'SV_STORE_SALES.net_sales', sourceDoc: 'Promotion calendar and comparable sales guide FY2026' },
    { id: 'BR-006', domain: 'Sales', text: 'Comparable store = open 13+ months, remodels excluded. Comp sales compare those stores with the same weekday 364 days earlier and include e-commerce sales attributed to them.', metric: 'SV_STORE_SALES.comp_sales_pct', sourceDoc: 'Promotion calendar and comparable sales guide FY2026' },
    { id: 'BR-007', domain: 'Sales', text: 'Basket size is net sales divided by sales transactions; returns-only transactions are not counted as transactions.', metric: 'SV_STORE_SALES.basket_size', sourceDoc: 'Promotion calendar and comparable sales guide FY2026' },
    { id: 'BR-008', domain: 'Sales', text: 'E-commerce orders are attributed to the fulfilling or pickup store, and to that store’s region.', metric: 'SV_STORE_SALES.ecommerce_share_pct', sourceDoc: 'Promotion calendar and comparable sales guide FY2026' },
    { id: 'BR-009', domain: 'Sales', text: 'A promotion lifted comparable sales when comp sales during its window, in the regions where it ran, exceeded 5%.', metric: 'SV_STORE_SALES.comp_sales_pct', sourceDoc: 'Promotion calendar and comparable sales guide FY2026' },
    { id: 'BR-010', domain: 'Merchandising', text: 'Promotion ROI is incremental gross margin divided by the discount Harbor & Pine funds after vendor funding.', metric: 'SV_PROMO_EFFECTIVENESS.promo_roi', sourceDoc: 'Promotion calendar and comparable sales guide FY2026' },
    { id: 'BR-011', domain: 'Merchandising', text: 'Sell-through is units sold divided by opening on-hand units plus units received in the period.', metric: 'SV_SUPPLY_CHAIN.sell_through_pct', sourceDoc: 'Markdown rules and clearance playbook' },
    { id: 'BR-012', domain: 'Merchandising', text: 'A store-SKU is out of stock when it is ranged on the planogram and has zero units on hand at the Sunday snapshot.', metric: 'SV_SUPPLY_CHAIN.oos_rate_pct', sourceDoc: 'Markdown rules and clearance playbook' },
    { id: 'BR-013', domain: 'Merchandising', text: 'Seasonal and Outdoor Living items below 40% sell-through after 8 weeks take a first markdown of 25%.', metric: 'SV_SUPPLY_CHAIN.sell_through_pct', sourceDoc: 'Markdown rules and clearance playbook' },
    { id: 'BR-014', domain: 'Supply chain', text: 'OTIF is measured per PO line: received at the DC on or before the requested delivery date with at least 98% of the ordered units.', metric: 'SV_SUPPLY_CHAIN.otif_pct', sourceDoc: 'Vendor compliance and EDI guide' },
    { id: 'BR-015', domain: 'Supply chain', text: 'Suppliers below 90% OTIF for a quarter are placed on a corrective action plan with chargebacks.', metric: 'SV_SUPPLY_CHAIN.otif_pct', sourceDoc: 'Vendor compliance and EDI guide' },
    { id: 'BR-016', domain: 'Store operations', text: 'Return rate is returned sales divided by gross sales; returns are accepted within 90 days (30 days for furniture).', metric: 'DP_RETURNS_FRAUD.return_rate_pct', sourceDoc: 'Returns policy and return fraud standard' },
    { id: 'BR-017', domain: 'Store operations', text: 'A return is suspicious when it has no receipt and is over $250, or when the same member makes more than five returns in 30 days.', metric: 'DP_RETURNS_FRAUD.suspicious_return_pct', sourceDoc: 'Returns policy and return fraud standard' },
    { id: 'BR-018', domain: 'Supply chain', text: 'ASN accuracy below 95% for a supplier in a month triggers a compliance chargeback.', metric: 'SV_SUPPLY_CHAIN.asn_accuracy_pct', sourceDoc: 'Vendor compliance and EDI guide' },
  ],
  verifiedQueries,
  synonyms: [
    { term: 'Comparable Store Sales', synonym: 'comps', scope: 'Sales' },
    { term: 'Comparable Store Sales', synonym: 'like for like', scope: 'Sales' },
    { term: 'Comparable Store Sales', synonym: 'same store sales', scope: 'Sales' },
    { term: 'Promotion', synonym: 'promo', scope: 'Merchandising' },
    { term: 'Promotion', synonym: 'campaign', scope: 'Merchandising' },
    { term: 'Loyalty Member', synonym: 'harbor club member', scope: 'Customer' },
    { term: 'Loyalty Member', synonym: 'shopper', scope: 'Customer' },
    { term: 'Basket Size', synonym: 'ATV', scope: 'Sales' },
    { term: 'Basket Size', synonym: 'average ticket', scope: 'Sales' },
    { term: 'Out-of-Stock', synonym: 'OOS', scope: 'Merchandising' },
    { term: 'Out-of-Stock', synonym: 'stockout', scope: 'Merchandising' },
    { term: 'Sell-Through', synonym: 'sell thru', scope: 'Merchandising' },
    { term: 'Supplier OTIF', synonym: 'on time in full', scope: 'Supply chain' },
    { term: 'Supplier OTIF', synonym: 'vendor delivery', scope: 'Supply chain' },
    { term: 'Supplier', synonym: 'vendor', scope: 'Supply chain' },
    { term: 'Store Region', synonym: 'territory', scope: 'Enterprise' },
    { term: 'Return Rate', synonym: 'returns rate', scope: 'Store operations' },
    { term: 'Suspicious Return', synonym: 'return fraud', scope: 'Store operations' },
    { term: 'E-commerce Share', synonym: 'online share', scope: 'Sales' },
    { term: 'Net Sales', synonym: 'revenue', scope: 'Sales' },
  ],
  documents: [
    {
      id: 'DOC-01', title: 'Promotion calendar and comparable sales guide FY2026', source: '@HPR_AI_PLATFORM.CONTEXT.DOCS/promo_calendar_comp_guide_fy2026.pdf', chunkCount: 38, updatedAt: '2026-06-22 09:00:00',
      chunks: [
        { n: 4, text: 'Q3 events on the FY2026 promotion calendar: 4th of July Home Sale (Jul 1–6, all regions), Summer Clearance (Jul 13–26), Back to Campus (Aug 1–16, Northeast, Mid-Atlantic and Midwest), Outdoor Living Event (Aug 6–16, West), Labor Day Weekend Sale (Aug 28–Sep 7), Fall Bedding Refresh (Sep 11–20, Northeast and Mid-Atlantic) and Harbor Club Double Points (Sep 17–27, Midwest and West).' },
        { n: 9, text: 'Comparable store sales. A comparable store is a store open 13 or more full months before the start of the reporting month; remodels are excluded, so a comparable store closed for a remodel leaves the comparable store base for every month affected this year or last year. Comparable store sales compare net sales of comparable stores with the same weekday 364 days earlier and include e-commerce sales attributed to those stores.' },
        { n: 12, text: 'Event performance is read during the promotion window, in the regions where the event ran, against the same weekday-aligned days last year. Merchandising treats growth above 5% during the window as an event that lifted sales; events that lap a strong prior-year event are reviewed separately.' },
        { n: 15, text: 'Promotion ROI is incremental gross margin divided by the discount Harbor & Pine funds after vendor funding. Baselines come from the weekly demand model and are frozen two weeks before the event.' },
      ],
    },
    {
      id: 'DOC-02', title: 'Returns policy and return fraud standard', source: '@HPR_AI_PLATFORM.CONTEXT.DOCS/returns_policy_2026.pdf', chunkCount: 22, updatedAt: '2026-02-10 11:30:00',
      chunks: [
        { n: 2, text: 'Most items can be returned within 90 days with a receipt or order number for a refund to the original tender. Furniture and outdoor furniture can be returned within 30 days.' },
        { n: 6, text: 'Returns without a receipt are refunded as store credit at the lowest selling price in the last 90 days. A no-receipt return over $250 needs manager approval and is flagged for loss-prevention review as a suspicious return.' },
        { n: 9, text: 'A member making more than five returns in 30 days is flagged as a suspicious returner. Loss Prevention reviews every flag within five business days; flags are counts for reporting and never a finding of fraud.' },
      ],
    },
    {
      id: 'DOC-03', title: 'Markdown rules and clearance playbook', source: '@HPR_AI_PLATFORM.CONTEXT.DOCS/markdown_rules_2026.pdf', chunkCount: 26, updatedAt: '2026-03-04 14:00:00',
      chunks: [
        { n: 3, text: 'Sell-through is units sold divided by opening on-hand units plus receipts for the period. Seasonal and Outdoor Living items below 40% sell-through after 8 weeks take a first markdown of 25%.' },
        { n: 7, text: 'A second markdown of 40% is taken at 12 weeks if sell-through is still below 60%. Remaining units move to Summer Clearance or the January clearance event.' },
        { n: 11, text: 'Permanent markdowns are recorded as discounts in net sales; promotional discounts are temporary and tracked by promotion id. Out-of-stock store-SKUs are excluded from markdown decisions until replenished.' },
      ],
    },
    {
      id: 'DOC-04', title: 'Vendor compliance and EDI guide', source: '@HPR_AI_PLATFORM.CONTEXT.DOCS/vendor_compliance_guide_v6.pdf', chunkCount: 31, updatedAt: '2026-01-20 10:00:00',
      chunks: [
        { n: 5, text: 'Suppliers must send an EDI 856 advance ship notice before the truck arrives at the DC. ASN accuracy below 95% in a month incurs a compliance chargeback.' },
        { n: 8, text: 'On time in full (OTIF) is measured per PO line: received at the DC on or before the requested delivery date with at least 98% of ordered units. Suppliers below 90% OTIF for a quarter are placed on a corrective action plan with chargebacks.' },
      ],
    },
  ],
};
