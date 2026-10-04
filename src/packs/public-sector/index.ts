// Public Sector pack: Westland County Services (spec sections 5–9).
import type { IndustryPack, Persona, ScenarioContext } from '../../types';
import { buildSharedObjects } from '../../mock-snowflake/shared-schemas';
import { buildAccessHistory, buildDmf, GATE4_CHECK } from '../shared/catalog-kit';
import { fmtNum, fmtUsd } from '../../lib/format';
import { generatePublicSector } from './data';
import { buildCatalog, GATE6_CHECK } from './catalog';
import { buildSemanticViews } from './semantic';
import { GLOSSARY } from './glossary';
import { CONTEXT } from './context';
import { KPIS } from './kpis';
import { INITIAL_ACCESS, PERSONAS } from './personas';
import { AGENTS } from './agents';
import { buildProducts, MASKING, ROW_POLICY } from './products';
import { buildScenarios } from './scenarios';
import { DISTRICTS, KPI_RANGES } from './generators.config';
import { PROFILE } from './pack';
import * as Q from './queries';

const DB = `${PROFILE.dbPrefix}_AI_PLATFORM`;
const allow = (p: Persona) => (p.rowFilter?.column === 'DISTRICT' ? p.rowFilter.allowed : undefined);

export function buildPack(): IndustryPack {
  const data = generatePublicSector(PROFILE.seed);
  const physical = buildCatalog(data, PROFILE.seed);
  const semanticViews = buildSemanticViews(data, (sv) => CONTEXT.verifiedQueries.filter((v) => v.semanticView === sv).map((v) => v.id));
  const products = buildProducts(DB, physical, semanticViews, CONTEXT, AGENTS);

  let packRef: IndustryPack | undefined;
  const scenarios = buildScenarios(data, () => packRef!);

  const dmf = buildDmf(physical, PROFILE.seed, { warn: ['FCT_PAYMENT', 'DP_PROGRAM_INTEGRITY'], fail: ['DP_WORKFORCE_BUDGET', 'BUDGET_LEDGER'] });
  const accessHistory = buildAccessHistory(physical, PERSONAS.map((p) => p.roleId));

  const worksheet: IndustryPack['worksheet'] = [
    { id: 'W-01', label: 'Applications over the 30-day standard by program (YTD)', sql: `SELECT program_code,\n       COUNT_IF(processing_business_days > 30) AS applications_over_standard,\n       AVG(IFF(within_standard, 1, 0)) * 100 AS timely_processing_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_CASE_MANAGEMENT\n WHERE decision_date BETWEEN '2026-01-01' AND '2026-09-30'\n   AND decision IN ('Approved', 'Denied')\n GROUP BY program_code ORDER BY applications_over_standard DESC;`,
      run: ({ persona }: ScenarioContext) => { const r = Q.processingStandard(data, allow(persona)); return { columns: ['PROGRAM', 'APPLICATIONS_OVER_STANDARD (SCALED)', 'TIMELY_PROCESSING_RATE', 'AVG_PROCESSING_DAYS'], rows: [...r.rows].sort((a, b) => b.over - a.over).map((x) => [x.program, Math.round(x.over * data.appScale), fmtNum(x.timelyPct, 1), fmtNum(x.avgDays, 1)]) }; } },
    { id: 'W-02', label: 'Case backlog and caseload by office', sql: `SELECT o.office_name, o.district, COUNT_IF(c.pending_action <> 'NONE') AS case_backlog,\n       COUNT(*) / MAX(o.caseworkers) AS avg_caseload\n  FROM ${DB}.CONFORMED_GOLD.FCT_CASE c\n  JOIN ${DB}.CONFORMED_GOLD.DIM_OFFICE o USING (office_key)\n WHERE c.case_status = 'Open'\n GROUP BY 1, 2 ORDER BY 3 DESC;`,
      run: ({ persona }) => ({ columns: ['OFFICE_NAME', 'DISTRICT', 'CASE_BACKLOG (SCALED)', 'AVG_CASELOAD'], rows: Q.backlogByOffice(data, allow(persona)).rows.map((x) => [x.office, x.district, x.backlog, x.caseload]) }) },
    { id: 'W-03', label: '311 resolution time by district, Q3 2026', sql: `SELECT district, AVG(resolution_days) AS avg_resolution_days,\n       AVG(IFF(within_sla, 1, 0)) * 100 AS on_time_resolution_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_SERVICE_REQUESTS_311\n WHERE created_date BETWEEN '2026-07-01' AND '2026-09-30' AND closed_date IS NOT NULL\n GROUP BY district ORDER BY avg_resolution_days DESC;`,
      run: ({ persona }) => ({ columns: ['DISTRICT', 'AVG_RESOLUTION_DAYS', 'ON_TIME_RESOLUTION_RATE'], rows: Q.srByDistrict(data, Q.PERIODS.quarter.months, allow(persona)).rows.sort((a, b) => b.avgDays - a.avgDays).map((x) => [x.district, fmtNum(x.avgDays, 2), fmtNum(x.onTimePct, 1)]) }) },
    { id: 'W-04', label: 'Cases flagged for integrity review by district', sql: `SELECT district, flag_status, COUNT(DISTINCT case_id) AS cases_flagged\n  FROM ${DB}.DATA_PRODUCTS.DP_PROGRAM_INTEGRITY\n WHERE flag_status IN ('Open review', 'Referred')\n GROUP BY 1, 2 ORDER BY 1, 2;`,
      run: ({ persona }) => ({ columns: ['DISTRICT', 'OPEN_REVIEW', 'REFERRED', 'CASES_FLAGGED (SCALED)'], rows: Q.integrityReview(data, allow(persona)).rows.map((x) => [x.district, x.openReview, x.referred, x.scaled]) }) },
    { id: 'W-05', label: 'Payment accuracy and improper rate by program (YTD)', sql: `SELECT program_code, SUM(payment_amount) AS total_benefits_paid,\n       AVG(IFF(is_improper, 0, 1)) * 100 AS payment_accuracy_rate,\n       SUM(improper_amount) / SUM(payment_amount) * 100 AS improper_payment_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_BENEFIT_PAYMENTS\n WHERE issue_date BETWEEN '2026-01-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 4 DESC;`,
      run: ({ persona }) => ({ columns: ['PROGRAM', 'TOTAL_BENEFITS_PAID (SCALED)', 'PAYMENT_ACCURACY_RATE', 'IMPROPER_PAYMENT_RATE'], rows: Q.paymentsByProgram(data, Q.PERIODS.ytd, allow(persona)).sort((a, b) => b.improperRate - a.improperRate).map((x) => [x.program, fmtUsd(x.paid, 0), fmtNum(x.accuracyPct, 1), fmtNum(x.improperRate, 2)]) }) },
    { id: 'W-06', label: 'Average processing days, 2026 vs 2025 (Jan–Sep)', sql: `SELECT program_code, YEAR(decision_date) AS decision_year, AVG(processing_business_days) AS avg_processing_days\n  FROM ${DB}.DATA_PRODUCTS.DP_CASE_MANAGEMENT\n WHERE MONTH(decision_date) <= 9 AND decision IN ('Approved', 'Denied')\n GROUP BY 1, 2 ORDER BY 1, 2;`,
      run: ({ persona }) => ({ columns: ['PROGRAM', 'AVG_DAYS_2025', 'AVG_DAYS_2026', 'APPROVAL_RATE_2026'], rows: Q.processingYoY(data, allow(persona)).rows.map((x) => [x.program, fmtNum(x.prev.avgDays, 1), fmtNum(x.cur.avgDays, 1), fmtNum(x.cur.approvalPct, 1)]) }) },
    { id: 'W-07', label: 'Daily 311 requests, last 30 days', sql: `SELECT created_date, COUNT(*) AS service_requests\n  FROM ${DB}.DATA_PRODUCTS.DP_SERVICE_REQUESTS_311\n WHERE created_date BETWEEN '2026-09-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['CREATED_DATE', 'SERVICE_REQUESTS (SCALED)'], rows: Q.srDaily(data, allow(persona)).daily.map((x) => [x.day, x.requests]) }) },
    { id: 'W-08', label: 'Active constituents and multi-program share by district', sql: `SELECT district, COUNT_IF(is_active) AS active_constituents,\n       AVG(IFF(is_active AND programs_enrolled >= 2, 1, IFF(is_active, 0, NULL))) * 100 AS multi_program_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_CONSTITUENT_360\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => { const a = allow(persona); return { columns: ['DISTRICT', 'ACTIVE_CONSTITUENTS (SCALED)', 'MULTI_PROGRAM_RATE'], rows: DISTRICTS.filter((x) => !a || a.includes(x.name)).map((x) => { const m = Q.multiProgram(data, [x.name]); return [x.name, Math.round(m.active * data.scale), fmtNum(m.pct, 1)]; }) }; } },
  ];

  const core = {
    profile: PROFILE, database: DB, semanticViews, glossary: GLOSSARY, context: CONTEXT, products, agents: AGENTS, kpis: KPIS, kpiRanges: KPI_RANGES,
    personas: PERSONAS, initialAccess: INITIAL_ACCESS, initialRequestJustification: 'Need the integrity review list for North and Central District cases to prioritise caseworker follow-up.',
    scenarios,
    certificationScript: {
      productId: 'DP-05' as const,
      failures: [
        { gate: 4, checkId: GATE4_CHECK, status: 'warn' as const, detail: '7 of 10 verified queries on SV_PROGRAM_INTEGRITY', fixedDetail: '10 of 10 verified queries (3 approved in Certification Studio)',
          fix: { label: 'Add 3 verified queries', kind: 'verified-queries' as const, items: ['How many cases were referred for investigation this quarter?', 'What is the overpayment recovery rate by district?', 'Which flag reasons lead to the most overpayments established?'] } },
        { gate: 6, checkId: GATE6_CHECK, status: 'fail' as const, detail: 'FCT_PAYMENT.CASE_GOV_ID is tagged GOV_ID (government ID) but has no masking policy', fixedDetail: 'MP_MASK_GOV_ID attached to FCT_PAYMENT.CASE_GOV_ID',
          fix: { label: 'Attach MP_MASK_GOV_ID', kind: 'masking' as const, items: [`ALTER TABLE ${DB}.CONFORMED_GOLD.FCT_PAYMENT MODIFY COLUMN CASE_GOV_ID SET MASKING POLICY ${DB}.GOVERNANCE.MP_MASK_GOV_ID;`] } },
      ],
    },
    worksheet,
    consumers: ['Snowflake Intelligence', 'Power BI via semantic views', 'Internal Marketplace', 'Open-data portal'],
    layerExamples: {
      bronze: 'CM_PERSON_CDC keeps every insert, update and delete from case management — duplicates, lower-case district codes and all.',
      silver: 'CURATED_SILVER.CONSTITUENT keeps one clean SCD2 row per constituent version, so a move between districts is tracked.',
      gold: 'FCT_APPLICATION and DIM_PROGRAM share PROGRAM_KEY, and DIM_DATE marks county business days for processing-day counts.',
      semantic: 'SV_CASE_MANAGEMENT defines applications_over_standard once — Power BI and the agent use the same 30-business-day rule.',
      glossary: 'T-009 Processing Days is owned by Eligibility Services, stewarded by K. Yamamoto and mapped to FCT_APPLICATION.PROCESSING_BUSINESS_DAYS.',
      context: 'BR-006 tells the agent to count business days from a complete application and cite the eligibility rules manual.',
      product: 'DP-02 Case Management v1.6.0 is certified with a 15-minute SLA and a YAML contract.',
      agent: 'AGT_PROGRAM_ANALYST answers with a full trace and a 95% evaluation score.',
      gov: 'MP_MASK_PII, MP_MASK_GOV_ID and RAP_DISTRICT_ACCESS apply to the agent exactly as they apply to the person asking.',
    },
    signature: { question: 'How many benefit applications exceed the 30-day processing standard?', agentId: 'AG-02', termId: 'T-009', ruleId: 'BR-006', docQuery: 'complete application' },
    maskingPolicy: MASKING.PII, rowAccessPolicy: ROW_POLICY, maskingPolicies: { PII: MASKING.PII, GOV_ID: MASKING.GOV_ID }, warehouse: 'WH_ANALYTICS_XS',
    dmf, accessHistory,
  };
  const shared = buildSharedObjects({ ...core, physical });
  const pack: IndustryPack = { ...core, objects: [...physical, ...shared] };
  packRef = pack;
  return pack;
}

export { Q as queries, generatePublicSector };
