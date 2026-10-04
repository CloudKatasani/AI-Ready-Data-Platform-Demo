// Bronze / Silver / Gold objects and product output ports for NVE_AI_PLATFORM (spec section 5).
import type { Column, ColumnTag, Row, SfObject } from '../../types';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, noisy, pad, round, ts } from '../../mock-snowflake/generators';
import type { UtilData } from './data';
import { AS_OF, STATE_TO_OPCO } from './generators.config';
import { latestBills } from './queries';

export const GATE6_CHECK = 'G6-MASK';

const col = (name: string, type: string, comment: string, opts: { tags?: ColumnTag[]; termId?: string; nullable?: boolean; maskPendingFix?: string } = {}): Column => ({
  name, type, comment, nullable: opts.nullable ?? true, tags: opts.tags, termId: opts.termId, maskPendingFix: opts.maskPendingFix,
});
const memo = <T,>(f: () => T) => {
  let v: T | undefined;
  return () => (v ??= f());
};
const dateKey = (d: string) => Number(d.replace(/-/g, ''));
const cdc = [col('OP_TYPE', 'VARCHAR(1)', 'CDC operation: I insert, U update, D delete'), col('OP_TS', 'TIMESTAMP_NTZ', 'GoldenGate commit timestamp')];
const opcoAccess = { column: 'OPCO' };
const stateAccess = (c: string) => ({ column: c, map: STATE_TO_OPCO });

/** Bronze rows with visible CDC noise: ~4% U duplicates, ~1% D, mixed case, untrimmed strings. */
function withCdc<T>(rng: Rng, items: T[], toRow: (x: T, noise: boolean) => Row, baseTs: string, visible: (x: T) => boolean = () => true): Row[] {
  const out: Row[] = [];
  // Force one update duplicate and one delete into the first rows every persona can see, so the preview shows CDC noise.
  const vis = items.map((x, i) => (visible(x) ? i : -1)).filter((i) => i >= 0);
  const forced = [vis[1] ?? 1, vis[4] ?? 4];
  items.forEach((x, i) => {
    const t0 = ts(addDays(baseTs, Math.floor(i / 40)), 300 + ((i * 17) % 900));
    out.push({ ...toRow(x, true), OP_TYPE: 'I', OP_TS: t0 });
    if (i === forced[0] || rng.chance(0.04)) out.push({ ...toRow(x, true), OP_TYPE: 'U', OP_TS: ts(addDays(baseTs, Math.floor(i / 40)), 300 + ((i * 17) % 900) + 41) });
    if (i === forced[1] || rng.chance(0.01)) out.push({ ...toRow(x, true), OP_TYPE: 'D', OP_TS: ts(addDays(baseTs, Math.floor(i / 40) + 1), 120) });
  });
  return out;
}

