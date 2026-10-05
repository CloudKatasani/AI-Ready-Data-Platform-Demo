// Telecom pack: Altair Communications (spec sections 5–9).
import type { IndustryPack, Persona } from '../../types';
import { buildSharedObjects } from '../../mock-snowflake/shared-schemas';
import { buildAccessHistory, buildDmf } from '../shared/catalog-kit';
import { fmtInt, fmtNum, fmtUsd } from '../../lib/format';
import { generateTelecom } from './data';
import { buildCatalog, GATE6_CHECK } from './catalog';
import { buildSemanticViews } from './semantic';
import { GLOSSARY } from './glossary';
import { CONTEXT } from './context';
import { KPIS } from './kpis';
import { INITIAL_ACCESS, PERSONAS } from './personas';
import { AGENTS } from './agents';
import { buildProducts, ROW_POLICY } from './products';
import { buildScenarios } from './scenarios';
import { KPI_RANGES, PLANS, REGIONS } from './generators.config';
import { PROFILE } from './pack';
import { buildExt } from './ext';
import * as Q from './queries';

const DB = `${PROFILE.dbPrefix}_AI_PLATFORM`;
const allow = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const regionsFor = (p: Persona) => REGIONS.filter((r) => !allow(p) || allow(p)!.includes(r));

