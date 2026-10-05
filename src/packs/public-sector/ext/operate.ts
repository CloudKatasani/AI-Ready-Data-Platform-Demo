// Public Sector: source inventory (E5), legacy Oracle BI (OBIEE) and Excel reports (E5) and incident scripts (E9).
import type { IncidentScript, InventoryTable, LegacyReport } from '../../../ext/types';
import { fmtInt } from '../../../lib/format';
import type { PsData } from '../data';
import { PERIODS } from '../queries';

const PERSON = 'RAW_BRONZE.CM_PERSON_CDC';
const CASE = 'RAW_BRONZE.CM_CASE_CDC';
const ELIG = 'RAW_BRONZE.ELIG_APPLICATION_CDC';
const PAY = 'RAW_BRONZE.BEN_PAYMENT_CDC';
const SR = 'RAW_BRONZE.SR311_REQUEST_CDC';
const GL = 'RAW_BRONZE.FIN_GL_CDC';

type Row = [table: string, domain: string, landsOrLevel: string | 0 | 1, consumedBy?: string[], note?: string, carries?: string[]];
const sys = (source: string, rows: Row[]): InventoryTable[] =>
  rows.map(([table, domain, l, consumedBy, note, carries]) => (typeof l === 'string' ? { source, table, domain, level: 1, lands: l, consumedBy, note, carries } : { source, table, domain, level: l, note }));

const C = 'Constituent';
const E = 'Eligibility & case management';
const P = 'Payments & integrity';
const F = 'Finance & workforce';

