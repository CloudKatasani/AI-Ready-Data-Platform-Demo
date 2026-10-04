// Utilities reference pack: Northvale Energy (spec sections 5–9).
import type { IndustryPack, Persona, ScenarioContext } from '../../types';
import { buildSharedObjects } from '../../mock-snowflake/shared-schemas';
import { buildAccessHistory, buildDmf } from '../shared/catalog-kit';
import { fmtNum, fmtUsd } from '../../lib/format';
import { generateUtilities } from './data';
import { buildCatalog, GATE6_CHECK } from './catalog';
import { buildSemanticViews } from './semantic';
import { GLOSSARY } from './glossary';
import { CONTEXT } from './context';
import { KPIS } from './kpis';
import { INITIAL_ACCESS, PERSONAS } from './personas';
import { AGENTS } from './agents';
import { buildProducts } from './products';
import { buildScenarios } from './scenarios';
import { KPI_RANGES, OPCOS } from './generators.config';
import { PROFILE } from './pack';
import * as Q from './queries';

const DB = `${PROFILE.dbPrefix}_AI_PLATFORM`;
const allow = (p: Persona) => (p.rowFilter?.column === 'OPCO' ? p.rowFilter.allowed : undefined);

export function buildPack(): IndustryPack {
  const data = generateUtilities(PROFILE.seed);
  const physical = buildCatalog(data, PROFILE.seed);
  const semanticViews = buildSemanticViews(data, (sv) => CONTEXT.verifiedQueries.filter((v) => v.semanticView === sv).map((v) => v.id));
  const products = buildProducts(DB, physical, semanticViews, CONTEXT, AGENTS);

  let packRef: IndustryPack | undefined;
  const scenarios = buildScenarios(data, () => packRef!);

  const dmf = buildDmf(physical, PROFILE.seed, { warn: ['FCT_BILLING', 'DP_BILLING_RECEIVABLES'], fail: ['DP_VEGETATION_RISK', 'VEGETATION_SPAN'] });
  const accessHistory = buildAccessHistory(physical, ['ANALYST_CUSTOMER', 'OPS_RELIABILITY', 'PROCUREMENT_MGR', 'DATA_STEWARD']);

  const worksheet: IndustryPack['worksheet'] = [
    { id: 'W-01', label: 'SAIDI by opco, YTD excluding MED', sql: `SELECT opco, SUM(customer_minutes) / MAX(customers_served_opco) AS saidi_minutes\n  FROM ${DB}.DATA_PRODUCTS.DP_SYSTEM_RELIABILITY\n WHERE outage_date BETWEEN '2026-01-01' AND '2026-09-30' AND med_flag = FALSE\n GROUP BY opco ORDER BY saidi_minutes DESC;`,
      run: ({ persona }: ScenarioContext) => { const r = Q.reliability(data, Q.PERIODS.ytd, true, allow(persona)); return { columns: ['OPCO', 'SAIDI_MINUTES', 'SAIFI', 'CAIDI_MINUTES'], rows: [...r.rows].sort((a, b) => b.saidi - a.saidi).map((x) => [x.opco, fmtNum(x.saidi, 1), fmtNum(x.saifi, 3), fmtNum(x.caidi, 1)]) }; } },
    { id: 'W-02', label: 'Top 10 circuits by customer minutes (30 days)', sql: `SELECT o.circuit_id, c.substation, SUM(o.customer_minutes) AS customer_minutes\n  FROM ${DB}.DATA_PRODUCTS.DP_SYSTEM_RELIABILITY o\n  JOIN ${DB}.CONFORMED_GOLD.DIM_CIRCUIT c USING (circuit_id)\n WHERE o.outage_date >= '2026-09-01'\n GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10;`,
      run: ({ persona }) => ({ columns: ['CIRCUIT_ID', 'SUBSTATION', 'OPCO', 'CUSTOMER_MINUTES'], rows: Q.topCircuitsByCi(data, 120).filter((x) => !allow(persona) || allow(persona)!.includes(x.opco)).sort((a, b) => b.cmi - a.cmi).slice(0, 10).map((x) => [x.circuitId, x.substation, x.opco, Math.round(x.cmi)]) }) },
    { id: 'W-03', label: 'Avg residential bill by region, Q3 2026', sql: `SELECT c.region, AVG(b.billed_amount) AS avg_monthly_bill\n  FROM ${DB}.CONFORMED_GOLD.FCT_BILLING b\n  JOIN ${DB}.CONFORMED_GOLD.DIM_CUSTOMER c USING (customer_key)\n WHERE c.segment = 'Residential' AND b.date_key BETWEEN 20260701 AND 20260930\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => { const r = Q.avgResidentialBillByRegion(data); const a = allow(persona); return { columns: ['REGION', 'OPCO', 'AVG_MONTHLY_BILL'], rows: r.rows.filter((x) => !a || a.includes(x.opco)).sort((x, y) => y.avgBill - x.avgBill).map((x) => [x.region, x.opco, fmtUsd(x.avgBill)]) }; } },
    { id: 'W-04', label: 'DSO by month (receivables)', sql: `SELECT DATE_TRUNC('month', statement_date) AS month,\n       (SUM(billed_amount) + SUM(arrears_amount)) / SUM(billed_amount) * 30 AS dso_days\n  FROM ${DB}.DATA_PRODUCTS.DP_BILLING_RECEIVABLES\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => { const a = allow(persona); const months = [...new Set(data.bills.map((b) => b.month))].sort(); return { columns: ['MONTH', 'DSO_DAYS'], rows: months.map((m) => { const x = data.bills.filter((b) => b.month === m && (!a || a.includes(b.opco))); const billed = x.reduce((s, b) => s + b.billed, 0); return [m, fmtNum(((billed + x.reduce((s, b) => s + b.arrears, 0)) / billed) * 30, 1)]; }) }; } },
    { id: 'W-05', label: 'Spend under contract by quarter', sql: `SELECT d.fiscal_quarter, SUM(IFF(s.on_contract, s.spend_usd, 0)) / SUM(s.spend_usd) * 100 AS pct\n  FROM ${DB}.CONFORMED_GOLD.FCT_PO_SPEND s\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE d USING (date_key)\n GROUP BY 1 ORDER BY 1;`,
      run: () => ({ columns: ['FISCAL_QUARTER', 'SPEND_UNDER_CONTRACT_PCT', 'TOTAL_SPEND'], rows: [['2025-Q4', ['2025-10', '2025-11', '2025-12']], ['2026-Q1', ['2026-01', '2026-02', '2026-03']], ['2026-Q2', ['2026-04', '2026-05', '2026-06']], ['2026-Q3', ['2026-07', '2026-08', '2026-09']]].map(([q, ms]) => { const r = Q.spendUnderContract(data, ms as string[]); return [q as string, fmtNum(r.pct, 1), fmtUsd(r.total, 0)]; }) }) },
    { id: 'W-06', label: 'Supplier OTIF', sql: `SELECT sp.supplier_name, AVG(IFF(f.otif_flag, 1, 0)) * 100 AS otif_pct, COUNT(*) AS lines\n  FROM ${DB}.CONFORMED_GOLD.FCT_PO_SPEND f\n  JOIN ${DB}.CONFORMED_GOLD.DIM_SUPPLIER sp USING (supplier_key)\n GROUP BY 1 ORDER BY 2;`,
      run: () => ({ columns: ['SUPPLIER_NAME', 'OTIF_PCT', 'LINES'], rows: Q.supplierOtif(data).map((s) => [s.supplier, fmtNum(s.otifPct, 1), s.lines]) }) },
    { id: 'W-07', label: 'Outage cause mix, YTD excluding MED', sql: `SELECT cause, COUNT(*) AS events, RATIO_TO_REPORT(COUNT(*)) OVER () * 100 AS pct\n  FROM ${DB}.CONFORMED_GOLD.FCT_OUTAGE\n WHERE date_key >= 20260101 AND med_flag = FALSE\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: () => ({ columns: ['CAUSE', 'EVENTS', 'PCT'], rows: Q.causeMix(data).map((c) => [c.cause, c.events, fmtNum(c.pct, 1)]) }) },
    { id: 'W-08', label: 'Active customers and paperless by opco', sql: `SELECT opco, COUNT_IF(is_active) AS active_customers,\n       AVG(IFF(is_active AND digital_enrolled, 1, IFF(is_active, 0, NULL))) * 100 AS paperless_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => { const a = allow(persona); const act = Q.activeCustomers(data); return { columns: ['OPCO', 'ACTIVE_CUSTOMERS (SCALED)', 'PAPERLESS_PCT'], rows: OPCOS.filter((o) => !a || a.includes(o.name)).map((o) => { const x = act.filter((c) => c.opco === o.name); return [o.name, Math.round(x.length * data.scale), fmtNum((x.filter((c) => c.paperless).length / x.length) * 100, 1)]; }) }; } },
  ];

  const core = {
    profile: PROFILE, database: DB, semanticViews, glossary: GLOSSARY, context: CONTEXT, products, agents: AGENTS, kpis: KPIS, kpiRanges: KPI_RANGES,
    personas: PERSONAS, initialAccess: INITIAL_ACCESS, initialRequestJustification: 'Need DSO and collections figures for the monthly receivables review in Ohio and Indiana.',
    scenarios,
    certificationScript: {
      productId: 'DP-05' as const,
      failures: [
        { gate: 4, checkId: 'G4-VQ', status: 'warn' as const, detail: '7 of 10 verified queries on SV_BILLING_AR', fixedDetail: '10 of 10 verified queries (3 approved in Certification Studio)',
          fix: { label: 'Add 3 verified queries', kind: 'verified-queries' as const, items: ['What is the collections rate by opco this quarter?', 'Which rate class has the highest DSO?', 'How many estimated bills were issued in September?'] } },
        { gate: 6, checkId: GATE6_CHECK, status: 'fail' as const, detail: 'FCT_BILLING.ACCOUNT_EMAIL is tagged PII but has no masking policy', fixedDetail: 'MP_MASK_PII attached to FCT_BILLING.ACCOUNT_EMAIL',
          fix: { label: 'Attach MP_MASK_PII', kind: 'masking' as const, items: [`ALTER TABLE ${DB}.CONFORMED_GOLD.FCT_BILLING MODIFY COLUMN ACCOUNT_EMAIL SET MASKING POLICY ${DB}.GOVERNANCE.MP_MASK_PII;`] } },
      ],
    },
    worksheet,
    consumers: ['Snowflake Intelligence', 'Power BI via semantic views', 'Internal Marketplace', 'APIs'],
    layerExamples: {
      bronze: 'CIS_CUSTOMER_CDC keeps every GoldenGate insert, update and delete from DB2 — including the duplicates.',
      silver: 'CURATED_SILVER.CUSTOMER keeps one clean SCD2 row per customer version, names trimmed and cased.',
      gold: 'FCT_OUTAGE and DIM_CIRCUIT share CIRCUIT_KEY, so every reliability metric joins the same way.',
      semantic: 'SV_RELIABILITY defines saidi_minutes once — Power BI and the agent use the same formula.',
      glossary: 'T-004 SAIDI is owned by T. Baptiste, stewarded by H. Sullivan and mapped to FCT_OUTAGE.CUSTOMER_MINUTES.',
      context: 'BR-012 tells the agent to exclude Major Event Days and cite the IEEE 1366 guide.',
      product: 'DP-02 System Reliability v1.4.1 is certified with an hourly SLA and a YAML contract.',
      agent: 'AGT_RELIABILITY_ANALYST answers with a full trace and a 96% evaluation score.',
      gov: 'MP_MASK_PII and RAP_OPCO_ACCESS apply to the agent exactly as they apply to the person asking.',
    },
    signature: { question: 'What is SAIDI year to date excluding major event days, by operating company?', agentId: 'AG-02', termId: 'T-004', ruleId: 'BR-012', docQuery: 'major event day' },
    maskingPolicy: 'MP_MASK_PII', rowAccessPolicy: 'RAP_OPCO_ACCESS', maskingPolicies: { PII: 'MP_MASK_PII' }, warehouse: 'WH_ANALYTICS_XS',
    dmf, accessHistory,
  };
  const shared = buildSharedObjects({ ...core, physical });
  const pack: IndustryPack = { ...core, objects: [...physical, ...shared] };
  packRef = pack;
  return pack;
}

export { Q as queries, generateUtilities };
