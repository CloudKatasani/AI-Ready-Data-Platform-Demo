// Banking pack: Ridgeline Bank (spec sections 5–9).
import type { IndustryPack, Persona, ScenarioContext } from '../../types';
import { buildSharedObjects } from '../../mock-snowflake/shared-schemas';
import { buildAccessHistory, buildDmf } from '../shared/catalog-kit';
import { fmtNum, fmtUsd } from '../../lib/format';
import { generateBanking } from './data';
import { buildCatalog, GATE6_CHECK } from './catalog';
import { buildSemanticViews } from './semantic';
import { GLOSSARY } from './glossary';
import { CONTEXT } from './context';
import { KPIS } from './kpis';
import { INITIAL_ACCESS, PERSONAS } from './personas';
import { AGENTS } from './agents';
import { buildProducts, MASKING_POLICIES, ROW_POLICY } from './products';
import { buildScenarios } from './scenarios';
import { KPI_RANGES, REGIONS } from './generators.config';
import { PROFILE } from './pack';
import * as Q from './queries';

const DB = `${PROFILE.dbPrefix}_AI_PLATFORM`;
const allow = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const bn = (v: number) => fmtNum(v / 1e9, 2);

export function buildPack(): IndustryPack {
  const data = generateBanking(PROFILE.seed);
  const physical = buildCatalog(data, PROFILE.seed);
  const semanticViews = buildSemanticViews(data, (sv) => CONTEXT.verifiedQueries.filter((v) => v.semanticView === sv).map((v) => v.id));
  const products = buildProducts(DB, physical, semanticViews, CONTEXT, AGENTS);

  let packRef: IndustryPack | undefined;
  const scenarios = buildScenarios(data, () => packRef!);

  const dmf = buildDmf(physical, PROFILE.seed, { warn: ['FCT_AML_ALERT', 'DP_AML_ALERTS'], fail: ['DP_CUSTOMER_PROFITABILITY'] });
  const accessHistory = buildAccessHistory(physical, PERSONAS.map((p) => p.roleId));

  const worksheet: IndustryPack['worksheet'] = [
    { id: 'W-01', label: 'NPL ratio by loan segment, Sep 2026', sql: `SELECT loan_segment,\n       SUM(IFF(days_past_due >= 90 OR non_accrual_flag, principal_balance, 0)) / SUM(principal_balance) * 100 AS npl_ratio,\n       SUM(principal_balance) AS loans_outstanding\n  FROM ${DB}.DATA_PRODUCTS.DP_LOAN_PORTFOLIO\n WHERE snapshot_date = '2026-09-30'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }: ScenarioContext) => ({ columns: ['LOAN_SEGMENT', 'NPL_RATIO', 'NPL_BALANCE_BN', 'LOANS_OUTSTANDING_BN'], rows: Q.nplBySegment(data, '2026-09', allow(persona)).sort((a, b) => b.nplRatio - a.nplRatio).map((x) => [x.segment, fmtNum(x.nplRatio, 2), bn(x.npl), bn(x.total)]) }) },
    { id: 'W-02', label: 'NPL ratio trend, 2026 month-ends', sql: `SELECT snapshot_date,\n       SUM(IFF(is_non_performing, principal_balance, 0)) / SUM(principal_balance) * 100 AS npl_ratio,\n       SUM(IFF(days_past_due >= 90, principal_balance, 0)) / SUM(principal_balance) * 100 AS dpd90_only_ratio\n  FROM ${DB}.CONFORMED_GOLD.FCT_LOAN_BALANCE f\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE d USING (date_key)\n WHERE d.fiscal_year = 2026\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['SNAPSHOT_MONTH', 'NPL_RATIO', 'DPD90_ONLY_RATIO', 'DPD30_PLUS_RATIO'], rows: Q.nplTrend(data, allow(persona)).map((x) => [x.month, fmtNum(x.nplRatio, 2), fmtNum(x.dpd90Ratio, 2), fmtNum(x.dpd30Ratio, 2)]) }) },
    { id: 'W-03', label: 'Deposits by region and YTD growth', sql: `SELECT region,\n       SUM(IFF(month_end = '2026-09-30', balance_usd, 0)) AS deposits_sep,\n       SUM(IFF(month_end = '2025-12-31', balance_usd, 0)) AS deposits_dec,\n       (deposits_sep / deposits_dec - 1) * 100 AS ytd_growth_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_DEPOSITS_LIQUIDITY\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['REGION', 'DEPOSITS_SEP_BN', 'DEPOSITS_DEC_BN', 'YTD_GROWTH_PCT', 'COST_OF_DEPOSITS_PCT'], rows: Q.depositsByRegion(data, allow(persona)).sort((a, b) => b.sep - a.sep).map((x) => [x.region, bn(x.sep), bn(x.dec), fmtNum(x.ytdPct, 2), fmtNum(x.cost, 2)]) }) },
    { id: 'W-04', label: 'NIM, LDR and cost-to-income by quarter', sql: `SELECT d.fiscal_quarter,\n       (SUM(IFF(gl_account IN ('4100','4200','4300'), amount_usd, 0)) - SUM(IFF(gl_account IN ('5100','5200'), amount_usd, 0))) * 4\n         / (SUM(IFF(gl_account IN ('1000','1100','1200'), amount_usd, 0)) / 3) * 100 AS net_interest_margin\n  FROM ${DB}.CONFORMED_GOLD.FCT_GL_MONTHLY g\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE d USING (date_key)\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['FISCAL_QUARTER', 'NET_INTEREST_MARGIN', 'LOAN_TO_DEPOSIT_RATIO', 'COST_TO_INCOME_RATIO'], rows: ([['2025-Q3', ['2025-07', '2025-08', '2025-09']], ['2025-Q4', ['2025-10', '2025-11', '2025-12']], ['2026-Q1', ['2026-01', '2026-02', '2026-03']], ['2026-Q2', ['2026-04', '2026-05', '2026-06']], ['2026-Q3', ['2026-07', '2026-08', '2026-09']]] as [string, string[]][]).map(([q, ms]) => { const r = Q.glQuarter(data, ms, allow(persona)); return [q, fmtNum(r.nim, 2), fmtNum(r.ldr, 1), fmtNum(r.efficiency, 1)]; }) }) },
    { id: 'W-05', label: 'Card fraud loss (bps) by merchant category, Q3', sql: `SELECT merchant_category,\n       SUM(fraud_loss_usd) / SUM(IFF(is_approved, amount_usd, 0)) * 10000 AS fraud_loss_bps\n  FROM ${DB}.CONFORMED_GOLD.FCT_CARD_TRANSACTION\n WHERE date_key BETWEEN 20260701 AND 20260930\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['MERCHANT_CATEGORY', 'FRAUD_LOSS_BPS', 'FRAUD_LOSS_USD', 'APPROVED_VOLUME_USD'], rows: Q.fraudByCategory(data, Q.PERIODS.q3, allow(persona)).map((x) => [x.category, fmtNum(x.bps, 1), fmtUsd(x.loss, 0), fmtUsd(x.volume, 0)]) }) },
    { id: 'W-06', label: 'Daily card spend, last 30 days', sql: `SELECT transaction_date, SUM(amount_usd) AS approved_spend, COUNT(*) AS transactions\n  FROM ${DB}.DATA_PRODUCTS.DP_CARD_TRANSACTIONS\n WHERE transaction_date >= '2026-09-01' AND is_approved\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['TRANSACTION_DATE', 'APPROVED_SPEND_USD', 'TRANSACTIONS_SAMPLE'], rows: Q.cardDaily(data, Q.PERIODS.last30, allow(persona)).map((x) => [x.day, fmtUsd(x.spend, 0), x.txns]) }) },
    { id: 'W-07', label: 'AML alerts and alert-to-case rate by scenario, YTD', sql: `SELECT scenario, COUNT(*) AS alerts,\n       COUNT_IF(is_escalated) / NULLIF(COUNT_IF(disposition <> 'Open'), 0) * 100 AS alert_to_case_rate\n  FROM ${DB}.CONFORMED_GOLD.FCT_AML_ALERT\n WHERE date_key >= 20260101\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['SCENARIO', 'ALERTS_SAMPLE', 'CASES', 'ALERT_TO_CASE_RATE'], rows: Q.amlByScenario(data, Q.PERIODS.ytd, allow(persona)).map((s) => [s.scenario, s.alerts, s.cases, fmtNum(s.rate, 1)]) }) },
    { id: 'W-08', label: 'Active and digitally active customers by region', sql: `SELECT region, COUNT_IF(is_active) AS active_customers,\n       AVG(IFF(is_active AND is_digital_active, 1, IFF(is_active, 0, NULL))) * 100 AS digital_active_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => { const a = allow(persona); return { columns: ['REGION', 'ACTIVE_CUSTOMERS (SCALED)', 'DIGITAL_ACTIVE_PCT'], rows: REGIONS.filter((r) => !a || a.includes(r.name)).map((r) => { const x = Q.digitalAdoption(data, [r.name]); return [r.name, x.activeScaled, fmtNum(x.pct, 1)]; }) }; } },
  ];

  const core = {
    profile: PROFILE, database: DB, semanticViews, glossary: GLOSSARY, context: CONTEXT, products, agents: AGENTS, kpis: KPIS, kpiRanges: KPI_RANGES,
    personas: PERSONAS, initialAccess: INITIAL_ACCESS, initialRequestJustification: 'Need AML alert counts and escalations on Mountain and Plains customers for the quarterly relationship risk review.',
    scenarios,
    certificationScript: {
      productId: 'DP-05' as const,
      failures: [
        { gate: 4, checkId: 'G4-VQ', status: 'warn' as const, detail: '7 of 10 verified queries on SV_AML_ALERTS', fixedDetail: '10 of 10 verified queries (3 approved in Certification Studio)',
          fix: { label: 'Add 3 verified queries', kind: 'verified-queries' as const, items: ['How many AML alerts are still open after 30 days?', 'Which monitoring scenario has the highest alert-to-case rate?', 'How many SARs were filed last quarter?'] } },
        { gate: 6, checkId: GATE6_CHECK, status: 'fail' as const, detail: 'FCT_AML_ALERT.ACCOUNT_NUMBER is tagged NPI but has no masking policy', fixedDetail: 'MP_MASK_NPI attached to FCT_AML_ALERT.ACCOUNT_NUMBER',
          fix: { label: 'Attach MP_MASK_NPI', kind: 'masking' as const, items: [`ALTER TABLE ${DB}.CONFORMED_GOLD.FCT_AML_ALERT MODIFY COLUMN ACCOUNT_NUMBER SET MASKING POLICY ${DB}.GOVERNANCE.MP_MASK_NPI;`] } },
      ],
    },
    worksheet,
    consumers: ['Snowflake Intelligence', 'Tableau via semantic views', 'Internal Marketplace', 'Regulatory reporting APIs'],
    layerExamples: {
      bronze: 'CORE_CUSTOMER_CDC keeps every insert, update and delete from the core banking CIF — duplicates, untrimmed names and all.',
      silver: 'CURATED_SILVER.CUSTOMER keeps one clean SCD2 row per customer version, so a segment upgrade keeps its history.',
      gold: 'FCT_LOAN_BALANCE and DIM_CUSTOMER share CUSTOMER_KEY, so every credit-quality metric joins the same way.',
      semantic: 'SV_LOAN_PORTFOLIO defines npl_ratio once — Tableau and the agent use the same formula.',
      glossary: 'T-013 NPL Ratio is owned by the Chief Credit Office, stewarded by G. Ellery and mapped to FCT_LOAN_BALANCE.PRINCIPAL_BALANCE.',
      context: 'BR-007 tells the agent that non-performing means 90+ days past due or on non-accrual, citing the Basel III definitions guide.',
      product: 'DP-03 Loan Portfolio Risk v1.6.0 is certified with a 06:00 ET daily SLA and a YAML contract.',
      agent: 'AGT_RISK_LIQUIDITY_ANALYST answers with a full trace and a 95% evaluation score.',
      gov: 'MP_MASK_PII, MP_MASK_PCI, MP_MASK_NPI and RAP_REGION_ACCESS apply to the agent exactly as they apply to the person asking.',
    },
    signature: { question: 'What is our NPL ratio by loan segment, and how has it trended this year?', agentId: 'AG-02', termId: 'T-013', ruleId: 'BR-007', docQuery: 'non-performing loan' },
    maskingPolicy: 'MP_MASK_PII', rowAccessPolicy: ROW_POLICY, maskingPolicies: MASKING_POLICIES, warehouse: 'WH_ANALYTICS_XS',
    dmf, accessHistory,
  };
  const shared = buildSharedObjects({ ...core, physical });
  const pack: IndustryPack = { ...core, objects: [...physical, ...shared] };
  packRef = pack;
  return pack;
}

export { Q as queries, generateBanking };