export const sourceInventory: InventoryTable[] = [
  ...sys('Case management', [
    ['PERSON', C, PERSON], ['PERSON_ADDRESS', C, PERSON, undefined, 'Street address kept in Silver only', ['CURATED_SILVER.CONSTITUENT.STREET_ADDRESS']],
    ['PERSON_CONTACT', C, PERSON, undefined, 'Email and phone', ['CONFORMED_GOLD.DIM_CONSTITUENT.EMAIL']], ['HOUSEHOLD_MEMBER', C, PERSON, undefined, undefined, ['CONFORMED_GOLD.DIM_CONSTITUENT.HOUSEHOLD_SIZE']],
    ['LANGUAGE_PREFERENCE', C, PERSON, ['DP-01'], undefined, ['CONFORMED_GOLD.DIM_CONSTITUENT.PREFERRED_LANGUAGE']],
    ['CASE_HEADER', E, CASE], ['CASE_ASSIGNMENT', E, CASE, undefined, 'Caseworker assignment', ['CONFORMED_GOLD.FCT_CASE.CASEWORKER_ID']], ['PENDING_ACTION', E, CASE, undefined, undefined, ['CONFORMED_GOLD.FCT_CASE.PENDING_ACTION']],
    ['RENEWAL_SCHEDULE', E, CASE, undefined, undefined, ['CONFORMED_GOLD.FCT_CASE.NEXT_RENEWAL_DATE']], ['OFFICE', E, CASE, undefined, undefined, ['CONFORMED_GOLD.DIM_OFFICE.OFFICE_NAME']],
    ['CASE_NOTE', E, 0, undefined, 'Free-text notes: needs a privacy review before landing'], ['CASE_TRANSFER', E, 1, undefined, 'Landed to a staging schema; CDC not yet enabled'],
  ]),
  ...sys('Eligibility', [
    ['APPLICATION', E, ELIG], ['APPLICATION_PROGRAM', E, ELIG, undefined, undefined, ['CONFORMED_GOLD.FCT_APPLICATION.PROGRAM_KEY']], ['VERIFICATION_ITEM', E, ELIG, undefined, 'Drives the complete date', ['CONFORMED_GOLD.FCT_APPLICATION.COMPLETE_DATE']],
    ['DETERMINATION', E, ELIG, undefined, undefined, ['CONFORMED_GOLD.FCT_APPLICATION.DECISION', 'CONFORMED_GOLD.FCT_APPLICATION.PROCESSING_BUSINESS_DAYS']], ['EXPEDITED_SCREENING', E, ELIG, undefined, undefined, ['CONFORMED_GOLD.FCT_APPLICATION.IS_EXPEDITED']],
    ['INCOME_RECORD', E, 1, undefined, 'Landed for the data-match pilot only'], ['NOTICE_OF_ACTION', E, 0], ['FAIR_HEARING_REQUEST', E, 0],
    ['PROGRAM_RULE_TABLE', E, 0, undefined, 'Maintained in the rules engine, not the database'],
  ]),
  ...sys('Benefits payments', [
    ['ISSUANCE', P, PAY], ['EBT_TRANSACTION', P, PAY, undefined, undefined, ['CONFORMED_GOLD.FCT_PAYMENT.ISSUED_ON_TIME']], ['PROVIDER_DISBURSEMENT', P, PAY, undefined, 'Child care provider payments', ['CONFORMED_GOLD.FCT_PAYMENT.PAYMENT_AMOUNT']],
    ['QC_REVIEW', P, PAY, undefined, 'Quality-control sample findings', ['CONFORMED_GOLD.FCT_PAYMENT.IS_IMPROPER', 'CONFORMED_GOLD.FCT_PAYMENT.IMPROPER_AMOUNT']],
    ['INTEGRITY_FLAG', P, PAY, ['DP-05'], 'Only feeds Program Integrity'], ['OVERPAYMENT_CLAIM', P, PAY, ['DP-05'], 'Only feeds Program Integrity'], ['RECOVERY_RECEIPT', P, PAY, ['DP-05'], 'Only feeds Program Integrity'],
    ['DATA_MATCH_RESULT', P, PAY, ['DP-05'], 'Income, employment and address matches'],
    ['EBT_CARD', P, 0], ['REPLACEMENT_ISSUANCE', P, 1], ['VENDOR_PAYEE', P, 0],
  ]),
  ...sys('311 service requests', [
    ['SERVICE_REQUEST', C, SR], ['REQUEST_TYPE', C, SR, undefined, undefined, ['CONFORMED_GOLD.FCT_SERVICE_REQUEST.REQUEST_TYPE']], ['WORK_ASSIGNMENT', C, SR, undefined, 'Department routing', ['CONFORMED_GOLD.FCT_SERVICE_REQUEST.DEPARTMENT']],
    ['SURVEY_RESPONSE', C, SR, ['DP-04'], undefined, ['CONFORMED_GOLD.FCT_SERVICE_REQUEST.SURVEY_SCORE']], ['REQUEST_STATUS_HISTORY', C, SR, undefined, 'Status changes kept in Silver only', ['CURATED_SILVER.SERVICE_REQUEST.STATUS']],
    ['REQUEST_ATTACHMENT', C, 0, undefined, 'Photos: unstructured, not in scope'], ['AGENT_CALL_LOG', C, 1], ['KNOWLEDGE_ARTICLE', C, 0],
  ]),
  ...sys('Finance', [
    ['GL_BALANCE', F, GL], ['BUDGET_LINE', F, GL], ['POSITION_CONTROL', F, GL, undefined, 'Authorised and filled positions'],
    ['COST_CENTER', F, 1], ['ENCUMBRANCE', F, 0], ['GRANT_AWARD', F, 0, undefined, 'Federal and state grant funding'], ['JOURNAL_ENTRY', F, 0],
  ]),
  ...sys('HR system', [['EMPLOYEE', F, 0, undefined, 'Sensitive HR data: needs a privacy review first'], ['VACANCY_REQUISITION', F, 1], ['TIMESHEET', F, 0]]),
  ...sys('Child care provider portal', [['PROVIDER', P, 1], ['ATTENDANCE_CLAIM', P, 0], ['PROVIDER_LICENSE', P, 0]]),
  ...sys('Document imaging', [['DOCUMENT_INDEX', E, 0], ['SCANNED_VERIFICATION', E, 0, undefined, 'Images: would need document AI first']]),
];

