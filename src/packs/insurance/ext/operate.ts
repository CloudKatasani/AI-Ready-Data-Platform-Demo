// Insurance: source inventory (E5), legacy Cognos and SAS reports (E5) and incident scripts (E9).
import type { IncidentScript, InventoryTable, LegacyReport } from '../../../ext/types';

const PAS = 'RAW_BRONZE.PAS_POLICY_CDC';
const CLM = 'RAW_BRONZE.CLM_CLAIM_CDC';
const BIL = 'RAW_BRONZE.BIL_INVOICE_CDC';
const AGT = 'RAW_BRONZE.AGT_SUBMISSION_CDC';
const CAT = 'RAW_BRONZE.CAT_EVENT_FEED';

type Row = [table: string, domain: string, landsOrLevel: string | 0 | 1, consumedBy?: string[], note?: string, carries?: string[]];
const sys = (source: string, rows: Row[]): InventoryTable[] =>
  rows.map(([table, domain, l, consumedBy, note, carries]) => (typeof l === 'string' ? { source, table, domain, level: 1, lands: l, consumedBy, note, carries } : { source, table, domain, level: l, note }));

export const sourceInventory: InventoryTable[] = [
  ...sys('Policy administration', [
    ['POLICY_MASTER', 'Policyholder', PAS], ['POLICY_TERM', 'Policyholder', PAS], ['POLICYHOLDER', 'Policyholder', PAS, ['DP-01'], 'Contact details feed Policyholder 360 only'],
    ['COVERAGE', 'Policyholder', PAS, undefined, 'Coverage limits curated, not yet modelled', ['CURATED_SILVER.POLICY.ANNUAL_PREMIUM']], ['PH_DEMOGRAPHICS', 'Policyholder', PAS, undefined, 'Date of birth curated for rating only', ['CURATED_SILVER.POLICY.BIRTH_DATE']],
    ['LOB_REFERENCE', 'Policyholder', PAS, undefined, 'Annual statement line not yet in a semantic view', ['CONFORMED_GOLD.DIM_LINE_OF_BUSINESS.ANNUAL_STATEMENT_LINE']],
    ['PROPERTY_SCHEDULE', 'Catastrophe risk', PAS, ['DP-06'], 'TIV by location; Catastrophe Exposure is Draft', ['CONFORMED_GOLD.DIM_POLICY.TOTAL_INSURED_VALUE']],
    ['CANCELLATION', 'Policyholder', PAS], ['ENDORSEMENT', 'Policyholder', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'], ['RATING_WORKSHEET', 'Policyholder', 1], ['UNDERWRITING_NOTE', 'Policyholder', 0],
    ['FORMS_ATTACHED', 'Policyholder', 0], ['VEHICLE_SCHEDULE', 'Policyholder', 0], ['DRIVER_SCHEDULE', 'Policyholder', 0, undefined, 'Driver licence numbers: needs a privacy review first'],
  ]),
  ...sys('Claims', [
    ['CLAIM_HEADER', 'Claims', CLM], ['FNOL', 'Claims', CLM, undefined, undefined, ['CURATED_SILVER.CLAIM.REPORT_DATE', 'CONFORMED_GOLD.FCT_CLAIM.CYCLE_DAYS']], ['CLAIMANT', 'Claims', CLM, undefined, 'Claimant identity curated in Silver', ['CURATED_SILVER.CLAIM.CLAIMANT_NAME']],
    ['CAUSE_OF_LOSS', 'Claims', CLM, undefined, 'Standardised cause of loss not yet modelled', ['CURATED_SILVER.CLAIM.CAUSE_OF_LOSS']],
    ['CLAIM_PAYMENT', 'Claims', CLM, undefined, undefined, ['CURATED_SILVER.CLAIM_TRANSACTION.AMOUNT_USD', 'CONFORMED_GOLD.FCT_CLAIM_TRANSACTION.AMOUNT_USD']],
    ['RESERVE_HISTORY', 'Claims', CLM, ['DP-05'], 'Feeds Loss Reserves only'], ['IBNR_ALLOCATION', 'Claims', CLM, ['DP-05'], 'Feeds Loss Reserves only'],
    ['SUBROGATION', 'Claims', CLM, undefined, undefined, ['CONFORMED_GOLD.FCT_CLAIM.SUBRO_RECOVERED']], ['FRAUD_REFERRAL', 'Claims', CLM, undefined, 'SIU score modelled, used by no product question', ['CONFORMED_GOLD.FCT_CLAIM.FRAUD_SCORE']],
    ['ADJUSTER_ASSIGNMENT', 'Claims', 1], ['CLAIM_DIARY', 'Claims', 0], ['MEDICAL_BILL', 'Claims', 0, undefined, 'PHI: needs masking design before landing'], ['LITIGATION', 'Claims', 0], ['SALVAGE', 'Claims', 0],
  ]),
  ...sys('Billing', [
    ['INVOICE', 'Finance', BIL], ['PAYMENT', 'Finance', BIL], ['PAY_PLAN', 'Finance', BIL, undefined, undefined, ['DATA_PRODUCTS.DP_PREMIUM_BILLING.PAY_PLAN']],
    ['DELINQUENCY_NOTICE', 'Finance', BIL, undefined, undefined, ['CURATED_SILVER.PREMIUM_INVOICE.DAYS_PAST_DUE', 'CONFORMED_GOLD.FCT_PREMIUM.DAYS_PAST_DUE']], ['EARNED_PREMIUM_LEDGER', 'Finance', BIL],
    ['COMMISSION_STATEMENT', 'Finance', 1, undefined, 'Landed for finance only; producer pay is out of scope for agents'], ['REFUND', 'Finance', 1], ['CASH_RECEIPT', 'Finance', 1], ['GL_JOURNAL', 'Finance', 0], ['PREMIUM_TAX', 'Finance', 0],
  ]),
  ...sys('Agent & broker portal', [
    ['SUBMISSION', 'Distribution', AGT], ['QUOTE', 'Distribution', AGT], ['BIND_REQUEST', 'Distribution', AGT], ['AGENCY', 'Distribution', AGT, undefined, undefined, ['CONFORMED_GOLD.DIM_PRODUCER.AGENCY_NAME', 'CONFORMED_GOLD.DIM_PRODUCER.CHANNEL']],
    ['PRODUCER_LICENSE', 'Distribution', 1], ['APPOINTMENT', 'Distribution', 0], ['PORTAL_SESSION', 'Distribution', 0], ['SUBMISSION_DOCUMENT', 'Distribution', 0], ['MARKETING_CAMPAIGN', 'Distribution', 0],
  ]),
  ...sys('Catastrophe feeds', [
    ['CAT_EVENT', 'Catastrophe risk', CAT], ['CAT_FOOTPRINT', 'Catastrophe risk', CAT, undefined, 'Event footprints fail freshness DMFs'], ['HURRICANE_TRACK', 'Catastrophe risk', 1],
    ['WILDFIRE_PERIMETER', 'Catastrophe risk', 1], ['MODELLED_AAL', 'Catastrophe risk', 0, undefined, 'Vendor cat-model output; licence review pending'],
  ]),
  ...sys('Documents', [
    ['UW_GUIDELINE_INDEX', 'Policyholder', 1, undefined, 'Indexed in Cortex Search, not tabular'], ['NAIC_FILING_ARCHIVE', 'Finance', 0], ['RESERVING_MEMO', 'Claims', 0],
  ]),
];

type Rep = [name: string, kpis: string[], missing?: string[], tool?: string];
const REPORTS: Rep[] = [
  ['Monthly loss ratio by line', ['K-01']], ['Combined ratio flash', ['K-02', 'K-09', 'K-15']], ['Claims cycle time by adjuster', ['K-03'], ['Adjuster name']],
  ['Average severity trend', ['K-04']], ['Subrogation recovery tracker', ['K-05']], ['Claim frequency by state', ['K-06'], ['Exposure units']],
  ['Open claims inventory', ['K-07']], ['Catastrophe loss summary', ['K-08', 'K-10']], ['Incurred losses by accident year', ['K-10'], ['Accident year development triangle'], 'SAS'],
  ['Paid losses daily', ['K-11']], ['Earned and written premium', ['K-12', 'K-13']], ['Premium growth by state', ['K-14']],
  ['Expense ratio by line', ['K-15']], ['Average premium per policy', ['K-16']], ['Billing delinquency aging', ['K-17'], ['Aging bucket by 30 days']],
  ['Policy retention scorecard', ['K-18']], ['Policies in force by region', ['K-19']], ['Policyholder tenure profile', ['K-20']],
  ['Quote-to-bind by agency', ['K-21']], ['New business premium by channel', ['K-22']], ['Agency quote turnaround', ['K-23']],
  ['Case reserve balance', ['K-24']], ['IBNR by line', ['K-25'], undefined, 'SAS'], ['Average reserve per open claim', ['K-26']],
  ['Cat-zone TIV accumulation', ['K-27', 'K-28']], ['Hurricane season exposure pack', ['K-27'], ['Modelled AAL'], 'SAS'],
  ['Quarterly underwriting board pack', ['K-01', 'K-02', 'K-08', 'K-12']], ['Large loss review', ['K-07', 'K-10'], ['Litigation status']],
  ['Reserve adequacy review', ['K-24', 'K-25', 'K-10'], undefined, 'SAS'], ['Statutory Schedule P support', ['K-10', 'K-11', 'K-25'], ['Schedule P line mapping'], 'SAS'],
  ['Agency production review', ['K-21', 'K-22', 'K-23']], ['Renewal and retention by agency', ['K-18', 'K-21'], ['Agency appointment date']],
  ['Claims operations dashboard', ['K-03', 'K-07', 'K-11']], ['Premium and loss by state', ['K-10', 'K-12']], ['Fraud referral summary', [], ['SIU referral outcome', 'Fraud score band']],
  ['Litigation tracker', [], ['Defence counsel', 'Suit date']], ['Commission statement reconciliation', [], ['Commission rate']], ['Medical bill review savings', [], ['Bill amount', 'Allowed amount'], 'SAS'],
  ['Policyholder 360 snapshot', ['K-16', 'K-18', 'K-19', 'K-20']], ['Loss ratio by agency', ['K-01', 'K-21'], ['Agency of record on claim']],
];
const OWNERS = ['Claims Analytics', 'Underwriting', 'Actuarial', 'Finance', 'Distribution'];
export const legacyReports: LegacyReport[] = REPORTS.map(([name, kpiIds, missing, tool], i) => ({
  id: `RPT-${String(i + 1).padStart(3, '0')}`, name, tool: tool ?? 'Cognos', owner: OWNERS[i % OWNERS.length], kpiIds, missing: missing ?? [],
}));

export const incidents: IncidentScript[] = [
  {
    id: 'INC-1', title: 'Late CDC feed', fault: 'CLM_CLAIM_CDC stops receiving rows for 5 h (claims system CDC connector stalled).',
    objectFqn: CLM, dmf: { metric: 'FRESHNESS', value: 300, threshold: 60, unit: ' min' },
    affects: [{ productId: 'DP-02', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-02', 'S-05'], message: 'Data as of 5 h ago: claim updates have not arrived since 06:05, so open claims and payments may be out of date.' }],
    resolution: 'CDC connector restarted; 5 h of claim changes replayed and CURATED_SILVER.CLAIM refreshed.', ttdMin: 18, ttrMin: 52,
  },
  {
    id: 'INC-2', title: 'Null spike in a CDE', fault: '14% nulls in POLICY.LINE_OF_BUSINESS after a policy administration code-table change.',
    objectFqn: 'CURATED_SILVER.POLICY', column: 'LINE_OF_BUSINESS', dmf: { metric: 'NULL_COUNT', value: 14, threshold: 0.5, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }, { productId: 'DP-03', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'block', scenarioIds: ['S-06', 'S-09'], message: 'I can’t give loss ratios by line right now: 14% of policies (LINE_OF_BUSINESS, a critical data element) arrived without a line in the last load, so earned premium by line would be understated. The policy data steward has been alerted; ask again once the incident is resolved.' }],
    resolution: 'Code-table mapping for the new LOB codes added to the Silver transform; POLICY rebuilt and DMFs re-checked.', ttdMin: 11, ttrMin: 140,
  },
  {
    id: 'INC-3', title: 'Duplicate load', fault: 'A replayed billing batch doubles 52,000 September premium invoices.',
    objectFqn: BIL, dmf: { metric: 'DUPLICATE_COUNT', value: 52000, threshold: 0, unit: ' rows' },
    affects: [{ productId: 'DP-03', status: 'Down' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'block', scenarioIds: ['S-09'], message: 'Combined ratio answers are paused: a replayed billing batch doubled 52,000 September invoices, so premium figures would be overstated. The last good snapshot is 2026-09-29 23:00; I can answer as of then once Premium & Billing is restored.' }],
    resolution: 'Duplicate batch removed with a MERGE on (INVOICE_NO, OP_TS); downstream dynamic tables refreshed.', ttdMin: 7, ttrMin: 70,
  },
  {
    id: 'INC-4', title: 'Schema drift', fault: 'The portal adds SUB_TYPE_CD_V2 and stops filling SUB_TYPE_CD.',
    objectFqn: AGT, column: 'SUB_TYPE_CD', dmf: { metric: 'CONTRACT_CHECK (SUB_TYPE_CD null %)', value: 100, threshold: 1, unit: '%' },
    affects: [{ productId: 'DP-04', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-03', mode: 'warn', scenarioIds: ['S-12'], message: 'New business premium may be overstated: the portal moved submission type to SUB_TYPE_CD_V2, so rewrites and reinstatements bound since yesterday cannot be excluded.' }],
    resolution: 'Data contract updated to map SUB_TYPE_CD_V2 to SUBMISSION_TYPE; Silver SUBMISSION rebuilt.', ttdMin: 40, ttrMin: 210,
  },
  {
    id: 'INC-5', title: 'Volume anomaly', fault: 'Policy CDC rows drop 65% day over day.',
    objectFqn: PAS, dmf: { metric: 'ROW_COUNT change', value: -65, threshold: -30, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }, { productId: 'DP-06', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'warn', scenarioIds: ['S-08'], message: 'Volume caveat: policy changes dropped 65% day over day, so in-force TIV may miss yesterday’s new and renewed property policies.' }],
    resolution: 'Policy administration extract filter corrected; missing policy changes backfilled.', ttdMin: 15, ttrMin: 105,
  },
];
