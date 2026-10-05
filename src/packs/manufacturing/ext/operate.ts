// Manufacturing: source inventory (E5), legacy SSRS / Power BI reports (E5) and incident scripts (E9).
import type { IncidentScript, InventoryTable, LegacyReport } from '../../../ext/types';

const ROSTER = 'RAW_BRONZE.MES_OPERATOR_CDC';
const MES = 'RAW_BRONZE.MES_LINE_EVENT_CDC';
const SO = 'RAW_BRONZE.ERP_SALES_ORDER_CDC';
const IOT = 'RAW_BRONZE.IOT_SENSOR_READING_CDC';
const QMS = 'RAW_BRONZE.QMS_INSPECTION_CDC';
const ASN = 'RAW_BRONZE.SUPPLIER_ASN_CDC';

type Row = [table: string, domain: string, landsOrLevel: string | 0 | 1, consumedBy?: string[], note?: string, carries?: string[]];
const sys = (source: string, rows: Row[]): InventoryTable[] =>
  rows.map(([table, domain, l, consumedBy, note, carries]) => (typeof l === 'string' ? { source, table, domain, level: 1, lands: l, consumedBy, note, carries } : { source, table, domain, level: l, note }));

export const sourceInventory: InventoryTable[] = [
  ...sys('MES', [
    ['SHIFT_PRODUCTION', 'Operations', MES], ['DOWNTIME_EVENT', 'Operations', MES, undefined, undefined, ['CONFORMED_GOLD.FCT_LINE_PRODUCTION.UNPLANNED_DOWNTIME_MIN']],
    ['LOSS_REASON_CODE', 'Operations', MES, undefined, 'Decoded in Silver; not yet a Gold dimension', ['CURATED_SILVER.LINE_SHIFT_PRODUCTION.LOSS_REASON']],
    ['OPERATOR_ROSTER', 'Workforce', ROSTER], ['CREW_CERTIFICATION', 'Workforce', ROSTER, undefined, 'Certification level curated in Silver only', ['CURATED_SILVER.OPERATOR.CERT_LEVEL']],
    ['LINE_MASTER', 'Operations', MES, undefined, undefined, ['CONFORMED_GOLD.DIM_LINE.LINE_STATUS', 'CONFORMED_GOLD.DIM_LINE.IDEAL_CYCLE_SEC']],
    ['PROCESS_RECIPE', 'Operations', MES, undefined, 'Trade secret: modelled but not in a semantic view', ['CONFORMED_GOLD.DIM_LINE.PROCESS_RECIPE_ID']],
    ['SHIFT_CALENDAR', 'Operations', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'], ['WORK_INSTRUCTION', 'Operations', 0], ['ANDON_CALL', 'Operations', 0],
    ['LABOR_BOOKING', 'Workforce', 0], ['MATERIAL_CONSUMPTION', 'Operations', 1],
  ]),
  ...sys('ERP (orders, BOM)', [
    ['SALES_ORDER_HEADER', 'Order fulfilment', SO], ['SALES_ORDER_ITEM', 'Order fulfilment', SO], ['SCHEDULE_LINE', 'Order fulfilment', SO, ['DP-05'], undefined, ['CONFORMED_GOLD.FCT_ORDER.ON_TIME_FLAG']],
    ['DELIVERY_PROOF', 'Order fulfilment', SO, ['DP-05'], 'Proof of delivery', ['CONFORMED_GOLD.FCT_ORDER.LEAD_TIME_DAYS', 'CONFORMED_GOLD.FCT_ORDER.IN_FULL_FLAG']],
    ['CUSTOMER_MASTER', 'Order fulfilment', SO, ['DP-05']], ['MATERIAL_GROUP', 'Order fulfilment', SO, undefined, 'Curated, not yet in Gold', ['CURATED_SILVER.SALES_ORDER_LINE.PRODUCT_FAMILY']],
    ['COSTED_BOM', 'Finance', SO, undefined, 'Standard cost carried into FCT_ORDER only', ['CONFORMED_GOLD.FCT_ORDER.STD_UNIT_COST']],
    ['BOM_ITEM', 'Finance', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'], ['ROUTING', 'Operations', 1], ['PURCHASE_ORDER', 'Supply chain', 1, undefined, 'Read through the supplier portal today'],
    ['INVOICE', 'Finance', 0], ['CREDIT_MEMO', 'Finance', 0], ['GL_POSTING', 'Finance', 0], ['INVENTORY_BALANCE', 'Supply chain', 0],
  ]),
  ...sys('IoT sensor historian', [
    ['VIBRATION_TAG', 'Maintenance', IOT], ['TEMPERATURE_TAG', 'Maintenance', IOT], ['POWER_METER', 'Sustainability', IOT, undefined, 'Feeds condition-based PM; line energy comes from MES'],
    ['ALARM_LOG', 'Maintenance', 1], ['TAG_CONFIG', 'Maintenance', 0], ['COMPRESSED_AIR_FLOW', 'Sustainability', 0],
  ]),
  ...sys('QMS', [
    ['INSPECTION_LOT', 'Quality', QMS], ['USAGE_DECISION', 'Quality', QMS, undefined, undefined, ['CONFORMED_GOLD.FCT_QUALITY_INSPECTION.PASSED_FIRST_FLAG']],
    ['NONCONFORMANCE', 'Quality', QMS, undefined, undefined, ['CONFORMED_GOLD.FCT_QUALITY_INSPECTION.NCR_NUMBER', 'CONFORMED_GOLD.FCT_QUALITY_INSPECTION.COPQ_USD']],
    ['DEFECT_CATALOG', 'Quality', QMS, undefined, 'Codes cleaned in Silver; no Gold dimension yet', ['CURATED_SILVER.QUALITY_INSPECTION_LOT.DEFECT_CODE']],
    ['CAPA', 'Quality', 1], ['CALIBRATION_RECORD', 'Quality', 0], ['AUDIT_FINDING', 'Quality', 0], ['CUSTOMER_COMPLAINT', 'Quality', 0, undefined, 'Holds customer contact details: privacy review first'],
  ]),
  ...sys('Supplier portal', [
    ['ASN', 'Supply chain', ASN], ['GOODS_RECEIPT', 'Supply chain', ASN, undefined, undefined, ['CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY.OTIF_FLAG']],
    ['INCOMING_INSPECTION', 'Supply chain', ASN, undefined, undefined, ['CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY.QTY_REJECTED']],
    ['VENDOR_MASTER', 'Supply chain', ASN, undefined, undefined, ['CONFORMED_GOLD.DIM_SUPPLIER.SUPPLIER_NAME']],
    ['SCAR', 'Supply chain', 1], ['SUPPLIER_CERTIFICATE', 'Supply chain', 0], ['FORECAST_COMMIT', 'Supply chain', 0],
  ]),
  ...sys('CMMS', [
    ['WORK_ORDER', 'Maintenance', IOT, undefined, 'Failures confirmed from MES downtime and IoT alarms', ['CONFORMED_GOLD.FCT_MAINTENANCE_EVENT.WO_TYPE', 'CONFORMED_GOLD.FCT_MAINTENANCE_EVENT.REPAIR_HOURS']],
    ['ASSET_REGISTER', 'Maintenance', IOT, undefined, undefined, ['CONFORMED_GOLD.DIM_ASSET.CRITICALITY']],
    ['ASSET_INSTALL_DATA', 'Maintenance', IOT, undefined, 'Install year modelled but not used by any metric', ['CONFORMED_GOLD.DIM_ASSET.INSTALL_YEAR']],
    ['PM_SCHEDULE', 'Maintenance', 1], ['SPARE_PART_STOCK', 'Maintenance', 0], ['TECHNICIAN_TIME', 'Workforce', 0],
  ]),
  ...sys('Energy metering', [
    ['UTILITY_INVOICE', 'Sustainability', 0], ['GRID_EMISSION_FACTOR', 'Sustainability', 1, undefined, 'Annual factor file loaded by hand'], ['SUBMETER_READING', 'Sustainability', 0],
  ]),
];

type Rep = [name: string, kpis: string[], missing?: string[], tool?: string];
const REPORTS: Rep[] = [
  ['Daily OEE by line', ['K-01', 'K-02', 'K-03', 'K-04']], ['Weekly tier-3 OEE review', ['K-01'], ['Tier-3 action log']], ['Business unit OEE scorecard', ['K-01', 'K-02', 'K-03', 'K-04'], undefined, 'Power BI'],
  ['Shift output summary', ['K-05']], ['Downtime Pareto by reason', ['K-06']], ['Active line count', ['K-07']],
  ['Plant manager morning report', ['K-01', 'K-05', 'K-06'], ['Safety incidents']], ['Changeover overrun log', ['K-06'], ['Changeover standard times']], ['Shift lead performance', ['K-01']],
  ['First-pass yield by plant', ['K-08']], ['Scrap and rework trend', ['K-09', 'K-13']], ['Defects per million by product family', ['K-10']],
  ['NCR register', ['K-11']], ['Cost of poor quality summary', ['K-12'], undefined, 'Power BI'], ['Material review board pack', ['K-11', 'K-12'], ['MRB disposition notes']],
  ['Customer complaint tracker', [], ['Complaint records', 'Customer contact']], ['MTBF by asset', ['K-14']], ['MTTR by technician crew', ['K-15'], ['Technician time']],
  ['Planned maintenance compliance', ['K-16']], ['Corrective work order backlog', ['K-17'], ['Work order status']], ['Spare parts stock-out risk', [], ['Spare part stock', 'Reorder points']],
  ['Supplier OTIF scorecard', ['K-18']], ['Incoming inspection PPM', ['K-19']], ['Supplier lead time by commodity', ['K-20']],
  ['Quarterly supplier review pack', ['K-18', 'K-19', 'K-20'], undefined, 'Power BI'], ['SCAR status', ['K-18'], ['SCAR records']], ['Customer on-time delivery', ['K-21']],
  ['Order lead time by business unit', ['K-22']], ['Fill rate by customer', ['K-23']], ['Monthly shipments', ['K-24']],
  ['S&OP delivery and output pack', ['K-21', 'K-23', 'K-05'], undefined, 'Power BI'], ['Late order lines detail', ['K-21'], ['Re-promise reason']], ['Energy per unit by plant', ['K-25']],
  ['Scope 2 emissions quarterly', ['K-26']], ['Sustainability board pack', ['K-25', 'K-26'], ['Scope 1 fuel use'], 'Power BI'], ['Operations executive dashboard', ['K-01', 'K-08', 'K-21'], undefined, 'Power BI'],
  ['Quality and OEE joint review', ['K-01', 'K-08', 'K-09']], ['Standard cost variance', [], ['Actual cost', 'Standard cost by BOM']], ['Calibration due list', [], ['Calibration records']],
  ['Labor efficiency by plant', ['K-05'], ['Labor hours booked']],
];
const OWNERS = ['Manufacturing Excellence', 'Plant Quality', 'Reliability Engineering', 'Supply Chain', 'Customer Operations', 'EHS & Sustainability'];
export const legacyReports: LegacyReport[] = REPORTS.map(([name, kpiIds, missing, tool], i) => ({
  id: `RPT-${String(i + 1).padStart(3, '0')}`, name, tool: tool ?? 'SSRS', owner: OWNERS[i % OWNERS.length], kpiIds, missing: missing ?? [],
}));

export const incidents: IncidentScript[] = [
  {
    id: 'INC-1', title: 'Late CDC feed', fault: 'MES_LINE_EVENT_CDC stops receiving shift records for 5 h (MES outbound connector stalled after a plant server patch).',
    objectFqn: MES, dmf: { metric: 'FRESHNESS', value: 300, threshold: 60, unit: ' min' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }],
    agentEffect: [
      { agentId: 'AG-01', mode: 'warn', message: 'Data as of 5 h ago: MES shift records have not arrived since 01:10, so today’s output and OEE are understated.' },
      { agentId: 'AG-02', mode: 'warn', scenarioIds: ['S-06'], message: 'Data as of 5 h ago: MES shift records are late, so loss drivers for the latest shifts are missing.' },
    ],
    resolution: 'MES outbound connector restarted; 5 h of shift records replayed and LINE_SHIFT_PRODUCTION refreshed.', ttdMin: 18, ttrMin: 52,
  },
  {
    id: 'INC-2', title: 'Null spike in a CDE', fault: '14% nulls in FCT_QUALITY_INSPECTION.COPQ_USD after the QMS cost-rate table was reloaded empty.',
    objectFqn: 'CONFORMED_GOLD.FCT_QUALITY_INSPECTION', column: 'COPQ_USD', dmf: { metric: 'NULL_COUNT', value: 14, threshold: 0.5, unit: '%' },
    affects: [{ productId: 'DP-02', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'block', scenarioIds: ['S-07'], message: 'I can’t rank defect codes by cost of poor quality right now: 14% of COPQ_USD values (a critical data element) arrived empty in the last load, so any ranking would be wrong. The quality data steward has been alerted; ask again once the incident is resolved.' }],
    resolution: 'QMS cost-rate table reloaded; affected inspection lots recosted and DMFs re-checked.', ttdMin: 11, ttrMin: 85,
  },
  {
    id: 'INC-3', title: 'Duplicate load', fault: 'A replayed ERP batch doubles 2,400 sales order lines.',
    objectFqn: SO, dmf: { metric: 'DUPLICATE_COUNT', value: 2400, threshold: 0, unit: ' rows' },
    affects: [{ productId: 'DP-05', status: 'Down' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'block', scenarioIds: ['S-04'], message: 'Delivery answers are paused: a replayed ERP batch doubled 2,400 order lines, so on-time delivery and fill rate would be wrong. The last good snapshot is 2026-09-29 23:00; I can answer as of then once Order to Delivery is restored.' }],
    resolution: 'Duplicate batch removed with a MERGE on (VBELN, POSNR); SALES_ORDER_LINE and FCT_ORDER refreshed.', ttdMin: 7, ttrMin: 70,
  },
  {
    id: 'INC-4', title: 'Schema drift', fault: 'The supplier portal adds QTY_REJ_EA and stops filling QTY_REJ.',
    objectFqn: ASN, column: 'QTY_REJ', dmf: { metric: 'CONTRACT_CHECK (QTY_REJ null %)', value: 100, threshold: 1, unit: '%' },
    affects: [{ productId: 'DP-04', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-03', mode: 'warn', scenarioIds: ['S-10'], message: 'Supplier PPM is incomplete: the portal moved rejects to QTY_REJ_EA and stopped filling QTY_REJ, so receipts since yesterday show no rejects.' }],
    resolution: 'Data contract updated to map QTY_REJ_EA to QTY_REJECTED; Silver SUPPLIER_RECEIPT rebuilt.', ttdMin: 40, ttrMin: 160,
  },
  {
    id: 'INC-5', title: 'Volume anomaly', fault: 'IoT sensor readings drop 65% hour over hour after a historian gateway lost two plants.',
    objectFqn: IOT, dmf: { metric: 'ROW_COUNT change', value: -65, threshold: -30, unit: '%' },
    affects: [{ productId: 'DP-03', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-03', mode: 'warn', scenarioIds: ['S-11', 'S-12'], message: 'Volume caveat: IoT readings dropped 65% in the last hour, so condition-based work orders for Pune and Suzhou may be missing.' }],
    resolution: 'Historian gateway restarted; buffered readings back-filled from the edge stores.', ttdMin: 12, ttrMin: 95,
  },
];
