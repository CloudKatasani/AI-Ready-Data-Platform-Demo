// Retail pack: Harbor & Pine (spec sections 5–9).
import type { IndustryPack, Persona, ScenarioContext } from '../../types';
import { buildSharedObjects } from '../../mock-snowflake/shared-schemas';
import { buildAccessHistory, buildDmf, GATE4_CHECK } from '../shared/catalog-kit';
import { fmtNum, fmtUsd } from '../../lib/format';
import { generateRetail } from './data';
import { buildCatalog, GATE6_CHECK } from './catalog';
import { buildSemanticViews } from './semantic';
import { GLOSSARY } from './glossary';
import { CONTEXT } from './context';
import { KPIS } from './kpis';
import { INITIAL_ACCESS, PERSONAS } from './personas';
import { AGENTS } from './agents';
import { buildProducts, ROW_POLICY } from './products';
import { buildScenarios } from './scenarios';
import { KPI_RANGES } from './generators.config';
import { PROFILE } from './pack';
import * as Q from './queries';

const DB = `${PROFILE.dbPrefix}_AI_PLATFORM`;
const allow = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);

export function buildPack(): IndustryPack {
  const data = generateRetail(PROFILE.seed);
  const physical = buildCatalog(data, PROFILE.seed);
  const semanticViews = buildSemanticViews(data, (sv) => CONTEXT.verifiedQueries.filter((v) => v.semanticView === sv).map((v) => v.id));
  const products = buildProducts(DB, physical, semanticViews, CONTEXT, AGENTS);

  let packRef: IndustryPack | undefined;
  const scenarios = buildScenarios(data, () => packRef!);

  const dmf = buildDmf(physical, PROFILE.seed, { warn: ['FCT_PROMO_SALES', 'DP_PROMOTION_EFFECTIVENESS'], fail: ['DP_RETURNS_FRAUD', 'RETURN_TXN'] });
  const accessHistory = buildAccessHistory(physical, PERSONAS.map((p) => p.roleId));

  const worksheet: IndustryPack['worksheet'] = [
    { id: 'W-01', label: 'Comp sales by promotion, Q3 2026', sql: `SELECT ty.promo_name,\n       SUM(ty.net_sales_usd) / SUM(ly.net_sales_usd) * 100 - 100 AS comp_sales_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE ty\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE dt ON dt.calendar_date = ty.sales_date\n  JOIN ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE ly\n    ON ly.store_id = ty.store_id AND ly.channel = ty.channel AND ly.sales_date = dt.same_day_last_year\n WHERE ty.sales_date BETWEEN '2026-07-01' AND '2026-09-30' AND ty.is_comp_store AND ty.promo_id IS NOT NULL\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }: ScenarioContext) => ({ columns: ['PROMO_NAME', 'WINDOW', 'COMP_SALES_PCT', 'LIFTED_ABOVE_5_PCT'], rows: Q.compByPromotion(data, allow(persona)).sort((a, b) => b.pct - a.pct).map((x) => [x.name, `${x.from} – ${x.to}`, fmtNum(x.pct, 1), x.pct > 5 ? 'YES' : 'NO']) }) },
    { id: 'W-02', label: 'Comparable store sales by region, YTD', sql: `SELECT region, SUM(ty.net_sales_usd) / SUM(ly.net_sales_usd) * 100 - 100 AS comp_sales_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE ty\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE dt ON dt.calendar_date = ty.sales_date\n  JOIN ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE ly\n    ON ly.store_id = ty.store_id AND ly.channel = ty.channel AND ly.sales_date = dt.same_day_last_year\n WHERE ty.sales_date BETWEEN '2026-01-01' AND '2026-09-30' AND ty.is_comp_store\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['REGION', 'COMP_SALES_PCT', 'TY_COMP_SALES', 'LY_COMP_SALES'], rows: Q.compByRegion(data, Q.PERIODS.ytd, allow(persona)).sort((a, b) => b.pct - a.pct).map((x) => [x.region, fmtNum(x.pct, 1), fmtUsd(x.ty, 0), fmtUsd(x.ly, 0)]) }) },
    { id: 'W-03', label: 'Top 10 stores by net sales, last week', sql: `SELECT store_id, store_name, region, SUM(net_sales_usd) AS net_sales\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE\n WHERE sales_date BETWEEN '2026-09-21' AND '2026-09-27'\n GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 10;`,
      run: ({ persona }) => ({ columns: ['STORE_ID', 'STORE_NAME', 'REGION', 'NET_SALES', 'BASKET_SIZE'], rows: Q.topStoresByNetSales(data, Q.PERIODS.lastWeek, 10, allow(persona)).map((x) => [x.store.id, x.store.name, x.store.region, fmtUsd(x.net, 0), fmtUsd(x.basket)]) }) },
    { id: 'W-04', label: 'Loyalty share of sales by region, Q3 2026', sql: `SELECT region, SUM(loyalty_sales_usd) / SUM(net_sales_usd) * 100 AS loyalty_share_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE\n WHERE sales_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['REGION', 'LOYALTY_SHARE_PCT', 'NET_SALES'], rows: Q.loyaltyShareByRegion(data, Q.PERIODS.quarter, allow(persona)).rows.sort((a, b) => b.pct - a.pct).map((x) => [x.region, fmtNum(x.pct, 1), fmtUsd(x.net, 0)]) }) },
    { id: 'W-05', label: 'Promotion ROI by promotion, Q3 2026', sql: `SELECT promo_name, SUM(incremental_margin_usd) / SUM(promo_cost_usd) AS promo_roi,\n       (SUM(net_sales_usd) - SUM(baseline_sales_usd)) / SUM(baseline_sales_usd) * 100 AS lift_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_PROMOTION_EFFECTIVENESS\n WHERE sale_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['PROMO_NAME', 'PROMO_ROI', 'LIFT_PCT', 'REDEMPTION_RATE_PCT'], rows: Q.promoEffectiveness(data, Q.PERIODS.quarter.months, allow(persona)).rows.sort((a, b) => b.roi - a.roi).map((x) => [x.name, fmtNum(x.roi, 2), fmtNum(x.liftPct, 1), fmtNum(x.redemptionPct, 1)]) }) },
    { id: 'W-06', label: 'Supplier OTIF and fill rate', sql: `SELECT supplier_name, AVG(IFF(otif_flag, 1, 0)) * 100 AS otif_pct,\n       SUM(received_units) / SUM(ordered_units) * 100 AS fill_rate_pct, COUNT(*) AS lines\n  FROM ${DB}.DATA_PRODUCTS.DP_SUPPLIER_PERFORMANCE\n GROUP BY 1 ORDER BY 2;`,
      run: () => ({ columns: ['SUPPLIER_NAME', 'OTIF_PCT', 'FILL_RATE_PCT', 'LINES'], rows: Q.supplierPerformance(data).map((s) => [s.supplier, fmtNum(s.otifPct, 1), fmtNum(s.fillPct, 1), s.lines]) }) },
    { id: 'W-07', label: 'Out-of-stock rate by category, last week', sql: `SELECT category, SUM(skus_out_of_stock) / SUM(skus_ranged) * 100 AS oos_rate_pct,\n       SUM(on_hand_units) AS on_hand_units\n  FROM ${DB}.DATA_PRODUCTS.DP_INVENTORY_HEALTH\n WHERE week_ending = '2026-09-27'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => { const a = allow(persona); const rows = a ? Q.oosByRegion(data, a).map((x) => [x.region, fmtNum(x.oosPct, 1), '—']) : Q.inventoryHealth(data).rows.sort((x, y) => y.oosPct - x.oosPct).map((x) => [x.category, fmtNum(x.oosPct, 1), fmtNum(x.wos, 1)]); return { columns: [a ? 'REGION' : 'CATEGORY', 'OOS_RATE_PCT', 'WEEKS_OF_SUPPLY'], rows }; } },
    { id: 'W-08', label: 'Return rate and suspicious returns by region, Q3 2026', sql: `SELECT s.region, SUM(s.returns_usd) / SUM(s.gross_sales_usd) * 100 AS return_rate_pct,\n       (SELECT COUNT_IF(is_suspicious) FROM ${DB}.DATA_PRODUCTS.DP_RETURNS_FRAUD r WHERE r.region = s.region) AS suspicious\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE s\n WHERE s.sales_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['REGION', 'RETURN_RATE_PCT', 'RETURNS_SAMPLE', 'SUSPICIOUS', 'SUSPICIOUS_PCT'], rows: Q.returnsByRegion(data, allow(persona)).rows.map((x) => [x.region, fmtNum(x.returnPct, 1), x.returns, x.suspicious, fmtNum(x.suspiciousPct, 1)]) }) },
  ];

  const core = {
    profile: PROFILE, database: DB, semanticViews, glossary: GLOSSARY, context: CONTEXT, products, agents: AGENTS, kpis: KPIS, kpiRanges: KPI_RANGES,
    personas: PERSONAS, initialAccess: INITIAL_ACCESS, initialRequestJustification: 'Need promotion ROI and redemption rates for the Q3 promotion review covering the Northeast and Mid-Atlantic.',
    scenarios,
    certificationScript: {
      productId: 'DP-05' as const,
      failures: [
        { gate: 4, checkId: GATE4_CHECK, status: 'warn' as const, detail: '7 of 10 verified queries on SV_PROMO_EFFECTIVENESS', fixedDetail: '10 of 10 verified queries (3 approved in Certification Studio)',
          fix: { label: 'Add 3 verified queries', kind: 'verified-queries' as const, items: ['Which promotions had the highest redemption rate in the Northeast this quarter?', 'What was the promotion cost of the Labor Day Weekend Sale?', 'Promotional lift for loyalty offers versus events last quarter'] } },
        { gate: 6, checkId: GATE6_CHECK, status: 'fail' as const, detail: 'FCT_PROMO_SALES.CARD_LAST4 is tagged PCI but has no masking policy', fixedDetail: 'MP_MASK_PCI attached to FCT_PROMO_SALES.CARD_LAST4',
          fix: { label: 'Attach MP_MASK_PCI', kind: 'masking' as const, items: [`ALTER TABLE ${DB}.CONFORMED_GOLD.FCT_PROMO_SALES MODIFY COLUMN CARD_LAST4 SET MASKING POLICY ${DB}.GOVERNANCE.MP_MASK_PCI;`] } },
      ],
    },
    worksheet,
    consumers: ['Snowflake Intelligence', 'Tableau via semantic views', 'Internal Marketplace', 'APIs'],
    layerExamples: {
      bronze: 'LOYALTY_MEMBER_CDC keeps every insert, update and delete from the loyalty platform — including duplicates and untrimmed names.',
      silver: 'CURATED_SILVER.LOYALTY_MEMBER keeps one clean SCD2 row per member version, so tier upgrades are tracked over time.',
      gold: 'FCT_SALES and DIM_STORE share STORE_KEY, and DIM_DATE.SAME_DAY_LAST_YEAR lines every day up with its comparable day.',
      semantic: 'SV_STORE_SALES defines comp_sales_pct once — Tableau and the agent use the same comparable-store formula.',
      glossary: 'T-004 Comparable Store Sales is owned by Finance – FP&A, stewarded by M. Haddad and mapped to FCT_SALES.IS_COMP_STORE.',
      context: 'BR-006 tells the agent a comparable store is open 13+ months with remodels excluded, and to cite the comp sales guide.',
      product: 'DP-02 Sales Performance v3.1.0 is certified with an hourly SLA and a YAML contract.',
      agent: 'AGT_STORE_OPS_ANALYST answers with a full trace and a 95% evaluation score.',
      gov: 'MP_MASK_PII, MP_MASK_PCI and RAP_REGION_ACCESS apply to the agent exactly as they apply to the person asking.',
    },
    signature: { question: 'Which promotions lifted comparable sales above 5% last quarter?', agentId: 'AG-02', termId: 'T-004', ruleId: 'BR-006', docQuery: 'comparable store' },
    maskingPolicy: 'MP_MASK_PII', rowAccessPolicy: ROW_POLICY, maskingPolicies: { PII: 'MP_MASK_PII', PCI: 'MP_MASK_PCI' }, warehouse: 'WH_ANALYTICS_XS',
    dmf, accessHistory,
  };
  const shared = buildSharedObjects({ ...core, physical });
  const pack: IndustryPack = { ...core, objects: [...physical, ...shared] };
  packRef = pack;
  return pack;
}

export { Q as queries, generateRetail };
