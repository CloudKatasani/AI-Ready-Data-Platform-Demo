// Healthcare pack: Crestview Health System (spec sections 5–9).
import type { IndustryPack, Persona, ScenarioContext } from '../../types';
import { buildSharedObjects } from '../../mock-snowflake/shared-schemas';
import { buildAccessHistory, buildDmf } from '../shared/catalog-kit';
import { fmtInt, fmtNum, fmtUsd } from '../../lib/format';
import { generateHealthcare } from './data';
import { buildCatalog, GATE6_CHECK } from './catalog';
import { buildSemanticViews } from './semantic';
import { GLOSSARY } from './glossary';
import { CONTEXT } from './context';
import { KPIS } from './kpis';
import { INITIAL_ACCESS, PERSONAS } from './personas';
import { AGENTS } from './agents';
import { buildProducts, MASKING_POLICY, ROW_POLICY } from './products';
import { buildScenarios } from './scenarios';
import { KPI_RANGES, MARKETS } from './generators.config';
import { PROFILE } from './pack';
import * as Q from './queries';
import { buildExt } from './ext';

const DB = `${PROFILE.dbPrefix}_AI_PLATFORM`;
const allow = (p: Persona) => (p.rowFilter?.column === 'MARKET' ? p.rowFilter.allowed : undefined);

