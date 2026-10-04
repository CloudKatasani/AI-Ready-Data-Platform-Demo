// Semantic views for Harbor & Pine (spec sections 5 and 7.3).
import type { Row, SemanticView } from '../../types';
import { addDays, dateRange, sum } from '../../mock-snowflake/generators';
import { isCompInMonth, type RetailData } from './data';
import { AS_OF, SCALES } from './generators.config';

const n = (r: Row, k: string) => Number(r[k] ?? 0);
const quarterOf = (x: string) => `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`;

export function buildSemanticViews(d: RetailData, vqIds: (sv: string) => string[]): SemanticView[] {
  const storeByKey = new Map(d.stores.map((s) => [s.key, s]));
  const promoByKey = new Map(d.promos.map((p) => [p.key, p]));

  // ---- Customer & loyalty
  const since = addDays(AS_OF, -365);
  const customerLoyalty: SemanticView = {
    name: 'SV_CUSTOMER_LOYALTY',
    description: 'Harbor Club members, tiers, spend, omnichannel behaviour and loyalty share of sales',
    tables: [
      { alias: 'member', fqn: 'CONFORMED_GOLD.DIM_CUSTOMER', pk: 'CUSTOMER_KEY' },
      { alias: 'store', fqn: 'CONFORMED_GOLD.DIM_STORE', pk: 'STORE_KEY' },
      { alias: 'sales', fqn: 'CONFORMED_GOLD.FCT_SALES', pk: 'SALES_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'member', to: 'store', on: 'HOME_STORE_KEY' },
      { from: 'sales', to: 'store', on: 'STORE_KEY' },
      { from: 'sales', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'member.spend_12m', expr: 'member.SPEND_12M_USD', description: 'Net spend in the trailing 12 months' },
      { name: 'member.purchases_12m', expr: 'member.PURCHASES_12M', description: 'Purchase days in the trailing 12 months' },
      { name: 'member.predicted_clv', expr: 'member.PREDICTED_CLV_USD', description: 'Predicted 3-year CLV (draft model)' },
      { name: 'sales.net_sales', expr: 'sales.NET_SALES_USD' },
      { name: 'sales.loyalty_sales', expr: 'sales.LOYALTY_SALES_USD' },
    ],
    dimensions: [
      { name: 'member.home_region', expr: 'member.HOME_REGION', synonyms: ['region', 'store region', 'territory'], description: 'Region of the member’s home store' },
      { name: 'member.tier', expr: 'member.TIER', synonyms: ['loyalty tier', 'status level'], description: 'Member / Plus / Elite' },
      { name: 'member.member_status', expr: 'member.MEMBER_STATUS', synonyms: ['account status'] },
      { name: 'member.is_omnichannel', expr: 'member.IS_OMNICHANNEL', synonyms: ['omnichannel', 'cross-channel'] },
      { name: 'store.format', expr: 'store.FORMAT', synonyms: ['store type'] },
      { name: 'store.region', expr: 'store.REGION', synonyms: ['region'] },
    ],
    timeDimensions: [
      { name: 'member.last_purchase_date', expr: 'member.LAST_PURCHASE_DATE', description: 'Most recent purchase' },
      { name: 'date.sales_date', expr: 'date.CALENDAR_DATE', description: 'Business date' },
    ],
    metrics: [
      { name: 'active_members', expr: "COUNT(DISTINCT IFF(member.member_status = 'Active' AND member.last_purchase_date > CURRENT_DATE - 365, member.customer_key, NULL))", description: 'Members with Active status and a purchase in the last 12 months', synonyms: ['active members', 'active loyalty members', 'member count'], termId: 'T-002', unit: 'members' },
      { name: 'loyalty_share_pct', expr: 'SUM(sales.loyalty_sales) / SUM(sales.net_sales) * 100', description: 'Share of net sales identified to a Harbor Club member', synonyms: ['loyalty share', 'member share of sales', 'loyalty penetration'], termId: 'T-009', unit: '%' },
      { name: 'avg_spend_per_member', expr: 'AVG(member.spend_12m)', description: 'Average 12-month net spend per active member', synonyms: ['spend per member', 'member value'], termId: 'T-030', unit: 'USD' },
      { name: 'repeat_purchase_rate', expr: 'AVG(IFF(member.purchases_12m >= 2, 1, 0)) * 100', description: 'Share of active members with two or more purchase days in 12 months', synonyms: ['repeat rate', 'retention'], termId: 'T-026', unit: '%' },
      { name: 'omnichannel_share_pct', expr: 'AVG(IFF(member.is_omnichannel, 1, 0)) * 100', description: 'Share of active members who bought in store and online', synonyms: ['omnichannel share', 'cross-channel members'], termId: 'T-027', unit: '%' },
      { name: 'avg_predicted_clv', expr: 'AVG(member.predicted_clv)', description: 'Average predicted customer lifetime value (draft model)', synonyms: ['clv', 'lifetime value'], termId: 'T-024', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_CUSTOMER_LOYALTY'),
    productIds: ['DP-01'],
    playground: {
      from: 'SEMANTIC.SV_CUSTOMER_LOYALTY',
      rows: () => d.members.map((m) => ({
        region: m.region, tier: m.tier, format: storeByKey.get(m.homeStoreKey)!.format, active: m.status === 'Active' && m.lastPurchase > since,
        omni: m.storeBuyer && m.onlineBuyer, purchases: m.purchases12m, spend: m.spend12m, clv: m.clv,
      })),
      dimensions: [
        { name: 'member.home_region', column: 'region' },
        { name: 'member.tier', column: 'tier' },
        { name: 'store.format', column: 'format' },
      ],
      filters: [
        { label: 'Active members (BR-001)', sql: "member.member_status = 'Active' AND member.last_purchase_date > '2025-09-30'", test: (r) => Boolean(r.active) },
        { label: 'Active Elite members', sql: "member.tier = 'Elite' AND member.last_purchase_date > '2025-09-30'", test: (r) => Boolean(r.active) && r.tier === 'Elite' },
        { label: 'All members', sql: 'TRUE', test: () => true },
      ],
      metrics: [
        { name: 'active_members', unit: '', decimals: 0, sqlExpr: 'active_members', agg: (rs) => Math.round(rs.filter((r) => r.active).length * d.memberScale) },
        { name: 'avg_spend_per_member', unit: 'USD', decimals: 2, sqlExpr: 'avg_spend_per_member', agg: (rs) => { const a = rs.filter((r) => r.active); return sum(a.map((r) => n(r, 'spend'))) / Math.max(1, a.length); } },
        { name: 'repeat_purchase_rate', unit: '%', decimals: 1, sqlExpr: 'repeat_purchase_rate', agg: (rs) => { const a = rs.filter((r) => r.active); return (a.filter((r) => n(r, 'purchases') >= 2).length / Math.max(1, a.length)) * 100; } },
        { name: 'omnichannel_share_pct', unit: '%', decimals: 1, sqlExpr: 'omnichannel_share_pct', agg: (rs) => { const a = rs.filter((r) => r.active); return (a.filter((r) => r.omni).length / Math.max(1, a.length)) * 100; } },
        { name: 'avg_predicted_clv', unit: 'USD', decimals: 2, sqlExpr: 'avg_predicted_clv', agg: (rs) => { const a = rs.filter((r) => r.active); return sum(a.map((r) => n(r, 'clv'))) / Math.max(1, a.length); } },
      ],
    },
  };

  // ---- Store sales (signature view): TY rows joined to their same-weekday LY rows for comp
  const salesRows = () => {
    const agg = new Map<string, Row>();
    const ty = dateRange('2026-01-01', AS_OF);
    for (const s of d.stores) {
      const cells = d.byStoreDay.cells[s.key - 1];
      for (const day of ty) {
        const di = d.byStoreDay.idx.get(day)!;
        const a = cells[di];
        if (!a) continue;
        const month = day.slice(0, 7);
        const b = cells[di - 364];
        const comp = isCompInMonth(s, month) && Boolean(b);
        for (const x of a) {
          const promo = x.promoKey ? promoByKey.get(x.promoKey)!.name : 'No promotion';
          const k = `${s.region}|${x.channel}|${month}|${promo}|${comp}`;
          let r = agg.get(k);
          if (!r) agg.set(k, (r = { region: s.region, channel: x.channel, month, promo_name: promo, comp, tyNet: 0, lyNet: 0, txns: 0, units: 0 }));
          r.tyNet = n(r, 'tyNet') + x.net;
          r.txns = n(r, 'txns') + x.txns;
          r.units = n(r, 'units') + x.units;
          if (comp) for (const y of b!) if (y.channel === x.channel) r.lyNet = n(r, 'lyNet') + y.net;
        }
      }
    }
    return [...agg.values()];
  };
  const compPct = (rs: Row[]) => {
    const c = rs.filter((r) => r.comp);
    const lyNet = sum(c.map((r) => n(r, 'lyNet')));
    return lyNet ? ((sum(c.map((r) => n(r, 'tyNet'))) - lyNet) / lyNet) * 100 : 0;
  };
  const storeSales: SemanticView = {
    name: 'SV_STORE_SALES',
    description: 'Store and e-commerce sales, comparable store sales, baskets and promotions by store, region and day',
    tables: [
      { alias: 'sales', fqn: 'CONFORMED_GOLD.FCT_SALES', pk: 'SALES_KEY' },
      { alias: 'store', fqn: 'CONFORMED_GOLD.DIM_STORE', pk: 'STORE_KEY' },
      { alias: 'promo', fqn: 'CONFORMED_GOLD.DIM_PROMOTION', pk: 'PROMO_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'sales', to: 'store', on: 'STORE_KEY' },
      { from: 'sales', to: 'promo', on: 'PROMO_KEY' },
      { from: 'sales', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'sales.net_sales', expr: 'sales.NET_SALES_USD', description: 'Net sales (gross − discounts − returns)' },
      { name: 'sales.gross_sales', expr: 'sales.GROSS_SALES_USD' },
      { name: 'sales.discount', expr: 'sales.DISCOUNT_USD' },
      { name: 'sales.transactions', expr: 'sales.TRANSACTIONS' },
      { name: 'sales.units', expr: 'sales.UNITS' },
      { name: 'sales.net_sales_ly', expr: 'sales_ly.NET_SALES_USD', description: 'Net sales on date.same_day_last_year for the same store and channel' },
    ],
    dimensions: [
      { name: 'store.region', expr: 'store.REGION', synonyms: ['region', 'territory', 'market'], description: 'Store region' },
      { name: 'store.store_name', expr: 'store.STORE_NAME', synonyms: ['store', 'location', 'branch'], description: 'Store' },
      { name: 'store.format', expr: 'store.FORMAT', synonyms: ['store format', 'store type'] },
      { name: 'promo.promo_name', expr: 'promo.PROMO_NAME', synonyms: ['promotion', 'promo', 'event', 'campaign'], description: 'Promotion running in the store’s region that day' },
      { name: 'sales.channel', expr: 'sales.CHANNEL', synonyms: ['channel', 'online', 'in store'] },
      { name: 'sales.is_comp_store', expr: 'sales.IS_COMP_STORE', synonyms: ['comp store', 'comparable store', 'like for like'], description: 'Comparable in this month (BR-006)' },
    ],
    timeDimensions: [
      { name: 'date.sales_date', expr: 'date.CALENDAR_DATE', description: 'Business date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter (FY = calendar year)' },
      { name: 'date.same_day_last_year', expr: 'date.SAME_DAY_LAST_YEAR', description: 'Same weekday 364 days earlier' },
    ],
    metrics: [
      { name: 'comp_sales_pct', expr: 'SUM(IFF(sales.is_comp_store, sales.net_sales, 0)) / SUM(IFF(sales.is_comp_store, sales.net_sales_ly, 0)) * 100 - 100', description: 'Comparable store sales growth: comp stores only, vs the same weekday-aligned days last year', synonyms: ['comp sales', 'comparable sales', 'comps', 'like for like sales', 'same store sales'], termId: 'T-004', unit: '%' },
      { name: 'net_sales', expr: 'SUM(sales.net_sales)', description: 'Net sales after discounts and returns, excluding tax', synonyms: ['sales', 'revenue', 'turnover'], termId: 'T-006', unit: 'USD' },
      { name: 'basket_size', expr: 'SUM(sales.net_sales) / SUM(sales.transactions)', description: 'Average net sales per transaction', synonyms: ['average transaction value', 'atv', 'average basket', 'basket size'], termId: 'T-007', unit: 'USD' },
      { name: 'transactions', expr: 'SUM(sales.transactions)', description: 'Sales transactions', synonyms: ['traffic', 'tickets', 'orders'], termId: 'T-007', unit: 'transactions' },
      { name: 'units_per_transaction', expr: 'SUM(sales.units) / SUM(sales.transactions)', description: 'Average units per transaction', synonyms: ['upt', 'items per basket'], termId: 'T-008', unit: 'units' },
      { name: 'ecommerce_share_pct', expr: "SUM(IFF(sales.channel = 'E-commerce', sales.net_sales, 0)) / SUM(sales.net_sales) * 100", description: 'Share of net sales from web and app orders', synonyms: ['online share', 'digital share', 'ecom penetration'], termId: 'T-025', unit: '%' },
      { name: 'discount_rate_pct', expr: 'SUM(sales.discount) / SUM(sales.gross_sales) * 100', description: 'Discounts as a share of gross sales', synonyms: ['discount rate', 'promotional depth', 'markdown rate'], termId: 'T-028', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_STORE_SALES'),
    productIds: ['DP-02'],
    playground: {
      from: 'SEMANTIC.SV_STORE_SALES',
      rows: salesRows,
      dimensions: [
        { name: 'promo.promo_name', column: 'promo_name' },
        { name: 'store.region', column: 'region' },
        { name: 'sales.channel', column: 'channel' },
      ],
      filters: [
        { label: 'Q3 2026 vs same days last year', sql: "date.sales_date BETWEEN '2026-07-01' AND '2026-09-30'", test: (r) => ['2026-07', '2026-08', '2026-09'].includes(String(r.month)) },
        { label: 'Year to date vs prior year', sql: "date.sales_date BETWEEN '2026-01-01' AND '2026-09-30'", test: () => true },
        { label: 'September 2026', sql: "date.sales_date BETWEEN '2026-09-01' AND '2026-09-30'", test: (r) => r.month === '2026-09' },
      ],
      metrics: [
        { name: 'comp_sales_pct', unit: '%', decimals: 1, sqlExpr: 'comp_sales_pct', agg: (rs) => compPct(rs) },
        { name: 'net_sales', unit: 'USD', decimals: 0, sqlExpr: 'net_sales', agg: (rs) => sum(rs.map((r) => n(r, 'tyNet'))) * d.storeScale },
        { name: 'basket_size', unit: 'USD', decimals: 2, sqlExpr: 'basket_size', agg: (rs) => sum(rs.map((r) => n(r, 'tyNet'))) / Math.max(1, sum(rs.map((r) => n(r, 'txns')))) },
        { name: 'transactions', unit: '', decimals: 0, sqlExpr: 'transactions', agg: (rs) => sum(rs.map((r) => n(r, 'txns'))) * d.storeScale },
        { name: 'units_per_transaction', unit: '', decimals: 2, sqlExpr: 'units_per_transaction', agg: (rs) => sum(rs.map((r) => n(r, 'units'))) / Math.max(1, sum(rs.map((r) => n(r, 'txns')))) },
      ],
    },
  };

  // ---- Supply chain: inventory health and supplier performance
  const invRows = () => d.inventory.map((x) => ({ region: x.region, category: x.category, week: x.week, fiscal_quarter: quarterOf(x.week), begin: x.begin, received: x.received, sold: x.sold, end: x.end, cost: x.unitCost, skus: x.skus, oos: x.oos }));
  const weeksOf = (rs: Row[]) => [...new Set(rs.map((r) => String(r.week)))].sort();
  const supplyChain: SemanticView = {
    name: 'SV_SUPPLY_CHAIN',
    description: 'Inventory health (sell-through, stock-outs, weeks of supply, turns) and supplier delivery performance',
    tables: [
      { alias: 'inv', fqn: 'CONFORMED_GOLD.FCT_INVENTORY', pk: 'INVENTORY_KEY' },
      { alias: 'po', fqn: 'CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY', pk: 'PO_LINE_KEY' },
      { alias: 'store', fqn: 'CONFORMED_GOLD.DIM_STORE', pk: 'STORE_KEY' },
      { alias: 'supplier', fqn: 'CONFORMED_GOLD.DIM_SUPPLIER', pk: 'SUPPLIER_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'inv', to: 'store', on: 'STORE_KEY' },
      { from: 'inv', to: 'date', on: 'DATE_KEY' },
      { from: 'po', to: 'supplier', on: 'SUPPLIER_KEY' },
      { from: 'po', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'inv.units_sold', expr: 'inv.UNITS_SOLD' },
      { name: 'inv.units_received', expr: 'inv.UNITS_RECEIVED' },
      { name: 'inv.begin_on_hand', expr: 'inv.BEGIN_ON_HAND_UNITS' },
      { name: 'inv.on_hand_units', expr: 'inv.ON_HAND_UNITS' },
      { name: 'inv.on_hand_cost', expr: 'inv.ON_HAND_COST_USD' },
      { name: 'inv.cogs', expr: 'inv.COGS_USD' },
      { name: 'inv.skus_ranged', expr: 'inv.SKUS_RANGED' },
      { name: 'inv.skus_oos', expr: 'inv.SKUS_OUT_OF_STOCK' },
      { name: 'po.ordered_units', expr: 'po.ORDERED_UNITS' },
      { name: 'po.received_units', expr: 'po.RECEIVED_UNITS' },
      { name: 'po.cost', expr: 'po.COST_USD' },
      { name: 'po.lead_time_days', expr: 'po.LEAD_TIME_DAYS' },
    ],
    dimensions: [
      { name: 'inv.category', expr: 'inv.CATEGORY', synonyms: ['category', 'department', 'merchandise category'] },
      { name: 'store.region', expr: 'store.REGION', synonyms: ['region'] },
      { name: 'supplier.supplier_name', expr: 'supplier.SUPPLIER_NAME', synonyms: ['vendor', 'supplier'] },
      { name: 'po.dc_name', expr: 'po.DC_NAME', synonyms: ['distribution center', 'dc', 'warehouse'] },
      { name: 'supplier.preferred', expr: 'supplier.PREFERRED', synonyms: ['preferred vendor'] },
    ],
    timeDimensions: [
      { name: 'date.week_ending', expr: 'date.CALENDAR_DATE', description: 'Inventory week ending (Sunday) or PO date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER' },
    ],
    metrics: [
      { name: 'sell_through_pct', expr: 'SUM(inv.units_sold) / (SUM(IFF(date.week_ending = MIN(date.week_ending), inv.begin_on_hand, 0)) + SUM(inv.units_received)) * 100', description: 'Units sold ÷ (opening on hand + receipts) for the period', synonyms: ['sell through', 'sell-thru', 'sell through rate'], termId: 'T-010', unit: '%' },
      { name: 'inventory_turns', expr: 'SUM(inv.cogs) * 52 / COUNT(DISTINCT date.week_ending) / AVG(inv.on_hand_cost_week)', description: 'Annualised cost of goods sold ÷ average inventory at cost', synonyms: ['turns', 'stock turn', 'inventory turnover'], termId: 'T-011', unit: 'turns' },
      { name: 'oos_rate_pct', expr: 'SUM(inv.skus_oos) / SUM(inv.skus_ranged) * 100', description: 'Share of ranged store-SKUs with zero on hand at the weekly snapshot', synonyms: ['out of stock rate', 'stockout rate', 'oos'], termId: 'T-012', unit: '%' },
      { name: 'weeks_of_supply', expr: 'SUM(inv.on_hand_units) / AVG(weekly units sold, last 4 weeks)', description: 'Weeks of stock at the recent rate of sale', synonyms: ['wos', 'weeks of cover', 'cover'], termId: 'T-013', unit: 'weeks' },
      { name: 'inventory_cost', expr: 'SUM(inv.on_hand_cost)', description: 'Inventory at cost at the latest week end', synonyms: ['inventory value', 'stock value'], termId: 'T-029', unit: 'USD' },
      { name: 'otif_pct', expr: 'AVG(IFF(po.otif_flag, 1, 0)) * 100', description: 'Share of PO lines received on time and in full', synonyms: ['otif', 'on time in full', 'vendor delivery'], termId: 'T-014', unit: '%' },
      { name: 'fill_rate_pct', expr: 'SUM(po.received_units) / SUM(po.ordered_units) * 100', description: 'Units received ÷ units ordered', synonyms: ['fill rate', 'unit fill'], termId: 'T-015', unit: '%' },
      { name: 'avg_lead_time_days', expr: 'AVG(po.lead_time_days)', description: 'Average days from PO to DC receipt', synonyms: ['lead time', 'supplier lead time'], termId: 'T-016', unit: 'days' },
      { name: 'asn_accuracy_pct', expr: 'AVG(IFF(po.asn_accurate, 1, 0)) * 100', description: 'Share of PO lines whose ASN matched the receipt', synonyms: ['asn accuracy', 'ship notice accuracy'], termId: 'T-017', unit: '%' },
      { name: 'po_spend', expr: 'SUM(po.cost)', description: 'Purchase order cost received', synonyms: ['purchases', 'buy', 'po spend'], termId: 'T-031', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_SUPPLY_CHAIN'),
    productIds: ['DP-03', 'DP-04'],
    playground: {
      from: 'SEMANTIC.SV_SUPPLY_CHAIN',
      rows: invRows,
      dimensions: [
        { name: 'inv.category', column: 'category' },
        { name: 'store.region', column: 'region' },
        { name: 'date.fiscal_quarter', column: 'fiscal_quarter' },
      ],
      filters: [
        { label: 'Q3 2026 (13 weeks)', sql: "date.week_ending BETWEEN '2026-07-01' AND '2026-09-30'", test: (r) => String(r.week) >= '2026-07-01' },
        { label: 'Last week (w/e 2026-09-27)', sql: "date.week_ending = '2026-09-27'", test: (r) => r.week === '2026-09-27' },
        { label: 'Last 52 weeks', sql: "date.week_ending >= '2025-10-05'", test: () => true },
      ],
      metrics: [
        { name: 'sell_through_pct', unit: '%', decimals: 1, sqlExpr: 'sell_through_pct', agg: (rs) => { const w = weeksOf(rs)[0]; return (sum(rs.map((r) => n(r, 'sold'))) / Math.max(1, sum(rs.filter((r) => r.week === w).map((r) => n(r, 'begin'))) + sum(rs.map((r) => n(r, 'received'))))) * 100; } },
        { name: 'oos_rate_pct', unit: '%', decimals: 1, sqlExpr: 'oos_rate_pct', agg: (rs) => (sum(rs.map((r) => n(r, 'oos'))) / Math.max(1, sum(rs.map((r) => n(r, 'skus'))))) * 100 },
        { name: 'weeks_of_supply', unit: 'weeks', decimals: 1, sqlExpr: 'weeks_of_supply', agg: (rs) => { const ws = weeksOf(rs); const last = ws[ws.length - 1]; return sum(rs.filter((r) => r.week === last).map((r) => n(r, 'end'))) / Math.max(1, sum(rs.map((r) => n(r, 'sold'))) / ws.length); } },
        { name: 'inventory_turns', unit: 'turns', decimals: 2, sqlExpr: 'inventory_turns', agg: (rs) => { const ws = weeksOf(rs); return (sum(rs.map((r) => n(r, 'sold') * n(r, 'cost'))) * (52 / ws.length)) / Math.max(1, sum(rs.map((r) => n(r, 'end') * n(r, 'cost'))) / ws.length); } },
        { name: 'inventory_cost', unit: 'USD', decimals: 0, sqlExpr: 'inventory_cost', agg: (rs) => { const ws = weeksOf(rs); const last = ws[ws.length - 1]; return sum(rs.filter((r) => r.week === last).map((r) => n(r, 'end') * n(r, 'cost'))) * d.storeScale; } },
      ],
    },
  };

  // ---- Promotion effectiveness (DP-05)
  const promoRows = () => d.promoSales.map((x) => {
    const p = promoByKey.get(x.promoKey)!;
    return { promo_name: p.name, promo_key: p.key, offers: p.offersIssued, region: x.region, category: x.category, fiscal_quarter: quarterOf(x.date), net: x.net, base: x.baseline, incr: x.incrementalMargin, cost: x.promoCost };
  });
  const promo: SemanticView = {
    name: 'SV_PROMO_EFFECTIVENESS',
    description: 'Promotion redemptions, lift over baseline, ROI and redemption rate by promotion, region and category',
    tables: [
      { alias: 'promo_sales', fqn: 'CONFORMED_GOLD.FCT_PROMO_SALES', pk: 'PROMO_SALE_KEY' },
      { alias: 'promo', fqn: 'CONFORMED_GOLD.DIM_PROMOTION', pk: 'PROMO_KEY' },
      { alias: 'store', fqn: 'CONFORMED_GOLD.DIM_STORE', pk: 'STORE_KEY' },
      { alias: 'member', fqn: 'CONFORMED_GOLD.DIM_CUSTOMER', pk: 'CUSTOMER_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'promo_sales', to: 'promo', on: 'PROMO_KEY' },
      { from: 'promo_sales', to: 'store', on: 'STORE_KEY' },
      { from: 'promo_sales', to: 'member', on: 'CUSTOMER_KEY' },
      { from: 'promo_sales', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'promo_sales.net_sales', expr: 'promo_sales.NET_SALES_USD' },
      { name: 'promo_sales.baseline_sales', expr: 'promo_sales.BASELINE_SALES_USD' },
      { name: 'promo_sales.incremental_margin', expr: 'promo_sales.INCREMENTAL_MARGIN_USD' },
      { name: 'promo_sales.promo_cost', expr: 'promo_sales.PROMO_COST_USD' },
      { name: 'promo.offers_issued', expr: 'promo.OFFERS_ISSUED' },
    ],
    dimensions: [
      { name: 'promo.promo_name', expr: 'promo.PROMO_NAME', synonyms: ['promotion', 'promo', 'event', 'campaign'] },
      { name: 'promo.promo_type', expr: 'promo.PROMO_TYPE', synonyms: ['promotion type', 'mechanic'] },
      { name: 'store.region', expr: 'store.REGION', synonyms: ['region'] },
      { name: 'promo_sales.category', expr: 'promo_sales.CATEGORY', synonyms: ['category', 'department'] },
      { name: 'promo_sales.channel', expr: 'promo_sales.CHANNEL', synonyms: ['channel'] },
    ],
    timeDimensions: [
      { name: 'date.sale_date', expr: 'date.CALENDAR_DATE' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER' },
    ],
    metrics: [
      { name: 'promo_roi', expr: 'SUM(promo_sales.incremental_margin) / SUM(promo_sales.promo_cost)', description: 'Incremental gross margin per dollar of Harbor & Pine-funded discount', synonyms: ['promotion roi', 'return on promotion', 'promo return'], termId: 'T-020', unit: 'ratio' },
      { name: 'promo_lift_pct', expr: '(SUM(promo_sales.net_sales) - SUM(promo_sales.baseline_sales)) / SUM(promo_sales.baseline_sales) * 100', description: 'Promoted-item sales above the modelled baseline', synonyms: ['promotional lift', 'uplift', 'incremental sales %'], termId: 'T-019', unit: '%' },
      { name: 'redemption_rate_pct', expr: 'COUNT(promo_sales.promo_sale_key) / SUM(DISTINCT promo.offers_issued) * 100', description: 'Redemptions ÷ offers issued', synonyms: ['redemption rate', 'take rate', 'coupon redemption'], termId: 'T-021', unit: '%' },
      { name: 'promo_cost', expr: 'SUM(promo_sales.promo_cost)', description: 'Discount funded by Harbor & Pine', synonyms: ['promotion cost', 'discount cost', 'promo spend'], termId: 'T-020', unit: 'USD' },
      { name: 'incremental_margin', expr: 'SUM(promo_sales.incremental_margin)', description: 'Gross margin on sales above baseline', synonyms: ['incremental margin', 'incremental profit'], termId: 'T-020', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_PROMO_EFFECTIVENESS'),
    productIds: ['DP-05'],
    playground: {
      from: 'SEMANTIC.SV_PROMO_EFFECTIVENESS',
      rows: promoRows,
      dimensions: [
        { name: 'promo.promo_name', column: 'promo_name' },
        { name: 'store.region', column: 'region' },
        { name: 'promo_sales.category', column: 'category' },
      ],
      filters: [
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.fiscal_quarter === '2026-Q3' },
        { label: 'Q2 2026', sql: "date.fiscal_quarter = '2026-Q2'", test: (r) => r.fiscal_quarter === '2026-Q2' },
        { label: 'Year to date', sql: "date.sale_date BETWEEN '2026-01-01' AND '2026-09-30'", test: () => true },
      ],
      metrics: [
        { name: 'promo_roi', unit: '', decimals: 2, sqlExpr: 'promo_roi', agg: (rs) => sum(rs.map((r) => n(r, 'incr'))) / Math.max(1, sum(rs.map((r) => n(r, 'cost')))) },
        { name: 'promo_lift_pct', unit: '%', decimals: 1, sqlExpr: 'promo_lift_pct', agg: (rs) => { const b = sum(rs.map((r) => n(r, 'base'))); return ((sum(rs.map((r) => n(r, 'net'))) - b) / Math.max(1, b)) * 100; } },
        { name: 'redemption_rate_pct', unit: '%', decimals: 1, sqlExpr: 'redemption_rate_pct', agg: (rs) => { const offers = sum([...new Map(rs.map((r) => [r.promo_key, n(r, 'offers')])).values()]); return ((rs.length * SCALES.promoSales) / Math.max(1, offers)) * 100; } },
        { name: 'promo_cost', unit: 'USD', decimals: 0, sqlExpr: 'promo_cost', agg: (rs) => sum(rs.map((r) => n(r, 'cost'))) * SCALES.promoSales },
      ],
    },
  };

  return [customerLoyalty, storeSales, supplyChain, promo];
}
