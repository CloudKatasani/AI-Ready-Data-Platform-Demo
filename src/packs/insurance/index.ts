// Insurance pack: Sentinel Mutual (spec sections 5–9).
import type { IndustryPack, Persona, ScenarioContext } from '../../types';
import { buildSharedObjects } from '../../mock-snowflake/shared-schemas';
import { buildAccessHistory, buildDmf } from '../shared/catalog-kit';
import { fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import { generateInsurance } from './data';
import { buildCatalog, GATE6_CHECK } from './catalog';
import { buildSemanticViews } from './semantic';
import { GLOSSARY } from './glossary';
import { CONTEXT } from './context';
import { KPIS } from './kpis';
import { INITIAL_ACCESS, PERSONAS } from './personas';
import { AGENTS } from './agents';
import { buildProducts } from './products';
import { buildScenarios } from './scenarios';
import { KPI_RANGES } from './generators.config';
import { PROFILE } from './pack';
import * as Q from './queries';
import { buildExt } from './ext';

const DB = `${PROFILE.dbPrefix}_AI_PLATFORM`;
const allow = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const usdM = (v: number) => `$${fmtNum(v / 1e6, 1)} M`;

export function buildPack(): IndustryPack {
  const data = generateInsurance(PROFILE.seed);
  const physical = buildCatalog(data, PROFILE.seed);
  const semanticViews = buildSemanticViews(data, (sv) => CONTEXT.verifiedQueries.filter((v) => v.semanticView === sv).map((v) => v.id));
  const products = buildProducts(DB, physical, semanticViews, CONTEXT, AGENTS);

  let packRef: IndustryPack | undefined;
  const scenarios = buildScenarios(data, () => packRef!);

  const dmf = buildDmf(physical, PROFILE.seed, { warn: ['FCT_RESERVE', 'DP_LOSS_RESERVES'], fail: ['DP_CATASTROPHE_EXPOSURE', 'CAT_EVENT'] });
  const accessHistory = buildAccessHistory(physical, ['CLAIMS_ANALYST', 'CLAIMS_OPS_MGR', 'UW_MANAGER', 'DATA_STEWARD']);

  const worksheet: IndustryPack['worksheet'] = [
    { id: 'W-01', label: 'Loss ratio ex-cat by line, YTD', sql: `SELECT c.line_of_business,\n       SUM(IFF(c.cat_code IS NULL, c.incurred_loss, 0)) / MAX(p.earned_premium) * 100 AS loss_ratio_ex_cat\n  FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE c\n  JOIN (SELECT line_of_business, SUM(earned_premium) AS earned_premium\n          FROM ${DB}.DATA_PRODUCTS.DP_PREMIUM_BILLING\n         WHERE premium_month BETWEEN '2026-01-01' AND '2026-09-01' GROUP BY 1) p USING (line_of_business)\n WHERE c.loss_date BETWEEN '2026-01-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }: ScenarioContext) => { const r = Q.underwriting(data, Q.PERIODS.ytd, allow(persona), 'line'); return { columns: ['LINE_OF_BUSINESS', 'EARNED_PREMIUM', 'LOSS_RATIO_EX_CAT', 'CAT_POINTS'], rows: [...r.rows].sort((a, b) => b.lrEx - a.lrEx).map((x) => [Q.lineName(x.key), usdM(x.earned), fmtNum(x.lrEx, 1), fmtNum(x.catLr, 1)]) }; } },
    { id: 'W-02', label: 'Combined ratio components, 2025 vs 2026 YTD', sql: `SELECT YEAR(loss_date) AS fiscal_year,\n       SUM(incurred_loss) / SUM(earned_premium) * 100 AS loss_ratio,\n       SUM(lae_amount) / SUM(earned_premium) * 100 AS lae_ratio,\n       SUM(uw_expense) / SUM(earned_premium) * 100 AS expense_ratio\n  FROM ${DB}.SEMANTIC.SV_CLAIMS_EXPERIENCE\n WHERE MONTH(loss_date) <= 9\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['FISCAL_YEAR', 'LOSS_RATIO', 'LAE_RATIO', 'EXPENSE_RATIO', 'COMBINED_RATIO'], rows: ([['2025', Q.PERIODS.priorYtd], ['2026', Q.PERIODS.ytd]] as const).map(([y, r]) => { const c = Q.combinedRatio(data, r, allow(persona)); return [y, fmtNum(c.lr, 1), fmtNum(c.laeRatio, 1), fmtNum(c.expenseRatio, 1), fmtNum(c.combined, 1)]; }) }) },
    { id: 'W-03', label: 'Average severity by line, YTD', sql: `SELECT line_of_business, AVG(incurred_loss) AS avg_severity, COUNT(*) AS claims\n  FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE\n WHERE loss_date BETWEEN '2026-01-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['LINE_OF_BUSINESS', 'AVG_SEVERITY', 'CLAIMS (SAMPLE)'], rows: Q.severityByLine(data, Q.PERIODS.ytd, allow(persona)).rows.sort((a, b) => b.severity - a.severity).map((x) => [x.name, fmtUsd(x.severity, 0), x.claims]) }) },
    { id: 'W-04', label: 'Case reserves and IBNR by valuation month', sql: `SELECT DATE_TRUNC('month', valuation_date) AS valuation_month,\n       SUM(case_reserve) AS case_reserve_balance, SUM(ibnr_allocated) AS ibnr_reserve\n  FROM ${DB}.DATA_PRODUCTS.DP_LOSS_RESERVES\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['VALUATION_MONTH', 'CASE_RESERVE_BALANCE', 'IBNR_RESERVE', 'OPEN_CLAIMS (SCALED)'], rows: Q.reserveTrend(data, allow(persona)).map((t) => [t.month, usdM(t.caseBal), usdM(t.ibnr), fmtInt(t.openClaims * data.claimScale)]) }) },
    { id: 'W-05', label: 'Quote-to-bind by quarter', sql: `SELECT d.fiscal_quarter, COUNT_IF(s.is_bound) / COUNT_IF(s.is_quoted) * 100 AS quote_to_bind_ratio\n  FROM ${DB}.CONFORMED_GOLD.FCT_SUBMISSION s\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE d ON d.date_key = s.quote_date_key\n GROUP BY 1 ORDER BY 1;`,
      run: () => ({ columns: ['FISCAL_QUARTER', 'QUOTED (SCALED)', 'BOUND (SCALED)', 'QUOTE_TO_BIND_PCT'], rows: Q.quoteToBindByQuarter(data).map((q) => [q.quarter, fmtInt(q.scaledQuoted), fmtInt(q.scaledBound), fmtNum(q.ratio, 1)]) }) },
    { id: 'W-06', label: 'Agency quote turnaround, 2026', sql: `SELECT p.agency_name, p.channel, AVG(s.turnaround_days) AS quote_turnaround_days, COUNT(*) AS quotes\n  FROM ${DB}.CONFORMED_GOLD.FCT_SUBMISSION s\n  JOIN ${DB}.CONFORMED_GOLD.DIM_PRODUCER p USING (agency_key)\n WHERE s.quote_date_key >= 20260101\n GROUP BY 1, 2 ORDER BY 3 DESC;`,
      run: ({ persona }) => { const a = allow(persona); return { columns: ['AGENCY_NAME', 'CHANNEL', 'REGION', 'QUOTE_TURNAROUND_DAYS', 'QUOTES'], rows: Q.agencyTurnaround(data).filter((x) => !a || a.includes(x.region)).map((x) => [x.agency, x.channel, x.region, fmtNum(x.turnaround, 1), x.quotes]) }; } },
    { id: 'W-07', label: 'Daily claim payments, last 30 days', sql: `SELECT date_key, SUM(amount_usd) AS loss_payments\n  FROM ${DB}.CONFORMED_GOLD.FCT_CLAIM_TRANSACTION\n WHERE txn_type = 'Loss payment' AND date_key BETWEEN 20260901 AND 20260930\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['PAYMENT_DATE', 'LOSS_PAYMENTS', 'PAYMENTS (SAMPLE)'], rows: Q.dailyPayments(data, allow(persona)).days.map((x) => [x.day, usdM(x.amount), x.payments]) }) },
    { id: 'W-08', label: 'Policies in force and retention by region', sql: `SELECT region, COUNT_IF(is_in_force) AS policies_in_force,\n       AVG(IFF(is_in_force, annual_premium, NULL)) AS avg_premium,\n       AVG(IFF(renewed_flag, 1, 0)) * 100 AS retention_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_POLICYHOLDER_360\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => ({ columns: ['REGION', 'POLICIES_IN_FORCE (SCALED)', 'AVG_PREMIUM', 'RETENTION_PCT'], rows: Q.policyholderSummary(data, allow(persona)).byRegion.sort((a, b) => b.pif - a.pif).map((x) => [x.region, fmtInt(x.pif), fmtUsd(x.avgPremium, 0), fmtPct(x.retention)]) }) },
  ];

  const core = {
    profile: PROFILE, database: DB, semanticViews, glossary: GLOSSARY, context: CONTEXT, products, agents: AGENTS, kpis: KPIS, kpiRanges: KPI_RANGES,
    personas: PERSONAS, initialAccess: INITIAL_ACCESS, initialRequestJustification: 'Need case reserve and IBNR figures for the monthly large-loss and reserve review in the Northeast and Midwest.',
    scenarios,
    certificationScript: {
      productId: 'DP-05' as const,
      failures: [
        { gate: 4, checkId: 'G4-VQ', status: 'warn' as const, detail: '7 of 10 verified queries on SV_LOSS_RESERVES', fixedDetail: '10 of 10 verified queries (3 approved in Certification Studio)',
          fix: { label: 'Add 3 verified queries', kind: 'verified-queries' as const, items: ['What are case reserves by accident year and line of business?', 'How has IBNR changed since the June valuation?', 'Which line has the highest average case reserve per open claim?'] } },
        { gate: 6, checkId: GATE6_CHECK, status: 'fail' as const, detail: 'FCT_RESERVE.CLAIMANT_DOB is tagged PHI but has no masking policy', fixedDetail: 'MP_MASK_PHI attached to FCT_RESERVE.CLAIMANT_DOB',
          fix: { label: 'Attach MP_MASK_PHI', kind: 'masking' as const, items: [`ALTER TABLE ${DB}.CONFORMED_GOLD.FCT_RESERVE MODIFY COLUMN CLAIMANT_DOB SET MASKING POLICY ${DB}.GOVERNANCE.MP_MASK_PHI;`] } },
      ],
    },
    worksheet,
    consumers: ['Snowflake Intelligence', 'Power BI via semantic views', 'Internal Marketplace', 'APIs'],
    layerExamples: {
      bronze: 'PAS_POLICY_CDC keeps every insert, update and delete from policy administration — including the duplicates.',
      silver: 'CURATED_SILVER.POLICY keeps one clean SCD2 row per policy term, names trimmed and cased.',
      gold: 'FCT_CLAIM and FCT_PREMIUM share LINE_CODE and REGION, so every loss ratio joins the same way.',
      semantic: 'SV_CLAIMS_EXPERIENCE defines loss_ratio_ex_cat once — Power BI and the agent use the same formula.',
      glossary: 'T-008 Loss Ratio is owned by K. Ashford, stewarded by R. Mendes and mapped to FCT_CLAIM.INCURRED_LOSS and FCT_PREMIUM.EARNED_PREMIUM.',
      context: 'BR-005 tells the agent to use earned premium, exclude claims on the cat-code list and cite the NAIC reporting guide.',
      product: 'DP-02 Claims Experience v1.6.0 is certified with an hourly SLA and a YAML contract.',
      agent: 'AGT_UNDERWRITING_COPILOT answers with a full trace and a 95% evaluation score.',
      gov: 'MP_MASK_PII, MP_MASK_PHI and RAP_REGION_ACCESS apply to the agent exactly as they apply to the person asking.',
    },
    signature: { question: 'What is the loss ratio by line of business this year, excluding catastrophe losses?', agentId: 'AG-02', termId: 'T-008', ruleId: 'BR-005', docQuery: 'cat-code list' },
    maskingPolicy: 'MP_MASK_PII', rowAccessPolicy: 'RAP_REGION_ACCESS', maskingPolicies: { PII: 'MP_MASK_PII', PHI: 'MP_MASK_PHI' }, warehouse: 'WH_ANALYTICS_XS',
    dmf, accessHistory,
  };
  const shared = buildSharedObjects({ ...core, physical });
  const pack: IndustryPack = { ...core, objects: [...physical, ...shared], ext: buildExt(data, physical) };
  packRef = pack;
  return pack;
}

export { Q as queries, generateInsurance };
