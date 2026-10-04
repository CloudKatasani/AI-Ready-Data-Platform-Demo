// Bronze / Silver / Gold objects and product output ports for WCS_AI_PLATFORM (spec section 5).
import type { SfObject } from '../../types';
import { cdcColumns, col, dateKey, GATE6_CHECK, memo, withCdc } from '../shared/catalog-kit';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, noisy, pad, round, ts } from '../../mock-snowflake/generators';
import { isBusinessDay, type PsData } from './data';
import { AS_OF, CONSTITUENTS_TOTAL, DISTRICT_BY_CODE, PROGRAMS } from './generators.config';
import { activeConstituents, openCasesByConstituent, STANDARD_DAYS, workforce } from './queries';

export { GATE6_CHECK };

const cdc = cdcColumns();
const districtAccess = { column: 'DISTRICT' };
const codeAccess = (c: string) => ({ column: c, map: DISTRICT_BY_CODE });
const programKey = (code: string) => PROGRAMS.findIndex((p) => p.code === code) + 1;
const ANALYST_CODES = ['ND', 'CD'];

export function buildCatalog(d: PsData, seed: number): SfObject[] {
  const rng = new Rng(seed + 7);
  const sample = d.constituents.slice(0, 400);
  const consByKey = new Map(d.constituents.map((c) => [c.key, c]));
  const officeByKey = new Map(d.offices.map((o) => [o.key, o]));
  const codeOf = (district: string) => Object.entries(DISTRICT_BY_CODE).find(([, v]) => v === district)![0];

  const bronze: SfObject[] = [
    {
      schema: 'RAW_BRONZE', name: 'CM_PERSON_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 1,
      comment: 'Constituent (person) master CDC from the case management system, landed as Apache Iceberg',
      columns: [
        col('PERSON_ID', 'VARCHAR(12)', 'Case management person id (WC- prefix, may carry trailing spaces)', { nullable: false }),
        col('FIRST_NM', 'VARCHAR(40)', 'First name (raw)', { tags: ['PII'] }), col('LAST_NM', 'VARCHAR(40)', 'Last name (raw)', { tags: ['PII'] }),
        col('SSN_NO', 'VARCHAR(11)', 'Government identifier as captured at intake', { tags: ['GOV_ID'] }),
        col('EMAIL_ADDR', 'VARCHAR(120)', 'Email (raw)', { tags: ['PII'] }), col('ADDR_LN1', 'VARCHAR(80)', 'Street address', { tags: ['PII'] }),
        col('CITY', 'VARCHAR(40)', 'City'), col('DIST_CD', 'VARCHAR(2)', 'Service district code (ND, CD, SD, RD)'),
        col('STAT_CD', 'VARCHAR(1)', 'Status code (A active, I inactive)'), ...cdc,
      ],
      rowCount: 9_418_552, bytes: 1.4e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:48:12', upstream: ['ext:Case management'],
      rowAccess: codeAccess('DIST_CD'),
      rows: memo(() => withCdc(rng, sample, (c) => ({
        PERSON_ID: rng.chance(0.3) ? `${c.constituentId}  ` : c.constituentId, FIRST_NM: noisy(rng, c.first), LAST_NM: noisy(rng, c.last), SSN_NO: c.govId,
        EMAIL_ADDR: rng.chance(0.3) ? c.email.toUpperCase() : c.email, ADDR_LN1: noisy(rng, c.street.toUpperCase()), CITY: noisy(rng, c.city),
        DIST_CD: rng.chance(0.2) ? c.districtCode.toLowerCase() : c.districtCode, STAT_CD: c.status === 'Active' ? 'A' : 'I',
      }), '2026-09-01', (c) => ANALYST_CODES.includes(c.districtCode))),
    },
    {
      schema: 'RAW_BRONZE', name: 'CM_PERSON_CDC_STRM', layer: 'bronze', type: 'STREAM', order: 2,
      comment: 'Append-only stream feeding CURATED_SILVER.CONSTITUENT', columns: [], rowCount: 862, owner: 'INGEST_ADMIN',
      lastAltered: '2026-09-30 05:49:00', upstream: ['RAW_BRONZE.CM_PERSON_CDC'],
    },
    {
      schema: 'RAW_BRONZE', name: 'CM_CASE_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 3,
      comment: 'Program cases and caseworker assignments from case management',
      columns: [col('CASE_NO', 'VARCHAR(20)', 'Case number'), col('PERSON_ID', 'VARCHAR(12)', 'Person id'), col('PGM_CD', 'VARCHAR(4)', 'Program code'), col('OFC_CD', 'VARCHAR(5)', 'Office code'), col('DIST_CD', 'VARCHAR(2)', 'Service district code'), col('WORKER_ID', 'VARCHAR(14)', 'Assigned caseworker'), col('OPEN_DT', 'DATE', 'Case opened'), col('CLOSE_DT', 'DATE', 'Case closed'), col('CASE_STAT', 'VARCHAR(2)', 'OP open, CL closed'), col('PEND_ACTN', 'VARCHAR(4)', 'Pending action (APP, REN, CHG)'), ...cdc],
      rowCount: 3_120_408, bytes: 3.9e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:51:30', upstream: ['ext:Case management'],
      rowAccess: codeAccess('DIST_CD'),
      rows: memo(() => withCdc(rng, d.cases.slice(0, 300), (x) => ({
        CASE_NO: x.caseId, PERSON_ID: consByKey.get(x.constituentKey)!.constituentId, PGM_CD: x.program, OFC_CD: officeByKey.get(x.officeKey)!.code, DIST_CD: codeOf(x.district),
        WORKER_ID: x.caseworkerId, OPEN_DT: x.opened, CLOSE_DT: x.closed, CASE_STAT: x.status === 'Open' ? 'OP' : 'CL',
        PEND_ACTN: { NONE: null, APPLICATION: 'APP', RENEWAL: 'REN', CHANGE: 'CHG' }[x.pendingAction],
      }), '2026-09-10', (x) => ANALYST_CODES.includes(codeOf(x.district)))),
    },
    {
      schema: 'RAW_BRONZE', name: 'ELIG_APPLICATION_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 4,
      comment: 'Benefit applications and eligibility determinations from the eligibility system',
      columns: [col('APP_NO', 'VARCHAR(16)', 'Application number'), col('PERSON_ID', 'VARCHAR(12)', 'Person id'), col('PGM_CD', 'VARCHAR(4)', 'Program code'), col('CHNL_CD', 'VARCHAR(3)', 'Channel (ONL, INP, PHN, MAL)'), col('RCVD_DT', 'DATE', 'Received date'), col('CMPLT_DT', 'DATE', 'Date the application became complete'), col('DECN_DT', 'DATE', 'Decision date'), col('DECN_CD', 'VARCHAR(1)', 'A approved, D denied, W withdrawn, P pending'), col('DIST_CD', 'VARCHAR(2)', 'Service district code'), ...cdc],
      rowCount: 1_904_115, bytes: 2.6e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:02:44', upstream: ['ext:Eligibility'],
      rowAccess: codeAccess('DIST_CD'),
      rows: memo(() => withCdc(rng, d.applications.slice(-300).reverse(), (a) => ({
        APP_NO: a.appId, PERSON_ID: consByKey.get(a.constituentKey)!.constituentId, PGM_CD: a.program, CHNL_CD: { Online: 'ONL', 'In person': 'INP', Phone: 'PHN', Mail: 'MAL' }[a.channel] ?? 'ONL',
        RCVD_DT: a.received, CMPLT_DT: a.complete, DECN_DT: a.decision, DECN_CD: a.outcome.charAt(0), DIST_CD: codeOf(a.district),
      }), '2026-09-15', (a) => ANALYST_CODES.includes(codeOf(a.district)))),
    },
    {
      schema: 'RAW_BRONZE', name: 'BEN_PAYMENT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 5,
      comment: 'Issued benefit payments (EBT, direct deposit and provider disbursements)',
      columns: [col('PMT_ID', 'VARCHAR(20)', 'Payment id'), col('CASE_NO', 'VARCHAR(20)', 'Case number'), col('PGM_CD', 'VARCHAR(4)', 'Program code'), col('ISSUE_DT', 'DATE', 'Issuance date'), col('PMT_AMT', 'NUMBER(10,2)', 'Amount issued'), col('QC_ERR_CD', 'VARCHAR(6)', 'Quality-control error code'), col('RCPT_SSN', 'VARCHAR(11)', 'Recipient government identifier', { tags: ['GOV_ID'] }), ...cdc],
      rowCount: 26_884_310, bytes: 2.2e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 04:20:00', upstream: ['ext:Benefits payments'],
      rows: memo(() => withCdc(rng, d.payments.slice(-300).reverse(), (p) => ({
        PMT_ID: p.paymentId, CASE_NO: p.caseId, PGM_CD: p.program, ISSUE_DT: p.date, PMT_AMT: p.amount, QC_ERR_CD: p.errorType ? p.errorType.replace('Underpayment – ', 'U-').slice(0, 6).toUpperCase() : null, RCPT_SSN: p.govId,
      }), '2026-09-02')),
    },
    {
      schema: 'RAW_BRONZE', name: 'SR311_REQUEST_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 6,
      comment: '311 service requests from phone, mobile app, web and walk-in',
      columns: [col('SR_NO', 'VARCHAR(16)', 'Request number'), col('SR_TYPE', 'VARCHAR(40)', 'Request type (free text, mixed case)'), col('CHNL', 'VARCHAR(12)', 'Channel'), col('DIST_CD', 'VARCHAR(2)', 'Service district code'), col('OPEN_TS', 'TIMESTAMP_NTZ', 'Created'), col('CLOSE_TS', 'TIMESTAMP_NTZ', 'Closed'), col('STAT', 'VARCHAR(8)', 'OPEN / CLOSED'), ...cdc],
      rowCount: 3_611_204, bytes: 4.4e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:11:09', upstream: ['ext:311 service requests'],
      rowAccess: codeAccess('DIST_CD'),
      rows: memo(() => withCdc(rng, d.requests.slice(-300).reverse(), (s) => ({
        SR_NO: s.srId, SR_TYPE: noisy(rng, s.type), CHNL: s.channel.toUpperCase(), DIST_CD: codeOf(s.district), OPEN_TS: ts(s.created, s.createdMin),
        CLOSE_TS: s.closed ? ts(s.closed, (s.createdMin + Math.round(((s.resolutionDays ?? 0) % 1) * 1440)) % 1440) : null, STAT: s.closed ? 'CLOSED' : 'OPEN',
      }), '2026-09-28', (s) => ANALYST_CODES.includes(codeOf(s.district)))),
    },
    {
      schema: 'RAW_BRONZE', name: 'FIN_GL_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 7,
      comment: 'General ledger budget and actual lines from the county finance system',
      columns: [col('GL_ACCT', 'VARCHAR(10)', 'GL account'), col('COST_CTR', 'VARCHAR(10)', 'Cost centre'), col('FISCAL_PER', 'VARCHAR(7)', 'Fiscal period (YYYY-MM)'), col('AMT_TYPE', 'VARCHAR(3)', 'BUD budget, ACT actual'), col('AMT', 'NUMBER(14,2)', 'Amount'), col('FTE', 'NUMBER(7,1)', 'Positions (authorised or filled)'), ...cdc],
      rowCount: 1_240_118, bytes: 9.1e7, owner: 'INGEST_ADMIN', lastAltered: '2026-09-29 23:30:00', upstream: ['ext:Finance'],
      rows: memo(() => withCdc(rng, d.budget.slice(-120).reverse().flatMap((b) => [{ b, t: 'BUD' }, { b, t: 'ACT' }]), ({ b, t }) => ({
        GL_ACCT: b.admin ? '6100-ADM' : '6200-PRG', COST_CTR: `CC-${pad(b.dept.length * 37, 4)}`, FISCAL_PER: b.month, AMT_TYPE: t, AMT: t === 'BUD' ? b.budget : b.actual, FTE: t === 'BUD' ? b.fteBudget : b.fteFilled,
      }), '2026-09-29')),
    },
  ];

  const open = memo(() => openCasesByConstituent(d));
  const silver: SfObject[] = [
    {
      schema: 'CURATED_SILVER', name: 'CONSTITUENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 1,
      comment: 'Deduplicated SCD2 constituent entity (one row per version; district changes are tracked)',
      columns: [
        col('CONSTITUENT_ID', 'VARCHAR(12)', 'Constituent identifier (from PERSON_ID, trimmed)', { nullable: false, termId: 'T-001', tags: ['CDE'] }),
        col('FIRST_NAME', 'VARCHAR(40)', 'First name', { tags: ['PII'] }), col('LAST_NAME', 'VARCHAR(40)', 'Last name', { tags: ['PII'] }),
        col('GOV_ID', 'VARCHAR(11)', 'Government identifier', { tags: ['GOV_ID'], termId: 'T-026' }),
        col('EMAIL', 'VARCHAR(120)', 'Email (lowercased)', { tags: ['PII'] }), col('STREET_ADDRESS', 'VARCHAR(80)', 'Street address', { tags: ['PII'] }),
        col('CITY', 'VARCHAR(40)', 'City'), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003', tags: ['CDE'] }),
        col('CONSTITUENT_STATUS', 'VARCHAR(10)', 'Active / Inactive', { termId: 'T-002' }), col('EFFECTIVE_FROM', 'DATE', 'SCD2 valid from'),
        col('EFFECTIVE_TO', 'DATE', 'SCD2 valid to'), col('IS_CURRENT', 'BOOLEAN', 'Current version flag'),
      ],
      rowCount: 341_208, bytes: 6.2e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:04:10', upstream: ['RAW_BRONZE.CM_PERSON_CDC_STRM'],
      rowAccess: districtAccess,
      rows: memo(() => sample.flatMap((c) => {
        const cur = { CONSTITUENT_ID: c.constituentId, FIRST_NAME: c.first, LAST_NAME: c.last, GOV_ID: c.govId, EMAIL: c.email, STREET_ADDRESS: c.street, CITY: c.city, DISTRICT: c.district, CONSTITUENT_STATUS: c.status };
        return c.priorDistrict
          ? [{ ...cur, DISTRICT: c.priorDistrict, EFFECTIVE_FROM: '2019-03-01', EFFECTIVE_TO: addDays(c.changedOn!, -1), IS_CURRENT: false }, { ...cur, EFFECTIVE_FROM: c.changedOn!, EFFECTIVE_TO: null, IS_CURRENT: true }]
          : [{ ...cur, EFFECTIVE_FROM: c.effectiveFrom, EFFECTIVE_TO: null, IS_CURRENT: true }];
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'CASE_RECORD', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 2,
      comment: 'Typed program cases with office, caseworker and pending action',
      columns: [col('CASE_ID', 'VARCHAR(20)', 'Case id', { termId: 'T-005' }), col('CONSTITUENT_ID', 'VARCHAR(12)', 'Constituent', { termId: 'T-001' }), col('PROGRAM_CODE', 'VARCHAR(4)', 'Program', { termId: 'T-004' }), col('OFFICE_CODE', 'VARCHAR(5)', 'Office'), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('CASEWORKER_ID', 'VARCHAR(14)', 'Assigned caseworker'), col('OPENED_DATE', 'DATE', 'Opened'), col('CLOSED_DATE', 'DATE', 'Closed'), col('CASE_STATUS', 'VARCHAR(8)', 'Open / Closed'), col('PENDING_ACTION', 'VARCHAR(12)', 'NONE / APPLICATION / RENEWAL / CHANGE', { termId: 'T-006' })],
      rowCount: 2_980_114, bytes: 2.9e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:06:51', upstream: ['RAW_BRONZE.CM_CASE_CDC'],
      rowAccess: districtAccess,
      rows: memo(() => d.cases.map((x) => ({ CASE_ID: x.caseId, CONSTITUENT_ID: consByKey.get(x.constituentKey)!.constituentId, PROGRAM_CODE: x.program, OFFICE_CODE: officeByKey.get(x.officeKey)!.code, DISTRICT: x.district, CASEWORKER_ID: x.caseworkerId, OPENED_DATE: x.opened, CLOSED_DATE: x.closed, CASE_STATUS: x.status, PENDING_ACTION: x.pendingAction }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'BENEFIT_APPLICATION', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 3,
      comment: 'Typed benefit applications with completeness and decision dates',
      columns: [col('APPLICATION_ID', 'VARCHAR(16)', 'Application id', { termId: 'T-007' }), col('CONSTITUENT_ID', 'VARCHAR(12)', 'Constituent', { termId: 'T-001' }), col('PROGRAM_CODE', 'VARCHAR(4)', 'Program', { termId: 'T-004' }), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('CHANNEL', 'VARCHAR(10)', 'Submission channel', { termId: 'T-025' }), col('RECEIVED_DATE', 'DATE', 'Received'), col('COMPLETE_DATE', 'DATE', 'All required verifications received', { termId: 'T-008' }), col('DECISION_DATE', 'DATE', 'Eligibility decision'), col('DECISION', 'VARCHAR(10)', 'Approved / Denied / Withdrawn / Pending', { termId: 'T-011' })],
      rowCount: 1_861_402, bytes: 1.7e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:08:20', upstream: ['RAW_BRONZE.ELIG_APPLICATION_CDC'],
      rowAccess: districtAccess,
      rows: memo(() => d.applications.slice().reverse().map((a) => ({ APPLICATION_ID: a.appId, CONSTITUENT_ID: consByKey.get(a.constituentKey)!.constituentId, PROGRAM_CODE: a.program, DISTRICT: a.district, CHANNEL: a.channel, RECEIVED_DATE: a.received, COMPLETE_DATE: a.complete, DECISION_DATE: a.decision, DECISION: a.outcome }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'BENEFIT_PAYMENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 4,
      comment: 'Typed benefit payments with quality-control and integrity outcomes',
      columns: [col('PAYMENT_ID', 'VARCHAR(20)', 'Payment id'), col('CASE_ID', 'VARCHAR(20)', 'Case', { termId: 'T-005' }), col('PROGRAM_CODE', 'VARCHAR(4)', 'Program', { termId: 'T-004' }), col('ISSUE_DATE', 'DATE', 'Issued'), col('PAYMENT_AMOUNT', 'NUMBER(10,2)', 'Amount issued', { termId: 'T-013' }), col('IS_IMPROPER', 'BOOLEAN', 'Quality control found an improper amount', { termId: 'T-015' }), col('ERROR_TYPE', 'VARCHAR(40)', 'QC error type'), col('INTEGRITY_FLAG', 'BOOLEAN', 'Case under an integrity flag at issuance', { termId: 'T-020' })],
      rowCount: 25_902_744, bytes: 1.6e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 04:41:00', upstream: ['RAW_BRONZE.BEN_PAYMENT_CDC'],
      rows: memo(() => d.payments.slice().reverse().map((p) => ({ PAYMENT_ID: p.paymentId, CASE_ID: p.caseId, PROGRAM_CODE: p.program, ISSUE_DATE: p.date, PAYMENT_AMOUNT: p.amount, IS_IMPROPER: p.improper, ERROR_TYPE: p.errorType, INTEGRITY_FLAG: p.flagged }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'SERVICE_REQUEST', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 5,
      comment: 'Cleansed 311 service requests with standard types and departments',
      columns: [col('SR_ID', 'VARCHAR(16)', 'Request id', { termId: 'T-017' }), col('REQUEST_TYPE', 'VARCHAR(40)', 'Standard request type'), col('DEPARTMENT', 'VARCHAR(30)', 'Responsible department'), col('CHANNEL', 'VARCHAR(12)', 'Channel', { termId: 'T-025' }), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('CREATED_TS', 'TIMESTAMP_NTZ', 'Created'), col('CLOSED_TS', 'TIMESTAMP_NTZ', 'Closed'), col('STATUS', 'VARCHAR(8)', 'Open / Closed'), col('SURVEY_SCORE', 'NUMBER(1)', 'Post-closure survey 1–5', { termId: 'T-019' })],
      rowCount: 3_540_008, bytes: 3.3e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:12:02', upstream: ['RAW_BRONZE.SR311_REQUEST_CDC'],
      rowAccess: districtAccess,
      rows: memo(() => d.requests.slice(-3000).reverse().map((s) => ({ SR_ID: s.srId, REQUEST_TYPE: s.type, DEPARTMENT: s.dept, CHANNEL: s.channel, DISTRICT: s.district, CREATED_TS: ts(s.created, s.createdMin), CLOSED_TS: s.closed ? ts(s.closed, s.createdMin) : null, STATUS: s.closed ? 'Closed' : 'Open', SURVEY_SCORE: s.survey }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'BUDGET_LEDGER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 day', order: 6,
      comment: 'Monthly budget, actual and positions by department',
      columns: [col('DEPARTMENT', 'VARCHAR(40)', 'Department'), col('PERIOD_MONTH', 'DATE', 'Fiscal month'), col('IS_ADMINISTRATIVE', 'BOOLEAN', 'Administrative cost (counts toward cost per case)', { termId: 'T-022' }), col('BUDGET_AMOUNT', 'NUMBER(14,2)', 'Adopted budget', { termId: 'T-023' }), col('ACTUAL_AMOUNT', 'NUMBER(14,2)', 'Actual expenditure', { termId: 'T-023' }), col('FTE_BUDGETED', 'NUMBER(7,1)', 'Authorised positions'), col('FTE_FILLED', 'NUMBER(7,1)', 'Filled positions', { termId: 'T-024' })],
      rowCount: 18_204, bytes: 2.1e6, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-29 23:55:00', upstream: ['RAW_BRONZE.FIN_GL_CDC'],
      rows: memo(() => d.budget.slice().reverse().map((b) => ({ DEPARTMENT: b.dept, PERIOD_MONTH: `${b.month}-01`, IS_ADMINISTRATIVE: b.admin, BUDGET_AMOUNT: b.budget, ACTUAL_AMOUNT: b.actual, FTE_BUDGETED: b.fteBudget, FTE_FILLED: b.fteFilled }))),
    },
  ];

  const allDates = dateRange('2025-01-01', AS_OF);
  const gold: SfObject[] = [
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_CONSTITUENT', layer: 'gold', type: 'TABLE', order: 1, comment: 'Conformed constituent dimension (current version)',
      columns: [
        col('CONSTITUENT_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('CONSTITUENT_ID', 'VARCHAR(12)', 'Constituent id', { termId: 'T-001', tags: ['CDE'] }),
        col('CONSTITUENT_NAME', 'VARCHAR(80)', 'Constituent name', { tags: ['PII'] }), col('GOV_ID', 'VARCHAR(11)', 'Government identifier', { tags: ['GOV_ID'], termId: 'T-026' }),
        col('EMAIL', 'VARCHAR(120)', 'Email', { tags: ['PII'] }), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003', tags: ['CDE'] }),
        col('OFFICE_KEY', 'NUMBER', 'Home office'), col('AGE_BAND', 'VARCHAR(6)', 'Age band'), col('HOUSEHOLD_SIZE', 'NUMBER(2)', 'Household size'),
        col('PREFERRED_LANGUAGE', 'VARCHAR(20)', 'Preferred language'), col('PREFERRED_CHANNEL', 'VARCHAR(10)', 'Preferred channel', { termId: 'T-025' }),
      ],
      rowCount: CONSTITUENTS_TOTAL, bytes: 5.1e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:20:00', upstream: ['CURATED_SILVER.CONSTITUENT'], rowAccess: districtAccess,
      rows: memo(() => d.constituents.map((c) => ({ CONSTITUENT_KEY: c.key, CONSTITUENT_ID: c.constituentId, CONSTITUENT_NAME: `${c.first} ${c.last}`, GOV_ID: c.govId, EMAIL: c.email, DISTRICT: c.district, OFFICE_KEY: c.officeKey, AGE_BAND: c.ageBand, HOUSEHOLD_SIZE: c.householdSize, PREFERRED_LANGUAGE: c.language, PREFERRED_CHANNEL: c.channel }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_PROGRAM', layer: 'gold', type: 'TABLE', order: 2, comment: 'Benefit programs with processing standard and renewal cycle',
      columns: [col('PROGRAM_KEY', 'NUMBER', 'Surrogate key'), col('PROGRAM_CODE', 'VARCHAR(4)', 'Program code', { termId: 'T-004', tags: ['CDE'] }), col('PROGRAM_NAME', 'VARCHAR(40)', 'Program name', { termId: 'T-004' }), col('PROCESSING_STANDARD_DAYS', 'NUMBER(3)', 'Processing standard in business days', { termId: 'T-010' }), col('RENEWAL_MONTHS', 'NUMBER(2)', 'Renewal cycle (months)'), col('ISSUES_PAYMENTS', 'BOOLEAN', 'Program issues benefit payments')],
      rowCount: PROGRAMS.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-07-01 02:00:00', upstream: ['CURATED_SILVER.CASE_RECORD'],
      rows: memo(() => PROGRAMS.map((p, i) => ({ PROGRAM_KEY: i + 1, PROGRAM_CODE: p.code, PROGRAM_NAME: p.name, PROCESSING_STANDARD_DAYS: STANDARD_DAYS, RENEWAL_MONTHS: p.renewalMonths, ISSUES_PAYMENTS: p.pays }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_OFFICE', layer: 'gold', type: 'TABLE', order: 3, comment: 'Service offices with district, residents and filled caseworker positions',
      columns: [col('OFFICE_KEY', 'NUMBER', 'Surrogate key'), col('OFFICE_CODE', 'VARCHAR(5)', 'Office code'), col('OFFICE_NAME', 'VARCHAR(40)', 'Office'), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003', tags: ['CDE'] }), col('CITY', 'VARCHAR(30)', 'City'), col('RESIDENTS_SERVED', 'NUMBER', 'Residents in catchment'), col('CASEWORKERS', 'NUMBER', 'Filled caseworker positions', { termId: 'T-012' })],
      rowCount: d.offices.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-01 02:00:00', upstream: ['CURATED_SILVER.CASE_RECORD'], rowAccess: districtAccess,
      rows: memo(() => d.offices.map((o) => ({ OFFICE_KEY: o.key, OFFICE_CODE: o.code, OFFICE_NAME: o.name, DISTRICT: o.district, CITY: o.city, RESIDENTS_SERVED: o.residents, CASEWORKERS: o.caseworkers }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_DATE', layer: 'gold', type: 'TABLE', order: 4, comment: 'Calendar with fiscal periods and county business days',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'yyyymmdd'), col('CALENDAR_DATE', 'DATE', 'Date'), col('FISCAL_QUARTER', 'VARCHAR(7)', 'Fiscal quarter (FY = calendar year)'), col('FISCAL_YEAR', 'NUMBER(4)', 'Fiscal year'), col('IS_BUSINESS_DAY', 'BOOLEAN', 'Weekday that is not a county holiday', { termId: 'T-009', tags: ['CDE'] })],
      rowCount: allDates.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:05:00', upstream: [],
      rows: memo(() => allDates.slice().reverse().map((x) => ({ DATE_KEY: dateKey(x), CALENDAR_DATE: x, FISCAL_QUARTER: `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`, FISCAL_YEAR: Number(x.slice(0, 4)), IS_BUSINESS_DAY: isBusinessDay(x) }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_CASE', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 5, comment: 'Program case fact (one row per case) with pending action for backlog',
      columns: [col('CASE_KEY', 'NUMBER', 'Case'), col('CASE_ID', 'VARCHAR(20)', 'Case id', { termId: 'T-005', tags: ['CDE'] }), col('CONSTITUENT_KEY', 'NUMBER', 'Constituent'), col('PROGRAM_KEY', 'NUMBER', 'Program'), col('OFFICE_KEY', 'NUMBER', 'Office'), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('CASEWORKER_ID', 'VARCHAR(14)', 'Assigned caseworker', { termId: 'T-012' }), col('OPENED_DATE', 'DATE', 'Opened'), col('CLOSED_DATE', 'DATE', 'Closed'), col('CASE_STATUS', 'VARCHAR(8)', 'Open / Closed', { termId: 'T-005', tags: ['CDE'] }), col('PENDING_ACTION', 'VARCHAR(12)', 'Action awaiting a caseworker decision', { termId: 'T-006', tags: ['CDE'] }), col('PENDING_SINCE', 'DATE', 'Pending since'), col('NEXT_RENEWAL_DATE', 'DATE', 'Next renewal due')],
      rowCount: 2_980_114, bytes: 2.4e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:21:40', upstream: ['CURATED_SILVER.CASE_RECORD', 'CONFORMED_GOLD.DIM_PROGRAM', 'CONFORMED_GOLD.DIM_OFFICE'], rowAccess: districtAccess,
      rows: memo(() => d.cases.map((x) => ({ CASE_KEY: x.key, CASE_ID: x.caseId, CONSTITUENT_KEY: x.constituentKey, PROGRAM_KEY: programKey(x.program), OFFICE_KEY: x.officeKey, DISTRICT: x.district, CASEWORKER_ID: x.caseworkerId, OPENED_DATE: x.opened, CLOSED_DATE: x.closed, CASE_STATUS: x.status, PENDING_ACTION: x.pendingAction, PENDING_SINCE: x.pendingSince, NEXT_RENEWAL_DATE: x.nextRenewal }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_APPLICATION', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 6, comment: 'Benefit application fact with processing days in business days from a complete application',
      columns: [
        col('APPLICATION_KEY', 'NUMBER', 'Application'), col('APPLICATION_ID', 'VARCHAR(16)', 'Application id', { termId: 'T-007', tags: ['CDE'] }), col('CONSTITUENT_KEY', 'NUMBER', 'Constituent'), col('PROGRAM_KEY', 'NUMBER', 'Program'), col('OFFICE_KEY', 'NUMBER', 'Office'),
        col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('DATE_KEY', 'NUMBER(8)', 'Received date key'), col('CHANNEL', 'VARCHAR(10)', 'Submission channel', { termId: 'T-025' }),
        col('RECEIVED_DATE', 'DATE', 'Received'), col('COMPLETE_DATE', 'DATE', 'Application complete (all verifications in)', { termId: 'T-008', tags: ['CDE'] }), col('DECISION_DATE', 'DATE', 'Eligibility decision'),
        col('PROCESSING_BUSINESS_DAYS', 'NUMBER(4)', 'Business days from complete application to decision (BR-006)', { termId: 'T-009', tags: ['CDE'] }),
        col('WITHIN_STANDARD', 'BOOLEAN', 'Decided within 30 business days (BR-007)', { termId: 'T-010', tags: ['CDE'] }), col('DECISION', 'VARCHAR(10)', 'Approved / Denied / Withdrawn / Pending', { termId: 'T-011' }), col('IS_EXPEDITED', 'BOOLEAN', 'Expedited food assistance'),
      ],
      rowCount: 1_861_402, bytes: 1.5e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:22:15', upstream: ['CURATED_SILVER.BENEFIT_APPLICATION', 'CONFORMED_GOLD.DIM_PROGRAM', 'CONFORMED_GOLD.DIM_OFFICE'], rowAccess: districtAccess,
      rows: memo(() => d.applications.slice().reverse().map((a) => ({ APPLICATION_KEY: a.key, APPLICATION_ID: a.appId, CONSTITUENT_KEY: a.constituentKey, PROGRAM_KEY: programKey(a.program), OFFICE_KEY: a.officeKey, DISTRICT: a.district, DATE_KEY: dateKey(a.received), CHANNEL: a.channel, RECEIVED_DATE: a.received, COMPLETE_DATE: a.complete, DECISION_DATE: a.decision, PROCESSING_BUSINESS_DAYS: a.bizDays, WITHIN_STANDARD: a.bizDays === null ? null : a.bizDays <= STANDARD_DAYS, DECISION: a.outcome, IS_EXPEDITED: a.expedited }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_PAYMENT', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 7, comment: 'Benefit payment fact with quality-control and program-integrity outcomes',
      columns: [
        col('PAYMENT_KEY', 'NUMBER', 'Payment'), col('CASE_KEY', 'NUMBER', 'Case'), col('CONSTITUENT_KEY', 'NUMBER', 'Constituent'), col('PROGRAM_KEY', 'NUMBER', 'Program'), col('DATE_KEY', 'NUMBER(8)', 'Issue date'),
        col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('PAYMENT_AMOUNT', 'NUMBER(10,2)', 'Amount issued', { termId: 'T-013', tags: ['CDE'] }),
        col('IS_IMPROPER', 'BOOLEAN', 'Improper payment found by quality control', { termId: 'T-015', tags: ['CDE'] }), col('IMPROPER_AMOUNT', 'NUMBER(10,2)', 'Over- or under-paid amount', { termId: 'T-015', tags: ['CDE'] }),
        col('ERROR_TYPE', 'VARCHAR(40)', 'QC error type'), col('ISSUED_ON_TIME', 'BOOLEAN', 'Issued by the scheduled issuance date', { termId: 'T-016' }),
        col('INTEGRITY_FLAG', 'BOOLEAN', 'Case under an integrity flag at issuance', { termId: 'T-020', tags: ['CDE'] }), col('FLAG_REASON', 'VARCHAR(40)', 'Integrity flag reason'), col('FLAG_STATUS', 'VARCHAR(24)', 'Open review / Referred / Overpayment established / Cleared', { termId: 'T-020' }),
        col('OVERPAYMENT_AMOUNT', 'NUMBER(10,2)', 'Overpayment established', { termId: 'T-021', tags: ['CDE'] }), col('RECOVERED_AMOUNT', 'NUMBER(10,2)', 'Overpayment recovered to date', { termId: 'T-021' }),
        col('CASE_GOV_ID', 'VARCHAR(11)', 'Government identifier of the case head (for data matching)', { tags: ['GOV_ID'], termId: 'T-026', maskPendingFix: GATE6_CHECK }),
      ],
      rowCount: 25_902_744, bytes: 2.0e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 04:58:30', upstream: ['CURATED_SILVER.BENEFIT_PAYMENT', 'CONFORMED_GOLD.FCT_CASE', 'CONFORMED_GOLD.DIM_PROGRAM'], rowAccess: districtAccess,
      rows: memo(() => d.payments.slice().reverse().map((p) => ({ PAYMENT_KEY: p.key, CASE_KEY: p.caseKey, CONSTITUENT_KEY: p.constituentKey, PROGRAM_KEY: programKey(p.program), DATE_KEY: dateKey(p.date), DISTRICT: p.district, PAYMENT_AMOUNT: p.amount, IS_IMPROPER: p.improper, IMPROPER_AMOUNT: p.improperAmount, ERROR_TYPE: p.errorType, ISSUED_ON_TIME: p.onTime, INTEGRITY_FLAG: p.flagged, FLAG_REASON: p.flagReason, FLAG_STATUS: p.flagStatus, OVERPAYMENT_AMOUNT: p.overpayment, RECOVERED_AMOUNT: p.recovered, CASE_GOV_ID: p.govId }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_SERVICE_REQUEST', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 8, comment: '311 service request fact at request grain',
      columns: [col('SR_KEY', 'NUMBER', 'Request'), col('SR_ID', 'VARCHAR(16)', 'Request id', { termId: 'T-017', tags: ['CDE'] }), col('DATE_KEY', 'NUMBER(8)', 'Created date'), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('REQUEST_TYPE', 'VARCHAR(40)', 'Request type'), col('DEPARTMENT', 'VARCHAR(30)', 'Department'), col('CHANNEL', 'VARCHAR(12)', 'Channel', { termId: 'T-025' }), col('RESOLUTION_DAYS', 'NUMBER(6,1)', 'Days from creation to closure', { termId: 'T-018', tags: ['CDE'] }), col('WITHIN_SLA', 'BOOLEAN', 'Closed within the type SLA', { termId: 'T-018', tags: ['CDE'] }), col('REOPENED', 'BOOLEAN', 'Reopened after closure'), col('SURVEY_SCORE', 'NUMBER(1)', 'Satisfaction survey 1–5', { termId: 'T-019' })],
      rowCount: 3_540_008, bytes: 2.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:13:00', upstream: ['CURATED_SILVER.SERVICE_REQUEST'], rowAccess: districtAccess,
      rows: memo(() => d.requests.slice().reverse().map((s) => ({ SR_KEY: s.key, SR_ID: s.srId, DATE_KEY: dateKey(s.created), DISTRICT: s.district, REQUEST_TYPE: s.type, DEPARTMENT: s.dept, CHANNEL: s.channel, RESOLUTION_DAYS: s.resolutionDays, WITHIN_SLA: s.onTime, REOPENED: s.reopened, SURVEY_SCORE: s.survey }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_BUDGET', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 day', order: 9, comment: 'Budget, expenditure and positions by department and month',
      columns: [col('BUDGET_KEY', 'NUMBER', 'Line'), col('DATE_KEY', 'NUMBER(8)', 'Month start'), col('DEPARTMENT', 'VARCHAR(40)', 'Department'), col('IS_ADMINISTRATIVE', 'BOOLEAN', 'Administrative cost', { termId: 'T-022' }), col('BUDGET_AMOUNT', 'NUMBER(14,2)', 'Adopted budget', { termId: 'T-023' }), col('ACTUAL_AMOUNT', 'NUMBER(14,2)', 'Actual expenditure', { termId: 'T-022', tags: ['CDE'] }), col('FTE_BUDGETED', 'NUMBER(7,1)', 'Authorised positions', { termId: 'T-024' }), col('FTE_FILLED', 'NUMBER(7,1)', 'Filled positions', { termId: 'T-024' })],
      rowCount: 1_512, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:30:00', upstream: ['CURATED_SILVER.BUDGET_LEDGER'],
      rows: memo(() => d.budget.slice().reverse().map((b) => ({ BUDGET_KEY: b.key, DATE_KEY: dateKey(`${b.month}-01`), DEPARTMENT: b.dept, IS_ADMINISTRATIVE: b.admin, BUDGET_AMOUNT: b.budget, ACTUAL_AMOUNT: b.actual, FTE_BUDGETED: b.fteBudget, FTE_FILLED: b.fteFilled }))),
    },
  ];

  const srCount12 = memo(() => {
    const m = new Map<string, number>();
    for (const s of d.requests) if (s.created > addDays(AS_OF, -365)) m.set(s.district, (m.get(s.district) ?? 0) + 1);
    return m;
  });

  const products: SfObject[] = [
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CONSTITUENT_360', layer: 'product', type: 'SECURE VIEW', order: 3, comment: 'Output port of Constituent 360',
      columns: [
        col('CONSTITUENT_ID', 'VARCHAR(12)', 'Constituent id', { termId: 'T-001', tags: ['CDE'] }), col('CONSTITUENT_NAME', 'VARCHAR(80)', 'Constituent name', { tags: ['PII'] }),
        col('GOV_ID', 'VARCHAR(11)', 'Government identifier', { tags: ['GOV_ID'], termId: 'T-026' }), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003', tags: ['CDE'] }),
        col('OFFICE_NAME', 'VARCHAR(40)', 'Home office'), col('AGE_BAND', 'VARCHAR(6)', 'Age band'), col('PREFERRED_LANGUAGE', 'VARCHAR(20)', 'Preferred language'),
        col('IS_ACTIVE', 'BOOLEAN', 'Active constituent (rule BR-001)', { termId: 'T-002', tags: ['CDE'] }), col('PROGRAMS_ENROLLED', 'NUMBER(2)', 'Open program cases', { termId: 'T-027' }),
        col('PROGRAM_CODES', 'VARCHAR(30)', 'Programs enrolled'), col('NEXT_RENEWAL_DATE', 'DATE', 'Earliest renewal due'), col('LAST_CONTACT_DATE', 'DATE', 'Last contact (application, renewal, payment or visit)'),
        col('DISTRICT_311_REQUESTS_12M', 'NUMBER(8)', '311 requests in the district, 12 months (sample)', { termId: 'T-017' }),
      ],
      rowCount: CONSTITUENTS_TOTAL, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:30:00', upstream: ['CONFORMED_GOLD.DIM_CONSTITUENT', 'CONFORMED_GOLD.FCT_CASE', 'CONFORMED_GOLD.FCT_SERVICE_REQUEST'], rowAccess: districtAccess,
      rows: memo(() => {
        const active = new Set(activeConstituents(d).map((c) => c.key));
        return d.constituents.map((c) => {
          const cs = open().get(c.key) ?? [];
          return {
            CONSTITUENT_ID: c.constituentId, CONSTITUENT_NAME: `${c.first} ${c.last}`, GOV_ID: c.govId, DISTRICT: c.district, OFFICE_NAME: officeByKey.get(c.officeKey)!.name,
            AGE_BAND: c.ageBand, PREFERRED_LANGUAGE: c.language, IS_ACTIVE: active.has(c.key), PROGRAMS_ENROLLED: cs.length, PROGRAM_CODES: cs.map((x) => x.program).join(', '),
            NEXT_RENEWAL_DATE: cs.map((x) => x.nextRenewal).filter(Boolean).sort()[0] ?? null, LAST_CONTACT_DATE: c.lastContact, DISTRICT_311_REQUESTS_12M: srCount12().get(c.district) ?? 0,
          };
        });
      }),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CASE_MANAGEMENT', layer: 'product', type: 'SECURE VIEW', order: 4, comment: 'Output port of Case Management',
      columns: [col('APPLICATION_ID', 'VARCHAR(16)', 'Application', { termId: 'T-007', tags: ['CDE'] }), col('PROGRAM_CODE', 'VARCHAR(4)', 'Program', { termId: 'T-004', tags: ['CDE'] }), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003', tags: ['CDE'] }), col('OFFICE_NAME', 'VARCHAR(40)', 'Office'), col('CHANNEL', 'VARCHAR(10)', 'Channel', { termId: 'T-025' }), col('RECEIVED_DATE', 'DATE', 'Received'), col('COMPLETE_DATE', 'DATE', 'Complete', { termId: 'T-008', tags: ['CDE'] }), col('DECISION_DATE', 'DATE', 'Decision'), col('PROCESSING_BUSINESS_DAYS', 'NUMBER(4)', 'Processing days (business days from complete application)', { termId: 'T-009', tags: ['CDE'] }), col('WITHIN_STANDARD', 'BOOLEAN', 'Within the 30-day standard', { termId: 'T-010', tags: ['CDE'] }), col('DECISION', 'VARCHAR(10)', 'Decision', { termId: 'T-011' })],
      rowCount: 1_861_402, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:24:00', upstream: ['CONFORMED_GOLD.FCT_APPLICATION', 'CONFORMED_GOLD.FCT_CASE', 'CONFORMED_GOLD.DIM_OFFICE'], rowAccess: districtAccess,
      rows: memo(() => d.applications.slice().reverse().map((a) => ({ APPLICATION_ID: a.appId, PROGRAM_CODE: a.program, DISTRICT: a.district, OFFICE_NAME: officeByKey.get(a.officeKey)!.name, CHANNEL: a.channel, RECEIVED_DATE: a.received, COMPLETE_DATE: a.complete, DECISION_DATE: a.decision, PROCESSING_BUSINESS_DAYS: a.bizDays, WITHIN_STANDARD: a.bizDays === null ? null : a.bizDays <= STANDARD_DAYS, DECISION: a.outcome }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_BENEFIT_PAYMENTS', layer: 'product', type: 'SECURE VIEW', order: 5, comment: 'Output port of Benefits Payments',
      columns: [col('PAYMENT_ID', 'VARCHAR(20)', 'Payment'), col('CASE_ID', 'VARCHAR(20)', 'Case', { termId: 'T-005' }), col('PROGRAM_CODE', 'VARCHAR(4)', 'Program', { termId: 'T-004', tags: ['CDE'] }), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('ISSUE_DATE', 'DATE', 'Issued'), col('PAYMENT_AMOUNT', 'NUMBER(10,2)', 'Amount', { termId: 'T-013', tags: ['CDE'] }), col('IS_IMPROPER', 'BOOLEAN', 'Improper payment', { termId: 'T-015', tags: ['CDE'] }), col('IMPROPER_AMOUNT', 'NUMBER(10,2)', 'Improper amount', { termId: 'T-015', tags: ['CDE'] }), col('ERROR_TYPE', 'VARCHAR(40)', 'QC error type'), col('ISSUED_ON_TIME', 'BOOLEAN', 'On time', { termId: 'T-016' })],
      rowCount: 25_902_744, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:00:00', upstream: ['CONFORMED_GOLD.FCT_PAYMENT', 'CONFORMED_GOLD.DIM_PROGRAM'], rowAccess: districtAccess,
      rows: memo(() => d.payments.slice().reverse().map((p) => ({ PAYMENT_ID: p.paymentId, CASE_ID: p.caseId, PROGRAM_CODE: p.program, DISTRICT: p.district, ISSUE_DATE: p.date, PAYMENT_AMOUNT: p.amount, IS_IMPROPER: p.improper, IMPROPER_AMOUNT: p.improperAmount, ERROR_TYPE: p.errorType, ISSUED_ON_TIME: p.onTime }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_SERVICE_REQUESTS_311', layer: 'product', type: 'SECURE VIEW', order: 6, comment: 'Output port of Service Requests (311)',
      columns: [col('SR_ID', 'VARCHAR(16)', 'Request', { termId: 'T-017', tags: ['CDE'] }), col('REQUEST_TYPE', 'VARCHAR(40)', 'Type'), col('DEPARTMENT', 'VARCHAR(30)', 'Department'), col('CHANNEL', 'VARCHAR(12)', 'Channel', { termId: 'T-025' }), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003', tags: ['CDE'] }), col('CREATED_DATE', 'DATE', 'Created'), col('CLOSED_DATE', 'DATE', 'Closed'), col('RESOLUTION_DAYS', 'NUMBER(6,1)', 'Resolution days', { termId: 'T-018', tags: ['CDE'] }), col('WITHIN_SLA', 'BOOLEAN', 'Within SLA', { termId: 'T-018', tags: ['CDE'] }), col('REOPENED', 'BOOLEAN', 'Reopened'), col('SURVEY_SCORE', 'NUMBER(1)', 'Survey score', { termId: 'T-019' })],
      rowCount: 3_540_008, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:14:00', upstream: ['CONFORMED_GOLD.FCT_SERVICE_REQUEST', 'CONFORMED_GOLD.DIM_DATE'], rowAccess: districtAccess,
      rows: memo(() => d.requests.slice().reverse().map((s) => ({ SR_ID: s.srId, REQUEST_TYPE: s.type, DEPARTMENT: s.dept, CHANNEL: s.channel, DISTRICT: s.district, CREATED_DATE: s.created, CLOSED_DATE: s.closed, RESOLUTION_DAYS: s.resolutionDays, WITHIN_SLA: s.onTime, REOPENED: s.reopened, SURVEY_SCORE: s.survey }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_PROGRAM_INTEGRITY', layer: 'product', type: 'SECURE VIEW', order: 7, comment: 'Output port of Program Integrity (in certification)',
      columns: [
        col('PAYMENT_ID', 'VARCHAR(20)', 'Payment'), col('CASE_ID', 'VARCHAR(20)', 'Case', { termId: 'T-005', tags: ['CDE'] }),
        col('CASE_GOV_ID', 'VARCHAR(11)', 'Government identifier of the case head (from FCT_PAYMENT)', { tags: ['GOV_ID'], termId: 'T-026', maskPendingFix: GATE6_CHECK }),
        col('PROGRAM_CODE', 'VARCHAR(4)', 'Program', { termId: 'T-004' }), col('DISTRICT', 'VARCHAR(20)', 'Service district', { termId: 'T-003' }), col('ISSUE_DATE', 'DATE', 'Issued'),
        col('PAYMENT_AMOUNT', 'NUMBER(10,2)', 'Amount', { termId: 'T-013' }), col('INTEGRITY_FLAG', 'BOOLEAN', 'Integrity flag', { termId: 'T-020', tags: ['CDE'] }), col('FLAG_REASON', 'VARCHAR(40)', 'Flag reason'),
        col('FLAG_STATUS', 'VARCHAR(24)', 'Flag status', { termId: 'T-020', tags: ['CDE'] }), col('OVERPAYMENT_AMOUNT', 'NUMBER(10,2)', 'Overpayment established', { termId: 'T-021', tags: ['CDE'] }), col('RECOVERED_AMOUNT', 'NUMBER(10,2)', 'Recovered', { termId: 'T-021', tags: ['CDE'] }),
      ],
      rowCount: 25_902_744, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:02:00', upstream: ['CONFORMED_GOLD.FCT_PAYMENT', 'CONFORMED_GOLD.FCT_CASE'], rowAccess: districtAccess,
      rows: memo(() => d.payments.slice().reverse().map((p) => ({ PAYMENT_ID: p.paymentId, CASE_ID: p.caseId, CASE_GOV_ID: p.govId, PROGRAM_CODE: p.program, DISTRICT: p.district, ISSUE_DATE: p.date, PAYMENT_AMOUNT: p.amount, INTEGRITY_FLAG: p.flagged, FLAG_REASON: p.flagReason, FLAG_STATUS: p.flagStatus, OVERPAYMENT_AMOUNT: p.overpayment, RECOVERED_AMOUNT: p.recovered }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_WORKFORCE_BUDGET', layer: 'product', type: 'SECURE VIEW', order: 8, comment: 'Output port of Workforce & Budget (draft)',
      columns: [col('DEPARTMENT', 'VARCHAR(40)', 'Department'), col('PERIOD_MONTH', 'DATE', 'Month'), col('BUDGET_AMOUNT', 'NUMBER(14,2)', 'Budget', { termId: 'T-023' }), col('ACTUAL_AMOUNT', 'NUMBER(14,2)', 'Actual', { termId: 'T-023' }), col('FTE_BUDGETED', 'NUMBER(7,1)', 'Authorised positions'), col('FTE_FILLED', 'NUMBER(7,1)', 'Filled positions', { termId: 'T-024' }), col('VACANCY_PCT', 'NUMBER(5,1)', 'Vacancy %', { termId: 'T-024' }), col('OPEN_CASES', 'NUMBER', 'Open cases at month end (county total)', { termId: 'T-005' }), col('COST_PER_CASE', 'NUMBER(10,2)', 'Administrative cost per open case, trailing 12 months', { termId: 'T-022', tags: ['CDE'] })],
      rowCount: 1_512, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-29 02:00:00', upstream: ['CONFORMED_GOLD.FCT_BUDGET', 'CONFORMED_GOLD.FCT_CASE'],
      rows: memo(() => {
        const wf = workforce(d);
        return d.budget.slice().reverse().map((b) => ({ DEPARTMENT: b.dept, PERIOD_MONTH: `${b.month}-01`, BUDGET_AMOUNT: b.budget, ACTUAL_AMOUNT: b.actual, FTE_BUDGETED: b.fteBudget, FTE_FILLED: b.fteFilled, VACANCY_PCT: round(((b.fteBudget - b.fteFilled) / b.fteBudget) * 100, 1), OPEN_CASES: wf.openCases, COST_PER_CASE: b.month === '2026-09' && b.admin ? wf.costPerCase : null }));
      }),
    },
  ];

  return [...bronze, ...silver, ...gold, ...products];
}

