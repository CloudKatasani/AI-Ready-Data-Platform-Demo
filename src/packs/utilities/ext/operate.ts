// Utilities: source inventory (E5), legacy Cognos reports (E5) and incident scripts (E9).
import type { IncidentScript, InventoryTable, LegacyReport } from '../../../ext/types';

const CIS = 'RAW_BRONZE.CIS_CUSTOMER_CDC';
const BILL = 'RAW_BRONZE.BILL_HDR_CDC';
const AMI = 'RAW_BRONZE.AMI_READ_CDC';
const OMS = 'RAW_BRONZE.OMS_EVENT_CDC';
const PO = 'RAW_BRONZE.PO_LINE_CDC';
const VEG = 'RAW_BRONZE.VEG_INSPECTION_CDC';

type Row = [table: string, domain: string, landsOrLevel: string | 0 | 1, consumedBy?: string[], note?: string, carries?: string[]];
const sys = (source: string, rows: Row[]): InventoryTable[] =>
  rows.map(([table, domain, l, consumedBy, note, carries]) => (typeof l === 'string' ? { source, table, domain, level: 1, lands: l, consumedBy, note, carries } : { source, table, domain, level: l, note }));

export const sourceInventory: InventoryTable[] = [
  ...sys('DB2 CIS', [
    ['CUSTOMER', 'Customer', CIS], ['ACCOUNT', 'Customer', BILL, undefined, 'Billing contact', ['CONFORMED_GOLD.FCT_BILLING.ACCOUNT_EMAIL']], ['PREMISE', 'Customer', CIS, undefined, undefined, ['CONFORMED_GOLD.DIM_PREMISE.PREMISE_ID']], ['SERVICE_AGREEMENT', 'Customer', CIS, undefined, undefined, ['CONFORMED_GOLD.DIM_CUSTOMER.SEGMENT']],
    ['CONTACT_PREFERENCE', 'Customer', CIS, ['DP-01'], undefined, ['CONFORMED_GOLD.DIM_CUSTOMER.DIGITAL_ENROLLED']], ['RATE_SCHEDULE', 'Customer', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'],
    ['CUSTOMER_NOTE', 'Customer', 0], ['LIFE_SUPPORT_REGISTER', 'Customer', 0, undefined, 'Sensitive health data: needs a privacy review first'],
  ]),
  ...sys('DB2 billing', [
    ['BILL_HEADER', 'Finance', BILL], ['BILL_LINE', 'Finance', BILL, ['DP-05']], ['AR_AGING', 'Finance', BILL, ['DP-05']], ['PAYMENT_TXN', 'Finance', BILL, ['DP-05']],
    ['PAYMENT_ARRANGEMENT', 'Finance', BILL, ['DP-05']], ['BILL_ADJUSTMENT', 'Finance', 1], ['COLLECTION_ACTION', 'Finance', 0], ['DUNNING_NOTICE', 'Finance', 0],
  ]),
  ...sys('AMI head-end', [
    ['INTERVAL_READ', 'Grid operations', AMI], ['REGISTER_READ', 'Grid operations', AMI, undefined, undefined, ['CURATED_SILVER.METER_READ_15MIN.READ_QUALITY']], ['METER_ASSET', 'Grid operations', AMI, undefined, undefined, ['CURATED_SILVER.METER_READ_15MIN.METER_ID']],
    ['METER_EVENT', 'Grid operations', 1], ['VEE_EXCEPTION', 'Grid operations', 0], ['NETWORK_HEALTH', 'Grid operations', 0],
  ]),
  ...sys('OMS / ADMS', [
    ['OUTAGE_EVENT', 'Grid operations', OMS], ['CALL_TICKET', 'Grid operations', OMS, undefined, undefined, ['CURATED_SILVER.OUTAGE_EVENT.START_TS']], ['MAJOR_EVENT_DAY', 'Grid operations', OMS, undefined, undefined, ['CONFORMED_GOLD.FCT_OUTAGE.MED_FLAG', 'CONFORMED_GOLD.DIM_DATE.IS_MAJOR_EVENT_DAY']],
    ['CREW_DISPATCH', 'Grid operations', 1], ['SWITCHING_ORDER', 'Grid operations', 0], ['DEVICE_OPERATION', 'Grid operations', 0],
  ]),
  ...sys('ERP procurement', [
    ['PO_LINE', 'Supply chain', PO], ['PO_HEADER', 'Supply chain', PO], ['VENDOR_MASTER', 'Supply chain', PO, undefined, undefined, ['CONFORMED_GOLD.DIM_SUPPLIER.SUPPLIER_NAME', 'CONFORMED_GOLD.DIM_SUPPLIER.DIVERSITY_CERTIFIED']], ['GOODS_RECEIPT', 'Supply chain', PO, undefined, undefined, ['CURATED_SILVER.PURCHASE_ORDER_LINE.RECEIVED_DATE', 'CONFORMED_GOLD.FCT_PO_SPEND.OTIF_FLAG']],
    ['CONTRACT', 'Supply chain', PO], ['INVOICE', 'Supply chain', 1], ['MATERIAL_MASTER', 'Supply chain', 1], ['SPEND_CATEGORY', 'Supply chain', 0],
  ]),
  ...sys('Vegetation system', [
    ['SPAN_INSPECTION', 'Grid operations', VEG], ['TRIM_WORK_ORDER', 'Grid operations', VEG], ['TRIM_CONTRACTOR', 'Grid operations', 1], ['TREE_SPECIES', 'Grid operations', 0],
  ]),
  ...sys('GIS', [
    ['CIRCUIT_MODEL', 'Grid operations', 1], ['TRANSFORMER', 'Grid operations', 1], ['POLE', 'Grid operations', 0], ['SERVICE_POINT', 'Grid operations', 0], ['FEEDER_SEGMENT', 'Grid operations', 0],
  ]),
  ...sys('Maximo', [
    ['WORK_ORDER', 'Grid operations', 1], ['ASSET', 'Grid operations', 0], ['LABOR_TIME', 'Supply chain', 0], ['INSPECTION_RESULT', 'Grid operations', 0],
  ]),
  ...sys('Customer portal', [
    ['PAPERLESS_ENROLLMENT', 'Customer', BILL, ['DP-01']], ['OUTAGE_REPORT', 'Customer', 1], ['WEB_SESSION', 'Customer', 0], ['PAYMENT_METHOD', 'Finance', 0],
  ]),
];

type Rep = [name: string, kpis: string[], missing?: string[]];
const REPORTS: Rep[] = [
  ['Monthly active customer count', ['K-01']], ['Residential bill trend by region', ['K-02']], ['Paperless adoption scorecard', ['K-04']],
  ['Customer churn watchlist', ['K-05', 'K-03']], ['Customer 360 executive pack', ['K-01', 'K-02', 'K-04']], ['Arrears by opco', ['K-03']],
  ['High-bill complaint drivers', ['K-02'], ['Complaint category']], ['SAIDI / SAIFI regulatory filing', ['K-06', 'K-07']], ['CAIDI by operating company', ['K-08']],
  ['Worst-performing circuits', ['K-09', 'K-10']], ['Daily reliability flash', ['K-06', 'K-09']], ['Major event day log', ['K-06'], ['MED storm narrative']],
  ['Storm restoration timeline', ['K-10'], ['Crew dispatch times']], ['Daily load profile', ['K-11']], ['Peak demand by rate class', ['K-12']],
  ['Meter read performance', ['K-13', 'K-14']], ['Estimated reads by route', ['K-14'], ['Meter route']], ['Total spend by category', ['K-15']],
  ['Contract compliance', ['K-16']], ['Supplier OTIF scorecard', ['K-17']], ['PO cycle time', ['K-18']], ['Maverick spend review', ['K-19']],
  ['Quarterly procurement board pack', ['K-15', 'K-16', 'K-17']], ['Days sales outstanding', ['K-20']], ['Bills issued and estimated', ['K-21', 'K-22']],
  ['Collections effectiveness', ['K-23']], ['AR aging buckets', ['K-20', 'K-23'], ['Aging bucket by 30 days']], ['Cash forecast', ['K-23'], ['Payment arrangement schedule']],
  ['Spans overdue for trim', ['K-24']], ['Tree-caused outages', ['K-25']], ['Trim cycle compliance', ['K-26']], ['Vegetation contractor performance', ['K-26'], ['Contractor cost']],
  ['Revenue and billing reconciliation', ['K-21', 'K-02']], ['Customer and reliability joint review', ['K-01', 'K-06']], ['Read-to-bill quality', ['K-13', 'K-22']],
  ['Regulatory customer metrics', ['K-01', 'K-06', 'K-07'], ['Complaint counts']], ['Field work backlog', [], ['Work order status', 'Crew hours']],
  ['Transformer loading', [], ['Transformer rating', 'Load per transformer']], ['Pole inspection status', [], ['Pole condition']], ['Web self-service usage', ['K-04'], ['Web sessions']],
];
const OWNERS = ['Customer Ops', 'Grid Reliability', 'Supply Chain', 'Revenue Assurance', 'Asset Management'];
export const legacyReports: LegacyReport[] = REPORTS.map(([name, kpiIds, missing], i) => ({
  id: `RPT-${String(i + 1).padStart(3, '0')}`, name, tool: 'Cognos', owner: OWNERS[i % OWNERS.length], kpiIds, missing: missing ?? [],
}));

export const incidents: IncidentScript[] = [
  {
    id: 'INC-1', title: 'Late CDC feed', fault: 'OMS_EVENT_CDC stops receiving rows for 6 h (GoldenGate extract stalled).',
    objectFqn: OMS, dmf: { metric: 'FRESHNESS', value: 360, threshold: 120, unit: ' min' },
    affects: [{ productId: 'DP-02', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'warn', message: 'Data as of 6 h ago: OMS outage events have not arrived since 06:12, so reliability figures may be understated.' }],
    resolution: 'GoldenGate extract restarted; 6 h of OMS events replayed and OUTAGE_EVENT refreshed.', ttdMin: 22, ttrMin: 48,
  },
  {
    id: 'INC-2', title: 'Null spike in a CDE', fault: '18% nulls in BILLING_STATEMENT.AMOUNT_DUE_USD after a billing extract change.',
    objectFqn: 'CURATED_SILVER.BILLING_STATEMENT', column: 'AMOUNT_DUE_USD', dmf: { metric: 'NULL_COUNT', value: 18, threshold: 0.5, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }, { productId: 'DP-05', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'block', scenarioIds: ['S-01', 'S-03', 'S-04'], message: 'I can’t give bill or arrears totals right now: 18% of statement amounts (AMOUNT_DUE_USD, a critical data element) arrived empty in the last load, so any total would be understated. The billing data steward has been alerted; ask again once the incident is resolved.' }],
    resolution: 'Billing extract re-run with the corrected AMT_DUE mapping; null rows reloaded and DMFs re-checked.', ttdMin: 9, ttrMin: 95,
  },
  {
    id: 'INC-3', title: 'Duplicate load', fault: 'A replayed CDC batch doubles 40,000 AMI interval reads.',
    objectFqn: AMI, dmf: { metric: 'DUPLICATE_COUNT', value: 40000, threshold: 0, unit: ' rows' },
    affects: [{ productId: 'DP-03', status: 'Down' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'block', scenarioIds: ['S-05'], message: 'Usage answers are paused: a replayed AMI batch doubled 40,000 interval reads, so demand figures would be overstated. The last good snapshot is 2026-10-03 23:45; I can answer as of then once the AMI Usage product is restored.' }],
    resolution: 'Duplicate batch removed with a MERGE on (METER_ID, READ_TS); downstream dynamic tables refreshed.', ttdMin: 6, ttrMin: 64,
  },
  {
    id: 'INC-4', title: 'Schema drift', fault: 'CIS adds RATE_CD_V2 and stops filling RATE_CD.',
    objectFqn: CIS, column: 'RATE_CD', dmf: { metric: 'CONTRACT_CHECK (RATE_CD null %)', value: 100, threshold: 1, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-05', 'S-01'], message: 'Rate class breakdowns are incomplete: CIS added RATE_CD_V2 and stopped filling RATE_CD, so accounts changed since yesterday show no rate class.' }],
    resolution: 'Data contract updated to map RATE_CD_V2 to RATE_CLASS; Silver CUSTOMER rebuilt.', ttdMin: 35, ttrMin: 180,
  },
  {
    id: 'INC-5', title: 'Volume anomaly', fault: 'PO lines drop 70% day over day.',
    objectFqn: PO, dmf: { metric: 'ROW_COUNT change', value: -70, threshold: -30, unit: '%' },
    affects: [{ productId: 'DP-04', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-03', mode: 'warn', message: 'Volume caveat: PO lines dropped 70% day over day, so spend for the last day is likely incomplete.' }],
    resolution: 'ERP extract filter corrected; missing PO lines backfilled.', ttdMin: 14, ttrMin: 120,
  },
];