type Rep = [name: string, kpis: string[], missing?: string[], excel?: boolean];
const REPORTS: Rep[] = [
  ['Active constituents by district', ['K-01']], ['Multi-program enrollment summary', ['K-02']], ['Online application share', ['K-04']],
  ['Constituent services monthly pack', ['K-01', 'K-02', 'K-04']], ['Renewals due next 30 days by caseworker', ['K-01'], ['Caseworker name on renewal list'], true],
  ['311 monthly service level report', ['K-05', 'K-06', 'K-07']], ['311 resolution time by department', ['K-06']], ['311 reopen tracker', ['K-08'], undefined, true],
  ['311 satisfaction survey results', ['K-03']], ['Open-data 311 extract', ['K-05', 'K-06'], ['Small-cell suppression flag']], ['Council district 311 briefing', ['K-05', 'K-07'], ['Council district boundary'], true],
  ['Case backlog by office', ['K-09']], ['Caseload per caseworker', ['K-14']], ['Applications received by channel', ['K-15']],
  ['Timeliness: 30-day processing standard', ['K-11', 'K-12']], ['Average processing days by program', ['K-10']], ['Approval and denial rates', ['K-13']],
  ['State timeliness submission', ['K-10', 'K-11', 'K-12'], ['Expedited 7-day standard breakdown'], true], ['Eligibility operations weekly', ['K-09', 'K-10', 'K-15']],
  ['Pending applications aging', ['K-11'], ['Pending age buckets']], ['Benefits issued by program', ['K-16']], ['Payment accuracy by program', ['K-17']],
  ['Improper payment rate (state QC)', ['K-18', 'K-19']], ['On-time issuance report', ['K-20']], ['Benefit disbursement reconciliation', ['K-16'], ['Bank settlement totals'], true],
  ['Improper payments over $300', ['K-19']], ['Integrity flags by district', ['K-22']], ['Integrity flag rate trend', ['K-23']],
  ['Overpayment recovery status', ['K-24'], undefined, true], ['Program integrity quarterly to the state', ['K-22', 'K-23', 'K-24']],
  ['Cost per case', ['K-21'], undefined, true], ['Budget vs actual by department', ['K-25'], undefined, true], ['Caseworker vacancy report', ['K-26'], undefined, true],
  ['Human services budget hearing pack', ['K-21', 'K-25', 'K-26', 'K-14'], ['Grant funding by source'], true], ['County manager scorecard', ['K-01', 'K-09', 'K-18', 'K-07']],
  ['Integrity and accuracy joint review', ['K-17', 'K-22']], ['Fair hearing outcomes', [], ['Hearing requests', 'Hearing decisions']], ['Notice of action volumes', [], ['Notices issued by type']],
  ['Child care provider attendance', [], ['Provider attendance claims'], true], ['Staff overtime by office', [], ['Timesheet hours', 'Overtime cost'], true],
];
const OWNERS = ['Constituent Services', '311 Contact Center', 'Eligibility Services', 'Benefit Disbursement', 'Program Integrity Unit', 'Budget Office'];
export const legacyReports: LegacyReport[] = REPORTS.map(([name, kpiIds, missing, excel], i) => ({
  id: `RPT-${String(i + 1).padStart(3, '0')}`, name, tool: excel ? 'Excel workbook' : 'Oracle BI (OBIEE)', owner: OWNERS[i % OWNERS.length], kpiIds, missing: missing ?? [],
}));