export function buildPack(): IndustryPack {
  const data = generateHealthcare(PROFILE.seed);
  const physical = buildCatalog(data, PROFILE.seed);
  const semanticViews = buildSemanticViews(data, (sv) => CONTEXT.verifiedQueries.filter((v) => v.semanticView === sv).map((v) => v.id));
  const products = buildProducts(DB, physical, semanticViews, CONTEXT, AGENTS);

  let packRef: IndustryPack | undefined;
  const scenarios = buildScenarios(data, () => packRef!);

  const dmf = buildDmf(physical, PROFILE.seed, { warn: ['FCT_SUPPLY_USAGE', 'DP_CLINICAL_SUPPLY_CHAIN'], fail: ['DP_CARE_GAPS'] });
  const accessHistory = buildAccessHistory(physical, PERSONAS.map((p) => p.roleId));

  const worksheet: IndustryPack['worksheet'] = [
    { id: 'W-01', label: '30-day readmission rate by service line (Jan–Aug 2026)', sql: `SELECT service_line,\n       SUM(IFF(readmit_30d_flag, 1, 0)) / COUNT(*) * 100 AS readmission_rate_30d\n  FROM ${DB}.DATA_PRODUCTS.DP_QUALITY_READMISSIONS\n WHERE is_eligible_index AND discharge_date BETWEEN '2026-01-01' AND '2026-08-31'\n GROUP BY service_line ORDER BY readmission_rate_30d DESC;`,
      run: ({ persona }: ScenarioContext) => { const r = Q.readmissions(data, Q.PERIODS.readmitYtd, allow(persona)); return { columns: ['SERVICE_LINE', 'INDEX_STAYS', 'READMISSIONS', 'READMISSION_RATE_30D'], rows: r.rows.map((x) => [x.serviceLine, x.index, x.readmits, fmtNum(x.rate, 1)]) }; } },
    { id: 'W-02', label: 'Bed occupancy by hospital, Q3 2026', sql: `SELECT f.facility_name, f.market, f.staffed_beds,\n       SUM(e.inpatient_nights) / (f.staffed_beds * 92) * 100 AS bed_occupancy_pct\n  FROM ${DB}.CONFORMED_GOLD.FCT_ENCOUNTER e\n  JOIN ${DB}.CONFORMED_GOLD.DIM_FACILITY f USING (facility_key)\n WHERE e.encounter_type = 'Inpatient'\n GROUP BY 1, 2, 3 ORDER BY 4 DESC;`,
      run: ({ persona }) => ({ columns: ['FACILITY_NAME', 'MARKET', 'STAFFED_BEDS', 'AVG_DAILY_CENSUS', 'BED_OCCUPANCY_PCT'], rows: Q.occupancy(data, Q.PERIODS.quarter, allow(persona)).rows.map((x) => [x.hospital, x.market, x.beds, x.adc, fmtNum(x.occupancy, 1)]) }) },
    { id: 'W-03', label: 'Claim denial rate by payer, Q3 2026', sql: `SELECT p.payer_name, COUNT(*) AS claims, AVG(IFF(c.is_denied, 1, 0)) * 100 AS denial_rate\n  FROM ${DB}.CONFORMED_GOLD.FCT_CLAIM c\n  JOIN ${DB}.CONFORMED_GOLD.DIM_PAYER p USING (payer_key)\n WHERE c.date_key BETWEEN 20260701 AND 20260930\n GROUP BY 1 ORDER BY 3 DESC;`,
      run: ({ persona }) => ({ columns: ['PAYER_NAME', 'CLAIMS', 'DENIED', 'DENIAL_RATE'], rows: Q.denialByPayer(data, Q.PERIODS.quarter, allow(persona)).rows.map((x) => [x.payer, x.claims, x.denied, fmtNum(x.rate, 1)]) }) },
    { id: 'W-04', label: 'Days in A/R by month-end', sql: `SELECT month_end,\n       SUM(open_ar_usd) / (SUM(expected_net_usd_90d) / 90) AS days_in_ar\n  FROM ${DB}.DATA_PRODUCTS.DP_REVENUE_CYCLE\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['MONTH', 'DAYS_IN_AR'], rows: Q.daysInArTrend(data, allow(persona)).map((x) => [x.month, fmtNum(x.days, 1)]) }) },
    { id: 'W-05', label: 'ED wait time and LWBS by hospital, Sep 2026', sql: `SELECT facility_name, COUNT(*) AS visits, AVG(ed_wait_min) AS ed_wait_minutes,\n       AVG(IFF(lwbs_flag, 1, 0)) * 100 AS lwbs_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_ENCOUNTERS_THROUGHPUT\n WHERE encounter_type = 'Emergency' AND encounter_date >= '2026-09-01'\n GROUP BY 1 ORDER BY 3 DESC;`,
      run: ({ persona }) => ({ columns: ['FACILITY_NAME', 'VISITS', 'ED_WAIT_MINUTES', 'LWBS_RATE'], rows: Q.edWait(data, Q.PERIODS.month, allow(persona)).rows.map((x) => [x.hospital, x.visits, fmtNum(x.avgWait, 1), fmtNum(x.lwbsPct, 1)]) }) },
    { id: 'W-06', label: 'Supply cost per surgical case by service line, Q3 2026', sql: `SELECT service_line, COUNT(DISTINCT encounter_id) AS surgical_cases,\n       SUM(IFF(item_type = 'Supply', cost_usd, 0)) / COUNT(DISTINCT encounter_id) AS supply_cost_per_case\n  FROM ${DB}.DATA_PRODUCTS.DP_CLINICAL_SUPPLY_CHAIN\n WHERE is_surgical_case AND usage_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 3 DESC;`,
      run: ({ persona }) => ({ columns: ['SERVICE_LINE', 'SURGICAL_CASES', 'SUPPLY_COST_PER_CASE'], rows: Q.supplyCostPerCase(data, Q.PERIODS.quarter, allow(persona)).rows.map((x) => [x.serviceLine, x.cases, fmtUsd(x.perCase, 0)]) }) },
    { id: 'W-07', label: 'Clinics with no-show rate above 15% (12 months)', sql: `SELECT c.clinic_name, c.specialty, c.market,\n       COUNT_IF(a.appt_status = 'No-show') / COUNT_IF(a.appt_status IN ('Completed', 'No-show')) * 100 AS no_show_rate\n  FROM ${DB}.CONFORMED_GOLD.FCT_APPOINTMENT a\n  JOIN ${DB}.CONFORMED_GOLD.DIM_CLINIC c USING (clinic_key)\n GROUP BY 1, 2, 3\nHAVING no_show_rate > 15 ORDER BY 4 DESC;`,
      run: ({ persona }) => { const a = allow(persona); return { columns: ['CLINIC_NAME', 'SPECIALTY', 'MARKET', 'SCHEDULED', 'NO_SHOW_RATE'], rows: Q.noShowByClinic(data).filter((x) => x.rate > 15 && (!a || a.includes(x.market))).map((x) => [x.clinic, x.specialty, x.market, x.scheduled, fmtNum(x.rate, 1)]) }; } },
    { id: 'W-08', label: 'Active patients and self-pay share by market', sql: `SELECT market, COUNT_IF(is_active) AS active_patients,\n       AVG(IFF(is_active AND payer_class = 'Self-pay', 1, IFF(is_active, 0, NULL))) * 100 AS self_pay_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_PATIENT_360\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => { const a = allow(persona); return { columns: ['MARKET', 'ACTIVE_PATIENTS (SCALED)', 'SELF_PAY_PCT'], rows: MARKETS.filter((m) => !a || a.includes(m.name)).map((m) => { const r = Q.activeByPayerClass(data, [m.name]); return [m.name, fmtInt(r.activeScaled), fmtNum(r.selfPay.share, 1)]; }) }; } },
  ];

  const core = {
    profile: PROFILE, database: DB, semanticViews, glossary: GLOSSARY, context: CONTEXT, products, agents: AGENTS, kpis: KPIS, kpiRanges: KPI_RANGES,
    personas: PERSONAS, initialAccess: INITIAL_ACCESS, initialRequestJustification: 'Need supply cost per surgical case for the North and Central perioperative margin review and payer contract modelling.',
    scenarios,
    certificationScript: {
      productId: 'DP-05' as const,
      failures: [
        { gate: 4, checkId: 'G4-VQ', status: 'warn' as const, detail: '7 of 10 verified queries on SV_SUPPLY_CHAIN', fixedDetail: '10 of 10 verified queries (3 approved in Certification Studio)',
          fix: { label: 'Add 3 verified queries', kind: 'verified-queries' as const, items: ['What is the supply cost per case for orthopedic surgery by hospital?', 'Which vendors have the lowest on-contract share?', 'How did pharmacy spend per inpatient stay change this quarter?'] } },
        { gate: 6, checkId: GATE6_CHECK, status: 'fail' as const, detail: 'FCT_SUPPLY_USAGE.PATIENT_MRN is tagged PHI but has no masking policy', fixedDetail: `${MASKING_POLICY} attached to FCT_SUPPLY_USAGE.PATIENT_MRN`,
          fix: { label: `Attach ${MASKING_POLICY}`, kind: 'masking' as const, items: [`ALTER TABLE ${DB}.CONFORMED_GOLD.FCT_SUPPLY_USAGE MODIFY COLUMN PATIENT_MRN SET MASKING POLICY ${DB}.GOVERNANCE.${MASKING_POLICY};`] } },
      ],
    },
    worksheet,
    consumers: ['Snowflake Intelligence', 'Power BI via semantic views', 'Internal Marketplace', 'APIs'],
    layerExamples: {
      bronze: 'EHR_PATIENT_CDC keeps every ADT registration insert, update and delete from the EHR — including the duplicates.',
      silver: 'CURATED_SILVER.PATIENT keeps one clean SCD2 row per patient version, MRNs trimmed and names cased.',
      gold: 'FCT_READMISSION and DIM_FACILITY share FACILITY_KEY, so every readmission metric joins to hospitals the same way.',
      semantic: 'SV_QUALITY defines readmission_rate_30d once — Power BI and the agent use the same formula.',
      glossary: 'T-006 30-Day Readmission is owned by Dr. R. Valcourt, stewarded by J. Holloway and mapped to FCT_READMISSION.READMIT_30D_FLAG.',
      context: 'BR-012 tells the agent to exclude planned readmissions and transfers (CMS method) and cite the readmission definitions.',
      product: 'DP-04 Quality & Readmissions v2.0.0 is certified with a daily SLA and a YAML contract.',
      agent: 'AGT_CLINICAL_QUALITY_ANALYST answers with a full trace and a 96% evaluation score.',
      gov: `${MASKING_POLICY} and ${ROW_POLICY} apply to the agent exactly as they apply to the person asking.`,
    },
    signature: { question: 'What is our 30-day all-cause readmission rate by service line?', agentId: 'AG-02', termId: 'T-006', ruleId: 'BR-012', docQuery: 'planned readmission' },
    maskingPolicy: MASKING_POLICY, rowAccessPolicy: ROW_POLICY, maskingPolicies: { PHI: MASKING_POLICY }, warehouse: 'WH_ANALYTICS_XS',
    dmf, accessHistory,
  };
  const shared = buildSharedObjects({ ...core, physical });
  const pack: IndustryPack = { ...core, objects: [...physical, ...shared], ext: buildExt(data, physical) };
  packRef = pack;
  return pack;
}

export { Q as queries, generateHealthcare };
