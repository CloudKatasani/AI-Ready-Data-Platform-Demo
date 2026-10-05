// Telecom: source inventory (E5), legacy Tableau and Excel reports (E5) and incident scripts (E9).
import type { IncidentScript, InventoryTable, LegacyReport } from '../../../ext/types';

const CRM = 'RAW_BRONZE.CRM_SUBSCRIBER_CDC';
const BSS = 'RAW_BRONZE.BSS_INVOICE_CDC';
const CDR = 'RAW_BRONZE.CDR_MEDIATION_CDC';
const OSS = 'RAW_BRONZE.OSS_NETWORK_EVENT_CDC';
const FSM = 'RAW_BRONZE.FSM_WORK_ORDER_CDC';

type Row = [table: string, domain: string, landsOrLevel: string | 0 | 1, consumedBy?: string[], note?: string, carries?: string[]];
const sys = (source: string, rows: Row[]): InventoryTable[] =>
  rows.map(([table, domain, l, consumedBy, note, carries]) => (typeof l === 'string' ? { source, table, domain, level: 1, lands: l, consumedBy, note, carries } : { source, table, domain, level: l, note }));

export const sourceInventory: InventoryTable[] = [
  ...sys('CRM', [
    ['SUBSCRIBER', 'Subscriber', CRM], ['ACCOUNT', 'Subscriber', CRM, undefined, 'Billing account holder', ['CONFORMED_GOLD.DIM_SUBSCRIBER.SUBSCRIBER_ID']],
    ['SUBSCRIPTION_PLAN', 'Subscriber', CRM, undefined, undefined, ['CONFORMED_GOLD.DIM_PLAN.PLAN_CODE']], ['PORT_REQUEST', 'Subscriber', CRM, undefined, 'Number port-out requests from the porting hub', ['CONFORMED_GOLD.FCT_SUBSCRIBER_MONTHLY.PORT_OUTS']],
    ['CONTACT_PREFERENCE', 'Subscriber', CRM, ['DP-01'], 'Autopay and paperless flags', ['CONFORMED_GOLD.DIM_SUBSCRIBER.AUTOPAY']], ['CHURN_SCORE', 'Subscriber', CRM, ['DP-01'], 'Nightly model output', ['CONFORMED_GOLD.DIM_SUBSCRIBER.CHURN_PROPENSITY']],
    ['LIFECYCLE_EVENT', 'Subscriber', CRM, undefined, 'Curated, not yet in a Gold fact', ['CURATED_SILVER.SUBSCRIBER_EVENT.EVENT_TYPE']], ['CONTRACT_TERM', 'Subscriber', CRM, undefined, 'Contract end dates', ['CONFORMED_GOLD.DIM_SUBSCRIBER.OUT_OF_CONTRACT']],
    ['RETENTION_OFFER', 'Subscriber', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'], ['HOUSEHOLD', 'Subscriber', 0],
    ['CUSTOMER_NOTE', 'Subscriber', 0, undefined, 'Free text: needs a PII review first'], ['CPNI_CONSENT', 'Subscriber', 0, undefined, 'CPNI opt-in records: legal sign-off pending'],
  ]),
  ...sys('BSS billing', [
    ['INVOICE_HEADER', 'Revenue', BSS], ['RATING_RESULT', 'Revenue', BSS, undefined, undefined, ['CONFORMED_GOLD.FCT_BILLING.RATED_AMOUNT']], ['ROAMING_CHARGE', 'Revenue', BSS, undefined, undefined, ['CONFORMED_GOLD.FCT_BILLING.ROAMING_REVENUE']],
    ['INVOICE_LINE', 'Revenue', BSS, ['DP-05'], 'Handset subsidy lines', ['CONFORMED_GOLD.FCT_BILLING.DEVICE_SUBSIDY']], ['DEVICE_INSTALLMENT', 'Revenue', BSS, ['DP-05'], undefined, ['CONFORMED_GOLD.FCT_BILLING.DEVICE_REVENUE']],
    ['COST_ALLOCATION', 'Revenue', BSS, ['DP-05'], 'Network and interconnect cost per invoice', ['CONFORMED_GOLD.FCT_BILLING.COST_OF_SERVICE']],
    ['PAYMENT_TXN', 'Revenue', 1], ['BILL_ADJUSTMENT', 'Revenue', 1], ['DISCOUNT', 'Revenue', 0], ['COLLECTION_CASE', 'Revenue', 0], ['TAX_LINE', 'Revenue', 0],
  ]),
  ...sys('CDR mediation', [
    ['VOICE_CDR', 'Network', CDR], ['DATA_SESSION', 'Network', CDR, undefined, undefined, ['CONFORMED_GOLD.FCT_DAILY_USAGE.DATA_GB']], ['ROAMING_TAP_FILE', 'Revenue', CDR, undefined, 'TAP files from roaming partners', ['CONFORMED_GOLD.FCT_DAILY_USAGE.ROAMING_MB']],
    ['SMS_RECORD', 'Network', CDR, undefined, 'Curated, not yet aggregated', ['CURATED_SILVER.USAGE_EVENT.EVENT_TYPE']], ['MEDIATION_REJECT', 'Network', 1], ['IPDR', 'Network', 0, undefined, 'Volume too high for the current CDC scope'],
  ]),
  ...sys('OSS network events', [
    ['ALARM_EVENT', 'Network', OSS], ['CELL_KPI_COUNTER', 'Network', OSS, undefined, undefined, ['CONFORMED_GOLD.FCT_NETWORK_DAILY.DROPPED_CALLS']],
    ['CELL_SITE_CONFIG', 'Network', OSS, undefined, 'Site type not yet in a semantic view', ['CONFORMED_GOLD.DIM_CELL_SITE.SITE_TYPE']], ['MAINTENANCE_WINDOW', 'Network', 1],
    ['PM_COUNTER_15MIN', 'Network', 1], ['TRANSPORT_LINK', 'Network', 0], ['RAN_PARAMETER', 'Network', 0], ['NEIGHBOR_RELATION', 'Network', 0],
  ]),
  ...sys('Field service', [
    ['WORK_ORDER', 'Field service', FSM], ['APPOINTMENT', 'Field service', FSM, undefined, undefined, ['CONFORMED_GOLD.FCT_WORK_ORDER.HOURS_TO_RESOLVE']], ['TECHNICIAN', 'Field service', 1],
    ['TRUCK_ROLL', 'Field service', 1], ['PARTS_USAGE', 'Field service', 0],
  ]),
  ...sys('Network inventory', [['SITE_REGISTER', 'Network', 1], ['ANTENNA', 'Network', 0], ['FIBER_ROUTE', 'Network', 0], ['SPECTRUM_LICENSE', 'Network', 0]]),
  ...sys('Retail POS', [['DEVICE_SALE', 'Revenue', 0], ['STORE', 'Revenue', 0], ['DEVICE_INVENTORY', 'Revenue', 1]]),
  ...sys('Customer care', [['CARE_INTERACTION', 'Subscriber', 0], ['IVR_CALL', 'Subscriber', 0], ['CHAT_TRANSCRIPT', 'Subscriber', 0, undefined, 'Free text with CPNI: needs a privacy review']]),
  ...sys('Partner settlement', [['WHOLESALE_ROAMING_SETTLEMENT', 'Revenue', 0], ['INTERCONNECT_INVOICE', 'Revenue', 1]]),
];

type Rep = [name: string, kpis: string[], missing?: string[], tool?: string];
const REPORTS: Rep[] = [
  ['Active subscriber base', ['K-01']], ['Postpaid ARPU by region', ['K-02']], ['Autopay adoption scorecard', ['K-05']], ['Subscriber 360 executive dashboard', ['K-01', 'K-02', 'K-05']],
  ['Data usage per subscriber trend', ['K-03']], ['Minutes of use by plan', ['K-04']], ['Monthly service revenue', ['K-06'], undefined, 'Excel'], ['Revenue leakage by market', ['K-07', 'K-09']],
  ['Roaming revenue share', ['K-08']], ['Rating vs billing reconciliation', ['K-07'], ['Rating engine reject codes'], 'Excel'], ['Dropped call rate by region', ['K-10']],
  ['Network availability scorecard', ['K-11']], ['Call setup success rate', ['K-12']], ['Downlink throughput by technology', ['K-13']], ['Site SLA compliance', ['K-14']],
  ['Mobile data traffic', ['K-15']], ['Worst cell sites (top 50)', ['K-10', 'K-11'], ['Neighbor relation list']], ['Weekly NOC review', ['K-10', 'K-11', 'K-12']],
  ['Postpaid churn by plan and region', ['K-16']], ['Prepaid churn trend', ['K-17']], ['Net adds and gross adds', ['K-18', 'K-19']], ['Port-out analysis', ['K-20'], ['Gaining carrier']],
  ['Broadband churn', ['K-21']], ['Board churn pack', ['K-16', 'K-17', 'K-21'], undefined, 'Excel'], ['Plan gross margin', ['K-22']], ['Device subsidy by handset', ['K-23']],
  ['Margin per subscriber by plan', ['K-24']], ['Pricing review pack', ['K-02', 'K-22', 'K-24']], ['First-time fix by work order type', ['K-25']], ['Hours to resolve by market', ['K-26']],
  ['Field service weekly', ['K-25', 'K-26'], ['Technician utilisation']], ['Churn and network experience', ['K-16', 'K-10']], ['Retention offer take-up', ['K-16'], ['Offer accepted', 'Offer cost']],
  ['Store device sales', [], ['Units sold', 'Store'], 'Excel'], ['Care contact drivers', [], ['Contact reason', 'Handle time']], ['Spectrum utilisation', [], ['Carrier bandwidth']],
  ['Interconnect cost', [], ['Interconnect minutes', 'Settlement rate']], ['Regulatory CPNI audit', ['K-01'], ['Consent status']], ['Truck roll cost', ['K-25'], ['Cost per roll']],
  ['Revenue assurance monthly', ['K-06', 'K-07', 'K-09']],
];
const OWNERS = ['Subscriber Analytics', 'Network Operations', 'Revenue Assurance', 'Finance', 'Field Operations'];
export const legacyReports: LegacyReport[] = REPORTS.map(([name, kpiIds, missing, tool], i) => ({
  id: `RPT-${String(i + 1).padStart(3, '0')}`, name, tool: tool ?? 'Tableau', owner: OWNERS[i % OWNERS.length], kpiIds, missing: missing ?? [],
}));

export const incidents: IncidentScript[] = [
  {
    id: 'INC-1', title: 'Late CDC feed', fault: 'OSS_NETWORK_EVENT_CDC stops receiving alarms for 5 h (fault manager export queue stalled).',
    objectFqn: OSS, dmf: { metric: 'FRESHNESS', value: 300, threshold: 60, unit: ' min' },
    affects: [{ productId: 'DP-02', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'warn', scenarioIds: ['S-07', 'S-08', 'S-09'], message: 'Data as of 5 h ago: OSS alarms have not arrived since 01:10, so downtime and availability for today may be understated.' }],
    resolution: 'Fault manager export queue restarted; 5 h of alarms replayed and NETWORK_EVENT refreshed.', ttdMin: 18, ttrMin: 52,
  },
  {
    id: 'INC-2', title: 'Null spike in a CDE', fault: '16% nulls in FCT_BILLING.SERVICE_REVENUE after a BSS invoice extract change.',
    objectFqn: 'CONFORMED_GOLD.FCT_BILLING', column: 'SERVICE_REVENUE', dmf: { metric: 'NULL_COUNT', value: 16, threshold: 0.5, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }, { productId: 'DP-03', status: 'Degraded' }, { productId: 'DP-05', status: 'Degraded' }],
    agentEffect: [
      { agentId: 'AG-01', mode: 'block', scenarioIds: ['S-01', 'S-04'], message: 'I can’t give ARPU or margin right now: 16% of invoice service revenue (SERVICE_REVENUE, a critical data element) arrived empty in the last load, so any figure would be understated. The revenue data steward has been alerted; ask again once the incident is resolved.' },
      { agentId: 'AG-03', mode: 'warn', message: 'Service revenue is incomplete: 16% of invoices in the last load have no SERVICE_REVENUE, so ARPU and leakage may be off.' },
    ],
    resolution: 'BSS extract re-run with the corrected BILLED_AMT mapping; null rows reloaded and DMFs re-checked.', ttdMin: 11, ttrMin: 90,
  },
  {
    id: 'INC-3', title: 'Duplicate load', fault: 'A replayed mediation batch doubles 2.4 million data CDRs.',
    objectFqn: CDR, dmf: { metric: 'DUPLICATE_COUNT', value: 2_400_000, threshold: 0, unit: ' rows' },
    affects: [{ productId: 'DP-03', status: 'Down' }, { productId: 'DP-01', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'block', scenarioIds: ['S-05'], message: 'Usage answers are paused: a replayed mediation batch doubled 2.4 million data CDRs, so data usage would be overstated. The last good snapshot is 2026-09-29 23:45; I can answer as of then once Usage & Revenue is restored.' }],
    resolution: 'Duplicate batch removed with a MERGE on (CDR_ID, EVENT_TS); FCT_DAILY_USAGE refreshed.', ttdMin: 7, ttrMin: 70,
  },
  {
    id: 'INC-4', title: 'Schema drift', fault: 'CRM adds PLAN_CD_V2 for the new plan catalog and stops filling PLAN_CD.',
    objectFqn: CRM, column: 'PLAN_CD', dmf: { metric: 'CONTRACT_CHECK (PLAN_CD null %)', value: 100, threshold: 1, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }, { productId: 'DP-04', status: 'Degraded' }],
    agentEffect: [
      { agentId: 'AG-02', mode: 'warn', scenarioIds: ['S-06'], message: 'Plan breakdowns are incomplete: CRM added PLAN_CD_V2 and stopped filling PLAN_CD, so lines changed since yesterday have no plan.' },
      { agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-01', 'S-04'], message: 'Plan breakdowns are incomplete: CRM stopped filling PLAN_CD yesterday.' },
    ],
    resolution: 'Data contract updated to map PLAN_CD_V2 to PLAN_CODE; Silver SUBSCRIBER rebuilt.', ttdMin: 32, ttrMin: 165,
  },
  {
    id: 'INC-5', title: 'Volume anomaly', fault: 'Work orders drop 68% day over day.',
    objectFqn: FSM, dmf: { metric: 'ROW_COUNT change', value: -68, threshold: -30, unit: '%' },
    affects: [{ productId: 'DP-06', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'warn', scenarioIds: ['S-08'], message: 'Volume caveat: work orders dropped 68% day over day, so first-time fix for the last day is likely incomplete.' }],
    resolution: 'Field service extract filter corrected; missing work orders backfilled.', ttdMin: 15, ttrMin: 110,
  },
];