export function buildPack(): IndustryPack {
  const data = generateTelecom(PROFILE.seed);
  const physical = buildCatalog(data, PROFILE.seed);
  const semanticViews = buildSemanticViews(data, (sv) => CONTEXT.verifiedQueries.filter((v) => v.semanticView === sv).map((v) => v.id));
  const products = buildProducts(DB, physical, semanticViews, CONTEXT, AGENTS);

  let packRef: IndustryPack | undefined;
  const scenarios = buildScenarios(data, () => packRef!);

  const dmf = buildDmf(physical, PROFILE.seed, { warn: ['FCT_BILLING', 'DP_DEVICE_PLAN_PROFITABILITY'], fail: ['DP_FIELD_SERVICE_EFFICIENCY', 'WORK_ORDER'] });
  const accessHistory = buildAccessHistory(physical, ['ANALYST_SUBSCRIBER', 'NETOPS_MANAGER', 'REVENUE_ASSURANCE', 'DATA_STEWARD']);

  const worksheet: IndustryPack['worksheet'] = [
    { id: 'W-01', label: 'Postpaid churn by plan and region, Sep 2026', sql: `SELECT plan_name, region,\n       SUM(voluntary_disconnects + port_outs) / SUM(opening_base) * 100 AS postpaid_churn_rate,\n       SUM(migrations_out) AS migrations_excluded\n  FROM ${DB}.DATA_PRODUCTS.DP_CHURN_RETENTION\n WHERE month = '2026-09' AND segment = 'Postpaid'\n GROUP BY 1, 2 ORDER BY 1, 2;`,
      run: ({ persona }) => { const r = Q.churnByPlanRegion(data, Q.PERIODS.month, 'Postpaid', allow(persona)); return { columns: ['PLAN_NAME', 'REGION', 'OPENING_BASE', 'CHURNED', 'POSTPAID_CHURN_RATE', 'MIGRATIONS_EXCLUDED'], rows: r.cells.map((c) => [c.plan, c.region, c.opening, c.churned, fmtNum(c.rate, 2), c.migOut]) }; } },
    { id: 'W-02', label: 'Top 10 cell sites by dropped call rate (30 days)', sql: `SELECT site_id, market, technology, SUM(dropped_calls) / SUM(call_attempts) * 100 AS dropped_call_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_NETWORK_PERFORMANCE\n WHERE kpi_date >= '2026-09-01'\n GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 10;`,
      run: ({ persona }) => ({ columns: ['SITE_ID', 'MARKET', 'TECHNOLOGY', 'DROPPED_CALL_RATE', 'DROPPED_CALLS'], rows: Q.topSitesByDcr(data, 10, allow(persona)).map((x) => [x.siteId, x.market, x.technology, fmtNum(x.dcr, 2), x.dropped]) }) },
    { id: 'W-03', label: 'Postpaid ARPU by region, Q3 2026', sql: `SELECT region, SUM(service_revenue) / COUNT(*) AS postpaid_arpu\n  FROM ${DB}.DATA_PRODUCTS.DP_USAGE_REVENUE\n WHERE segment = 'Postpaid' AND invoice_month BETWEEN '2026-07' AND '2026-09'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => { const r = Q.arpuByRegion(data, Q.PERIODS.quarter.months, allow(persona)); return { columns: ['REGION', 'POSTPAID_ARPU', 'INVOICES'], rows: [...r.rows].sort((a, b) => b.arpu - a.arpu).map((x) => [x.region, fmtUsd(x.arpu), x.invoices]) }; } },
    { id: 'W-04', label: 'Dropped call rate by quarter and region', sql: `SELECT d.fiscal_quarter, n.region, SUM(dropped_calls) / SUM(call_attempts) * 100 AS dropped_call_rate\n  FROM ${DB}.CONFORMED_GOLD.FCT_NETWORK_DAILY n\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE d USING (date_key)\n GROUP BY 1, 2 ORDER BY 1, 2;`,
      run: ({ persona }) => ({ columns: ['FISCAL_QUARTER', 'REGION', 'DROPPED_CALL_RATE', 'NETWORK_AVAILABILITY'], rows: [['2026-Q1', '2026-01-01', '2026-03-31'], ['2026-Q2', '2026-04-01', '2026-06-30'], ['2026-Q3', '2026-07-01', '2026-09-30']].flatMap(([q, from, to]) => regionsFor(persona).map((rg) => { const s = Q.netSummary(data, { from, to }, allow(persona), rg); return [q, rg, fmtNum(s.dcr, 3), fmtNum(s.availability, 3)]; })) }) },
    { id: 'W-05', label: 'Revenue leakage by market, Q3 2026', sql: `SELECT market, SUM(leakage_amount) / SUM(rated_amount) * 100 AS revenue_leakage_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_USAGE_REVENUE\n WHERE invoice_month BETWEEN '2026-07' AND '2026-09'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['MARKET', 'REGION', 'REVENUE_LEAKAGE_PCT', 'LEAKAGE_USD (SCALED)'], rows: Q.leakageByMarket(data).rows.filter((x) => !allow(persona) || allow(persona)!.includes(x.region)).map((x) => [x.market, x.region, fmtNum(x.pct, 2), fmtInt(x.leakage)]) }) },
    { id: 'W-06', label: 'Postpaid churn and net adds by month', sql: `SELECT month,\n       SUM(voluntary_disconnects + port_outs) / SUM(opening_base) * 100 AS postpaid_churn_rate,\n       SUM(gross_adds) - SUM(voluntary_disconnects + port_outs + involuntary_disconnects) AS net_adds\n  FROM ${DB}.DATA_PRODUCTS.DP_CHURN_RETENTION\n WHERE segment = 'Postpaid'\n GROUP BY 1 ORDER BY 1;`,
      run: () => ({ columns: ['MONTH', 'POSTPAID_CHURN_RATE', 'NET_ADDS'], rows: Q.churnTrend(data).map((x) => [x.month, fmtNum(x.rate, 2), x.net]) }) },
    { id: 'W-07', label: 'First-time fix by work order type, Q3 2026', sql: `SELECT work_order_type, COUNT(*) AS work_orders, AVG(IFF(first_time_fix, 1, 0)) * 100 AS ftf_pct, AVG(hours_to_resolve) AS avg_hours\n  FROM ${DB}.DATA_PRODUCTS.DP_FIELD_SERVICE_EFFICIENCY\n WHERE opened_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 3;`,
      run: ({ persona }) => ({ columns: ['WORK_ORDER_TYPE', 'WORK_ORDERS', 'FTF_PCT', 'AVG_HOURS'], rows: Q.fieldService(data, Q.PERIODS.quarter, allow(persona)).byType.sort((a, b) => a.ftf - b.ftf).map((x) => [x.type, x.orders, fmtNum(x.ftf, 1), fmtNum(x.hours, 1)]) }) },
    { id: 'W-08', label: 'Active subscribers and autopay by region', sql: `SELECT region, COUNT_IF(is_active) AS active_subscribers,\n       AVG(IFF(is_active AND autopay, 1, IFF(is_active, 0, NULL))) * 100 AS autopay_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_SUBSCRIBER_360\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => { const act = Q.activeSubscribers(data, allow(persona)); return { columns: ['REGION', 'ACTIVE_SUBSCRIBERS (SCALED)', 'AUTOPAY_PCT'], rows: regionsFor(persona).map((rg) => { const x = act.filter((s) => s.region === rg); return [rg, Math.round(x.length * data.scale), fmtNum((x.filter((s) => s.autopay).length / x.length) * 100, 1)]; }) }; } },
  ];

  const core = {
    profile: PROFILE, database: DB, semanticViews, glossary: GLOSSARY, context: CONTEXT, products, agents: AGENTS, kpis: KPIS, kpiRanges: KPI_RANGES,
    personas: PERSONAS, initialAccess: INITIAL_ACCESS, initialRequestJustification: 'Need plan and device margin by plan for the Q3 pricing review of Northeast and Southeast postpaid plans.',
    scenarios,
    certificationScript: {
      productId: 'DP-05' as const,
      failures: [
        { gate: 4, checkId: 'G4-VQ', status: 'warn' as const, detail: '7 of 10 verified queries on SV_DEVICE_PLAN_PROFITABILITY', fixedDetail: '10 of 10 verified queries (3 approved in Certification Studio)',
          fix: { label: 'Add 3 verified queries', kind: 'verified-queries' as const, items: ['What is the device subsidy by device model this quarter?', 'Which region has the lowest margin per subscriber?', `How does gross margin for ${PLANS[2].name} compare with ${PLANS[0].name}?`] } },
        { gate: 6, checkId: GATE6_CHECK, status: 'fail' as const, detail: 'DIM_SUBSCRIBER.MSISDN is tagged CPNI but has no masking policy', fixedDetail: 'MP_MASK_CPNI attached to DIM_SUBSCRIBER.MSISDN',
          fix: { label: 'Attach MP_MASK_CPNI', kind: 'masking' as const, items: [`ALTER TABLE ${DB}.CONFORMED_GOLD.DIM_SUBSCRIBER MODIFY COLUMN MSISDN SET MASKING POLICY ${DB}.GOVERNANCE.MP_MASK_CPNI;`] } },
      ],
    },
    worksheet,
    consumers: ['Snowflake Intelligence', 'Tableau via semantic views', 'Internal Marketplace', 'APIs'],
    layerExamples: {
      bronze: 'CRM_SUBSCRIBER_CDC keeps every CRM insert, update and delete for 9.8 M mobile lines and 2.1 M broadband homes — duplicates included.',
      silver: 'CURATED_SILVER.SUBSCRIBER keeps one clean SCD2 row per subscriber version, so a plan change is history, not a new subscriber.',
      gold: 'FCT_SUBSCRIBER_MONTHLY and DIM_PLAN share PLAN_KEY, so churn, port-outs and plan migrations roll up the same way everywhere.',
      semantic: 'SV_CHURN_RETENTION defines postpaid_churn_rate once — Tableau and the agent use the same formula.',
      glossary: 'T-004 Churn Rate is owned by K. Albright, stewarded by R. Mensah and mapped to FCT_SUBSCRIBER_MONTHLY.PORT_OUTS.',
      context: 'BR-004 tells the agent that churn counts voluntary disconnects and port-outs, excludes plan migrations, and cites the KPI standard.',
      product: 'DP-04 Churn & Retention v2.0.1 is certified with a daily SLA and a YAML contract.',
      agent: 'AGT_NETWORK_OPS_ANALYST answers churn and network questions with a full trace and a 95% evaluation score.',
      gov: 'MP_MASK_PII, MP_MASK_CPNI and RAP_REGION_ACCESS apply to the agent exactly as they apply to the person asking.',
    },
    signature: { question: 'What was postpaid churn last month by plan and region?', agentId: 'AG-02', termId: 'T-004', ruleId: 'BR-004', docQuery: 'plan migrations' },
    maskingPolicy: 'MP_MASK_CPNI', rowAccessPolicy: ROW_POLICY, maskingPolicies: { PII: 'MP_MASK_PII', CPNI: 'MP_MASK_CPNI' }, warehouse: 'WH_ANALYTICS_XS',
    dmf, accessHistory,
  };
  const shared = buildSharedObjects({ ...core, physical });
  const pack: IndustryPack = { ...core, objects: [...physical, ...shared], ext: buildExt(data, physical) };
  packRef = pack;
  return pack;
}

export { Q as queries, generateTelecom };
