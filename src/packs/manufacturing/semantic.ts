// Semantic views for Forgepoint Industries (spec sections 5 and 7.3).
import type { Row, SemanticView } from '../../types';
import { sum } from '../../mock-snowflake/generators';
import type { MfgData } from './data';
import { PERIODS } from './queries';

const n = (r: Row, k: string) => Number(r[k] ?? 0);
const quarterOf = (x: string) => `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`;
const ratio = (a: number, b: number) => (b ? a / b : 0);

export function buildSemanticViews(d: MfgData, vqIds: (sv: string) => string[]): SemanticView[] {
  const lw = PERIODS.lastWeek;

  const plant: SemanticView = {
    name: 'SV_PLANT_PERFORMANCE',
    description: 'OEE, its availability / performance / quality components, output, downtime and quality losses by business unit, plant, line and shift',
    tables: [
      { alias: 'production', fqn: 'CONFORMED_GOLD.FCT_LINE_PRODUCTION', pk: 'PRODUCTION_KEY' },
      { alias: 'line', fqn: 'CONFORMED_GOLD.DIM_LINE', pk: 'LINE_KEY' },
      { alias: 'operator', fqn: 'CONFORMED_GOLD.DIM_OPERATOR', pk: 'OPERATOR_KEY' },
      { alias: 'inspection', fqn: 'CONFORMED_GOLD.FCT_QUALITY_INSPECTION', pk: 'LOT_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'production', to: 'line', on: 'LINE_KEY' },
      { from: 'production', to: 'operator', on: 'SHIFT_LEAD_KEY' },
      { from: 'production', to: 'date', on: 'DATE_KEY' },
      { from: 'inspection', to: 'line', on: 'LINE_KEY' },
      { from: 'inspection', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'production.planned_production_min', expr: 'production.PLANNED_PRODUCTION_MIN', description: 'Scheduled time less planned downtime (OEE denominator)' },
      { name: 'production.run_min', expr: 'production.RUN_MIN', description: 'Run time after unplanned downtime' },
      { name: 'production.ideal_run_min', expr: 'production.TOTAL_UNITS * production.IDEAL_CYCLE_SEC / 60', description: 'Minutes the units would have taken at ideal cycle time' },
      { name: 'production.total_units', expr: 'production.TOTAL_UNITS' },
      { name: 'production.good_units', expr: 'production.GOOD_UNITS' },
      { name: 'production.scrap_units', expr: 'production.SCRAP_UNITS' },
      { name: 'production.rework_units', expr: 'production.REWORK_UNITS' },
      { name: 'production.unplanned_downtime_min', expr: 'production.UNPLANNED_DOWNTIME_MIN' },
      { name: 'inspection.defect_qty', expr: 'inspection.DEFECT_QTY' },
      { name: 'inspection.inspected_qty', expr: 'inspection.INSPECTED_QTY' },
      { name: 'inspection.copq_usd', expr: 'inspection.COPQ_USD' },
    ],
    dimensions: [
      { name: 'line.business_unit', expr: 'line.BUSINESS_UNIT', synonyms: ['business unit', 'bu', 'division', 'segment'], description: 'Business unit' },
      { name: 'line.plant_name', expr: 'line.PLANT_NAME', synonyms: ['plant', 'site', 'factory'], description: 'Plant' },
      { name: 'line.line_id', expr: 'line.LINE_ID', synonyms: ['line', 'production line', 'work centre', 'cell'], description: 'Production line' },
      { name: 'line.line_type', expr: 'line.LINE_TYPE', synonyms: ['process', 'line type'], description: 'Process type' },
      { name: 'production.top_loss_reason', expr: 'production.TOP_LOSS_REASON', synonyms: ['loss reason', 'downtime reason', 'stop reason'], description: 'Largest unplanned loss reason in the shift' },
      { name: 'operator.shift_lead', expr: 'operator.OPERATOR_NAME', synonyms: ['shift lead', 'supervisor', 'crew lead'], description: 'Shift lead (PII, masked by MP_MASK_PII)' },
      { name: 'inspection.defect_code', expr: 'inspection.DEFECT_CODE', synonyms: ['defect', 'failure mode', 'defect type'], description: 'Defect code' },
    ],
    timeDimensions: [
      { name: 'date.production_date', expr: 'date.CALENDAR_DATE', description: 'Shift date' },
      { name: 'date.production_week', expr: 'date.PRODUCTION_WEEK', description: 'Production week, Monday to Sunday' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Quarter (FY = calendar year)' },
    ],
    metrics: [
      { name: 'oee_pct', expr: '(SUM(production.run_min) / SUM(production.planned_production_min)) * (SUM(production.ideal_run_min) / SUM(production.run_min)) * (SUM(production.good_units) / SUM(production.total_units)) * 100', description: 'Overall equipment effectiveness = availability × performance × quality; planned downtime excluded', synonyms: ['oee', 'overall equipment effectiveness', 'line efficiency'], termId: 'T-004', unit: '%' },
      { name: 'availability_pct', expr: 'SUM(production.run_min) / SUM(production.planned_production_min) * 100', description: 'Run time ÷ planned production time', synonyms: ['availability', 'uptime'], termId: 'T-005', unit: '%' },
      { name: 'performance_pct', expr: 'SUM(production.ideal_run_min) / SUM(production.run_min) * 100', description: 'Ideal cycle time × units ÷ run time', synonyms: ['performance', 'speed', 'rate efficiency'], termId: 'T-006', unit: '%' },
      { name: 'quality_rate_pct', expr: 'SUM(production.good_units) / SUM(production.total_units) * 100', description: 'Good-first-time units ÷ units started', synonyms: ['quality rate', 'yield'], termId: 'T-007', unit: '%' },
      { name: 'units_produced', expr: 'SUM(production.good_units)', description: 'Good units produced', synonyms: ['output', 'throughput', 'production volume'], termId: 'T-010', unit: 'units' },
      { name: 'unplanned_downtime_hours', expr: 'SUM(production.unplanned_downtime_min) / 60', description: 'Unplanned downtime hours', synonyms: ['downtime', 'stoppages', 'lost hours'], termId: 'T-009', unit: 'hours' },
      { name: 'active_lines', expr: "COUNT(DISTINCT IFF(line.line_status = 'Active' AND date.production_date > CURRENT_DATE - 30, line.line_key, NULL))", description: 'Lines with Active status and scheduled production in the last 30 days', synonyms: ['running lines', 'line count'], termId: 'T-002', unit: 'lines' },
      { name: 'first_pass_yield_pct', expr: 'AVG(IFF(inspection.passed_first_flag, 1, 0)) * 100', description: 'Inspection lots accepted at first inspection', synonyms: ['fpy', 'first pass yield', 'right first time'], termId: 'T-011', unit: '%' },
      { name: 'scrap_rate_pct', expr: 'SUM(production.scrap_units) / SUM(production.total_units) * 100', description: 'Scrapped units ÷ units started', synonyms: ['scrap', 'scrap rate'], termId: 'T-012', unit: '%' },
      { name: 'rework_rate_pct', expr: 'SUM(production.rework_units) / SUM(production.total_units) * 100', description: 'Reworked units ÷ units started', synonyms: ['rework'], termId: 'T-013', unit: '%' },
      { name: 'defects_ppm', expr: 'SUM(inspection.defect_qty) / SUM(inspection.inspected_qty) * 1000000', description: 'Defects per million units inspected', synonyms: ['ppm', 'dpm', 'defect rate'], termId: 'T-014', unit: 'ppm' },
      { name: 'copq_usd', expr: 'SUM(inspection.copq_usd)', description: 'Cost of poor quality from nonconforming lots', synonyms: ['cost of poor quality', 'copq', 'quality cost'], termId: 'T-015', unit: 'USD' },
      { name: 'ncr_count', expr: 'COUNT(inspection.ncr_number)', description: 'Nonconformance reports opened', synonyms: ['ncrs', 'nonconformances'], termId: 'T-016', unit: 'NCRs' },
    ],
    verifiedQueryIds: vqIds('SV_PLANT_PERFORMANCE'),
    productIds: ['DP-01', 'DP-02'],
    playground: {
      from: 'SEMANTIC.SV_PLANT_PERFORMANCE',
      rows: () => d.production.map((p) => ({ business_unit: p.bu, plant: p.plantName, line_id: p.lineId, date: p.date, planned: p.plannedMin, run: p.runMin, ideal: p.idealMin, total: p.total, good: p.good, scrap: p.scrap })),
      dimensions: [
        { name: 'line.line_id', column: 'line_id' },
        { name: 'line.business_unit', column: 'business_unit' },
        { name: 'line.plant_name', column: 'plant' },
      ],
      filters: [
        { label: 'Last week (Mon 21 – Sun 27 Sep 2026)', sql: `date.production_date BETWEEN '${lw.from}' AND '${lw.to}'`, test: (r) => String(r.date) >= lw.from && String(r.date) <= lw.to },
        { label: 'September 2026', sql: "date.production_date BETWEEN '2026-09-01' AND '2026-09-30'", test: (r) => String(r.date).startsWith('2026-09') },
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => quarterOf(String(r.date)) === '2026-Q3' },
        { label: 'Q2 2026', sql: "date.fiscal_quarter = '2026-Q2'", test: (r) => quarterOf(String(r.date)) === '2026-Q2' },
      ],
      metrics: [
        { name: 'oee_pct', unit: '%', decimals: 1, sqlExpr: 'oee_pct', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'ideal'))), sum(rs.map((r) => n(r, 'planned')))) * ratio(sum(rs.map((r) => n(r, 'good'))), sum(rs.map((r) => n(r, 'total')))) * 100 },
        { name: 'availability_pct', unit: '%', decimals: 1, sqlExpr: 'availability_pct', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'run'))), sum(rs.map((r) => n(r, 'planned')))) * 100 },
        { name: 'performance_pct', unit: '%', decimals: 1, sqlExpr: 'performance_pct', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'ideal'))), sum(rs.map((r) => n(r, 'run')))) * 100 },
        { name: 'quality_rate_pct', unit: '%', decimals: 1, sqlExpr: 'quality_rate_pct', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'good'))), sum(rs.map((r) => n(r, 'total')))) * 100 },
        { name: 'scrap_rate_pct', unit: '%', decimals: 2, sqlExpr: 'scrap_rate_pct', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'scrap'))), sum(rs.map((r) => n(r, 'total')))) * 100 },
      ],
    },
  };

  // Asset × month rows: operating hours from the line's run time, failures and PM work from the maintenance fact.
  const assetMonthRows = () => {
    const run = new Map<string, number>();
    for (const p of d.production) { const k = `${p.lineKey}|${p.date.slice(0, 7)}`; run.set(k, (run.get(k) ?? 0) + p.runMin / 60); }
    const ev = new Map<string, { f: number; h: number; pm: number }>();
    for (const m of d.maint) {
      const k = `${m.assetKey}|${m.date.slice(0, 7)}`;
      const cur = ev.get(k) ?? { f: 0, h: 0, pm: 0 };
      if (m.kind === 'Corrective') { cur.f += 1; cur.h += m.hours; } else cur.pm += 1;
      ev.set(k, cur);
    }
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    return d.assets.flatMap((a) => months.map((mo) => {
      const e = ev.get(`${a.key}|${mo}`) ?? { f: 0, h: 0, pm: 0 };
      return { business_unit: a.bu, criticality: a.criticality, asset_type: a.type, month: mo, quarter: quarterOf(`${mo}-01`), op: run.get(`${a.lineKey}|${mo}`) ?? 0, failures: e.f, repair: e.h, pm: e.pm };
    }));
  };

  const maintenance: SemanticView = {
    name: 'SV_ASSET_MAINTENANCE',
    description: 'Asset reliability and maintenance effectiveness: MTBF, MTTR, failures and planned maintenance share',
    tables: [
      { alias: 'maint', fqn: 'CONFORMED_GOLD.FCT_MAINTENANCE_EVENT', pk: 'WORK_ORDER_KEY' },
      { alias: 'asset', fqn: 'CONFORMED_GOLD.DIM_ASSET', pk: 'ASSET_KEY' },
      { alias: 'line', fqn: 'CONFORMED_GOLD.DIM_LINE', pk: 'LINE_KEY' },
      { alias: 'production', fqn: 'CONFORMED_GOLD.FCT_LINE_PRODUCTION', pk: 'PRODUCTION_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'maint', to: 'asset', on: 'ASSET_KEY' },
      { from: 'maint', to: 'line', on: 'LINE_KEY' },
      { from: 'maint', to: 'date', on: 'DATE_KEY' },
      { from: 'production', to: 'line', on: 'LINE_KEY' },
    ],
    facts: [
      { name: 'maint.repair_hours', expr: 'maint.REPAIR_HOURS', description: 'Hours down for repair or service' },
      { name: 'production.operating_hours', expr: 'production.RUN_MIN / 60', description: 'Line run hours, attributed to every asset on the line' },
    ],
    dimensions: [
      { name: 'asset.criticality', expr: 'asset.CRITICALITY', synonyms: ['critical', 'criticality class', 'abc class'], description: 'A critical, B important, C standard' },
      { name: 'asset.asset_type', expr: 'asset.ASSET_TYPE', synonyms: ['machine type', 'equipment'], description: 'Equipment type' },
      { name: 'asset.asset_id', expr: 'asset.ASSET_ID', synonyms: ['asset', 'machine'], description: 'Asset' },
      { name: 'line.business_unit', expr: 'line.BUSINESS_UNIT', synonyms: ['business unit', 'bu'], description: 'Business unit' },
      { name: 'maint.wo_type', expr: 'maint.WO_TYPE', synonyms: ['work order type', 'corrective', 'preventive'], description: 'Corrective or Preventive' },
      { name: 'maint.failure_cause', expr: 'maint.FAILURE_CAUSE', synonyms: ['failure mode', 'cause'], description: 'Failure cause' },
    ],
    timeDimensions: [
      { name: 'date.event_month', expr: "DATE_TRUNC('month', date.CALENDAR_DATE)" },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER' },
    ],
    metrics: [
      { name: 'mtbf_hours', expr: "SUM(production.operating_hours) / COUNT_IF(maint.wo_type = 'Corrective')", description: 'Mean time between failures: operating hours ÷ failures', synonyms: ['mtbf', 'mean time between failures', 'reliability'], termId: 'T-017', unit: 'hours' },
      { name: 'mttr_hours', expr: "AVG(IFF(maint.wo_type = 'Corrective', maint.repair_hours, NULL))", description: 'Mean time to repair: repair hours ÷ failures', synonyms: ['mttr', 'mean time to repair', 'repair time'], termId: 'T-018', unit: 'hours' },
      { name: 'failures', expr: "COUNT_IF(maint.wo_type = 'Corrective')", description: 'Unplanned failures (corrective work orders)', synonyms: ['breakdowns', 'failures'], termId: 'T-017', unit: 'failures' },
      { name: 'planned_maintenance_pct', expr: "COUNT_IF(maint.wo_type = 'Preventive') / COUNT(*) * 100", description: 'Share of work orders that were planned (preventive or condition-based)', synonyms: ['pm compliance', 'planned maintenance', 'planned work share'], termId: 'T-019', unit: '%' },
      { name: 'repair_hours', expr: "SUM(IFF(maint.wo_type = 'Corrective', maint.repair_hours, 0))", description: 'Total repair hours on failures', synonyms: ['repair hours'], termId: 'T-018', unit: 'hours' },
    ],
    verifiedQueryIds: vqIds('SV_ASSET_MAINTENANCE'),
    productIds: ['DP-03'],
    playground: {
      from: 'SEMANTIC.SV_ASSET_MAINTENANCE',
      rows: assetMonthRows,
      dimensions: [
        { name: 'line.business_unit', column: 'business_unit' },
        { name: 'asset.criticality', column: 'criticality' },
        { name: 'asset.asset_type', column: 'asset_type' },
      ],
      filters: [
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
        { label: 'Q2 2026', sql: "date.fiscal_quarter = '2026-Q2'", test: (r) => r.quarter === '2026-Q2' },
        { label: 'September 2026', sql: "date.event_month = '2026-09-01'", test: (r) => r.month === '2026-09' },
      ],
      metrics: [
        { name: 'mtbf_hours', unit: 'hours', decimals: 1, sqlExpr: 'mtbf_hours', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'op'))), Math.max(1, sum(rs.map((r) => n(r, 'failures'))))) },
        { name: 'mttr_hours', unit: 'hours', decimals: 2, sqlExpr: 'mttr_hours', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'repair'))), Math.max(1, sum(rs.map((r) => n(r, 'failures'))))) },
        { name: 'failures', unit: '', decimals: 0, sqlExpr: 'failures', agg: (rs) => sum(rs.map((r) => n(r, 'failures'))) },
        { name: 'planned_maintenance_pct', unit: '%', decimals: 1, sqlExpr: 'planned_maintenance_pct', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'pm'))), sum(rs.map((r) => n(r, 'pm') + n(r, 'failures')))) * 100 },
      ],
    },
  };

  const supplier: SemanticView = {
    name: 'SV_SUPPLIER_PERFORMANCE',
    description: 'Inbound supplier delivery and quality: OTIF, incoming PPM and lead time',
    tables: [
      { alias: 'delivery', fqn: 'CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY', pk: 'RECEIPT_KEY' },
      { alias: 'supplier', fqn: 'CONFORMED_GOLD.DIM_SUPPLIER', pk: 'SUPPLIER_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'delivery', to: 'supplier', on: 'SUPPLIER_KEY' },
      { from: 'delivery', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'delivery.qty_received', expr: 'delivery.QTY_RECEIVED' },
      { name: 'delivery.qty_rejected', expr: 'delivery.QTY_REJECTED' },
      { name: 'delivery.lead_time_days', expr: 'delivery.LEAD_TIME_DAYS' },
    ],
    dimensions: [
      { name: 'supplier.supplier_name', expr: 'supplier.SUPPLIER_NAME', synonyms: ['vendor', 'supplier'] },
      { name: 'supplier.category', expr: 'supplier.CATEGORY', synonyms: ['commodity', 'category', 'material group'] },
      { name: 'supplier.preferred', expr: 'supplier.PREFERRED', synonyms: ['preferred vendor'] },
      { name: 'delivery.business_unit', expr: 'delivery.BUSINESS_UNIT', synonyms: ['business unit', 'bu'] },
      { name: 'delivery.plant_code', expr: 'delivery.PLANT_CODE', synonyms: ['plant', 'receiving plant'] },
    ],
    timeDimensions: [
      { name: 'date.receipt_date', expr: 'date.CALENDAR_DATE' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER' },
    ],
    metrics: [
      { name: 'otif_pct', expr: 'AVG(IFF(delivery.otif_flag, 1, 0)) * 100', description: 'Share of receipts delivered on time and in full', synonyms: ['otif', 'on time in full', 'supplier delivery performance'], termId: 'T-021', unit: '%' },
      { name: 'supplier_ppm', expr: 'SUM(delivery.qty_rejected) / SUM(delivery.qty_received) * 1000000', description: 'Parts rejected at incoming inspection per million received', synonyms: ['supplier ppm', 'incoming ppm', 'supplier quality'], termId: 'T-022', unit: 'ppm' },
      { name: 'lead_time_days', expr: 'AVG(delivery.lead_time_days)', description: 'Average days from PO to goods receipt', synonyms: ['lead time', 'supplier lead time'], termId: 'T-023', unit: 'days' },
      { name: 'receipts', expr: 'COUNT(delivery.receipt_key)', description: 'Goods receipts', synonyms: ['deliveries', 'receipts'], termId: 'T-021', unit: 'receipts' },
    ],
    verifiedQueryIds: vqIds('SV_SUPPLIER_PERFORMANCE'),
    productIds: ['DP-04'],
    playground: {
      from: 'SEMANTIC.SV_SUPPLIER_PERFORMANCE',
      rows: () => d.receipts.map((r) => ({ supplier: r.supplier, category: r.category, business_unit: r.bu, month: r.received.slice(0, 7), quarter: quarterOf(r.received), otif: r.otif, qty: r.qty, rej: r.rejected, lead: r.leadDays })),
      dimensions: [
        { name: 'supplier.supplier_name', column: 'supplier' },
        { name: 'supplier.category', column: 'category' },
        { name: 'delivery.business_unit', column: 'business_unit' },
      ],
      filters: [
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
        { label: 'Q2 2026', sql: "date.fiscal_quarter = '2026-Q2'", test: (r) => r.quarter === '2026-Q2' },
        { label: 'September 2026', sql: "date.receipt_date >= '2026-09-01'", test: (r) => r.month === '2026-09' },
      ],
      metrics: [
        { name: 'otif_pct', unit: '%', decimals: 1, sqlExpr: 'otif_pct', agg: (rs) => ratio(rs.filter((r) => r.otif).length, rs.length) * 100 },
        { name: 'supplier_ppm', unit: 'ppm', decimals: 0, sqlExpr: 'supplier_ppm', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'rej'))), sum(rs.map((r) => n(r, 'qty')))) * 1e6 },
        { name: 'lead_time_days', unit: 'days', decimals: 1, sqlExpr: 'lead_time_days', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'lead'))), rs.length) },
        { name: 'receipts', unit: '', decimals: 0, sqlExpr: 'receipts', agg: (rs) => rs.length },
      ],
    },
  };

  const order: SemanticView = {
    name: 'SV_ORDER_DELIVERY',
    description: 'Customer order-to-delivery: on-time delivery, fill rate, lead time and shipments',
    tables: [
      { alias: 'orders', fqn: 'CONFORMED_GOLD.FCT_ORDER', pk: 'ORDER_LINE_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [{ from: 'orders', to: 'date', on: 'DATE_KEY' }],
    facts: [
      { name: 'orders.lead_time_days', expr: 'orders.LEAD_TIME_DAYS' },
      { name: 'orders.qty_ordered', expr: 'orders.QTY_ORDERED' },
      { name: 'orders.net_value_usd', expr: 'orders.NET_VALUE_USD' },
    ],
    dimensions: [
      { name: 'orders.business_unit', expr: 'orders.BUSINESS_UNIT', synonyms: ['business unit', 'bu'] },
      { name: 'orders.product_family', expr: 'orders.PRODUCT_FAMILY', synonyms: ['product line', 'family'] },
      { name: 'orders.customer_name', expr: 'orders.CUSTOMER_NAME', synonyms: ['customer', 'account'] },
    ],
    timeDimensions: [{ name: 'date.delivery_month', expr: "DATE_TRUNC('month', date.CALENDAR_DATE)" }],
    metrics: [
      { name: 'on_time_delivery_pct', expr: 'AVG(IFF(orders.on_time_flag, 1, 0)) * 100', description: 'Order lines delivered on or before the promised date ÷ order lines delivered', synonyms: ['otd', 'on-time delivery', 'delivery performance'], termId: 'T-024', unit: '%' },
      { name: 'fill_rate_pct', expr: 'AVG(IFF(orders.in_full_flag, 1, 0)) * 100', description: 'Order lines shipped complete', synonyms: ['fill rate', 'in full'], termId: 'T-025', unit: '%' },
      { name: 'order_lead_time_days', expr: 'AVG(orders.lead_time_days)', description: 'Average days from order to delivery', synonyms: ['order lead time', 'order cycle time'], termId: 'T-026', unit: 'days' },
      { name: 'order_lines_shipped', expr: 'COUNT(orders.order_line_key)', description: 'Order lines delivered', synonyms: ['shipments', 'orders shipped'], termId: 'T-030', unit: 'lines' },
    ],
    verifiedQueryIds: vqIds('SV_ORDER_DELIVERY'),
    productIds: ['DP-05'],
    playground: {
      from: 'SEMANTIC.SV_ORDER_DELIVERY',
      rows: () => d.orders.filter((o) => o.delivered).map((o) => ({ business_unit: o.bu, product_family: o.family, month: o.delivered!.slice(0, 7), ontime: o.onTime, infull: o.inFull, lead: o.leadDays })),
      dimensions: [
        { name: 'orders.business_unit', column: 'business_unit' },
        { name: 'orders.product_family', column: 'product_family' },
        { name: 'date.delivery_month', column: 'month' },
      ],
      filters: [
        { label: 'September 2026', sql: "date.delivery_month = '2026-09-01'", test: (r) => r.month === '2026-09' },
        { label: 'Q3 2026', sql: "date.delivery_month BETWEEN '2026-07-01' AND '2026-09-01'", test: (r) => ['2026-07', '2026-08', '2026-09'].includes(String(r.month)) },
        { label: 'April – September 2026', sql: "date.delivery_month >= '2026-04-01'", test: (r) => String(r.month) >= '2026-04' },
      ],
      metrics: [
        { name: 'on_time_delivery_pct', unit: '%', decimals: 1, sqlExpr: 'on_time_delivery_pct', agg: (rs) => ratio(rs.filter((r) => r.ontime).length, rs.length) * 100 },
        { name: 'fill_rate_pct', unit: '%', decimals: 1, sqlExpr: 'fill_rate_pct', agg: (rs) => ratio(rs.filter((r) => r.infull).length, rs.length) * 100 },
        { name: 'order_lead_time_days', unit: 'days', decimals: 1, sqlExpr: 'order_lead_time_days', agg: (rs) => ratio(sum(rs.map((r) => n(r, 'lead'))), rs.length) },
        { name: 'order_lines_shipped', unit: '', decimals: 0, sqlExpr: 'order_lines_shipped', agg: (rs) => Math.round(rs.length * d.orderScale) },
      ],
    },
  };

  return [plant, maintenance, supplier, order];
}
