// Manufacturing pack: Forgepoint Industries (spec sections 5–9).
import type { IndustryPack, Persona, ScenarioContext } from '../../types';
import { buildSharedObjects } from '../../mock-snowflake/shared-schemas';
import { buildAccessHistory, buildDmf } from '../shared/catalog-kit';
import { fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import { generateManufacturing } from './data';
import { buildCatalog, GATE6_CHECK } from './catalog';
import { buildSemanticViews } from './semantic';
import { GLOSSARY } from './glossary';
import { CONTEXT } from './context';
import { KPIS } from './kpis';
import { INITIAL_ACCESS, PERSONAS } from './personas';
import { AGENTS } from './agents';
import { buildProducts, MASKING_POLICIES, ROW_POLICY } from './products';
import { buildScenarios } from './scenarios';
import { BUSINESS_UNITS, KPI_RANGES } from './generators.config';
import { PROFILE } from './pack';
import * as Q from './queries';
import { buildExt } from './ext';

const DB = `${PROFILE.dbPrefix}_AI_PLATFORM`;
const allow = (p: Persona) => (p.rowFilter?.column === 'BUSINESS_UNIT' ? p.rowFilter.allowed : undefined);

export function buildPack(): IndustryPack {
  const data = generateManufacturing(PROFILE.seed);
  const physical = buildCatalog(data, PROFILE.seed);
  const semanticViews = buildSemanticViews(data, (sv) => CONTEXT.verifiedQueries.filter((v) => v.semanticView === sv).map((v) => v.id));
  const products = buildProducts(DB, physical, semanticViews, CONTEXT, AGENTS);

  let packRef: IndustryPack | undefined;
  const scenarios = buildScenarios(data, () => packRef!);

  const dmf = buildDmf(physical, PROFILE.seed, { warn: ['FCT_ORDER', 'DP_ORDER_TO_DELIVERY'], fail: ['DP_ENERGY_EMISSIONS'] });
  const accessHistory = buildAccessHistory(physical, PERSONAS.map((p) => p.roleId));

  const worksheet: IndustryPack['worksheet'] = [
    { id: 'W-01', label: 'Lines below 65% OEE, last week', sql: `SELECT line_id, plant_name, business_unit,\n       SUM(run_min) / SUM(planned_production_min) * 100 AS availability_pct,\n       SUM(oee_pct * planned_production_min) / SUM(planned_production_min) AS oee_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_PRODUCTION_OEE\n WHERE production_date BETWEEN '2026-09-21' AND '2026-09-27'\n GROUP BY 1, 2, 3\nHAVING oee_pct < 65\n ORDER BY oee_pct;`,
      run: ({ persona }: ScenarioContext) => ({ columns: ['LINE_ID', 'PLANT_NAME', 'BUSINESS_UNIT', 'OEE_PCT', 'AVAILABILITY_PCT', 'PERFORMANCE_PCT', 'QUALITY_PCT', 'MAIN_LOSS'], rows: Q.linesBelowOee(data, Q.PERIODS.lastWeek, 65, allow(persona)).below.map((x) => [x.lineId, x.plant, x.bu, fmtNum(x.agg.oee, 1), fmtNum(x.agg.availability, 1), fmtNum(x.agg.performance, 1), fmtNum(x.agg.quality, 1), x.driver]) }) },
    { id: 'W-02', label: 'OEE by business unit, Q3 2026', sql: `SELECT l.business_unit,\n       SUM(p.run_min) / SUM(p.planned_production_min) * 100 AS availability_pct,\n       SUM(p.total_units * p.ideal_cycle_sec / 60) / SUM(p.run_min) * 100 AS performance_pct,\n       SUM(p.good_units) / SUM(p.total_units) * 100 AS quality_pct\n  FROM ${DB}.CONFORMED_GOLD.FCT_LINE_PRODUCTION p\n  JOIN ${DB}.CONFORMED_GOLD.DIM_LINE l USING (line_key)\n WHERE p.date_key BETWEEN 20260701 AND 20260930\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['BUSINESS_UNIT', 'OEE_PCT', 'AVAILABILITY_PCT', 'PERFORMANCE_PCT', 'QUALITY_PCT'], rows: Q.oeeByBu(data, Q.PERIODS.quarter.months, allow(persona)).rows.map((x) => [x.bu, fmtNum(x.oee, 1), fmtNum(x.availability, 1), fmtNum(x.performance, 1), fmtNum(x.quality, 1)]) }) },
    { id: 'W-03', label: 'Unplanned downtime by loss reason, Q3 2026', sql: `SELECT top_loss_reason, SUM(unplanned_downtime_min) / 60 AS downtime_hours, COUNT(*) AS shifts\n  FROM ${DB}.CONFORMED_GOLD.FCT_LINE_PRODUCTION\n WHERE date_key BETWEEN 20260701 AND 20260930 AND unplanned_downtime_min > 0\n GROUP BY 1 ORDER BY 2 DESC;`,
      run: ({ persona }) => {
        const a = allow(persona);
        const m = new Map<string, { h: number; n: number }>();
        for (const p of data.production) {
          if (!Q.inMonths(p.date, Q.PERIODS.quarter.months) || !p.unplannedMin || (a && !a.includes(p.bu))) continue;
          const cur = m.get(p.topReason) ?? { h: 0, n: 0 };
          cur.h += p.unplannedMin / 60;
          cur.n += 1;
          m.set(p.topReason, cur);
        }
        return { columns: ['TOP_LOSS_REASON', 'DOWNTIME_HOURS', 'SHIFTS'], rows: [...m.entries()].sort((x, y) => y[1].h - x[1].h).map(([r, v]) => [r, fmtInt(v.h), v.n]) };
      } },
    { id: 'W-04', label: 'Daily good units, last 30 days', sql: `SELECT production_date, SUM(good_units) AS units_produced\n  FROM ${DB}.DATA_PRODUCTS.DP_PRODUCTION_OEE\n WHERE production_date BETWEEN '2026-09-01' AND '2026-09-30'\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['PRODUCTION_DATE', 'UNITS_PRODUCED', 'OEE_PCT'], rows: Q.dailyUnits(data, Q.PERIODS.last30, allow(persona)).map((x) => [x.day, x.units, fmtNum(x.oee, 1)]) }) },
    { id: 'W-05', label: 'First-pass yield and scrap by quarter', sql: `SELECT d.fiscal_quarter, AVG(IFF(q.passed_first_flag, 1, 0)) * 100 AS fpy_pct, SUM(q.copq_usd) AS copq_usd\n  FROM ${DB}.CONFORMED_GOLD.FCT_QUALITY_INSPECTION q\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE d USING (date_key)\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['FISCAL_QUARTER', 'FPY_PCT', 'SCRAP_RATE_PCT', 'NCRS', 'COPQ_USD'], rows: [['2026-Q2', Q.PERIODS.prevQuarter.months], ['2026-Q3', Q.PERIODS.quarter.months]].map(([q, ms]) => { const r = Q.quality(data, ms as string[], allow(persona)); return [q as string, fmtNum(r.fpy, 1), fmtNum(r.scrapRate, 2), r.ncrs, fmtUsd(r.copq, 0)]; }) }) },
    { id: 'W-06', label: 'Lowest-MTBF assets, Q3 2026', sql: `SELECT a.asset_id, a.asset_type, a.criticality, COUNT_IF(m.wo_type = 'Corrective') AS failures,\n       AVG(IFF(m.wo_type = 'Corrective', m.repair_hours, NULL)) AS mttr_hours\n  FROM ${DB}.CONFORMED_GOLD.FCT_MAINTENANCE_EVENT m\n  JOIN ${DB}.CONFORMED_GOLD.DIM_ASSET a USING (asset_key)\n WHERE m.date_key BETWEEN 20260701 AND 20260930\n GROUP BY 1, 2, 3 ORDER BY failures DESC LIMIT 10;`,
      run: ({ persona }) => { const a = allow(persona); return { columns: ['ASSET_ID', 'ASSET_TYPE', 'CRITICALITY', 'FAILURES', 'MTBF_HOURS', 'MTTR_HOURS'], rows: Q.assetMtbf(data).filter((x) => x.failures > 0 && (!a || a.includes(x.a.bu))).sort((x, y) => x.mtbf - y.mtbf).slice(0, 10).map((x) => [x.a.id, x.a.type, x.a.criticality, x.failures, fmtNum(x.mtbf, 1), fmtNum(x.mttr, 2)]) }; } },
    { id: 'W-07', label: 'Supplier OTIF and PPM, Q3 2026', sql: `SELECT s.supplier_name, AVG(IFF(f.otif_flag, 1, 0)) * 100 AS otif_pct,\n       SUM(f.qty_rejected) / SUM(f.qty_received) * 1e6 AS supplier_ppm, COUNT(*) AS receipts\n  FROM ${DB}.CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY f\n  JOIN ${DB}.CONFORMED_GOLD.DIM_SUPPLIER s USING (supplier_key)\n WHERE f.date_key BETWEEN 20260701 AND 20260930\n GROUP BY 1 ORDER BY 2;`,
      run: ({ persona }) => ({ columns: ['SUPPLIER_NAME', 'OTIF_PCT', 'SUPPLIER_PPM', 'RECEIPTS'], rows: Q.supplierPerf(data, Q.PERIODS.quarter.months, allow(persona)).rows.sort((x, y) => x.otif - y.otif).map((s) => [s.supplier, fmtNum(s.otif, 1), s.ppm, s.receipts]) }) },
    { id: 'W-08', label: 'On-time delivery by month (Order to Delivery)', sql: `SELECT DATE_TRUNC('month', delivered_date) AS delivery_month,\n       AVG(IFF(on_time_flag, 1, 0)) * 100 AS on_time_delivery_pct,\n       AVG(IFF(in_full_flag, 1, 0)) * 100 AS fill_rate_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_ORDER_TO_DELIVERY\n WHERE delivered_date >= '2026-04-01'\n GROUP BY 1 ORDER BY 1;`,
      run: ({ persona }) => ({ columns: ['DELIVERY_MONTH', 'ON_TIME_DELIVERY_PCT', 'FILL_RATE_PCT', 'ORDER_LINES'], rows: Q.deliveryTrend(data, allow(persona)).map((t) => [t.month, fmtPct(t.otd), fmtPct(t.fill), t.lines]) }) },
  ];

  const core = {
    profile: PROFILE, database: DB, semanticViews, glossary: GLOSSARY, context: CONTEXT, products, agents: AGENTS, kpis: KPIS, kpiRanges: KPI_RANGES,
    personas: PERSONAS, initialAccess: INITIAL_ACCESS, initialRequestJustification: 'Need on-time delivery and fill rate for the Motion Systems and Fluid Power weekly S&OP review.',
    scenarios,
    certificationScript: {
      productId: 'DP-05' as const,
      failures: [
        { gate: 4, checkId: 'G4-VQ', status: 'warn' as const, detail: '7 of 10 verified queries on SV_ORDER_DELIVERY', fixedDetail: '10 of 10 verified queries (3 approved in Certification Studio)',
          fix: { label: 'Add 3 verified queries', kind: 'verified-queries' as const, items: ['Which customers had the lowest on-time delivery last quarter?', 'What is order lead time by business unit this month?', 'How many late order lines did we ship in September?'] } },
        { gate: 6, checkId: GATE6_CHECK, status: 'fail' as const, detail: 'FCT_ORDER.CUSTOMER_CONTACT is tagged PII but has no masking policy', fixedDetail: 'MP_MASK_PII attached to FCT_ORDER.CUSTOMER_CONTACT',
          fix: { label: 'Attach MP_MASK_PII', kind: 'masking' as const, items: [`ALTER TABLE ${DB}.CONFORMED_GOLD.FCT_ORDER MODIFY COLUMN CUSTOMER_CONTACT SET MASKING POLICY ${DB}.GOVERNANCE.MP_MASK_PII;`] } },
      ],
    },
    worksheet,
    consumers: ['Snowflake Intelligence', 'Power BI via semantic views', 'Internal Marketplace', 'Plant tier-meeting boards'],
    layerExamples: {
      bronze: 'MES_OPERATOR_CDC keeps every MES insert, update and delete for the operator roster — duplicates, untrimmed badges and mixed-case names included.',
      silver: 'CURATED_SILVER.OPERATOR keeps one clean SCD2 row per operator version, so a promotion to shift lead keeps its history.',
      gold: 'FCT_LINE_PRODUCTION and DIM_LINE share LINE_KEY, so OEE, scrap and energy all join to plants and business units the same way.',
      semantic: 'SV_PLANT_PERFORMANCE defines oee_pct once — the tier-meeting dashboard and the agents use the same formula.',
      glossary: 'T-004 OEE is owned by Manufacturing Excellence, stewarded by M. Lindgren and mapped to FCT_LINE_PRODUCTION.GOOD_UNITS and PLANNED_PRODUCTION_MIN.',
      context: 'BR-001 tells the agent that OEE = availability × performance × quality with planned downtime excluded, and to cite the OEE standard.',
      product: 'DP-01 Production & OEE v2.1.0 is certified with a 15-minute SLA and a YAML contract.',
      agent: 'AGT_QUALITY_COPILOT answers "which lines lost OEE and why" with a full trace and a 95% evaluation score.',
      gov: 'MP_MASK_PII, MP_MASK_TRADE_SECRET and RAP_BU_ACCESS apply to the agent exactly as they apply to the person asking.',
    },
    signature: { question: 'Which lines had OEE below 65% last week, and what drove the losses?', agentId: 'AG-02', termId: 'T-004', ruleId: 'BR-001', docQuery: 'planned downtime' },
    maskingPolicy: 'MP_MASK_PII', rowAccessPolicy: ROW_POLICY, maskingPolicies: MASKING_POLICIES, warehouse: 'WH_ANALYTICS_XS',
    dmf, accessHistory,
  };
  const shared = buildSharedObjects({ ...core, physical });
  const pack: IndustryPack = { ...core, objects: [...physical, ...shared], ext: buildExt(data, physical) };
  packRef = pack;
  return pack;
}

export const BUSINESS_UNIT_NAMES = BUSINESS_UNITS.map((b) => b.name);
export { Q as queries, generateManufacturing };
