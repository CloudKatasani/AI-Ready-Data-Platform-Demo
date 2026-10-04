// Bronze / Silver / Gold objects and product output ports for FPI_AI_PLATFORM (spec section 5).
import type { SfObject } from '../../types';
import { cdcColumns, col, dateKey, GATE6_CHECK, memo, withCdc } from '../shared/catalog-kit';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, noisy, pad, round, ts } from '../../mock-snowflake/generators';
import type { MfgData } from './data';
import { AS_OF, BU_CODE_TO_NAME, PLANTS } from './generators.config';

export { GATE6_CHECK };

const cdc = cdcColumns();
const buAccess = { column: 'BUSINESS_UNIT' };
const buCodeAccess = (c: string) => ({ column: c, map: BU_CODE_TO_NAME });
const BU_CODE: Record<string, string> = Object.fromEntries(Object.entries(BU_CODE_TO_NAME).map(([k, v]) => [v, k]));

export function buildCatalog(d: MfgData, seed: number): SfObject[] {
  const rng = new Rng(seed + 7);
  const opSample = d.operators.slice(0, 400);
  const opByKey = new Map(d.operators.map((o) => [o.key, o]));
  const lineByKey = new Map(d.lines.map((l) => [l.key, l]));
  const assetByKey = new Map(d.assets.map((a) => [a.key, a]));
  const supplierByKey = new Map(d.suppliers.map((s) => [s.key, s]));
  const efByPlant = new Map<string, number>(PLANTS.map((p) => [p.code, p.ef]));
  const recentProd = memo(() => d.production.slice(-300).reverse());

  const bronze: SfObject[] = [
    {
      schema: 'RAW_BRONZE', name: 'MES_OPERATOR_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 1,
      comment: 'Operator and crew roster CDC from the plant MES (badge, role, line assignment), landed as Apache Iceberg',
      columns: [
        col('BADGE_NO', 'VARCHAR(8)', 'MES badge number', { nullable: false }),
        col('FIRST_NM', 'VARCHAR(40)', 'First name (raw)', { tags: ['PII'] }), col('LAST_NM', 'VARCHAR(40)', 'Last name (raw)', { tags: ['PII'] }),
        col('EMAIL_ADDR', 'VARCHAR(120)', 'Work email (raw)', { tags: ['PII'] }), col('PLANT_CD', 'VARCHAR(3)', 'Plant code'),
        col('BU_CD', 'VARCHAR(2)', 'Business unit code (MS, FP, IC, AC)'), col('LINE_CD', 'VARCHAR(8)', 'Assigned line'),
        col('JOB_ROLE', 'VARCHAR(20)', 'Job role'), col('CERT_LVL', 'NUMBER(1)', 'Line certification level 1–3'),
        col('EMP_STAT', 'VARCHAR(1)', 'Employment status (A active, L leave, T terminated)'), ...cdc,
      ],
      rowCount: 1_912_406, bytes: 2.4e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:48:10', upstream: ['ext:MES'],
      rowAccess: buCodeAccess('BU_CD'),
      rows: memo(() => withCdc(rng, opSample, (o) => ({
        BADGE_NO: rng.chance(0.3) ? `${o.id} ` : o.id, FIRST_NM: noisy(rng, o.first), LAST_NM: noisy(rng, o.last),
        EMAIL_ADDR: rng.chance(0.3) ? o.email.toUpperCase() : o.email, PLANT_CD: o.plantCode, BU_CD: o.buCode, LINE_CD: noisy(rng, o.lineId),
        JOB_ROLE: noisy(rng, o.role), CERT_LVL: o.certLevel, EMP_STAT: o.status[0],
      }), '2026-09-01', (o) => o.buCode === 'MS' || o.buCode === 'FP')),
    },
    {
      schema: 'RAW_BRONZE', name: 'MES_OPERATOR_CDC_STRM', layer: 'bronze', type: 'STREAM', order: 2,
      comment: 'Append-only stream feeding CURATED_SILVER.OPERATOR', columns: [], rowCount: 846, owner: 'INGEST_ADMIN',
      lastAltered: '2026-09-30 05:49:00', upstream: ['RAW_BRONZE.MES_OPERATOR_CDC'],
    },
    {
      schema: 'RAW_BRONZE', name: 'MES_LINE_EVENT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 3,
      comment: 'Shift production records from MES: planned time, downtime, counts and loss reason codes',
      columns: [
        col('EVT_ID', 'VARCHAR(20)', 'MES event id'), col('LINE_CD', 'VARCHAR(8)', 'Line code'), col('SHIFT_DT', 'DATE', 'Shift date'), col('SHIFT_NO', 'NUMBER(1)', 'Shift 1–3'),
        col('PLAN_MIN', 'NUMBER(4)', 'Scheduled minutes'), col('PLAN_DOWN_MIN', 'NUMBER(4)', 'Planned downtime minutes (breaks, PM, planned changeover)'),
        col('DOWN_MIN', 'NUMBER(4)', 'Unplanned downtime minutes'), col('DOWN_RSN_CD', 'VARCHAR(6)', 'Primary downtime reason code'),
        col('TOTAL_CNT', 'NUMBER(8)', 'Units started'), col('SCRAP_CNT', 'NUMBER(6)', 'Units scrapped'), col('REWORK_CNT', 'NUMBER(6)', 'Units sent to rework'),
        col('LEAD_BADGE', 'VARCHAR(8)', 'Shift lead badge'), ...cdc,
      ],
      rowCount: 4_820_114, bytes: 6.3e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:02:31', upstream: ['ext:MES'],
      rows: memo(() => withCdc(rng, recentProd(), (p) => ({
        EVT_ID: `EV${p.date.replace(/-/g, '')}${pad(p.lineKey, 3)}${p.shift}`, LINE_CD: p.lineId, SHIFT_DT: p.date, SHIFT_NO: p.shift, PLAN_MIN: 480,
        PLAN_DOWN_MIN: p.plannedDownMin, DOWN_MIN: p.unplannedMin, DOWN_RSN_CD: { Breakdown: 'BRKDN', 'Material shortage': 'MATL', 'Changeover overrun': 'CHGOV', 'Quality hold': 'QHOLD', 'Operator unavailable': 'OPUNV' }[p.topReason] ?? 'OTH',
        TOTAL_CNT: p.total, SCRAP_CNT: p.scrap, REWORK_CNT: p.rework, LEAD_BADGE: opByKey.get(p.leadKey)!.id,
      }), '2026-09-29')),
    },
    {
      schema: 'RAW_BRONZE', name: 'ERP_SALES_ORDER_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 4,
      comment: 'Sales order lines and schedule lines from ERP (orders, BOM revision, standard cost)',
      columns: [
        col('VBELN', 'VARCHAR(10)', 'Sales order number'), col('POSNR', 'NUMBER(6)', 'Order line'), col('KUNNR', 'VARCHAR(10)', 'Sold-to customer'),
        col('CONTACT_EMAIL', 'VARCHAR(120)', 'Customer order contact', { tags: ['PII'] }), col('BU_CD', 'VARCHAR(2)', 'Business unit code'),
        col('MATKL', 'VARCHAR(24)', 'Product family'), col('KWMENG', 'NUMBER(10)', 'Ordered quantity'), col('NETWR', 'NUMBER(14,2)', 'Net value'),
        col('STD_COST', 'NUMBER(12,2)', 'Standard unit cost from the costed BOM', { tags: ['TRADE_SECRET'] }), col('EDATU', 'DATE', 'Promised delivery date'), ...cdc,
      ],
      rowCount: 2_406_880, bytes: 3.9e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 04:41:09', upstream: ['ext:ERP (orders, BOM)'],
      rowAccess: buCodeAccess('BU_CD'),
      rows: memo(() => withCdc(rng, d.orders.slice(-300).reverse(), (o) => ({
        VBELN: o.orderNo.replace('SO-', '00'), POSNR: o.lineNo, KUNNR: d.customers[o.customerKey - 1].id, CONTACT_EMAIL: rng.chance(0.3) ? o.contactEmail.toUpperCase() : o.contactEmail,
        BU_CD: BU_CODE[o.bu], MATKL: noisy(rng, o.family), KWMENG: o.qty, NETWR: o.value, STD_COST: o.unitCost, EDATU: o.promised,
      }), '2026-09-20', (o) => o.bu === 'Motion Systems' || o.bu === 'Fluid Power')),
    },
    {
      schema: 'RAW_BRONZE', name: 'IOT_SENSOR_READING_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 5,
      comment: 'Machine telemetry from the IoT sensor historian (1-minute aggregates): vibration, temperature, load and power',
      columns: [
        col('TAG_ID', 'VARCHAR(30)', 'Historian tag'), col('ASSET_ID', 'VARCHAR(14)', 'Asset id'), col('READ_TS', 'TIMESTAMP_NTZ', 'Reading timestamp'),
        col('VIBRATION_MM_S', 'NUMBER(6,2)', 'Vibration velocity RMS (mm/s)'), col('TEMP_C', 'NUMBER(5,1)', 'Bearing / housing temperature °C'),
        col('LOAD_PCT', 'NUMBER(5,1)', 'Spindle or motor load %'), col('POWER_KW', 'NUMBER(7,2)', 'Metered power kW'), col('QUALITY', 'VARCHAR(4)', 'OPC quality (GOOD, UNCR, BAD)'), ...cdc,
      ],
      rowCount: 38_416_220_904, bytes: 2.1e12, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:15:00', upstream: ['ext:IoT sensor historian'],
      rows: memo(() => withCdc(rng, Array.from({ length: 160 }, (_, i) => i), (i) => {
        const a = d.assets[(i * 7) % d.assets.length];
        const l = lineByKey.get(a.lineKey)!;
        return {
          TAG_ID: `${a.id}.VIB.RMS`, ASSET_ID: a.id, READ_TS: ts(AS_OF, 360 + Math.floor(i / 16)), VIBRATION_MM_S: round(rng.lognormal(2.4, 0.35), 2), TEMP_C: round(rng.normal(54, 6), 1),
          LOAD_PCT: round(rng.range(35, 92), 1), POWER_KW: round(l.kwRun * rng.range(0.15, 0.4), 2), QUALITY: rng.chance(0.02) ? 'UNCR' : 'GOOD',
        };
      }, AS_OF)),
    },
    {
      schema: 'RAW_BRONZE', name: 'QMS_INSPECTION_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 6,
      comment: 'Inspection lots, usage decisions and nonconformance reports from the QMS',
      columns: [
        col('INSP_LOT', 'VARCHAR(24)', 'Inspection lot'), col('LINE_CD', 'VARCHAR(8)', 'Line'), col('INSP_DT', 'DATE', 'Inspection date'), col('SAMPLE_QTY', 'NUMBER(6)', 'Sample size'),
        col('DEFECT_QTY', 'NUMBER(6)', 'Defects found'), col('DEFECT_CD', 'VARCHAR(30)', 'Defect code'), col('USAGE_DECISION', 'VARCHAR(1)', 'A accept, R rework, S scrap, U use as is'),
        col('NCR_NO', 'VARCHAR(14)', 'Nonconformance report'), col('OPERATOR_BADGE', 'VARCHAR(8)', 'Badge of the producing shift lead'), ...cdc,
      ],
      rowCount: 1_288_450, bytes: 1.4e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:22:40', upstream: ['ext:QMS'],
      rows: memo(() => withCdc(rng, d.lots.slice(-300).reverse(), (l) => ({
        INSP_LOT: l.lotId, LINE_CD: l.lineId, INSP_DT: l.date, SAMPLE_QTY: l.inspected, DEFECT_QTY: l.defects, DEFECT_CD: l.defectCode ? noisy(rng, l.defectCode) : null,
        USAGE_DECISION: l.disposition[0].replace('a', 'A'), NCR_NO: l.ncr, OPERATOR_BADGE: opByKey.get(l.operatorKey)!.id,
      }), '2026-09-25')),
    },
    {
      schema: 'RAW_BRONZE', name: 'SUPPLIER_ASN_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 7,
      comment: 'Advance ship notices and goods receipts from the supplier portal',
      columns: [
        col('ASN_NO', 'VARCHAR(12)', 'Advance ship notice'), col('VENDOR_ID', 'VARCHAR(8)', 'Vendor id'), col('PLANT_CD', 'VARCHAR(3)', 'Receiving plant'),
        col('PO_DT', 'DATE', 'Purchase order date'), col('PROMISED_DT', 'DATE', 'Promised date'), col('RECEIPT_DT', 'DATE', 'Goods receipt date'),
        col('QTY_RCVD', 'NUMBER(8)', 'Quantity received'), col('QTY_REJ', 'NUMBER(6)', 'Quantity rejected at incoming inspection'), ...cdc,
      ],
      rowCount: 812_604, bytes: 6.1e7, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 03:30:00', upstream: ['ext:Supplier portal'],
      rows: memo(() => withCdc(rng, d.receipts.slice(-300).reverse(), (r) => ({
        ASN_NO: r.asn, VENDOR_ID: supplierByKey.get(r.supplierKey)!.id, PLANT_CD: noisy(rng, r.plantCode), PO_DT: r.poDate, PROMISED_DT: r.promised, RECEIPT_DT: r.received, QTY_RCVD: r.qty, QTY_REJ: r.rejected,
      }), '2026-09-18')),
    },
  ];

  const silver: SfObject[] = [
    {
      schema: 'CURATED_SILVER', name: 'OPERATOR', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 1,
      comment: 'Deduplicated SCD2 operator entity (role and line history)',
      columns: [
        col('OPERATOR_ID', 'VARCHAR(8)', 'Badge number, trimmed', { nullable: false, termId: 'T-001', tags: ['CDE'] }),
        col('FIRST_NAME', 'VARCHAR(40)', 'First name', { tags: ['PII'] }), col('LAST_NAME', 'VARCHAR(40)', 'Last name', { tags: ['PII'] }),
        col('EMAIL', 'VARCHAR(120)', 'Work email (lowercased)', { tags: ['PII'] }), col('PLANT_CODE', 'VARCHAR(3)', 'Plant'),
        col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003', tags: ['CDE'] }), col('LINE_ID', 'VARCHAR(8)', 'Assigned line'),
        col('JOB_ROLE', 'VARCHAR(20)', 'Operator / Shift lead / Technician / Inspector'), col('CERT_LEVEL', 'NUMBER(1)', 'Line certification level'),
        col('EMPLOYMENT_STATUS', 'VARCHAR(12)', 'Active / Leave / Terminated'), col('EFFECTIVE_FROM', 'DATE', 'SCD2 valid from'), col('EFFECTIVE_TO', 'DATE', 'SCD2 valid to'), col('IS_CURRENT', 'BOOLEAN', 'Current version flag'),
      ],
      rowCount: 15_884, bytes: 2.6e6, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:20:12', upstream: ['RAW_BRONZE.MES_OPERATOR_CDC_STRM'],
      rowAccess: buAccess,
      rows: memo(() => opSample.flatMap((o) => {
        const cur = { OPERATOR_ID: o.id, FIRST_NAME: o.first, LAST_NAME: o.last, EMAIL: o.email, PLANT_CODE: o.plantCode, BUSINESS_UNIT: o.bu, LINE_ID: o.lineId, JOB_ROLE: o.role, CERT_LEVEL: o.certLevel, EMPLOYMENT_STATUS: o.status };
        return o.priorRole
          ? [{ ...cur, JOB_ROLE: o.priorRole, EFFECTIVE_FROM: o.hireDate, EFFECTIVE_TO: addDays(o.changedOn!, -1), IS_CURRENT: false }, { ...cur, EFFECTIVE_FROM: o.changedOn!, EFFECTIVE_TO: null, IS_CURRENT: true }]
          : [{ ...cur, EFFECTIVE_FROM: o.hireDate, EFFECTIVE_TO: null, IS_CURRENT: true }];
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'LINE_SHIFT_PRODUCTION', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 2,
      comment: 'Validated shift production records with typed counts and decoded loss reasons',
      columns: [
        col('LINE_ID', 'VARCHAR(8)', 'Line'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }), col('SHIFT_DATE', 'DATE', 'Shift date'), col('SHIFT_NO', 'NUMBER(1)', 'Shift'),
        col('PLANNED_DOWNTIME_MIN', 'NUMBER(4)', 'Planned downtime', { termId: 'T-008' }), col('UNPLANNED_DOWNTIME_MIN', 'NUMBER(4)', 'Unplanned downtime', { termId: 'T-009' }),
        col('LOSS_REASON', 'VARCHAR(24)', 'Primary unplanned loss reason'), col('TOTAL_UNITS', 'NUMBER(8)', 'Units started'), col('SCRAP_UNITS', 'NUMBER(6)', 'Scrap', { termId: 'T-012' }), col('REWORK_UNITS', 'NUMBER(6)', 'Rework', { termId: 'T-013' }),
        col('SHIFT_LEAD_ID', 'VARCHAR(8)', 'Shift lead badge', { termId: 'T-001' }),
      ],
      rowCount: 4_791_552, bytes: 3.9e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:21:40', upstream: ['RAW_BRONZE.MES_LINE_EVENT_CDC'], rowAccess: buAccess,
      rows: memo(() => d.production.slice(-1500).reverse().map((p) => ({
        LINE_ID: p.lineId, BUSINESS_UNIT: p.bu, SHIFT_DATE: p.date, SHIFT_NO: p.shift, PLANNED_DOWNTIME_MIN: p.plannedDownMin, UNPLANNED_DOWNTIME_MIN: p.unplannedMin,
        LOSS_REASON: p.unplannedMin ? p.topReason : null, TOTAL_UNITS: p.total, SCRAP_UNITS: p.scrap, REWORK_UNITS: p.rework, SHIFT_LEAD_ID: opByKey.get(p.leadKey)!.id,
      }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'SALES_ORDER_LINE', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 3,
      comment: 'Typed sales order lines with promised and delivered dates',
      columns: [
        col('ORDER_NO', 'VARCHAR(12)', 'Sales order'), col('LINE_NO', 'NUMBER(6)', 'Line'), col('CUSTOMER_ID', 'VARCHAR(8)', 'Customer'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }),
        col('PRODUCT_FAMILY', 'VARCHAR(30)', 'Product family'), col('QTY_ORDERED', 'NUMBER(10)', 'Ordered'), col('QTY_SHIPPED', 'NUMBER(10)', 'Shipped'),
        col('ORDER_DATE', 'DATE', 'Order date'), col('PROMISED_DATE', 'DATE', 'Promised delivery date'), col('DELIVERED_DATE', 'DATE', 'Proof-of-delivery date'), col('NET_VALUE_USD', 'NUMBER(14,2)', 'Net value'),
      ],
      rowCount: 2_381_904, bytes: 2.2e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 04:55:00', upstream: ['RAW_BRONZE.ERP_SALES_ORDER_CDC'], rowAccess: buAccess,
      rows: memo(() => d.orders.slice().reverse().map((o) => ({
        ORDER_NO: o.orderNo, LINE_NO: o.lineNo, CUSTOMER_ID: d.customers[o.customerKey - 1].id, BUSINESS_UNIT: o.bu, PRODUCT_FAMILY: o.family, QTY_ORDERED: o.qty, QTY_SHIPPED: o.shippedQty,
        ORDER_DATE: o.orderDate, PROMISED_DATE: o.promised, DELIVERED_DATE: o.delivered, NET_VALUE_USD: o.value,
      }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'ASSET_WORK_ORDER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '30 minutes', order: 4,
      comment: 'Corrective and preventive work orders, with failures confirmed from MES downtime and IoT alarms',
      columns: [
        col('WO_NUMBER', 'VARCHAR(12)', 'Work order'), col('ASSET_ID', 'VARCHAR(14)', 'Asset'), col('LINE_ID', 'VARCHAR(8)', 'Line'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }),
        col('WO_TYPE', 'VARCHAR(12)', 'Corrective / Preventive', { termId: 'T-019' }), col('WO_DATE', 'DATE', 'Event date'), col('DOWNTIME_HOURS', 'NUMBER(6,2)', 'Repair or service hours'), col('FAILURE_CAUSE', 'VARCHAR(30)', 'Failure or PM type'),
      ],
      rowCount: 1_204_330, bytes: 9.6e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:05:00', upstream: ['RAW_BRONZE.IOT_SENSOR_READING_CDC', 'RAW_BRONZE.MES_LINE_EVENT_CDC'], rowAccess: buAccess,
      rows: memo(() => d.maint.slice().reverse().map((m) => ({ WO_NUMBER: m.wo, ASSET_ID: m.assetId, LINE_ID: m.lineId, BUSINESS_UNIT: m.bu, WO_TYPE: m.kind, WO_DATE: m.date, DOWNTIME_HOURS: m.hours, FAILURE_CAUSE: m.cause }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'QUALITY_INSPECTION_LOT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 5,
      comment: 'Inspection lots with decoded usage decisions and linked NCRs',
      columns: [
        col('LOT_ID', 'VARCHAR(24)', 'Inspection lot'), col('LINE_ID', 'VARCHAR(8)', 'Line'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }), col('INSPECTION_DATE', 'DATE', 'Date'),
        col('INSPECTED_QTY', 'NUMBER(6)', 'Sample size'), col('DEFECT_QTY', 'NUMBER(6)', 'Defects', { termId: 'T-014' }), col('DEFECT_CODE', 'VARCHAR(30)', 'Defect code'),
        col('DISPOSITION', 'VARCHAR(10)', 'Accept / Rework / Scrap / Use as is'), col('NCR_NUMBER', 'VARCHAR(14)', 'Nonconformance report', { termId: 'T-016' }),
      ],
      rowCount: 1_270_118, bytes: 1.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:30:00', upstream: ['RAW_BRONZE.QMS_INSPECTION_CDC'], rowAccess: buAccess,
      rows: memo(() => d.lots.slice().reverse().map((l) => ({ LOT_ID: l.lotId, LINE_ID: l.lineId, BUSINESS_UNIT: l.bu, INSPECTION_DATE: l.date, INSPECTED_QTY: l.inspected, DEFECT_QTY: l.defects, DEFECT_CODE: l.defectCode, DISPOSITION: l.disposition, NCR_NUMBER: l.ncr }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'SUPPLIER_RECEIPT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 6,
      comment: 'Typed goods receipts against ASNs with OTIF flags',
      columns: [
        col('ASN_NUMBER', 'VARCHAR(12)', 'ASN'), col('SUPPLIER_ID', 'VARCHAR(8)', 'Supplier'), col('PLANT_CODE', 'VARCHAR(3)', 'Plant'), col('PROMISED_DATE', 'DATE', 'Promised'), col('RECEIVED_DATE', 'DATE', 'Received'),
        col('QTY_RECEIVED', 'NUMBER(8)', 'Received'), col('QTY_REJECTED', 'NUMBER(6)', 'Rejected', { termId: 'T-022' }), col('OTIF_FLAG', 'BOOLEAN', 'On time in full', { termId: 'T-021' }),
      ],
      rowCount: 798_116, bytes: 4.4e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 03:45:00', upstream: ['RAW_BRONZE.SUPPLIER_ASN_CDC'],
      rows: memo(() => d.receipts.slice().reverse().map((r) => ({ ASN_NUMBER: r.asn, SUPPLIER_ID: supplierByKey.get(r.supplierKey)!.id, PLANT_CODE: r.plantCode, PROMISED_DATE: r.promised, RECEIVED_DATE: r.received, QTY_RECEIVED: r.qty, QTY_REJECTED: r.rejected, OTIF_FLAG: r.otif }))),
    },
  ];

  const allDates = dateRange('2025-01-01', '2026-12-31');
  const weekOf = (x: string) => { const dow = (new Date(`${x}T00:00:00Z`).getUTCDay() + 6) % 7; return addDays(x, -dow); };

  const gold: SfObject[] = [
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_OPERATOR', layer: 'gold', type: 'TABLE', order: 1, comment: 'Conformed operator dimension (current version)',
      columns: [
        col('OPERATOR_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('OPERATOR_ID', 'VARCHAR(8)', 'Badge number', { termId: 'T-001', tags: ['CDE'] }),
        col('OPERATOR_NAME', 'VARCHAR(80)', 'Operator name', { tags: ['PII'] }), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003', tags: ['CDE'] }),
        col('PLANT_CODE', 'VARCHAR(3)', 'Plant'), col('LINE_ID', 'VARCHAR(8)', 'Home line'), col('JOB_ROLE', 'VARCHAR(20)', 'Role'), col('CERT_LEVEL', 'NUMBER(1)', 'Certification level'),
      ],
      rowCount: 14_600, bytes: 1.9e6, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:22:00', upstream: ['CURATED_SILVER.OPERATOR'], rowAccess: buAccess,
      rows: memo(() => d.operators.map((o) => ({ OPERATOR_KEY: o.key, OPERATOR_ID: o.id, OPERATOR_NAME: `${o.first} ${o.last}`, BUSINESS_UNIT: o.bu, PLANT_CODE: o.plantCode, LINE_ID: o.lineId, JOB_ROLE: o.role, CERT_LEVEL: o.certLevel }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_LINE', layer: 'gold', type: 'TABLE', order: 2, comment: 'Production lines with plant, business unit, rated speed and status',
      columns: [
        col('LINE_KEY', 'NUMBER', 'Surrogate key'), col('LINE_ID', 'VARCHAR(8)', 'Line id'), col('LINE_TYPE', 'VARCHAR(24)', 'Process type'), col('PLANT_CODE', 'VARCHAR(3)', 'Plant code'),
        col('PLANT_NAME', 'VARCHAR(30)', 'Plant'), col('COUNTRY', 'VARCHAR(2)', 'Country'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003', tags: ['CDE'] }),
        col('LINE_STATUS', 'VARCHAR(16)', 'Active / Decommissioned', { termId: 'T-002', tags: ['CDE'] }), col('SHIFT_PATTERN', 'VARCHAR(10)', 'Two- or three-shift'),
        col('IDEAL_CYCLE_SEC', 'NUMBER(7,1)', 'Ideal (nameplate) cycle time per unit', { termId: 'T-006', tags: ['CDE'] }), col('PROCESS_RECIPE_ID', 'VARCHAR(16)', 'Controlled process recipe', { tags: ['TRADE_SECRET'] }),
      ],
      rowCount: 80, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-01 02:00:00', upstream: ['CURATED_SILVER.LINE_SHIFT_PRODUCTION'], rowAccess: buAccess,
      rows: memo(() => d.lines.map((l) => ({
        LINE_KEY: l.key, LINE_ID: l.id, LINE_TYPE: l.type, PLANT_CODE: l.plantCode, PLANT_NAME: l.plantName, COUNTRY: d.plants[l.plantKey - 1].country, BUSINESS_UNIT: l.bu,
        LINE_STATUS: l.status, SHIFT_PATTERN: l.shifts === 3 ? '3-shift' : '2-shift', IDEAL_CYCLE_SEC: l.idealCycleSec, PROCESS_RECIPE_ID: `RCP-${l.buCode}-${pad(4100 + l.key * 37, 5)}`,
      }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_ASSET', layer: 'gold', type: 'TABLE', order: 3, comment: 'Machines and equipment per line with criticality ranking',
      columns: [col('ASSET_KEY', 'NUMBER', 'Surrogate key'), col('ASSET_ID', 'VARCHAR(14)', 'Asset id'), col('ASSET_TYPE', 'VARCHAR(24)', 'Equipment type'), col('LINE_ID', 'VARCHAR(8)', 'Line'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }), col('CRITICALITY', 'VARCHAR(1)', 'A critical, B important, C standard', { termId: 'T-020' }), col('INSTALL_YEAR', 'NUMBER(4)', 'Installed')],
      rowCount: 320, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-08-15 02:00:00', upstream: ['CURATED_SILVER.ASSET_WORK_ORDER'], rowAccess: buAccess,
      rows: memo(() => d.assets.map((a) => ({ ASSET_KEY: a.key, ASSET_ID: a.id, ASSET_TYPE: a.type, LINE_ID: a.lineId, BUSINESS_UNIT: a.bu, CRITICALITY: a.criticality, INSTALL_YEAR: a.installYear }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_SUPPLIER', layer: 'gold', type: 'TABLE', order: 4, comment: 'Supplier dimension',
      columns: [col('SUPPLIER_KEY', 'NUMBER', 'Surrogate key'), col('SUPPLIER_ID', 'VARCHAR(8)', 'Vendor id'), col('SUPPLIER_NAME', 'VARCHAR(60)', 'Supplier'), col('CATEGORY', 'VARCHAR(30)', 'Commodity'), col('COUNTRY', 'VARCHAR(2)', 'Country'), col('PREFERRED', 'BOOLEAN', 'Preferred supplier')],
      rowCount: 10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-08-15 02:00:00', upstream: ['CURATED_SILVER.SUPPLIER_RECEIPT'],
      rows: memo(() => d.suppliers.map((s) => ({ SUPPLIER_KEY: s.key, SUPPLIER_ID: s.id, SUPPLIER_NAME: s.name, CATEGORY: s.category, COUNTRY: s.country, PREFERRED: s.preferred }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_DATE', layer: 'gold', type: 'TABLE', order: 5, comment: 'Calendar with ISO production weeks, months and quarters',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'yyyymmdd'), col('CALENDAR_DATE', 'DATE', 'Date'), col('PRODUCTION_WEEK', 'DATE', 'Monday of the production week (Mon–Sun)'), col('FISCAL_MONTH', 'VARCHAR(7)', 'yyyy-mm'), col('FISCAL_QUARTER', 'VARCHAR(7)', 'Quarter (FY = calendar year)'), col('IS_WORKDAY', 'BOOLEAN', 'Monday–Friday')],
      rowCount: allDates.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:05:00', upstream: [],
      rows: memo(() => allDates.filter((x) => x <= AS_OF).reverse().map((x) => {
        const dow = new Date(`${x}T00:00:00Z`).getUTCDay();
        return { DATE_KEY: dateKey(x), CALENDAR_DATE: x, PRODUCTION_WEEK: weekOf(x), FISCAL_MONTH: x.slice(0, 7), FISCAL_QUARTER: `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`, IS_WORKDAY: dow > 0 && dow < 6 };
      })),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_LINE_PRODUCTION', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 6, comment: 'Production fact at line × shift grain: time, counts, losses and energy',
      columns: [
        col('PRODUCTION_KEY', 'NUMBER', 'Line-shift'), col('DATE_KEY', 'NUMBER(8)', 'Shift date'), col('LINE_KEY', 'NUMBER', 'Line'), col('SHIFT_NO', 'NUMBER(1)', 'Shift'), col('SHIFT_LEAD_KEY', 'NUMBER', 'Shift lead (DIM_OPERATOR)'),
        col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }),
        col('PLANNED_PRODUCTION_MIN', 'NUMBER(4)', 'Scheduled time less planned downtime', { termId: 'T-005', tags: ['CDE'] }),
        col('PLANNED_DOWNTIME_MIN', 'NUMBER(4)', 'Breaks, planned maintenance, planned changeovers', { termId: 'T-008', tags: ['CDE'] }),
        col('UNPLANNED_DOWNTIME_MIN', 'NUMBER(4)', 'Breakdowns, shortages, overruns, holds', { termId: 'T-009', tags: ['CDE'] }),
        col('RUN_MIN', 'NUMBER(4)', 'Run time', { termId: 'T-005', tags: ['CDE'] }), col('MINOR_STOP_MIN', 'NUMBER(4)', 'Estimated minor-stop minutes inside run time', { termId: 'T-029' }),
        col('IDEAL_CYCLE_SEC', 'NUMBER(7,1)', 'Ideal cycle time', { termId: 'T-006', tags: ['CDE'] }), col('TOTAL_UNITS', 'NUMBER(8)', 'Units started', { termId: 'T-006', tags: ['CDE'] }),
        col('GOOD_UNITS', 'NUMBER(8)', 'Units good first time', { termId: 'T-007', tags: ['CDE'] }), col('SCRAP_UNITS', 'NUMBER(6)', 'Scrapped units', { termId: 'T-012', tags: ['CDE'] }),
        col('REWORK_UNITS', 'NUMBER(6)', 'Units reworked', { termId: 'T-013' }), col('TOP_LOSS_REASON', 'VARCHAR(24)', 'Largest unplanned loss reason'), col('ENERGY_KWH', 'NUMBER(10,1)', 'Metered energy', { termId: 'T-027' }),
      ],
      rowCount: 4_791_552, bytes: 4.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:24:51', upstream: ['CURATED_SILVER.LINE_SHIFT_PRODUCTION', 'CONFORMED_GOLD.DIM_LINE'], rowAccess: buAccess,
      rows: memo(() => d.production.slice().reverse().map((p) => ({
        PRODUCTION_KEY: p.key, DATE_KEY: dateKey(p.date), LINE_KEY: p.lineKey, SHIFT_NO: p.shift, SHIFT_LEAD_KEY: p.leadKey, BUSINESS_UNIT: p.bu, PLANNED_PRODUCTION_MIN: p.plannedMin,
        PLANNED_DOWNTIME_MIN: p.plannedDownMin, UNPLANNED_DOWNTIME_MIN: p.unplannedMin, RUN_MIN: p.runMin, MINOR_STOP_MIN: p.minorStopMin, IDEAL_CYCLE_SEC: p.idealCycleSec,
        TOTAL_UNITS: p.total, GOOD_UNITS: p.good, SCRAP_UNITS: p.scrap, REWORK_UNITS: p.rework, TOP_LOSS_REASON: p.unplannedMin ? p.topReason : null, ENERGY_KWH: p.energyKwh,
      }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_QUALITY_INSPECTION', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 7, comment: 'Inspection lot fact with first-pass result, defects and cost of poor quality',
      columns: [
        col('LOT_KEY', 'NUMBER', 'Inspection lot'), col('DATE_KEY', 'NUMBER(8)', 'Inspection date'), col('LINE_KEY', 'NUMBER', 'Line'), col('OPERATOR_KEY', 'NUMBER', 'Producing shift lead'),
        col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }), col('INSPECTED_QTY', 'NUMBER(6)', 'Sample size', { termId: 'T-014' }), col('DEFECT_QTY', 'NUMBER(6)', 'Defects', { termId: 'T-014' }),
        col('PASSED_FIRST_FLAG', 'BOOLEAN', 'Accepted at first inspection', { termId: 'T-011', tags: ['CDE'] }), col('DEFECT_CODE', 'VARCHAR(30)', 'Defect code'), col('DISPOSITION', 'VARCHAR(10)', 'Usage decision'),
        col('NCR_NUMBER', 'VARCHAR(14)', 'Nonconformance report', { termId: 'T-016' }), col('COPQ_USD', 'NUMBER(12,2)', 'Cost of poor quality (scrap, rework, investigation)', { termId: 'T-015', tags: ['CDE'] }),
      ],
      rowCount: 1_270_118, bytes: 9.4e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:34:00', upstream: ['CURATED_SILVER.QUALITY_INSPECTION_LOT', 'CONFORMED_GOLD.DIM_LINE'], rowAccess: buAccess,
      rows: memo(() => d.lots.slice().reverse().map((l) => ({ LOT_KEY: l.key, DATE_KEY: dateKey(l.date), LINE_KEY: l.lineKey, OPERATOR_KEY: l.operatorKey, BUSINESS_UNIT: l.bu, INSPECTED_QTY: l.inspected, DEFECT_QTY: l.defects, PASSED_FIRST_FLAG: l.passedFirst, DEFECT_CODE: l.defectCode, DISPOSITION: l.disposition, NCR_NUMBER: l.ncr, COPQ_USD: l.copq }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_MAINTENANCE_EVENT', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '30 minutes', order: 8, comment: 'Maintenance fact at work-order grain (failures and preventive work)',
      columns: [
        col('WORK_ORDER_KEY', 'NUMBER', 'Work order'), col('ASSET_KEY', 'NUMBER', 'Asset'), col('LINE_KEY', 'NUMBER', 'Line'), col('DATE_KEY', 'NUMBER(8)', 'Event date'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }),
        col('WO_TYPE', 'VARCHAR(12)', 'Corrective (failure) or Preventive', { termId: 'T-019', tags: ['CDE'] }), col('REPAIR_HOURS', 'NUMBER(6,2)', 'Hours down for repair or service', { termId: 'T-018', tags: ['CDE'] }), col('FAILURE_CAUSE', 'VARCHAR(30)', 'Failure or PM type'),
      ],
      rowCount: 1_204_330, bytes: 6.2e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:08:00', upstream: ['CURATED_SILVER.ASSET_WORK_ORDER', 'CONFORMED_GOLD.DIM_ASSET'], rowAccess: buAccess,
      rows: memo(() => d.maint.slice().reverse().map((m) => ({ WORK_ORDER_KEY: m.key, ASSET_KEY: m.assetKey, LINE_KEY: m.lineKey, DATE_KEY: dateKey(m.date), BUSINESS_UNIT: m.bu, WO_TYPE: m.kind, REPAIR_HOURS: m.hours, FAILURE_CAUSE: m.cause }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_SUPPLIER_DELIVERY', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 9, comment: 'Inbound delivery fact at receipt grain',
      columns: [
        col('RECEIPT_KEY', 'NUMBER', 'Receipt'), col('SUPPLIER_KEY', 'NUMBER', 'Supplier'), col('DATE_KEY', 'NUMBER(8)', 'Receipt date'), col('PLANT_CODE', 'VARCHAR(3)', 'Receiving plant'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }),
        col('QTY_RECEIVED', 'NUMBER(8)', 'Received', { termId: 'T-022' }), col('QTY_REJECTED', 'NUMBER(6)', 'Rejected at incoming inspection', { termId: 'T-022', tags: ['CDE'] }),
        col('OTIF_FLAG', 'BOOLEAN', 'On time in full', { termId: 'T-021', tags: ['CDE'] }), col('LEAD_TIME_DAYS', 'NUMBER(4)', 'PO to receipt days', { termId: 'T-023' }),
      ],
      rowCount: 798_116, bytes: 3.6e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 03:50:00', upstream: ['CURATED_SILVER.SUPPLIER_RECEIPT', 'CONFORMED_GOLD.DIM_SUPPLIER'], rowAccess: buAccess,
      rows: memo(() => d.receipts.slice().reverse().map((r) => ({ RECEIPT_KEY: r.key, SUPPLIER_KEY: r.supplierKey, DATE_KEY: dateKey(r.received), PLANT_CODE: r.plantCode, BUSINESS_UNIT: r.bu, QTY_RECEIVED: r.qty, QTY_REJECTED: r.rejected, OTIF_FLAG: r.otif, LEAD_TIME_DAYS: r.leadDays }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_ORDER', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 10, comment: 'Customer order-to-delivery fact at order-line grain',
      columns: [
        col('ORDER_LINE_KEY', 'NUMBER', 'Order line'), col('ORDER_NO', 'VARCHAR(12)', 'Sales order', { termId: 'T-030' }), col('DATE_KEY', 'NUMBER(8)', 'Delivery date'),
        col('CUSTOMER_NAME', 'VARCHAR(60)', 'Sold-to customer'), col('CUSTOMER_CONTACT', 'VARCHAR(120)', 'Customer order contact email', { tags: ['PII'], maskPendingFix: GATE6_CHECK }),
        col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }), col('PRODUCT_FAMILY', 'VARCHAR(30)', 'Product family'),
        col('QTY_ORDERED', 'NUMBER(10)', 'Ordered'), col('QTY_SHIPPED', 'NUMBER(10)', 'Shipped', { termId: 'T-025' }),
        col('ON_TIME_FLAG', 'BOOLEAN', 'Delivered on or before the promised date', { termId: 'T-024', tags: ['CDE'] }), col('IN_FULL_FLAG', 'BOOLEAN', 'Shipped complete', { termId: 'T-025', tags: ['CDE'] }),
        col('LEAD_TIME_DAYS', 'NUMBER(4)', 'Order to delivery days', { termId: 'T-026' }), col('NET_VALUE_USD', 'NUMBER(14,2)', 'Net value'), col('STD_UNIT_COST', 'NUMBER(12,2)', 'Standard unit cost', { tags: ['TRADE_SECRET'] }),
      ],
      rowCount: 2_381_904, bytes: 1.9e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:02:00', upstream: ['CURATED_SILVER.SALES_ORDER_LINE', 'CONFORMED_GOLD.DIM_DATE'], rowAccess: buAccess,
      rows: memo(() => d.orders.slice().reverse().map((o) => ({
        ORDER_LINE_KEY: o.key, ORDER_NO: o.orderNo, DATE_KEY: o.delivered ? dateKey(o.delivered) : null, CUSTOMER_NAME: o.customer, CUSTOMER_CONTACT: o.contactEmail, BUSINESS_UNIT: o.bu, PRODUCT_FAMILY: o.family,
        QTY_ORDERED: o.qty, QTY_SHIPPED: o.shippedQty, ON_TIME_FLAG: o.onTime, IN_FULL_FLAG: o.status === 'Delivered' ? o.inFull : null, LEAD_TIME_DAYS: o.leadDays, NET_VALUE_USD: o.value, STD_UNIT_COST: o.unitCost,
      }))),
    },
  ];

  const products: SfObject[] = [
    {
      schema: 'DATA_PRODUCTS', name: 'DP_PRODUCTION_OEE', layer: 'product', type: 'SECURE VIEW', order: 3, comment: 'Output port of Production & OEE',
      columns: [
        col('PRODUCTION_DATE', 'DATE', 'Shift date'), col('SHIFT_NO', 'NUMBER(1)', 'Shift'), col('LINE_ID', 'VARCHAR(8)', 'Line'), col('PLANT_NAME', 'VARCHAR(30)', 'Plant'),
        col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003', tags: ['CDE'] }), col('SHIFT_LEAD_ID', 'VARCHAR(8)', 'Shift lead badge', { termId: 'T-001' }), col('SHIFT_LEAD_NAME', 'VARCHAR(80)', 'Shift lead name', { tags: ['PII'] }),
        col('PLANNED_PRODUCTION_MIN', 'NUMBER(4)', 'Planned production time', { termId: 'T-005', tags: ['CDE'] }), col('UNPLANNED_DOWNTIME_MIN', 'NUMBER(4)', 'Unplanned downtime', { termId: 'T-009', tags: ['CDE'] }),
        col('GOOD_UNITS', 'NUMBER(8)', 'Good units', { termId: 'T-010' }), col('AVAILABILITY_PCT', 'NUMBER(5,1)', 'Availability', { termId: 'T-005' }), col('PERFORMANCE_PCT', 'NUMBER(5,1)', 'Performance', { termId: 'T-006' }),
        col('QUALITY_PCT', 'NUMBER(5,1)', 'Quality rate', { termId: 'T-007' }), col('OEE_PCT', 'NUMBER(5,1)', 'OEE (rule BR-001)', { termId: 'T-004', tags: ['CDE'] }), col('TOP_LOSS_REASON', 'VARCHAR(24)', 'Largest unplanned loss'),
      ],
      rowCount: 4_791_552, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:25:00', upstream: ['CONFORMED_GOLD.FCT_LINE_PRODUCTION', 'CONFORMED_GOLD.DIM_LINE', 'CONFORMED_GOLD.DIM_OPERATOR'], rowAccess: buAccess,
      rows: memo(() => d.production.slice().reverse().map((p) => {
        const o = opByKey.get(p.leadKey)!;
        const a = p.runMin / p.plannedMin;
        const pf = p.runMin ? p.idealMin / p.runMin : 0;
        const q = p.total ? p.good / p.total : 0;
        return {
          PRODUCTION_DATE: p.date, SHIFT_NO: p.shift, LINE_ID: p.lineId, PLANT_NAME: p.plantName, BUSINESS_UNIT: p.bu, SHIFT_LEAD_ID: o.id, SHIFT_LEAD_NAME: `${o.first} ${o.last}`,
          PLANNED_PRODUCTION_MIN: p.plannedMin, UNPLANNED_DOWNTIME_MIN: p.unplannedMin, GOOD_UNITS: p.good, AVAILABILITY_PCT: round(a * 100, 1), PERFORMANCE_PCT: round(pf * 100, 1),
          QUALITY_PCT: round(q * 100, 1), OEE_PCT: round(a * pf * q * 100, 1), TOP_LOSS_REASON: p.unplannedMin ? p.topReason : null,
        };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_QUALITY_DEFECTS', layer: 'product', type: 'SECURE VIEW', order: 4, comment: 'Output port of Quality & Defects',
      columns: [
        col('LOT_ID', 'VARCHAR(24)', 'Inspection lot'), col('INSPECTION_DATE', 'DATE', 'Date'), col('LINE_ID', 'VARCHAR(8)', 'Line'), col('PLANT_CODE', 'VARCHAR(3)', 'Plant'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003', tags: ['CDE'] }),
        col('PRODUCT_FAMILY', 'VARCHAR(30)', 'Product family'), col('INSPECTED_QTY', 'NUMBER(6)', 'Sample size', { termId: 'T-014' }), col('DEFECT_QTY', 'NUMBER(6)', 'Defects', { termId: 'T-014' }),
        col('PASSED_FIRST_FLAG', 'BOOLEAN', 'First-pass accepted', { termId: 'T-011', tags: ['CDE'] }), col('DEFECT_CODE', 'VARCHAR(30)', 'Defect code'), col('DISPOSITION', 'VARCHAR(10)', 'Usage decision'),
        col('NCR_NUMBER', 'VARCHAR(14)', 'NCR', { termId: 'T-016' }), col('COPQ_USD', 'NUMBER(12,2)', 'Cost of poor quality', { termId: 'T-015', tags: ['CDE'] }),
      ],
      rowCount: 1_270_118, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:40:00', upstream: ['CONFORMED_GOLD.FCT_QUALITY_INSPECTION', 'CONFORMED_GOLD.DIM_LINE'], rowAccess: buAccess,
      rows: memo(() => d.lots.slice().reverse().map((l) => ({ LOT_ID: l.lotId, INSPECTION_DATE: l.date, LINE_ID: l.lineId, PLANT_CODE: l.plantCode, BUSINESS_UNIT: l.bu, PRODUCT_FAMILY: l.family, INSPECTED_QTY: l.inspected, DEFECT_QTY: l.defects, PASSED_FIRST_FLAG: l.passedFirst, DEFECT_CODE: l.defectCode, DISPOSITION: l.disposition, NCR_NUMBER: l.ncr, COPQ_USD: l.copq }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_ASSET_MAINTENANCE', layer: 'product', type: 'SECURE VIEW', order: 5, comment: 'Output port of Asset Maintenance',
      columns: [
        col('WO_NUMBER', 'VARCHAR(12)', 'Work order'), col('EVENT_DATE', 'DATE', 'Date'), col('ASSET_ID', 'VARCHAR(14)', 'Asset'), col('ASSET_TYPE', 'VARCHAR(24)', 'Equipment type'), col('CRITICALITY', 'VARCHAR(1)', 'Criticality', { termId: 'T-020' }),
        col('LINE_ID', 'VARCHAR(8)', 'Line'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003', tags: ['CDE'] }), col('WO_TYPE', 'VARCHAR(12)', 'Corrective / Preventive', { termId: 'T-019', tags: ['CDE'] }),
        col('REPAIR_HOURS', 'NUMBER(6,2)', 'Repair or service hours', { termId: 'T-018', tags: ['CDE'] }), col('FAILURE_CAUSE', 'VARCHAR(30)', 'Cause'),
      ],
      rowCount: 1_204_330, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:10:00', upstream: ['CONFORMED_GOLD.FCT_MAINTENANCE_EVENT', 'CONFORMED_GOLD.DIM_ASSET'], rowAccess: buAccess,
      rows: memo(() => d.maint.slice().reverse().map((m) => { const a = assetByKey.get(m.assetKey)!; return { WO_NUMBER: m.wo, EVENT_DATE: m.date, ASSET_ID: m.assetId, ASSET_TYPE: a.type, CRITICALITY: a.criticality, LINE_ID: m.lineId, BUSINESS_UNIT: m.bu, WO_TYPE: m.kind, REPAIR_HOURS: m.hours, FAILURE_CAUSE: m.cause }; })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_SUPPLIER_PERFORMANCE', layer: 'product', type: 'SECURE VIEW', order: 6, comment: 'Output port of Supplier Performance',
      columns: [
        col('ASN_NUMBER', 'VARCHAR(12)', 'ASN'), col('SUPPLIER_NAME', 'VARCHAR(60)', 'Supplier'), col('CATEGORY', 'VARCHAR(30)', 'Commodity'), col('PLANT_CODE', 'VARCHAR(3)', 'Plant'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }),
        col('PROMISED_DATE', 'DATE', 'Promised'), col('RECEIVED_DATE', 'DATE', 'Received'), col('QTY_RECEIVED', 'NUMBER(8)', 'Received'), col('QTY_REJECTED', 'NUMBER(6)', 'Rejected', { termId: 'T-022', tags: ['CDE'] }),
        col('OTIF_FLAG', 'BOOLEAN', 'On time in full', { termId: 'T-021', tags: ['CDE'] }), col('LEAD_TIME_DAYS', 'NUMBER(4)', 'Lead time', { termId: 'T-023' }),
      ],
      rowCount: 798_116, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 04:00:00', upstream: ['CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY', 'CONFORMED_GOLD.DIM_SUPPLIER'], rowAccess: buAccess,
      rows: memo(() => d.receipts.slice().reverse().map((r) => ({ ASN_NUMBER: r.asn, SUPPLIER_NAME: r.supplier, CATEGORY: r.category, PLANT_CODE: r.plantCode, BUSINESS_UNIT: r.bu, PROMISED_DATE: r.promised, RECEIVED_DATE: r.received, QTY_RECEIVED: r.qty, QTY_REJECTED: r.rejected, OTIF_FLAG: r.otif, LEAD_TIME_DAYS: r.leadDays }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_ORDER_TO_DELIVERY', layer: 'product', type: 'SECURE VIEW', order: 7, comment: 'Output port of Order to Delivery (in certification)',
      columns: [
        col('ORDER_NO', 'VARCHAR(12)', 'Sales order', { termId: 'T-030' }), col('CUSTOMER_NAME', 'VARCHAR(60)', 'Customer'), col('CUSTOMER_CONTACT', 'VARCHAR(120)', 'Customer order contact email (from FCT_ORDER)', { tags: ['PII'], maskPendingFix: GATE6_CHECK }),
        col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }), col('PRODUCT_FAMILY', 'VARCHAR(30)', 'Product family'), col('ORDER_DATE', 'DATE', 'Ordered'), col('PROMISED_DATE', 'DATE', 'Promised'), col('DELIVERED_DATE', 'DATE', 'Delivered'),
        col('QTY_ORDERED', 'NUMBER(10)', 'Ordered'), col('QTY_SHIPPED', 'NUMBER(10)', 'Shipped'), col('ON_TIME_FLAG', 'BOOLEAN', 'On time', { termId: 'T-024', tags: ['CDE'] }), col('IN_FULL_FLAG', 'BOOLEAN', 'In full', { termId: 'T-025', tags: ['CDE'] }),
        col('LEAD_TIME_DAYS', 'NUMBER(4)', 'Order lead time', { termId: 'T-026' }), col('NET_VALUE_USD', 'NUMBER(14,2)', 'Net value'),
      ],
      rowCount: 2_381_904, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:05:00', upstream: ['CONFORMED_GOLD.FCT_ORDER', 'CONFORMED_GOLD.DIM_DATE'], rowAccess: buAccess,
      rows: memo(() => d.orders.slice().reverse().map((o) => ({
        ORDER_NO: o.orderNo, CUSTOMER_NAME: o.customer, CUSTOMER_CONTACT: o.contactEmail, BUSINESS_UNIT: o.bu, PRODUCT_FAMILY: o.family, ORDER_DATE: o.orderDate, PROMISED_DATE: o.promised, DELIVERED_DATE: o.delivered,
        QTY_ORDERED: o.qty, QTY_SHIPPED: o.shippedQty, ON_TIME_FLAG: o.onTime, IN_FULL_FLAG: o.status === 'Delivered' ? o.inFull : null, LEAD_TIME_DAYS: o.leadDays, NET_VALUE_USD: o.value,
      }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_ENERGY_EMISSIONS', layer: 'product', type: 'SECURE VIEW', order: 8, comment: 'Output port of Energy & Emissions (draft)',
      columns: [
        col('ENERGY_DATE', 'DATE', 'Date'), col('LINE_ID', 'VARCHAR(8)', 'Line'), col('PLANT_CODE', 'VARCHAR(3)', 'Plant'), col('BUSINESS_UNIT', 'VARCHAR(30)', 'Business unit', { termId: 'T-003' }),
        col('ENERGY_KWH', 'NUMBER(10,1)', 'Metered energy'), col('GOOD_UNITS', 'NUMBER(8)', 'Good units', { termId: 'T-010' }), col('KWH_PER_UNIT', 'NUMBER(8,3)', 'Energy per good unit', { termId: 'T-027', tags: ['CDE'] }),
        col('EMISSION_FACTOR', 'NUMBER(5,3)', 'Grid emission factor kg CO2e/kWh (location-based)'), col('CO2E_KG', 'NUMBER(12,1)', 'Scope 2 emissions kg CO2e', { termId: 'T-028', tags: ['CDE'] }),
      ],
      rowCount: 1_802_640, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-29 02:00:00', upstream: ['CONFORMED_GOLD.FCT_LINE_PRODUCTION', 'CONFORMED_GOLD.DIM_LINE'], rowAccess: buAccess,
      rows: memo(() => {
        const m = new Map<string, { date: string; line: string; plant: string; bu: string; kwh: number; good: number }>();
        const since = addDays(AS_OF, -13);
        for (const p of d.production) {
          if (p.date < since) continue;
          const k = `${p.date}|${p.lineId}`;
          const cur = m.get(k) ?? { date: p.date, line: p.lineId, plant: p.plantCode, bu: p.bu, kwh: 0, good: 0 };
          cur.kwh += p.energyKwh;
          cur.good += p.good;
          m.set(k, cur);
        }
        return [...m.values()].sort((a, b) => (a.date === b.date ? a.line.localeCompare(b.line) : a.date < b.date ? 1 : -1)).map((x) => ({
          ENERGY_DATE: x.date, LINE_ID: x.line, PLANT_CODE: x.plant, BUSINESS_UNIT: x.bu, ENERGY_KWH: round(x.kwh, 1), GOOD_UNITS: x.good, KWH_PER_UNIT: round(x.kwh / Math.max(1, x.good), 3),
          EMISSION_FACTOR: efByPlant.get(x.plant)!, CO2E_KG: round(x.kwh * efByPlant.get(x.plant)!, 1),
        }));
      }),
    },
  ];

  return [...bronze, ...silver, ...gold, ...products];
}