export function buildCatalog(d: UtilData, seed: number): SfObject[] {
  const rng = new Rng(seed + 7);
  const custSample = d.customers.slice(0, 400);
  const latest = memo(() => latestBills(d));
  const circuitByKey = new Map(d.circuits.map((c) => [c.key, c]));
  const custByKey = new Map(d.customers.map((c) => [c.key, c]));
  const supplierByKey = new Map(d.suppliers.map((s) => [s.key, s]));

  const bronze: SfObject[] = [
    {
      schema: 'RAW_BRONZE', name: 'CIS_CUSTOMER_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 1,
      comment: 'Customer master CDC from DB2 CIS via Oracle GoldenGate, landed as Apache Iceberg on S3',
      columns: [
        col('CUST_NO', 'VARCHAR(10)', 'DB2 customer number (zero padded)', { nullable: false }),
        col('NM_FIRST', 'VARCHAR(40)', 'First name (raw)', { tags: ['PII'] }), col('NM_LAST', 'VARCHAR(40)', 'Last name (raw)', { tags: ['PII'] }),
        col('EMAIL_ADDR', 'VARCHAR(120)', 'Email (raw)', { tags: ['PII'] }), col('ADDR_LN1', 'VARCHAR(80)', 'Street address', { tags: ['PII'] }),
        col('CITY', 'VARCHAR(40)', 'Service city'), col('ST', 'VARCHAR(2)', 'State'), col('RATE_CD', 'VARCHAR(8)', 'Tariff rate code'),
        col('STAT_CD', 'VARCHAR(2)', 'Status code (A active, I inactive)'), ...cdc,
      ],
      rowCount: 48_211_604, bytes: 6.1e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:14:22', upstream: ['ext:DB2 CIS'],
      rowAccess: stateAccess('ST'),
      rows: memo(() => withCdc(rng, custSample, (c) => ({
        CUST_NO: rng.chance(0.3) ? `${c.custNo}  ` : c.custNo, NM_FIRST: noisy(rng, c.first), NM_LAST: noisy(rng, c.last),
        EMAIL_ADDR: rng.chance(0.3) ? c.email.toUpperCase() : c.email, ADDR_LN1: noisy(rng, c.street.toUpperCase()), CITY: noisy(rng, c.city),
        ST: c.state, RATE_CD: c.rateClass.replace('-', ''), STAT_CD: c.status === 'Active' ? 'A' : 'I',
      }), '2026-09-01', (c) => c.state === 'OH' || c.state === 'IN')),
    },
    {
      schema: 'RAW_BRONZE', name: 'CIS_CUSTOMER_CDC_STRM', layer: 'bronze', type: 'STREAM', order: 2,
      comment: 'Append-only stream feeding CURATED_SILVER.CUSTOMER', columns: [], rowCount: 1_204, owner: 'INGEST_ADMIN',
      lastAltered: '2026-09-30 06:15:00', upstream: ['RAW_BRONZE.CIS_CUSTOMER_CDC'],
    },
    {
      schema: 'RAW_BRONZE', name: 'AMI_READ_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 3,
      comment: 'Interval reads from the AMI head-end (15-minute kWh)',
      columns: [col('METER_ID', 'VARCHAR(12)', 'Meter id'), col('READ_TS', 'TIMESTAMP_NTZ', 'Interval end'), col('KWH_VAL', 'NUMBER(10,3)', 'Interval kWh'), col('QUAL_FLG', 'VARCHAR(2)', 'Quality flag (V valid, E estimated, M missing)'), ...cdc],
      rowCount: 52_415_880_112, bytes: 3.2e12, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:15:00', upstream: ['ext:AMI head-end'],
      rows: memo(() => withCdc(rng, Array.from({ length: 120 }, (_, i) => i), (i) => {
        const c = d.customers[i % 10];
        const v = d.usage[(i % 10) * 30 + 29].kwh / 96;
        return { METER_ID: c.meterId, READ_TS: ts(AS_OF, (Math.floor(i / 10) + 1) * 15), KWH_VAL: round(v * rng.range(0.5, 1.6), 3), QUAL_FLG: rng.chance(0.04) ? 'E' : 'V' };
      }, AS_OF)),
    },
    {
      schema: 'RAW_BRONZE', name: 'BILL_HDR_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 4,
      comment: 'Bill header CDC from DB2 billing',
      columns: [col('BILL_ID', 'VARCHAR(20)', 'Bill id'), col('CUST_NO', 'VARCHAR(10)', 'Customer number'), col('BILL_DT', 'DATE', 'Bill date'), col('AMT_DUE', 'NUMBER(12,2)', 'Amount due'), col('EST_FLG', 'VARCHAR(1)', 'Estimated bill (Y/N)'), col('PAPERLESS_IND', 'VARCHAR(1)', 'Paperless (Y/N)'), ...cdc],
      rowCount: 214_880_316, bytes: 1.9e10, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:58:10', upstream: ['ext:DB2 billing'],
      rows: memo(() => withCdc(rng, d.bills.filter((b) => b.month === '2026-09').slice(0, 300), (b) => ({
        BILL_ID: b.id, CUST_NO: pad(b.customerId, 10), BILL_DT: b.date, AMT_DUE: round(b.billed + b.arrears, 2), EST_FLG: b.estimated ? 'Y' : 'N', PAPERLESS_IND: b.paperless ? 'Y' : 'N',
      }), '2026-09-01')),
    },
    {
      schema: 'RAW_BRONZE', name: 'OMS_EVENT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 5,
      comment: 'Outage events from OMS / ADMS',
      columns: [col('EVT_ID', 'VARCHAR(20)', 'Event id'), col('CKT_ID', 'VARCHAR(12)', 'Circuit id'), col('START_TS', 'TIMESTAMP_NTZ', 'Outage start'), col('END_TS', 'TIMESTAMP_NTZ', 'Restoration'), col('CUST_OUT', 'NUMBER', 'Customers out'), col('CAUSE_CD', 'VARCHAR(6)', 'Cause code'), ...cdc],
      rowCount: 1_904_221, bytes: 2.4e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:10:41', upstream: ['ext:OMS / ADMS'],
      rows: memo(() => withCdc(rng, d.outages.slice(-300).reverse(), (o) => ({
        EVT_ID: o.id, CKT_ID: o.circuitId, START_TS: ts(o.date, o.startMin), END_TS: ts(addDays(o.date, Math.floor((o.startMin + o.duration) / 1440)), (o.startMin + o.duration) % 1440),
        CUST_OUT: o.ci, CAUSE_CD: { 'Tree contact': 'TREE', 'Equipment failure': 'EQUIP', Animal: 'ANML', 'Weather – wind': 'WIND', Lightning: 'LTNG', 'Vehicle accident': 'VEH', Unknown: 'UNK' }[o.cause] ?? 'UNK',
      }), '2026-09-20')),
    },
    {
      schema: 'RAW_BRONZE', name: 'PO_LINE_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 6,
      comment: 'Purchase order lines from ERP procurement',
      columns: [col('PO_NO', 'VARCHAR(10)', 'PO number'), col('LINE_NO', 'NUMBER', 'Line'), col('VENDOR_ID', 'VARCHAR(8)', 'Vendor id'), col('MATL_GRP', 'VARCHAR(10)', 'Material group'), col('AMT', 'NUMBER(14,2)', 'Line amount'), col('CONTRACT_REF', 'VARCHAR(12)', 'Outline agreement'), col('PROM_DT', 'DATE', 'Promised date'), col('RCV_DT', 'DATE', 'Goods receipt date'), ...cdc],
      rowCount: 3_412_908, bytes: 4.1e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 04:30:00', upstream: ['ext:ERP procurement'],
      rows: memo(() => withCdc(rng, d.poLines.slice(-300).reverse(), (l) => ({
        PO_NO: l.po, LINE_NO: l.line, VENDOR_ID: `V${pad(10040 + l.supplierKey * 13, 6)}`, MATL_GRP: l.category.slice(0, 4).toUpperCase(), AMT: l.spend,
        CONTRACT_REF: l.onContract ? `OA-${pad(4600 + l.supplierKey * 7, 6)}` : null, PROM_DT: l.promised, RCV_DT: l.received,
      }), '2026-09-15')),
    },
    {
      schema: 'RAW_BRONZE', name: 'VEG_INSPECTION_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 7,
      comment: 'Span inspections from the vegetation management system',
      columns: [col('SPAN_ID', 'VARCHAR(20)', 'Span id'), col('CKT_ID', 'VARCHAR(12)', 'Circuit'), col('INSP_DT', 'DATE', 'Inspection date'), col('CLEARANCE_FT', 'NUMBER(5,1)', 'Measured clearance (ft)'), col('LAST_TRIM_DT', 'DATE', 'Last trim date'), ...cdc],
      rowCount: 412_660, bytes: 3.8e7, owner: 'INGEST_ADMIN', lastAltered: '2026-09-28 18:00:00', upstream: ['ext:Vegetation mgmt system'],
      rows: memo(() => withCdc(rng, d.spans.slice(0, 200), (s) => ({ SPAN_ID: noisy(rng, s.id), CKT_ID: s.circuitId, INSP_DT: addDays(AS_OF, -((s.id.length * 7) % 90)), CLEARANCE_FT: s.clearanceFt, LAST_TRIM_DT: s.lastTrim }), '2026-07-01')),
    },
  ];

  const silver: SfObject[] = [
    {
      schema: 'CURATED_SILVER', name: 'CUSTOMER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 1,
      comment: 'Deduplicated SCD2 customer entity',
      columns: [
        col('CUSTOMER_ID', 'NUMBER(10)', 'Customer identifier (from CUST_NO)', { nullable: false, termId: 'T-001', tags: ['CDE'] }),
        col('FIRST_NAME', 'VARCHAR(40)', 'First name', { tags: ['PII'] }), col('LAST_NAME', 'VARCHAR(40)', 'Last name', { tags: ['PII'] }),
        col('EMAIL', 'VARCHAR(120)', 'Email (lowercased)', { tags: ['PII'] }), col('SERVICE_CITY', 'VARCHAR(40)', 'Service city'),
        col('STATE', 'VARCHAR(2)', 'State'), col('RATE_CLASS', 'VARCHAR(8)', 'Rate class', { termId: 'T-012', tags: ['CDE'] }),
        col('CUSTOMER_STATUS', 'VARCHAR(10)', 'Active / Inactive', { termId: 'T-002' }), col('EFFECTIVE_FROM', 'DATE', 'SCD2 valid from'),
        col('EFFECTIVE_TO', 'DATE', 'SCD2 valid to'), col('IS_CURRENT', 'BOOLEAN', 'Current version flag'),
      ],
      rowCount: 1_512_448, bytes: 2.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:29:40', upstream: ['RAW_BRONZE.CIS_CUSTOMER_CDC_STRM'],
      rowAccess: stateAccess('STATE'),
      rows: memo(() => custSample.flatMap((c) => {
        const cur = { CUSTOMER_ID: c.id, FIRST_NAME: c.first, LAST_NAME: c.last, EMAIL: c.email, SERVICE_CITY: c.city, STATE: c.state, RATE_CLASS: c.rateClass, CUSTOMER_STATUS: c.status };
        return c.priorRateClass
          ? [{ ...cur, RATE_CLASS: c.priorRateClass, EFFECTIVE_FROM: '2019-04-01', EFFECTIVE_TO: addDays(c.changedOn!, -1), IS_CURRENT: false }, { ...cur, EFFECTIVE_FROM: c.changedOn!, EFFECTIVE_TO: null, IS_CURRENT: true }]
          : [{ ...cur, EFFECTIVE_FROM: c.effectiveFrom, EFFECTIVE_TO: null, IS_CURRENT: true }];
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'METER_READ_15MIN', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 2,
      comment: 'Validated 15-minute interval reads',
      columns: [col('METER_ID', 'VARCHAR(12)', 'Meter id'), col('PREMISE_ID', 'VARCHAR(12)', 'Premise id'), col('INTERVAL_START', 'TIMESTAMP_NTZ', 'Interval start'), col('KWH', 'NUMBER(10,3)', 'Interval kWh'), col('READ_QUALITY', 'VARCHAR(10)', 'VALID / ESTIMATED', { termId: 'T-013' })],
      rowCount: 48_602_115_904, bytes: 1.1e12, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:30:02', upstream: ['RAW_BRONZE.AMI_READ_CDC'],
      rows: memo(() => Array.from({ length: 200 }, (_, i) => {
        const c = d.customers[i % 10];
        const daily = d.usage[(i % 10) * 30 + 29].kwh;
        const k = Math.floor(i / 10);
        const shape = 0.6 + 0.8 * Math.sin((Math.PI * (k + 24)) / 96) ** 2;
        return { METER_ID: c.meterId, PREMISE_ID: c.premiseId, INTERVAL_START: ts(AS_OF, k * 15), KWH: round((daily / 96) * shape, 3), READ_QUALITY: (i * 7) % 61 === 0 ? 'ESTIMATED' : 'VALID' };
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'BILLING_STATEMENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 3,
      comment: 'Typed billing statements',
      columns: [col('STATEMENT_ID', 'VARCHAR(20)', 'Statement id'), col('CUSTOMER_ID', 'NUMBER(10)', 'Customer', { termId: 'T-001' }), col('STATEMENT_DATE', 'DATE', 'Statement date'), col('AMOUNT_DUE_USD', 'NUMBER(12,2)', 'Amount billed this period', { termId: 'T-009' }), col('IS_ESTIMATED', 'BOOLEAN', 'Estimated bill', { termId: 'T-021' }), col('PAPERLESS_FLAG', 'BOOLEAN', 'Paperless', { termId: 'T-011' })],
      rowCount: 199_204_880, bytes: 1.2e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:01:13', upstream: ['RAW_BRONZE.BILL_HDR_CDC'],
      rows: memo(() => d.bills.filter((b) => b.month === '2026-09').slice(0, 300).map((b) => ({ STATEMENT_ID: b.id, CUSTOMER_ID: b.customerId, STATEMENT_DATE: b.date, AMOUNT_DUE_USD: b.billed, IS_ESTIMATED: b.estimated, PAPERLESS_FLAG: b.paperless }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'OUTAGE_EVENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 4,
      comment: 'Cleansed outage events with durations and MED flag',
      columns: [col('OUTAGE_ID', 'VARCHAR(20)', 'Outage id'), col('CIRCUIT_ID', 'VARCHAR(12)', 'Circuit'), col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003' }), col('START_TS', 'TIMESTAMP_NTZ', 'Start'), col('RESTORE_TS', 'TIMESTAMP_NTZ', 'Restored'), col('DURATION_MIN', 'NUMBER(8)', 'Duration minutes'), col('CUSTOMERS_INTERRUPTED', 'NUMBER(8)', 'Customers interrupted', { termId: 'T-005' }), col('CAUSE', 'VARCHAR(30)', 'Cause'), col('IS_MAJOR_EVENT_DAY', 'BOOLEAN', 'Occurred on a major event day', { termId: 'T-007' })],
      rowCount: 1_812_006, bytes: 1.9e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:12:55', upstream: ['RAW_BRONZE.OMS_EVENT_CDC'],
      rowAccess: opcoAccess,
      rows: memo(() => d.outages.slice().reverse().map((o) => ({
        OUTAGE_ID: o.id, CIRCUIT_ID: o.circuitId, OPCO: o.opco, START_TS: ts(o.date, o.startMin), RESTORE_TS: ts(addDays(o.date, Math.floor((o.startMin + o.duration) / 1440)), (o.startMin + o.duration) % 1440),
        DURATION_MIN: o.duration, CUSTOMERS_INTERRUPTED: o.ci, CAUSE: o.cause, IS_MAJOR_EVENT_DAY: o.med,
      }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'PURCHASE_ORDER_LINE', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 5,
      comment: 'Typed purchase order lines with contract flag',
      columns: [col('PO_NUMBER', 'VARCHAR(10)', 'PO number'), col('LINE_NUMBER', 'NUMBER', 'Line'), col('SUPPLIER_ID', 'NUMBER', 'Supplier'), col('CATEGORY', 'VARCHAR(30)', 'Spend category'), col('SPEND_USD', 'NUMBER(14,2)', 'Line spend'), col('ON_CONTRACT', 'BOOLEAN', 'Bought against a contract', { termId: 'T-015' }), col('PROMISED_DATE', 'DATE', 'Promised'), col('RECEIVED_DATE', 'DATE', 'Received')],
      rowCount: 3_380_114, bytes: 3.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 04:45:00', upstream: ['RAW_BRONZE.PO_LINE_CDC'],
      rows: memo(() => d.poLines.slice().reverse().map((l) => ({ PO_NUMBER: l.po, LINE_NUMBER: l.line, SUPPLIER_ID: l.supplierKey, CATEGORY: l.category, SPEND_USD: l.spend, ON_CONTRACT: l.onContract, PROMISED_DATE: l.promised, RECEIVED_DATE: l.received }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'VEGETATION_SPAN', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 day', order: 6,
      comment: 'Current vegetation state per span',
      columns: [col('SPAN_ID', 'VARCHAR(20)', 'Span id'), col('CIRCUIT_ID', 'VARCHAR(12)', 'Circuit'), col('LAST_TRIM_DATE', 'DATE', 'Last trim'), col('CYCLE_YEARS', 'NUMBER(2)', 'Trim cycle (years)'), col('CLEARANCE_FT', 'NUMBER(5,1)', 'Clearance ft'), col('IS_OVERDUE', 'BOOLEAN', 'Past its trim cycle', { termId: 'T-019' })],
      rowCount: 398_120, bytes: 2.2e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-29 01:00:00', upstream: ['RAW_BRONZE.VEG_INSPECTION_CDC'],
      rows: memo(() => d.spans.map((s) => ({ SPAN_ID: s.id, CIRCUIT_ID: s.circuitId, LAST_TRIM_DATE: s.lastTrim, CYCLE_YEARS: s.cycleYears, CLEARANCE_FT: s.clearanceFt, IS_OVERDUE: s.overdue }))),
    },
  ];

  const allDates: string[] = [];
  for (let x = '2025-01-01'; x <= AS_OF; x = addDays(x, 1)) allDates.push(x);
  const medSet = new Set(d.outages.filter((o) => o.med).map((o) => o.date));

  const gold: SfObject[] = [
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_CUSTOMER', layer: 'gold', type: 'TABLE', order: 1, comment: 'Conformed customer dimension (current)',
      columns: [
        col('CUSTOMER_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('CUSTOMER_ID', 'NUMBER(10)', 'Customer id', { termId: 'T-001', tags: ['CDE'] }),
        col('CUSTOMER_NAME', 'VARCHAR(80)', 'Customer name', { tags: ['PII'] }), col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003', tags: ['CDE'] }),
        col('REGION', 'VARCHAR(10)', 'Region'), col('RATE_CLASS', 'VARCHAR(8)', 'Rate class', { termId: 'T-012', tags: ['CDE'] }), col('SEGMENT', 'VARCHAR(30)', 'Customer segment'),
        col('DIGITAL_ENROLLED', 'BOOLEAN', 'Paperless / digital enrolled', { termId: 'T-011' }), col('CHURN_RISK_SCORE', 'NUMBER(3)', 'Model score 0–100', { termId: 'T-020' }),
      ],
      rowCount: 1_385_000, bytes: 1.4e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:31:00', upstream: ['CURATED_SILVER.CUSTOMER'], rowAccess: opcoAccess,
      rows: memo(() => d.customers.map((c) => ({ CUSTOMER_KEY: c.key, CUSTOMER_ID: c.id, CUSTOMER_NAME: `${c.first} ${c.last}`, OPCO: c.opco, REGION: c.region, RATE_CLASS: c.rateClass, SEGMENT: c.segment, DIGITAL_ENROLLED: c.paperless, CHURN_RISK_SCORE: c.churnRisk }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_PREMISE', layer: 'gold', type: 'TABLE', order: 2, comment: 'Service premise and meter',
      columns: [col('PREMISE_KEY', 'NUMBER', 'Surrogate key'), col('PREMISE_ID', 'VARCHAR(12)', 'Premise id'), col('METER_ID', 'VARCHAR(12)', 'Meter id'), col('CITY', 'VARCHAR(40)', 'City'), col('STATE', 'VARCHAR(2)', 'State'), col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003' }), col('CIRCUIT_ID', 'VARCHAR(12)', 'Feeding circuit')],
      rowCount: 1_391_208, bytes: 9.6e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:31:00', upstream: ['CURATED_SILVER.CUSTOMER', 'CURATED_SILVER.METER_READ_15MIN'], rowAccess: opcoAccess,
      rows: memo(() => d.customers.map((c) => ({ PREMISE_KEY: c.premiseKey, PREMISE_ID: c.premiseId, METER_ID: c.meterId, CITY: c.city, STATE: c.state, OPCO: c.opco, CIRCUIT_ID: c.circuitId }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_CIRCUIT', layer: 'gold', type: 'TABLE', order: 3, comment: 'Distribution circuits',
      columns: [col('CIRCUIT_KEY', 'NUMBER', 'Surrogate key'), col('CIRCUIT_ID', 'VARCHAR(12)', 'Circuit id'), col('SUBSTATION', 'VARCHAR(40)', 'Substation'), col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003', tags: ['CDE'] }), col('CUSTOMERS_SERVED', 'NUMBER', 'Customers served', { termId: 'T-004' }), col('VOLTAGE_KV', 'NUMBER(5,2)', 'Voltage kV')],
      rowCount: 120, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-01 02:00:00', upstream: ['CURATED_SILVER.OUTAGE_EVENT'], rowAccess: opcoAccess,
      rows: memo(() => d.circuits.map((c) => ({ CIRCUIT_KEY: c.key, CIRCUIT_ID: c.id, SUBSTATION: c.substation, OPCO: c.opco, CUSTOMERS_SERVED: c.served, VOLTAGE_KV: c.voltageKv }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_SUPPLIER', layer: 'gold', type: 'TABLE', order: 4, comment: 'Supplier dimension',
      columns: [col('SUPPLIER_KEY', 'NUMBER', 'Surrogate key'), col('SUPPLIER_NAME', 'VARCHAR(60)', 'Supplier'), col('CATEGORY', 'VARCHAR(30)', 'Primary category'), col('PREFERRED', 'BOOLEAN', 'Preferred supplier'), col('DIVERSITY_CERTIFIED', 'BOOLEAN', 'Diversity certified')],
      rowCount: 8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-08-15 02:00:00', upstream: ['CURATED_SILVER.PURCHASE_ORDER_LINE'],
      rows: memo(() => d.suppliers.map((s) => ({ SUPPLIER_KEY: s.key, SUPPLIER_NAME: s.name, CATEGORY: s.category, PREFERRED: s.preferred, DIVERSITY_CERTIFIED: s.diversity }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_DATE', layer: 'gold', type: 'TABLE', order: 5, comment: 'Calendar with fiscal periods and major event days',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'yyyymmdd'), col('CALENDAR_DATE', 'DATE', 'Date'), col('FISCAL_QUARTER', 'VARCHAR(7)', 'Fiscal quarter (FY = calendar year)'), col('FISCAL_YEAR', 'NUMBER(4)', 'Fiscal year'), col('IS_MAJOR_EVENT_DAY', 'BOOLEAN', 'IEEE 1366 major event day', { termId: 'T-007', tags: ['CDE'] })],
      rowCount: allDates.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:05:00', upstream: [],
      rows: memo(() => allDates.slice().reverse().map((x) => ({ DATE_KEY: dateKey(x), CALENDAR_DATE: x, FISCAL_QUARTER: `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`, FISCAL_YEAR: Number(x.slice(0, 4)), IS_MAJOR_EVENT_DAY: medSet.has(x) }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_DAILY_USAGE', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 6, comment: 'Daily consumption per premise',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'Date'), col('PREMISE_KEY', 'NUMBER', 'Premise'), col('CUSTOMER_KEY', 'NUMBER', 'Customer'), col('KWH', 'NUMBER(10,2)', 'Daily kWh'), col('PEAK_KW', 'NUMBER(8,2)', 'Daily peak demand kW', { termId: 'T-014' }), col('READ_SUCCESS_PCT', 'NUMBER(5,1)', 'Share of intervals read successfully', { termId: 'T-013', tags: ['CDE'] })],
      rowCount: 1_520_448_000, bytes: 4.6e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:33:12', upstream: ['CURATED_SILVER.METER_READ_15MIN', 'CONFORMED_GOLD.DIM_PREMISE'],
      rows: memo(() => d.usage.slice().reverse().map((u) => ({ DATE_KEY: dateKey(u.date), PREMISE_KEY: u.premiseKey, CUSTOMER_KEY: u.customerKey, KWH: u.kwh, PEAK_KW: u.peakKw, READ_SUCCESS_PCT: u.readSuccess }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_BILLING', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 7, comment: 'Billing and receivables fact',
      columns: [
        col('STATEMENT_KEY', 'NUMBER', 'Statement'), col('CUSTOMER_KEY', 'NUMBER', 'Customer'), col('DATE_KEY', 'NUMBER(8)', 'Statement date'),
        col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003' }),
        col('BILLED_AMOUNT', 'NUMBER(12,2)', 'Billed this period', { termId: 'T-009', tags: ['CDE'] }), col('ARREARS_AMOUNT', 'NUMBER(12,2)', 'Past-due balance', { termId: 'T-010', tags: ['CDE'] }),
        col('IS_ESTIMATED', 'BOOLEAN', 'Estimated bill', { termId: 'T-021' }), col('DAYS_TO_PAY', 'NUMBER(4)', 'Days from statement to payment', { termId: 'T-018', tags: ['CDE'] }),
        col('ACCOUNT_EMAIL', 'VARCHAR(120)', 'Billing contact email', { tags: ['PII'], maskPendingFix: GATE6_CHECK }),
      ],
      rowCount: 199_204_880, bytes: 9.8e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:05:44', upstream: ['CURATED_SILVER.BILLING_STATEMENT', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: opcoAccess,
      rows: memo(() => d.bills.slice().reverse().map((b) => ({ STATEMENT_KEY: b.key, CUSTOMER_KEY: b.customerKey, DATE_KEY: dateKey(b.date), OPCO: b.opco, BILLED_AMOUNT: b.billed, ARREARS_AMOUNT: b.arrears, IS_ESTIMATED: b.estimated, DAYS_TO_PAY: b.daysToPay, ACCOUNT_EMAIL: b.email }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_OUTAGE', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 8, comment: 'Outage fact at event grain',
      columns: [col('OUTAGE_KEY', 'NUMBER', 'Outage'), col('CIRCUIT_KEY', 'NUMBER', 'Circuit'), col('DATE_KEY', 'NUMBER(8)', 'Date'), col('CUSTOMER_MINUTES', 'NUMBER(12)', 'Customer minutes interrupted', { termId: 'T-008', tags: ['CDE'] }), col('CUSTOMERS_INTERRUPTED', 'NUMBER(8)', 'Customers interrupted', { termId: 'T-005', tags: ['CDE'] }), col('CAUSE', 'VARCHAR(30)', 'Cause'), col('MED_FLAG', 'BOOLEAN', 'Major event day', { termId: 'T-007', tags: ['CDE'] })],
      rowCount: 1_812_006, bytes: 1.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:13:30', upstream: ['CURATED_SILVER.OUTAGE_EVENT', 'CONFORMED_GOLD.DIM_CIRCUIT'],
      rows: memo(() => d.outages.slice().reverse().map((o) => ({ OUTAGE_KEY: o.key, CIRCUIT_KEY: o.circuitKey, DATE_KEY: dateKey(o.date), CUSTOMER_MINUTES: o.ci * o.duration, CUSTOMERS_INTERRUPTED: o.ci, CAUSE: o.cause, MED_FLAG: o.med }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_PO_SPEND', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 9, comment: 'Procurement spend fact at PO line grain',
      columns: [col('PO_LINE_KEY', 'NUMBER', 'PO line'), col('SUPPLIER_KEY', 'NUMBER', 'Supplier'), col('DATE_KEY', 'NUMBER(8)', 'PO date'), col('CATEGORY', 'VARCHAR(30)', 'Category'), col('SPEND_USD', 'NUMBER(14,2)', 'Spend', { tags: ['CDE'] }), col('ON_CONTRACT', 'BOOLEAN', 'On contract', { termId: 'T-015', tags: ['CDE'] }), col('OTIF_FLAG', 'BOOLEAN', 'On time in full', { termId: 'T-017', tags: ['CDE'] }), col('CYCLE_DAYS', 'NUMBER(4)', 'PO to receipt days', { termId: 'T-022' })],
      rowCount: 3_380_114, bytes: 2.0e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 04:50:00', upstream: ['CURATED_SILVER.PURCHASE_ORDER_LINE', 'CONFORMED_GOLD.DIM_SUPPLIER'],
      rows: memo(() => d.poLines.slice().reverse().map((l) => ({ PO_LINE_KEY: l.key, SUPPLIER_KEY: l.supplierKey, DATE_KEY: dateKey(l.date), CATEGORY: l.category, SPEND_USD: l.spend, ON_CONTRACT: l.onContract, OTIF_FLAG: l.otif, CYCLE_DAYS: l.cycleDays }))),
    },
  ];

  const usageAvg = memo(() => {
    const m = new Map<number, number>();
    for (const u of d.usage) m.set(u.customerKey, (m.get(u.customerKey) ?? 0) + u.kwh / 30);
    return m;
  });
  const billAvg = memo(() => {
    const m = new Map<number, number>();
    for (const b of d.bills) m.set(b.customerKey, (m.get(b.customerKey) ?? 0) + b.billed / 12);
    return m;
  });
  const treeByCircuit = memo(() => {
    const m = new Map<string, number>();
    for (const o of d.outages) if (o.cause === 'Tree contact' && o.date >= '2025-10-01') m.set(o.circuitId, (m.get(o.circuitId) ?? 0) + 1);
    return m;
  });

  const products: SfObject[] = [
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CUSTOMER_360', layer: 'product', type: 'SECURE VIEW', order: 3, comment: 'Output port of Customer 360',
      columns: [
        col('CUSTOMER_ID', 'NUMBER(10)', 'Customer id', { termId: 'T-001', tags: ['CDE'] }), col('CUSTOMER_NAME', 'VARCHAR(80)', 'Customer name', { tags: ['PII'] }),
        col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003', tags: ['CDE'] }), col('REGION', 'VARCHAR(10)', 'Region'), col('RATE_CLASS', 'VARCHAR(8)', 'Rate class', { termId: 'T-012' }),
        col('IS_ACTIVE', 'BOOLEAN', 'Active customer (rule BR-001)', { termId: 'T-002', tags: ['CDE'] }), col('DIGITAL_ENROLLED', 'BOOLEAN', 'Paperless', { termId: 'T-011' }),
        col('AVG_MONTHLY_BILL_12M', 'NUMBER(10,2)', 'Average monthly bill, trailing 12 months', { termId: 'T-009' }), col('ARREARS_AMOUNT', 'NUMBER(12,2)', 'Latest arrears', { termId: 'T-010' }),
        col('CHURN_RISK_SCORE', 'NUMBER(3)', 'Churn risk score', { termId: 'T-020' }), col('AVG_DAILY_KWH', 'NUMBER(8,1)', 'Average daily kWh (30 days)'),
      ],
      rowCount: 1_385_000, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:00:00', upstream: ['CONFORMED_GOLD.DIM_CUSTOMER', 'CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.FCT_DAILY_USAGE'], rowAccess: opcoAccess,
      rows: memo(() => {
        const since = addDays(AS_OF, -60);
        const recent = new Set(d.bills.filter((b) => b.date > since).map((b) => b.customerKey));
        return d.customers.map((c) => ({
          CUSTOMER_ID: c.id, CUSTOMER_NAME: `${c.first} ${c.last}`, OPCO: c.opco, REGION: c.region, RATE_CLASS: c.rateClass,
          IS_ACTIVE: c.status === 'Active' && recent.has(c.key), DIGITAL_ENROLLED: c.paperless, AVG_MONTHLY_BILL_12M: round(billAvg().get(c.key) ?? 0, 2),
          ARREARS_AMOUNT: latest().get(c.key)?.arrears ?? 0, CHURN_RISK_SCORE: c.churnRisk, AVG_DAILY_KWH: round(usageAvg().get(c.key) ?? 0, 1),
        }));
      }),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_SYSTEM_RELIABILITY', layer: 'product', type: 'SECURE VIEW', order: 4, comment: 'Output port of System Reliability',
      columns: [col('OUTAGE_ID', 'VARCHAR(20)', 'Outage'), col('OUTAGE_DATE', 'DATE', 'Date'), col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003' }), col('CIRCUIT_ID', 'VARCHAR(12)', 'Circuit'), col('CAUSE', 'VARCHAR(30)', 'Cause'), col('CUSTOMERS_INTERRUPTED', 'NUMBER(8)', 'Customers interrupted', { termId: 'T-005', tags: ['CDE'] }), col('CUSTOMER_MINUTES', 'NUMBER(12)', 'Customer minutes', { termId: 'T-008', tags: ['CDE'] }), col('DURATION_MIN', 'NUMBER(8)', 'Duration'), col('MED_FLAG', 'BOOLEAN', 'Major event day', { termId: 'T-007', tags: ['CDE'] }), col('CUSTOMERS_SERVED', 'NUMBER', 'Customers served on circuit')],
      rowCount: 1_812_006, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:14:00', upstream: ['CONFORMED_GOLD.FCT_OUTAGE', 'CONFORMED_GOLD.DIM_CIRCUIT'], rowAccess: opcoAccess,
      rows: memo(() => d.outages.slice().reverse().map((o) => ({ OUTAGE_ID: o.id, OUTAGE_DATE: o.date, OPCO: o.opco, CIRCUIT_ID: o.circuitId, CAUSE: o.cause, CUSTOMERS_INTERRUPTED: o.ci, CUSTOMER_MINUTES: o.ci * o.duration, DURATION_MIN: o.duration, MED_FLAG: o.med, CUSTOMERS_SERVED: circuitByKey.get(o.circuitKey)!.served }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_AMI_USAGE', layer: 'product', type: 'SECURE VIEW', order: 5, comment: 'Output port of AMI Usage',
      columns: [col('USAGE_DATE', 'DATE', 'Date'), col('PREMISE_ID', 'VARCHAR(12)', 'Premise'), col('METER_ID', 'VARCHAR(12)', 'Meter'), col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003' }), col('RATE_CLASS', 'VARCHAR(8)', 'Rate class', { termId: 'T-012' }), col('KWH', 'NUMBER(10,2)', 'Daily kWh'), col('PEAK_KW', 'NUMBER(8,2)', 'Peak kW', { termId: 'T-014' }), col('READ_SUCCESS_PCT', 'NUMBER(5,1)', 'Read success %', { termId: 'T-013', tags: ['CDE'] })],
      rowCount: 1_520_448_000, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:34:00', upstream: ['CONFORMED_GOLD.FCT_DAILY_USAGE', 'CONFORMED_GOLD.DIM_PREMISE'], rowAccess: opcoAccess,
      rows: memo(() => d.usage.slice().reverse().map((u) => {
        const c = custByKey.get(u.customerKey)!;
        return { USAGE_DATE: u.date, PREMISE_ID: c.premiseId, METER_ID: c.meterId, OPCO: u.opco, RATE_CLASS: u.rateClass, KWH: u.kwh, PEAK_KW: u.peakKw, READ_SUCCESS_PCT: u.readSuccess };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_PROCUREMENT_SPEND', layer: 'product', type: 'SECURE VIEW', order: 6, comment: 'Output port of Procurement Spend',
      columns: [col('PO_NUMBER', 'VARCHAR(10)', 'PO'), col('LINE_NUMBER', 'NUMBER', 'Line'), col('PO_DATE', 'DATE', 'PO date'), col('SUPPLIER_NAME', 'VARCHAR(60)', 'Supplier'), col('CATEGORY', 'VARCHAR(30)', 'Category'), col('SPEND_USD', 'NUMBER(14,2)', 'Spend'), col('ON_CONTRACT', 'BOOLEAN', 'On contract', { termId: 'T-015', tags: ['CDE'] }), col('OTIF_FLAG', 'BOOLEAN', 'OTIF', { termId: 'T-017', tags: ['CDE'] }), col('CYCLE_DAYS', 'NUMBER(4)', 'Cycle days', { termId: 'T-022' })],
      rowCount: 3_380_114, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:00:00', upstream: ['CONFORMED_GOLD.FCT_PO_SPEND', 'CONFORMED_GOLD.DIM_SUPPLIER'],
      rows: memo(() => d.poLines.slice().reverse().map((l) => ({ PO_NUMBER: l.po, LINE_NUMBER: l.line, PO_DATE: l.date, SUPPLIER_NAME: supplierByKey.get(l.supplierKey)!.name, CATEGORY: l.category, SPEND_USD: l.spend, ON_CONTRACT: l.onContract, OTIF_FLAG: l.otif, CYCLE_DAYS: l.cycleDays }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_BILLING_RECEIVABLES', layer: 'product', type: 'SECURE VIEW', order: 7, comment: 'Output port of Billing & Receivables (in certification)',
      columns: [
        col('STATEMENT_ID', 'VARCHAR(20)', 'Statement'), col('CUSTOMER_ID', 'NUMBER(10)', 'Customer', { termId: 'T-001' }), col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003' }),
        col('STATEMENT_DATE', 'DATE', 'Statement date'), col('BILLED_AMOUNT', 'NUMBER(12,2)', 'Billed', { termId: 'T-009', tags: ['CDE'] }), col('ARREARS_AMOUNT', 'NUMBER(12,2)', 'Arrears', { termId: 'T-010', tags: ['CDE'] }),
        col('IS_ESTIMATED', 'BOOLEAN', 'Estimated', { termId: 'T-021' }), col('DAYS_TO_PAY', 'NUMBER(4)', 'Days to pay', { termId: 'T-018', tags: ['CDE'] }),
        col('ACCOUNT_EMAIL', 'VARCHAR(120)', 'Billing contact email (from FCT_BILLING)', { tags: ['PII'], maskPendingFix: GATE6_CHECK }),
      ],
      rowCount: 199_204_880, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:06:00', upstream: ['CONFORMED_GOLD.FCT_BILLING', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: opcoAccess,
      rows: memo(() => d.bills.slice().reverse().map((b) => ({ STATEMENT_ID: b.id, CUSTOMER_ID: b.customerId, OPCO: b.opco, STATEMENT_DATE: b.date, BILLED_AMOUNT: b.billed, ARREARS_AMOUNT: b.arrears, IS_ESTIMATED: b.estimated, DAYS_TO_PAY: b.daysToPay, ACCOUNT_EMAIL: b.email }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_VEGETATION_RISK', layer: 'product', type: 'SECURE VIEW', order: 8, comment: 'Output port of Vegetation Risk (draft)',
      columns: [col('SPAN_ID', 'VARCHAR(20)', 'Span'), col('CIRCUIT_ID', 'VARCHAR(12)', 'Circuit'), col('OPCO', 'VARCHAR(30)', 'Operating company', { termId: 'T-003' }), col('LAST_TRIM_DATE', 'DATE', 'Last trim'), col('CYCLE_YEARS', 'NUMBER(2)', 'Cycle'), col('CLEARANCE_FT', 'NUMBER(5,1)', 'Clearance'), col('IS_OVERDUE', 'BOOLEAN', 'Overdue for trim', { termId: 'T-019', tags: ['CDE'] }), col('TREE_OUTAGES_12M', 'NUMBER(4)', 'Tree-caused outages on circuit, 12 months')],
      rowCount: 398_120, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-29 02:00:00', upstream: ['CURATED_SILVER.VEGETATION_SPAN', 'CONFORMED_GOLD.FCT_OUTAGE'], rowAccess: opcoAccess,
      rows: memo(() => d.spans.map((s) => ({ SPAN_ID: s.id, CIRCUIT_ID: s.circuitId, OPCO: s.opco, LAST_TRIM_DATE: s.lastTrim, CYCLE_YEARS: s.cycleYears, CLEARANCE_FT: s.clearanceFt, IS_OVERDUE: s.overdue, TREE_OUTAGES_12M: treeByCircuit().get(s.circuitId) ?? 0 }))),
    },
  ];

  return [...bronze, ...silver, ...gold, ...products];
}