export function buildIncidents(d: PsData): IncidentScript[] {
  // The replayed batch is the September issuance run, so its size comes from the sample scaled to the county.
  const sepIssuance = Math.round(d.payments.filter((p) => p.month === PERIODS.month).length * d.scale);
  return [
    {
      id: 'INC-1', title: 'Late CDC feed', fault: 'SR311_REQUEST_CDC stops receiving rows for 5 h (311 CRM export job hung).',
      objectFqn: SR, dmf: { metric: 'FRESHNESS', value: 300, threshold: 60, unit: ' min' },
      affects: [{ productId: 'DP-04', status: 'Degraded' }],
      agentEffect: [{ agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-01', 'S-05'], message: 'Data as of 5 h ago: 311 requests have not arrived since 07:05, so today’s volumes and resolution times may be understated.' }],
      resolution: '311 CRM export job restarted; 5 h of requests replayed and SERVICE_REQUEST refreshed.', ttdMin: 18, ttrMin: 52,
    },
    {
      id: 'INC-2', title: 'Null spike in a CDE', fault: '14% nulls in FCT_APPLICATION.COMPLETE_DATE after an eligibility release changed the verification status codes.',
      objectFqn: 'CONFORMED_GOLD.FCT_APPLICATION', column: 'COMPLETE_DATE', dmf: { metric: 'NULL_COUNT', value: 14, threshold: 0.5, unit: '%' },
      affects: [{ productId: 'DP-02', status: 'Degraded' }],
      agentEffect: [{ agentId: 'AG-02', mode: 'block', scenarioIds: ['S-06', 'S-09'], message: 'I can’t report processing timeliness right now: 14% of applications arrived without a complete date (COMPLETE_DATE, a critical data element), so processing days cannot be counted under BR-006. The eligibility data steward has been alerted; ask again once the incident is resolved.' }],
      resolution: 'Verification status mapping updated for the new codes; COMPLETE_DATE backfilled and DMFs re-checked.', ttdMin: 11, ttrMin: 140,
    },
    {
      id: 'INC-3', title: 'Duplicate load', fault: `The September issuance batch is replayed, doubling ${fmtInt(sepIssuance)} benefit payments.`,
      objectFqn: PAY, dmf: { metric: 'DUPLICATE_COUNT', value: sepIssuance, threshold: 0, unit: ' rows' },
      affects: [{ productId: 'DP-03', status: 'Down' }, { productId: 'DP-05', status: 'Degraded' }],
      agentEffect: [{ agentId: 'AG-03', mode: 'block', scenarioIds: ['S-10', 'S-11', 'S-12'], message: `Payment answers are paused: a replayed issuance batch doubled ${fmtInt(sepIssuance)} September payments, so benefits paid and improper payment figures would be overstated. I can answer again once Benefits Payments is restored.` }],
      resolution: 'Duplicate batch removed with a MERGE on PMT_ID; BENEFIT_PAYMENT and FCT_PAYMENT refreshed.', ttdMin: 7, ttrMin: 75,
    },
    {
      id: 'INC-4', title: 'Schema drift', fault: 'Case management adds PEND_ACTN_CD and stops filling PEND_ACTN.',
      objectFqn: CASE, column: 'PEND_ACTN', dmf: { metric: 'CONTRACT_CHECK (PEND_ACTN null %)', value: 100, threshold: 1, unit: '%' },
      affects: [{ productId: 'DP-02', status: 'Degraded' }],
      agentEffect: [{ agentId: 'AG-02', mode: 'warn', scenarioIds: ['S-07'], message: 'Backlog figures are incomplete: case management moved pending actions to PEND_ACTN_CD, so cases changed since yesterday show no pending action and the backlog is understated.' }],
      resolution: 'Data contract updated to map PEND_ACTN_CD to PENDING_ACTION; CASE_RECORD rebuilt.', ttdMin: 40, ttrMin: 210,
    },
    {
      id: 'INC-5', title: 'Volume anomaly', fault: 'General ledger lines drop 65% day over day after a fiscal period close.',
      objectFqn: GL, dmf: { metric: 'ROW_COUNT change', value: -65, threshold: -30, unit: '%' },
      affects: [{ productId: 'DP-06', status: 'Degraded' }],
      agentEffect: [{ agentId: 'AG-02', mode: 'warn', scenarioIds: ['S-08'], message: 'Volume caveat: general ledger lines dropped 65% day over day, so September spend and cost per case are likely incomplete.' }],
      resolution: 'Finance extract re-run after the period close; missing GL lines backfilled.', ttdMin: 25, ttrMin: 160,
    },
  ];
}
