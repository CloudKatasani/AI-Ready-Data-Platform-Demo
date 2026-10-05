// Retail: source inventory (E5), legacy MicroStrategy reports (E5) and incident scripts (E9).
import type { IncidentScript, InventoryTable, LegacyReport } from '../../../ext/types';

const LM = 'RAW_BRONZE.LOYALTY_MEMBER_CDC';
const POS = 'RAW_BRONZE.POS_TRANSACTION_CDC';
const ECOM = 'RAW_BRONZE.ECOM_ORDER_CDC';
const WMS = 'RAW_BRONZE.WMS_INVENTORY_CDC';
const EDI = 'RAW_BRONZE.SUPPLIER_EDI_CDC';

type Row = [table: string, domain: string, landsOrLevel: string | 0 | 1, consumedBy?: string[], note?: string, carries?: string[]];
const sys = (source: string, rows: Row[]): InventoryTable[] =>
  rows.map(([table, domain, l, consumedBy, note, carries]) => (typeof l === 'string' ? { source, table, domain, level: 1, lands: l, consumedBy, note, carries } : { source, table, domain, level: l, note }));

export const sourceInventory: InventoryTable[] = [
  ...sys('POS transactions', [
    ['POS_TXN_HEADER', 'Sales', POS], ['POS_TXN_LINE', 'Sales', POS, undefined, undefined, ['CONFORMED_GOLD.FCT_SALES.UNITS']],
    ['POS_DISCOUNT', 'Sales', POS, undefined, undefined, ['CONFORMED_GOLD.FCT_SALES.DISCOUNT_USD']],
    ['POS_TENDER', 'Finance', POS, undefined, 'Tender type is curated; not modelled into Gold yet', ['CURATED_SILVER.POS_TRANSACTION.TENDER_TYPE']],
    ['POS_PROMO_REDEMPTION', 'Merchandising', POS, ['DP-05'], 'Feeds Promotion Effectiveness only', ['CONFORMED_GOLD.FCT_PROMO_SALES.INCREMENTAL_MARGIN_USD']],
    ['POS_COUPON_SCAN', 'Merchandising', POS, ['DP-05'], 'Feeds Promotion Effectiveness only', ['CONFORMED_GOLD.FCT_PROMO_SALES.PROMO_COST_USD']],
    ['POS_RETURN', 'Store operations', POS, undefined, undefined, ['CURATED_SILVER.RETURN_TXN.HAS_RECEIPT']],
    ['POS_VOID', 'Store operations', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'], ['POS_REGISTER_EVENT', 'Store operations', 0], ['STORE_TRAFFIC_COUNT', 'Store operations', 0],
  ]),
  ...sys('E-commerce orders', [
    ['ORDER_HEADER', 'Sales', ECOM], ['ORDER_LINE', 'Sales', ECOM, undefined, undefined, ['CONFORMED_GOLD.FCT_SALES.NET_SALES_USD']],
    ['ORDER_FULFILLMENT', 'Sales', ECOM, undefined, 'Ship / pickup type is curated; not modelled into Gold yet', ['CURATED_SILVER.ECOM_ORDER.FULFILMENT_TYPE']],
    ['ORDER_RETURN', 'Store operations', ECOM, undefined, undefined, ['CURATED_SILVER.RETURN_TXN.CHANNEL']],
    ['PROMO_CODE_USAGE', 'Merchandising', ECOM, ['DP-05'], 'Feeds Promotion Effectiveness only', ['CONFORMED_GOLD.FCT_PROMO_SALES.BASELINE_SALES_USD']],
    ['CART_EVENT', 'Sales', 0], ['WEB_SESSION', 'Sales', 0], ['PRODUCT_REVIEW', 'Customer', 0], ['WISHLIST', 'Customer', 0],
  ]),
  ...sys('Loyalty', [
    ['MEMBER', 'Customer', LM], ['MEMBER_TIER_HISTORY', 'Customer', LM, undefined, undefined, ['CURATED_SILVER.LOYALTY_MEMBER.EFFECTIVE_FROM']],
    ['POINTS_LEDGER', 'Customer', LM, undefined, 'Points balance modelled but not in a semantic view', ['CONFORMED_GOLD.DIM_CUSTOMER.POINTS_BALANCE']],
    ['MEMBER_STATUS_EVENT', 'Customer', LM, ['DP-01'], undefined, ['CONFORMED_GOLD.DIM_CUSTOMER.MEMBER_STATUS']],
    ['REWARD_CERTIFICATE', 'Customer', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'], ['MEMBER_SURVEY', 'Customer', 0], ['HOUSEHOLD_LINK', 'Customer', 0, undefined, 'Household matching needs a privacy review first'],
  ]),
  ...sys('WMS inventory', [
    ['STOCK_ON_HAND', 'Merchandising', WMS], ['STOCK_RECEIPT', 'Merchandising', WMS, undefined, undefined, ['CONFORMED_GOLD.FCT_INVENTORY.UNITS_RECEIVED']],
    ['PLANOGRAM_RANGE', 'Merchandising', WMS, undefined, undefined, ['CONFORMED_GOLD.FCT_INVENTORY.SKUS_RANGED']],
    ['ITEM_MASTER', 'Merchandising', WMS, undefined, 'Brand is modelled in DIM_PRODUCT but not in a semantic view', ['CONFORMED_GOLD.DIM_PRODUCT.BRAND']],
    ['CYCLE_COUNT', 'Merchandising', 1], ['TRANSFER_ORDER', 'Supply chain', 1], ['DC_LOCATION', 'Supply chain', 0], ['SHRINK_ADJUSTMENT', 'Store operations', 0],
  ]),
  ...sys('Supplier EDI', [
    ['EDI_850_PO', 'Supply chain', EDI], ['EDI_856_ASN', 'Supply chain', EDI, undefined, undefined, ['CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY.ASN_ACCURATE']],
    ['DC_RECEIPT', 'Supply chain', EDI, undefined, undefined, ['CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY.RECEIVED_DATE']],
    ['VENDOR_MASTER', 'Supply chain', EDI, undefined, undefined, ['CONFORMED_GOLD.DIM_SUPPLIER.SUPPLIER_NAME']],
    ['EDI_810_INVOICE', 'Finance', 1], ['VENDOR_CHARGEBACK', 'Supply chain', 0], ['EDI_997_ACK', 'Supply chain', 0],
  ]),
  ...sys('Store systems', [
    ['STORE_MASTER', 'Store operations', POS, undefined, undefined, ['CONFORMED_GOLD.DIM_STORE.OPEN_DATE']],
    ['STORE_REMODEL', 'Store operations', POS, undefined, 'Remodel dates modelled; not mapped to a glossary term', ['CONFORMED_GOLD.DIM_STORE.REMODEL_START']],
    ['LABOR_SCHEDULE', 'Store operations', 0], ['STORE_BUDGET', 'Finance', 0],
  ]),
  ...sys('Promotions planning', [
    ['PROMO_EVENT', 'Merchandising', 1, undefined, 'Calendar extract lands in staging; DIM_PROMOTION is loaded from POS codes today'], ['PROMO_OFFER', 'Merchandising', 0], ['VENDOR_FUNDING_AGREEMENT', 'Merchandising', 0],
  ]),
  ...sys('Finance ERP', [['GL_SALES_JOURNAL', 'Finance', 0], ['MARKDOWN_LEDGER', 'Finance', 1], ['GIFT_CARD_LIABILITY', 'Finance', 0]]),
  ...sys('Loss prevention', [['LP_CASE', 'Store operations', 0, undefined, 'Case notes hold sensitive data: needs a privacy review first'], ['EXCEPTION_REPORT', 'Store operations', 0]]),
];

type Rep = [name: string, kpis: string[], missing?: string[]];
const REPORTS: Rep[] = [
  ['Weekly comp sales flash', ['K-06']], ['Comp sales by region and format', ['K-06'], ['Store format hierarchy']], ['Daily sales by store', ['K-07']],
  ['Net sales YTD vs plan', ['K-07'], ['Sales plan']], ['Basket and UPT dashboard', ['K-08', 'K-09']], ['E-commerce share of sales', ['K-10']],
  ['Discount and markdown rate', ['K-11']], ['Trading review pack', ['K-06', 'K-07', 'K-08', 'K-10']], ['Store ranking league table', ['K-07', 'K-08']],
  ['Harbor Club active member count', ['K-01']], ['Loyalty share of sales by region', ['K-02']], ['Member spend and frequency', ['K-03', 'K-04']],
  ['Omnichannel member tracker', ['K-05']], ['CRM campaign audience sizes', ['K-01'], ['Campaign membership']], ['Member CLV segments', ['K-25']],
  ['Customer insights monthly pack', ['K-01', 'K-02', 'K-04', 'K-05']], ['Sell-through by category', ['K-12']], ['Inventory turns and weeks of supply', ['K-13', 'K-15']],
  ['Out-of-stock exceptions', ['K-14']], ['Inventory at cost by region', ['K-16']], ['Markdown candidates', ['K-12'], ['Markdown price ladder']],
  ['Supplier OTIF scorecard', ['K-17']], ['Fill rate by supplier', ['K-18']], ['Lead time trend', ['K-19']], ['ASN compliance chargebacks', ['K-20'], ['Chargeback amounts']],
  ['PO spend by category', ['K-21']], ['Vendor business review pack', ['K-17', 'K-18', 'K-20', 'K-21']],
  ['Promotion ROI by event', ['K-22']], ['Promotional lift by category', ['K-23']], ['Offer redemption rates', ['K-24']], ['Promotion post-event review', ['K-22', 'K-23', 'K-24'], ['Halo and cannibalisation']],
  ['Promotion and comp sales review', ['K-06', 'K-22']], ['Return rate by store', ['K-26']], ['Suspicious returns watchlist', ['K-27']], ['Loss prevention monthly', ['K-26', 'K-27'], ['Shrink by store']],
  ['Returns vs sales by region', ['K-26', 'K-07']], ['Store labour productivity', [], ['Labour hours', 'Sales per labour hour']], ['Store traffic conversion', ['K-07'], ['Store traffic counts']],
  ['Gift card liability', [], ['Gift card balances']], ['Web funnel conversion', ['K-10'], ['Web sessions', 'Cart events']],
];
const OWNERS = ['Finance – FP&A', 'Customer Insights', 'Merchandise Planning', 'Supply Chain', 'Marketing & Promotions', 'Loss Prevention'];
export const legacyReports: LegacyReport[] = REPORTS.map(([name, kpiIds, missing], i) => ({
  id: `RPT-${String(i + 1).padStart(3, '0')}`, name, tool: 'MicroStrategy', owner: OWNERS[i % OWNERS.length], kpiIds, missing: missing ?? [],
}));

export const incidents: IncidentScript[] = [
  {
    id: 'INC-1', title: 'Late CDC feed', fault: 'ECOM_ORDER_CDC stops receiving rows for 5 h (commerce platform CDC connector stalled).',
    objectFqn: ECOM, dmf: { metric: 'FRESHNESS', value: 300, threshold: 60, unit: ' min' },
    affects: [{ productId: 'DP-02', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'warn', message: 'Data as of 5 h ago: web and app orders have not arrived since 01:10, so e-commerce sales and comp sales for today are understated.' }],
    resolution: 'CDC connector restarted; 5 h of web orders replayed and ECOM_ORDER and FCT_SALES refreshed.', ttdMin: 18, ttrMin: 52,
  },
  {
    id: 'INC-2', title: 'Null spike in a CDE', fault: '14% nulls in FCT_SALES.LOYALTY_SALES_USD after a POS member-scan mapping change.',
    objectFqn: 'CONFORMED_GOLD.FCT_SALES', column: 'LOYALTY_SALES_USD', dmf: { metric: 'NULL_COUNT', value: 14, threshold: 0.5, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }, { productId: 'DP-02', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'block', scenarioIds: ['S-01', 'S-05'], message: 'I can’t give loyalty sales figures right now: 14% of loyalty sales amounts (LOYALTY_SALES_USD, a critical data element) arrived empty in the last load, so loyalty share would be understated. The customer data steward has been alerted; ask again once the incident is resolved.' }],
    resolution: 'POS member-scan mapping reverted; affected store-days reloaded and DMFs re-checked.', ttdMin: 11, ttrMin: 85,
  },
  {
    id: 'INC-3', title: 'Duplicate load', fault: 'A replayed store batch doubles 61,840 POS transaction headers.',
    objectFqn: POS, dmf: { metric: 'DUPLICATE_COUNT', value: 61840, threshold: 0, unit: ' rows' },
    affects: [{ productId: 'DP-02', status: 'Down' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'block', scenarioIds: ['S-06', 'S-07', 'S-09'], message: 'Store sales answers are paused: a replayed POS batch doubled 61,840 transactions, so sales, comp sales and baskets would be overstated. The last good snapshot is 2026-09-29 23:59; I can answer as of then once Sales Performance is restored.' }],
    resolution: 'Duplicate batch removed with a MERGE on TXN_ID; downstream dynamic tables refreshed.', ttdMin: 7, ttrMin: 58,
  },
  {
    id: 'INC-4', title: 'Schema drift', fault: 'EDI 856 v5 adds SHIP_UOM and starts sending SHIP_QTY in cases instead of units.',
    objectFqn: EDI, column: 'SHIP_QTY', dmf: { metric: 'CONTRACT_CHECK (SHIP_QTY unit mismatch %)', value: 37, threshold: 1, unit: '%' },
    affects: [{ productId: 'DP-04', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-03', mode: 'warn', scenarioIds: ['S-11'], message: 'Supplier figures are incomplete: 37% of new ASNs report shipped quantity in cases, so ASN accuracy and fill rate for the last day may be wrong.' }],
    resolution: 'Data contract updated to convert SHIP_QTY by SHIP_UOM pack size; Silver SUPPLIER_PO_LINE rebuilt.', ttdMin: 40, ttrMin: 210,
  },
  {
    id: 'INC-5', title: 'Volume anomaly', fault: 'WMS inventory snapshot rows drop 64% day over day.',
    objectFqn: WMS, dmf: { metric: 'ROW_COUNT change', value: -64, threshold: -30, unit: '%' },
    affects: [{ productId: 'DP-03', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-03', mode: 'warn', scenarioIds: ['S-10', 'S-12'], message: 'Volume caveat: inventory snapshot rows dropped 64% day over day, so stock-outs and sell-through for the latest week are likely misstated.' }],
    resolution: 'WMS extract filter on location type corrected; missing store snapshots backfilled.', ttdMin: 16, ttrMin: 110,
  },
];
