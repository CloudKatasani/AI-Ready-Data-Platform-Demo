// Healthcare: source inventory (E5), legacy Epic Clarity / Crystal Reports (E5) and incident scripts (E9).
import type { IncidentScript, InventoryTable, LegacyReport } from '../../../ext/types';

const PAT = 'RAW_BRONZE.EHR_PATIENT_CDC';
const ENC = 'RAW_BRONZE.EHR_ENCOUNTER_CDC';
const CLM = 'RAW_BRONZE.CLM_837_835_CDC';
const APPT = 'RAW_BRONZE.SCHED_APPT_CDC';
const RX = 'RAW_BRONZE.RX_DISPENSE_CDC';
const SUP = 'RAW_BRONZE.SUPPLY_USAGE_CDC';

type Row = [table: string, domain: string, landsOrLevel: string | 0 | 1, consumedBy?: string[], note?: string, carries?: string[]];
const sys = (source: string, rows: Row[]): InventoryTable[] =>
  rows.map(([table, domain, l, consumedBy, note, carries]) => (typeof l === 'string' ? { source, table, domain, level: 1, lands: l, consumedBy, note, carries } : { source, table, domain, level: l, note }));

export const sourceInventory: InventoryTable[] = [
  ...sys('EHR (ADT, encounters)', [
    ['PATIENT', 'Patient access', PAT, ['DP-01']], ['PAT_COVERAGE', 'Revenue cycle', PAT, ['DP-01'], 'Primary coverage on the current registration', ['CONFORMED_GOLD.DIM_PATIENT.PAYER_CLASS']],
    ['PAT_DEMOGRAPHICS', 'Patient access', PAT, undefined, 'Name and birth date curated, not yet modelled for reporting', ['CURATED_SILVER.PATIENT.FIRST_NAME', 'CURATED_SILVER.PATIENT.BIRTH_DATE']],
    ['PAT_CONTACT', 'Patient access', PAT, undefined, 'Email curated in Silver only', ['CURATED_SILVER.PATIENT.EMAIL']],
    ['MYCHART_STATUS', 'Patient access', PAT, ['DP-01'], undefined, ['CONFORMED_GOLD.DIM_PATIENT.PORTAL_ENROLLED']],
    ['PAT_ENC_HSP', 'Hospital operations', ENC], ['PAT_ENC_ED', 'Hospital operations', ENC, undefined, undefined, ['CONFORMED_GOLD.FCT_ENCOUNTER.ED_WAIT_MIN', 'CONFORMED_GOLD.FCT_ENCOUNTER.LWBS_FLAG']],
    ['ADT_EVENT', 'Hospital operations', ENC, undefined, undefined, ['CONFORMED_GOLD.FCT_ENCOUNTER.LOS_DAYS', 'CONFORMED_GOLD.FCT_ENCOUNTER.DISCHARGE_DATE']],
    ['HSP_DISCHARGE_DISP', 'Quality & safety', ENC, undefined, undefined, ['CONFORMED_GOLD.FCT_READMISSION.IS_ELIGIBLE_INDEX', 'CONFORMED_GOLD.FCT_READMISSION.READMIT_30D_FLAG']],
    ['CLARITY_DEP', 'Hospital operations', ENC, undefined, 'Department master: trauma designation not yet in a semantic view', ['CONFORMED_GOLD.DIM_FACILITY.TRAUMA_LEVEL']],
    ['BED_CENSUS', 'Hospital operations', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'],
    ['ORDER_PROC', 'Hospital operations', 1], ['CLARITY_SER', 'Hospital operations', 0, undefined, 'Provider master'],
    ['NOTE_TEXT', 'Quality & safety', 0, undefined, 'Clinical notes: needs a HIPAA minimum-necessary review first'],
    ['PROBLEM_LIST', 'Population health', 0], ['FLOWSHEET_MEAS', 'Quality & safety', 0],
  ]),
  ...sys('Claims & remits (837/835)', [
    ['CLAIM_837I', 'Revenue cycle', CLM], ['CLAIM_837P', 'Revenue cycle', CLM], ['REMIT_835', 'Revenue cycle', CLM, undefined, undefined, ['CONFORMED_GOLD.FCT_CLAIM.PAID_USD', 'CONFORMED_GOLD.FCT_CLAIM.OPEN_AR_USD']],
    ['CARC_DENIAL', 'Revenue cycle', CLM, undefined, undefined, ['CONFORMED_GOLD.FCT_CLAIM.IS_DENIED', 'CONFORMED_GOLD.FCT_CLAIM.DENIAL_REASON']],
    ['PAYER_MASTER', 'Revenue cycle', CLM, undefined, undefined, ['CONFORMED_GOLD.DIM_PAYER.PAYER_NAME', 'CONFORMED_GOLD.DIM_PAYER.PAYER_CLASS']],
    ['CLEARINGHOUSE_EDIT', 'Revenue cycle', CLM, undefined, undefined, ['CURATED_SILVER.CLAIM.IS_CLEAN']],
    ['ELIGIBILITY_270_271', 'Revenue cycle', 1], ['PRIOR_AUTH', 'Revenue cycle', 1], ['CLAIM_ATTACHMENT_275', 'Revenue cycle', 0], ['APPEAL_LOG', 'Revenue cycle', 0],
  ]),
  ...sys('Scheduling', [
    ['APPOINTMENT', 'Patient access', APPT], ['APPT_STATUS_HIST', 'Patient access', APPT, undefined, undefined, ['CONFORMED_GOLD.FCT_APPOINTMENT.APPT_STATUS']],
    ['VISIT_TYPE', 'Patient access', APPT, undefined, 'New vs established: not yet in a semantic view', ['CONFORMED_GOLD.FCT_APPOINTMENT.VISIT_TYPE']],
    ['CLINIC_DEPARTMENT', 'Patient access', APPT, undefined, 'Affiliated hospital not yet mapped', ['CONFORMED_GOLD.DIM_CLINIC.PARENT_FACILITY']],
    ['BOOKING_AUDIT', 'Patient access', APPT, undefined, undefined, ['CURATED_SILVER.APPOINTMENT.BOOKED_DATE']],
    ['SLOT_TEMPLATE', 'Patient access', 1], ['WAITLIST', 'Patient access', 0], ['REFERRAL', 'Patient access', 0],
  ]),
  ...sys('Pharmacy', [
    ['MAR_DISPENSE', 'Supply chain', RX, ['DP-05']], ['NDC_FORMULARY', 'Supply chain', RX, ['DP-05']],
    ['DRUG_COST', 'Supply chain', RX, undefined, 'Extended cost curated in Silver', ['CURATED_SILVER.PHARMACY_DISPENSE.COST_USD']],
    ['RX_ORDER', 'Supply chain', 1], ['CONTROLLED_SUBSTANCE_LOG', 'Supply chain', 0, undefined, 'DEA records: separate access controls needed first'],
  ]),
  ...sys('Supply chain', [
    ['POU_CAPTURE', 'Supply chain', SUP, ['DP-05']], ['IMPLANT_LOG', 'Supply chain', SUP, ['DP-05']], ['ITEM_MASTER', 'Supply chain', SUP, ['DP-05'], undefined, ['CONFORMED_GOLD.FCT_SUPPLY_USAGE.CATEGORY']],
    ['GPO_CONTRACT', 'Supply chain', SUP, ['DP-05'], undefined, ['CONFORMED_GOLD.FCT_SUPPLY_USAGE.ON_CONTRACT']],
    ['VENDOR_MASTER', 'Supply chain', SUP, undefined, 'Vendor names cleansed in Silver only', ['CURATED_SILVER.SUPPLY_USAGE.VENDOR']],
    ['PURCHASE_ORDER', 'Supply chain', 1], ['PAR_LEVEL', 'Supply chain', 0], ['RECALL_NOTICE', 'Supply chain', 0],
  ]),
  ...sys('Lab (LIS)', [
    ['LAB_RESULT', 'Quality & safety', 1, undefined, 'HbA1c results needed to close care gaps'], ['LAB_ORDER', 'Quality & safety', 0], ['MICRO_CULTURE', 'Quality & safety', 0],
  ]),
  ...sys('ERP / general ledger', [
    ['GL_JOURNAL', 'Finance', 1], ['COST_CENTER', 'Finance', 0], ['PAYROLL_HOURS', 'Finance', 0],
  ]),
];

type Rep = [name: string, kpis: string[], missing?: string[]];
const REPORTS: Rep[] = [
  ['Active patient panel by market', ['K-01']], ['Self-pay and uninsured patients', ['K-02', 'K-01']], ['MyChart activation scorecard', ['K-03']],
  ['Patient risk stratification list', ['K-04'], ['HCC category detail']], ['Days in A/R trend', ['K-05']], ['Denials by payer and CARC', ['K-06']],
  ['Clean claim rate by clearinghouse batch', ['K-07'], ['Clearinghouse batch id']], ['Net collection rate by payer class', ['K-08']], ['A/R aging buckets', ['K-09', 'K-05']],
  ['Daily claim submission log', ['K-10']], ['Revenue cycle executive dashboard', ['K-05', 'K-06', 'K-07', 'K-08']], ['Bad debt and charity write-offs', ['K-08'], ['Charity care flag', 'Write-off reason']],
  ['Average length of stay by service line', ['K-11']], ['Midnight census and occupancy', ['K-12']], ['ED throughput: door to provider', ['K-13', 'K-14']],
  ['Monthly discharges by hospital', ['K-15']], ['Clinic no-show report', ['K-16']], ['New patient access lag', ['K-17']],
  ['30-day readmissions (CMS method)', ['K-18', 'K-21']], ['Transitional care follow-up', ['K-19']], ['Inpatient mortality review', ['K-20'], ['Expected mortality (risk adjusted)']],
  ['Quality committee monthly pack', ['K-18', 'K-19', 'K-20']], ['Hospital operations daily huddle', ['K-11', 'K-12', 'K-13']], ['Supply cost per surgical case', ['K-22']],
  ['Clinical supply and pharmacy spend', ['K-23']], ['On-contract compliance by vendor', ['K-24']], ['Perioperative margin review', ['K-22', 'K-11'], ['OR minutes per case']],
  ['Implant cost by surgeon', ['K-22'], ['Surgeon']], ['HEDIS care gap worklist', ['K-25']], ['Open care gaps by PCP', ['K-26']],
  ['Value-based contract scorecard', ['K-25', 'K-18'], ['Attributed lives by contract']], ['Readmissions and care gaps joint review', ['K-18', 'K-26']], ['Payer contract variance', ['K-08', 'K-06'], ['Contracted rate']],
  ['Surgical case volume by hospital', ['K-15'], ['Case type (inpatient vs outpatient surgery)']], ['Nurse staffing ratios', [], ['Nursing hours per patient day', 'Unit staffing grid']],
  ['Lab turnaround times', [], ['Lab order and result timestamps']], ['Pharmacy controlled substance audit', [], ['DEA schedule', 'Waste records']], ['Patient experience (HCAHPS)', [], ['Survey responses']],
  ['Central line infection (CLABSI) log', [], ['Line days', 'Infection events']], ['Charge capture lag', ['K-10'], ['Charge post date']],
];
const OWNERS = ['Revenue Cycle', 'Hospital Operations', 'Quality & Patient Safety', 'Clinical Supply Chain', 'Population Health', 'Patient Access'];
export const legacyReports: LegacyReport[] = REPORTS.map(([name, kpiIds, missing], i) => ({
  id: `RPT-${String(i + 1).padStart(3, '0')}`, name, tool: 'Epic Clarity / SAP Crystal Reports', owner: OWNERS[i % OWNERS.length], kpiIds, missing: missing ?? [],
}));

export const incidents: IncidentScript[] = [
  {
    id: 'INC-1', title: 'Late CDC feed', fault: 'EHR_ENCOUNTER_CDC stops receiving ADT rows for 5 h (HL7 interface engine queue stalled).',
    objectFqn: ENC, dmf: { metric: 'FRESHNESS', value: 300, threshold: 60, unit: ' min' },
    affects: [{ productId: 'DP-02', status: 'Degraded' }, { productId: 'DP-04', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'warn', message: 'Data as of 5 h ago: ADT admissions and discharges have not arrived since 01:04, so census, length of stay and readmission figures may be incomplete.' }],
    resolution: 'Interface engine queue restarted; 5 h of ADT messages replayed and ENCOUNTER refreshed.', ttdMin: 18, ttrMin: 55,
  },
  {
    id: 'INC-2', title: 'Null spike in a CDE', fault: '16% nulls in CLAIM.EXPECTED_NET_USD after a contract-modelling extract change.',
    objectFqn: 'CURATED_SILVER.CLAIM', column: 'EXPECTED_NET_USD', dmf: { metric: 'NULL_COUNT', value: 16, threshold: 0.5, unit: '%' },
    affects: [{ productId: 'DP-03', status: 'Degraded' }, { productId: 'DP-01', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'block', scenarioIds: ['S-03'], message: 'I can’t list open balances right now: 16% of expected reimbursement amounts (EXPECTED_NET_USD, a critical data element) arrived empty in the last load, so balances would be understated. The revenue cycle data steward has been alerted; ask again once the incident is resolved.' }],
    resolution: 'Contract-modelling extract re-run with the corrected expected-reimbursement mapping; null rows reloaded and DMFs re-checked.', ttdMin: 11, ttrMin: 90,
  },
  {
    id: 'INC-3', title: 'Duplicate load', fault: 'A replayed SIU batch doubles 18,000 clinic appointment rows.',
    objectFqn: APPT, dmf: { metric: 'DUPLICATE_COUNT', value: 18000, threshold: 0, unit: ' rows' },
    affects: [{ productId: 'DP-02', status: 'Down' }],
    agentEffect: [{ agentId: 'AG-03', mode: 'block', scenarioIds: ['S-11'], message: 'No-show answers are paused: a replayed scheduling batch doubled 18,000 appointment rows, so no-show rates would be wrong. The last good snapshot is 2026-09-29 23:30; I can answer as of then once Encounters & Throughput is restored.' }],
    resolution: 'Duplicate batch removed with a MERGE on (APPT_ID, OP_TS); downstream dynamic tables refreshed.', ttdMin: 7, ttrMin: 70,
  },
  {
    id: 'INC-4', title: 'Schema drift', fault: 'The EHR adds COVERAGE_PLAN_ID and stops filling PRIMARY_PAYER_ID on new registrations.',
    objectFqn: PAT, column: 'PRIMARY_PAYER_ID', dmf: { metric: 'CONTRACT_CHECK (PRIMARY_PAYER_ID null %)', value: 100, threshold: 1, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-02'], message: 'Payer class breakdowns are incomplete: the EHR added COVERAGE_PLAN_ID and stopped filling PRIMARY_PAYER_ID, so patients registered since yesterday show no payer class and may be counted as self-pay.' }],
    resolution: 'Data contract updated to map COVERAGE_PLAN_ID to PRIMARY_PAYER_ID; Silver PATIENT rebuilt.', ttdMin: 40, ttrMin: 165,
  },
  {
    id: 'INC-5', title: 'Volume anomaly', fault: 'Point-of-use supply lines drop 65% day over day.',
    objectFqn: SUP, dmf: { metric: 'ROW_COUNT change', value: -65, threshold: -30, unit: '%' },
    affects: [{ productId: 'DP-05', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-04'], message: 'Volume caveat: point-of-use supply lines dropped 65% day over day, so supply cost for the last day is likely understated.' }],
    resolution: 'Supply chain extract filter corrected; missing usage lines backfilled.', ttdMin: 15, ttrMin: 110,
  },
];
