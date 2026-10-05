// Bronze / Silver / Gold objects and product output ports for SMI_AI_PLATFORM (spec section 5).
import type { SfObject } from '../../types';
import { cdcColumns, col, dateKey, GATE6_CHECK, memo, memoRng, withCdc } from '../shared/catalog-kit';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, daysBetween, noisy, pad, round, ts } from '../../mock-snowflake/generators';
import { inForceOn, type InsData } from './data';
import { AS_OF, CAT_EVENTS, LINE_BY_CODE, LINES, STATE_TO_REGION } from './generators.config';

export { GATE6_CHECK };

const cdc = cdcColumns();
const regionAccess = { column: 'REGION' };
const stateAccess = (c: string) => ({ column: c, map: STATE_TO_REGION });
const A_REGIONS = ['Northeast', 'Midwest'];
const STATUS_CD = { 'In force': 'IF', Lapsed: 'LP', Cancelled: 'CN' } as const;
const STATEMENT_LINE: Record<string, string> = {
  PA: 'Private passenger auto liability & physical damage', HO: 'Homeowners multiple peril', CA: 'Commercial auto liability & physical damage',
  CP: 'Commercial multiple peril (property)', GL: 'Other liability – occurrence', WC: "Workers' compensation",
};

export function buildCatalog(d: InsData, seed: number): SfObject[] {
  const rng = new Rng(seed + 7);
  const polSample = d.policies.slice(0, 400);
  const polByKey = new Map(d.policies.map((p) => [p.key, p]));
  const claimByKey = new Map(d.claims.map((c) => [c.key, c]));
  const agencyByKey = new Map(d.agencies.map((a) => [a.key, a]));
  const lineName = (c: string) => LINE_BY_CODE[c].name;
  const monthKey = (m: string) => dateKey(`${m}-01`);

  const bronze: SfObject[] = [
    {
      schema: 'RAW_BRONZE', name: 'PAS_POLICY_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 1,
      comment: 'Policy and policyholder CDC from the policy administration system, landed as Apache Iceberg on S3',
      columns: [
        col('POLICY_NO', 'VARCHAR(16)', 'Policy number', { nullable: false }), col('PH_FIRST_NM', 'VARCHAR(40)', 'Policyholder first name (raw)', { tags: ['PII'] }),
        col('PH_LAST_NM', 'VARCHAR(40)', 'Policyholder last name (raw)', { tags: ['PII'] }), col('EMAIL_ADDR', 'VARCHAR(120)', 'Email (raw)', { tags: ['PII'] }),
        col('BIRTH_DT', 'DATE', 'Policyholder date of birth', { tags: ['PII'] }), col('ADDR_LN1', 'VARCHAR(80)', 'Mailing address', { tags: ['PII'] }),
        col('RISK_CITY', 'VARCHAR(40)', 'Risk location city'), col('RISK_ST', 'VARCHAR(2)', 'Risk state'), col('LOB_CD', 'VARCHAR(4)', 'Line of business code'),
        col('ANNUAL_PREM', 'NUMBER(12,2)', 'Annual term premium'), col('EFF_DT', 'DATE', 'Term effective date'),
        col('STAT_CD', 'VARCHAR(2)', 'Status code (IF in force, LP lapsed, CN cancelled)'), col('AGY_CD', 'VARCHAR(10)', 'Producing agency code'), ...cdc,
      ],
      rowCount: 61_402_118, bytes: 8.4e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:12:40', upstream: ['ext:Policy administration'],
      rowAccess: stateAccess('RISK_ST'),
      rows: memoRng(rng, seed + 701, () => withCdc(rng, polSample, (p) => ({
        POLICY_NO: rng.chance(0.3) ? `${p.policyNo}  ` : p.policyNo, PH_FIRST_NM: noisy(rng, p.first), PH_LAST_NM: noisy(rng, p.last),
        EMAIL_ADDR: rng.chance(0.3) ? p.email.toUpperCase() : p.email, BIRTH_DT: p.dob, ADDR_LN1: noisy(rng, p.street.toUpperCase()), RISK_CITY: noisy(rng, p.city),
        RISK_ST: p.state, LOB_CD: rng.chance(0.25) ? p.line.toLowerCase() : p.line, ANNUAL_PREM: p.premium, EFF_DT: p.termStart, STAT_CD: STATUS_CD[p.status],
        AGY_CD: agencyByKey.get(p.agencyKey)!.id,
      }), '2026-09-01', (p) => A_REGIONS.includes(p.region))),
    },
    {
      schema: 'RAW_BRONZE', name: 'CLM_CLAIM_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 2,
      comment: 'FNOL, claim header, reserve and payment status CDC from the claims system',
      columns: [
        col('CLAIM_NO', 'VARCHAR(16)', 'Claim number'), col('POLICY_NO', 'VARCHAR(16)', 'Policy number'), col('LOSS_DT', 'DATE', 'Date of loss'),
        col('RPT_DT', 'DATE', 'FNOL report date'), col('LOSS_ST', 'VARCHAR(2)', 'Loss state'), col('LOB_CD', 'VARCHAR(4)', 'Line of business code'),
        col('CAUSE_DESC', 'VARCHAR(40)', 'Cause of loss (free text)'), col('CLMNT_FIRST_NM', 'VARCHAR(40)', 'Claimant first name', { tags: ['PII'] }),
        col('CLMNT_LAST_NM', 'VARCHAR(40)', 'Claimant last name', { tags: ['PII'] }), col('CLMNT_BIRTH_DT', 'DATE', 'Claimant date of birth', { tags: ['PHI'] }),
        col('INJURY_DESC', 'VARCHAR(80)', 'Injury description', { tags: ['PHI'] }), col('CAT_CD', 'VARCHAR(10)', 'Catastrophe code (blank when not a cat)'),
        col('RESERVE_AMT', 'NUMBER(14,2)', 'Outstanding case reserve'), col('PAID_AMT', 'NUMBER(14,2)', 'Paid to date'), col('STAT_CD', 'VARCHAR(2)', 'O open, C closed, R reopened'), ...cdc,
      ],
      rowCount: 9_840_312, bytes: 2.6e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:05:12', upstream: ['ext:Claims'],
      rowAccess: stateAccess('LOSS_ST'),
      rows: memoRng(rng, seed + 702, () => withCdc(rng, d.claims.slice(-300).reverse(), (c) => ({
        CLAIM_NO: c.claimNo, POLICY_NO: polByKey.get(c.policyKey)!.policyNo, LOSS_DT: c.lossDate, RPT_DT: c.reportDate, LOSS_ST: c.state, LOB_CD: c.line,
        CAUSE_DESC: noisy(rng, c.cause), CLMNT_FIRST_NM: noisy(rng, c.claimantFirst), CLMNT_LAST_NM: noisy(rng, c.claimantLast), CLMNT_BIRTH_DT: c.claimantDob,
        INJURY_DESC: c.injury, CAT_CD: c.catCode ?? '', RESERVE_AMT: c.reserve, PAID_AMT: c.paid, STAT_CD: c.status[0],
      }), '2026-09-20', (c) => A_REGIONS.includes(c.region))),
    },
    {
      schema: 'RAW_BRONZE', name: 'BIL_INVOICE_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 3,
      comment: 'Premium invoices and payments CDC from the billing system',
      columns: [
        col('INVOICE_NO', 'VARCHAR(20)', 'Invoice number'), col('POLICY_NO', 'VARCHAR(16)', 'Policy number'), col('BILL_DT', 'DATE', 'Invoice date'),
        col('DUE_DT', 'DATE', 'Due date'), col('AMT_BILLED', 'NUMBER(12,2)', 'Amount billed'), col('PAY_PLAN_CD', 'VARCHAR(2)', 'M monthly, A annual'),
        col('DAYS_PAST_DUE', 'NUMBER(4)', 'Days past due at month end'), ...cdc,
      ],
      rowCount: 312_448_905, bytes: 2.2e10, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:41:03', upstream: ['ext:Billing'],
      rows: memoRng(rng, seed + 703, () => withCdc(rng, d.premiums.filter((p) => p.month === '2026-09' && p.billed > 0).slice(0, 300), (p) => ({
        INVOICE_NO: `INV-${p.month.replace('-', '')}-${pad(p.policyKey, 6)}`, POLICY_NO: polByKey.get(p.policyKey)!.policyNo, BILL_DT: `${p.month}-01`, DUE_DT: `${p.month}-21`,
        AMT_BILLED: p.billed, PAY_PLAN_CD: polByKey.get(p.policyKey)!.payPlan[0], DAYS_PAST_DUE: p.daysPastDue,
      }), '2026-09-01')),
    },
    {
      schema: 'RAW_BRONZE', name: 'AGT_SUBMISSION_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 4,
      comment: 'Submissions, quotes and binds from the agent & broker portal',
      columns: [
        col('SUBMISSION_ID', 'VARCHAR(16)', 'Submission id'), col('AGENCY_CD', 'VARCHAR(10)', 'Agency code'), col('AGENCY_NM', 'VARCHAR(60)', 'Agency name (raw)'),
        col('LOB_CD', 'VARCHAR(4)', 'Line of business code'), col('RISK_ST', 'VARCHAR(2)', 'Risk state'), col('RCVD_TS', 'TIMESTAMP_NTZ', 'Received'),
        col('QUOTE_TS', 'TIMESTAMP_NTZ', 'Quote issued'), col('QUOTED_PREM', 'NUMBER(12,2)', 'Quoted premium'), col('BIND_IND', 'VARCHAR(1)', 'Bound (Y/N)'),
        col('SUB_TYPE_CD', 'VARCHAR(2)', 'NB new business, RW rewrite, RI reinstatement'), ...cdc,
      ],
      rowCount: 14_203_377, bytes: 1.9e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:00:31', upstream: ['ext:Agent & broker portal'],
      rowAccess: stateAccess('RISK_ST'),
      rows: memoRng(rng, seed + 704, () => withCdc(rng, d.submissions.slice(-300).reverse(), (s) => ({
        SUBMISSION_ID: s.id, AGENCY_CD: agencyByKey.get(s.agencyKey)!.id, AGENCY_NM: noisy(rng, agencyByKey.get(s.agencyKey)!.name), LOB_CD: s.line, RISK_ST: s.state,
        RCVD_TS: ts(s.received, 480 + (s.key % 500)), QUOTE_TS: s.quoteDate ? ts(s.quoteDate, 540 + (s.key % 400)) : null, QUOTED_PREM: s.status === 'Declined' ? null : s.premium,
        BIND_IND: s.boundDate ? 'Y' : 'N', SUB_TYPE_CD: { 'New business': 'NB', Rewrite: 'RW', Reinstatement: 'RI' }[s.type],
      }), '2026-09-15', (s) => A_REGIONS.includes(s.region))),
    },
    {
      schema: 'RAW_BRONZE', name: 'CAT_EVENT_FEED', layer: 'bronze', type: 'ICEBERG TABLE', order: 5,
      comment: 'Catastrophe event feed: event codes, perils, dates and affected states',
      columns: [
        col('CAT_CD', 'VARCHAR(10)', 'Catastrophe code'), col('EVENT_NM', 'VARCHAR(60)', 'Event name (raw)'), col('PERIL_CD', 'VARCHAR(4)', 'Peril code'),
        col('START_DT', 'DATE', 'Event start'), col('END_DT', 'DATE', 'Event end'), col('AFFECTED_ST', 'VARCHAR(40)', 'Affected states (comma separated)'), ...cdc,
      ],
      rowCount: 1_204, bytes: 3.1e5, owner: 'INGEST_ADMIN', lastAltered: '2026-09-29 22:00:00', upstream: ['ext:Catastrophe feeds'],
      rows: memoRng(rng, seed + 705, () => withCdc(rng, [...CAT_EVENTS].reverse(), (e) => ({
        CAT_CD: e.code, EVENT_NM: noisy(rng, e.name), PERIL_CD: { Hurricane: 'HU', Wildfire: 'WF', 'Severe convective': 'SCS', 'Winter storm': 'WS' }[e.peril] ?? 'OT',
        START_DT: e.start, END_DT: e.end, AFFECTED_ST: e.states.join(','),
      }), '2025-02-15')),
    },
  ];

  const silver: SfObject[] = [
    {
      schema: 'CURATED_SILVER', name: 'POLICY', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 1,
      comment: 'Deduplicated SCD2 policy and policyholder entity (one version per policy term)',
      columns: [
        col('POLICY_ID', 'VARCHAR(16)', 'Policy number (trimmed)', { nullable: false }), col('POLICYHOLDER_ID', 'VARCHAR(10)', 'Policyholder identifier', { termId: 'T-001', tags: ['CDE'] }),
        col('FIRST_NAME', 'VARCHAR(40)', 'First name', { tags: ['PII'] }), col('LAST_NAME', 'VARCHAR(40)', 'Last name', { tags: ['PII'] }),
        col('EMAIL', 'VARCHAR(120)', 'Email (lowercased)', { tags: ['PII'] }), col('BIRTH_DATE', 'DATE', 'Date of birth', { tags: ['PII'] }),
        col('STATE', 'VARCHAR(2)', 'Risk state'), col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line of business', { termId: 'T-004', tags: ['CDE'] }),
        col('ANNUAL_PREMIUM', 'NUMBER(12,2)', 'Annual term premium', { termId: 'T-006' }), col('POLICY_STATUS', 'VARCHAR(12)', 'In force / Lapsed / Cancelled', { termId: 'T-002' }),
        col('EFFECTIVE_FROM', 'DATE', 'SCD2 valid from'), col('EFFECTIVE_TO', 'DATE', 'SCD2 valid to'), col('IS_CURRENT', 'BOOLEAN', 'Current version flag'),
      ],
      rowCount: 9_214_660, bytes: 1.3e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:28:10', upstream: ['RAW_BRONZE.PAS_POLICY_CDC'],
      rowAccess: stateAccess('STATE'),
      rows: memo(() => polSample.flatMap((p) => {
        const cur = { POLICY_ID: p.policyNo, POLICYHOLDER_ID: p.holderId, FIRST_NAME: p.first, LAST_NAME: p.last, EMAIL: p.email, BIRTH_DATE: p.dob, STATE: p.state, LINE_OF_BUSINESS: p.lineName };
        const prior = p.terms.length > 1 ? p.terms[p.terms.length - 2] : undefined;
        return prior
          ? [{ ...cur, ANNUAL_PREMIUM: prior.premium, POLICY_STATUS: 'In force', EFFECTIVE_FROM: prior.start, EFFECTIVE_TO: addDays(p.termStart, -1), IS_CURRENT: false },
            { ...cur, ANNUAL_PREMIUM: p.premium, POLICY_STATUS: p.status, EFFECTIVE_FROM: p.termStart, EFFECTIVE_TO: null, IS_CURRENT: true }]
          : [{ ...cur, ANNUAL_PREMIUM: p.premium, POLICY_STATUS: p.status, EFFECTIVE_FROM: p.termStart, EFFECTIVE_TO: null, IS_CURRENT: true }];
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'CLAIM', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 2,
      comment: 'Cleansed claims with standardised cause of loss, region and cat code',
      columns: [
        col('CLAIM_ID', 'VARCHAR(16)', 'Claim number'), col('POLICY_ID', 'VARCHAR(16)', 'Policy number'), col('LOSS_DATE', 'DATE', 'Date of loss'),
        col('REPORT_DATE', 'DATE', 'FNOL date'), col('CLOSE_DATE', 'DATE', 'Closed date'), col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' }),
        col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line of business', { termId: 'T-004' }), col('CAUSE_OF_LOSS', 'VARCHAR(30)', 'Cause of loss'),
        col('CLAIM_STATUS', 'VARCHAR(10)', 'Open / Closed / Reopened', { termId: 'T-014' }), col('CAT_CODE', 'VARCHAR(10)', 'Cat-code list match', { termId: 'T-009' }),
        col('CLAIMANT_NAME', 'VARCHAR(80)', 'Claimant name', { tags: ['PII'] }), col('CLAIMANT_BIRTH_DATE', 'DATE', 'Claimant date of birth', { tags: ['PHI'] }),
        col('INJURY_DESCRIPTION', 'VARCHAR(80)', 'Injury description', { tags: ['PHI'] }),
      ],
      rowCount: 9_402_115, bytes: 1.4e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:20:44', upstream: ['RAW_BRONZE.CLM_CLAIM_CDC', 'CURATED_SILVER.CAT_EVENT'],
      rowAccess: regionAccess,
      rows: memo(() => d.claims.slice().reverse().map((c) => ({
        CLAIM_ID: c.claimNo, POLICY_ID: polByKey.get(c.policyKey)!.policyNo, LOSS_DATE: c.lossDate, REPORT_DATE: c.reportDate, CLOSE_DATE: c.closeDate ?? null,
        REGION: c.region, LINE_OF_BUSINESS: lineName(c.line), CAUSE_OF_LOSS: c.cause, CLAIM_STATUS: c.status, CAT_CODE: c.catCode,
        CLAIMANT_NAME: `${c.claimantFirst} ${c.claimantLast}`, CLAIMANT_BIRTH_DATE: c.claimantDob, INJURY_DESCRIPTION: c.injury,
      }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'CLAIM_TRANSACTION', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 3,
      comment: 'Typed claim financial transactions: reserves, loss and expense payments, recoveries',
      columns: [col('TXN_ID', 'VARCHAR(16)', 'Transaction id'), col('CLAIM_ID', 'VARCHAR(16)', 'Claim number'), col('TXN_DATE', 'DATE', 'Transaction date'), col('TXN_TYPE', 'VARCHAR(24)', 'Transaction type'), col('AMOUNT_USD', 'NUMBER(14,2)', 'Amount (recoveries negative)', { termId: 'T-027' })],
      rowCount: 61_880_204, bytes: 4.0e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:21:02', upstream: ['RAW_BRONZE.CLM_CLAIM_CDC'],
      rows: memo(() => d.txns.slice(-3000).reverse().map((t) => ({ TXN_ID: `TX-${pad(t.key, 8)}`, CLAIM_ID: claimByKey.get(t.claimKey)!.claimNo, TXN_DATE: t.date, TXN_TYPE: t.type, AMOUNT_USD: t.amount }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'PREMIUM_INVOICE', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 4,
      comment: 'Typed premium invoices with pay plan and delinquency',
      columns: [col('INVOICE_ID', 'VARCHAR(20)', 'Invoice id'), col('POLICY_ID', 'VARCHAR(16)', 'Policy number'), col('INVOICE_MONTH', 'DATE', 'Invoice month'), col('BILLED_AMOUNT', 'NUMBER(12,2)', 'Billed'), col('PAY_PLAN', 'VARCHAR(10)', 'Monthly / Annual'), col('DAYS_PAST_DUE', 'NUMBER(4)', 'Days past due', { termId: 'T-023' })],
      rowCount: 298_114_026, bytes: 1.6e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:55:19', upstream: ['RAW_BRONZE.BIL_INVOICE_CDC'],
      rows: memo(() => d.premiums.filter((p) => p.month === '2026-09' && p.billed > 0).slice(0, 400).map((p) => ({ INVOICE_ID: `INV-${p.month.replace('-', '')}-${pad(p.policyKey, 6)}`, POLICY_ID: polByKey.get(p.policyKey)!.policyNo, INVOICE_MONTH: `${p.month}-01`, BILLED_AMOUNT: p.billed, PAY_PLAN: polByKey.get(p.policyKey)!.payPlan, DAYS_PAST_DUE: p.daysPastDue }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'SUBMISSION', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 5,
      comment: 'Cleansed submissions with quote and bind milestones',
      columns: [
        col('SUBMISSION_ID', 'VARCHAR(16)', 'Submission id'), col('AGENCY_ID', 'VARCHAR(10)', 'Agency', { termId: 'T-022' }), col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line of business', { termId: 'T-004' }),
        col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' }), col('RECEIVED_DATE', 'DATE', 'Received'), col('QUOTE_DATE', 'DATE', 'Quoted'), col('BOUND_DATE', 'DATE', 'Bound'),
        col('QUOTED_PREMIUM', 'NUMBER(12,2)', 'Quoted premium'), col('SUBMISSION_TYPE', 'VARCHAR(16)', 'New business / Rewrite / Reinstatement', { termId: 'T-018' }), col('STATUS', 'VARCHAR(12)', 'Pipeline status'),
      ],
      rowCount: 13_902_551, bytes: 1.1e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:02:47', upstream: ['RAW_BRONZE.AGT_SUBMISSION_CDC'],
      rowAccess: regionAccess,
      rows: memo(() => d.submissions.slice().reverse().map((s) => ({
        SUBMISSION_ID: s.id, AGENCY_ID: agencyByKey.get(s.agencyKey)!.id, LINE_OF_BUSINESS: lineName(s.line), REGION: s.region, RECEIVED_DATE: s.received, QUOTE_DATE: s.quoteDate ?? null,
        BOUND_DATE: s.boundDate ?? null, QUOTED_PREMIUM: s.status === 'Declined' ? null : s.premium, SUBMISSION_TYPE: s.type, STATUS: s.status,
      }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'CAT_EVENT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 day', order: 6,
      comment: 'The cat-code list: one row per declared catastrophe event',
      columns: [col('CAT_CODE', 'VARCHAR(10)', 'Catastrophe code', { termId: 'T-009', tags: ['CDE'] }), col('EVENT_NAME', 'VARCHAR(60)', 'Event name'), col('PERIL', 'VARCHAR(20)', 'Peril'), col('START_DATE', 'DATE', 'Start'), col('END_DATE', 'DATE', 'End'), col('AFFECTED_STATES', 'VARCHAR(40)', 'Affected states')],
      rowCount: CAT_EVENTS.length + 37, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-29 23:00:00', upstream: ['RAW_BRONZE.CAT_EVENT_FEED'],
      rows: memo(() => [...CAT_EVENTS].reverse().map((e) => ({ CAT_CODE: e.code, EVENT_NAME: e.name, PERIL: e.peril, START_DATE: e.start, END_DATE: e.end, AFFECTED_STATES: e.states.join(', ') }))),
    },
  ];

  const allDates: string[] = [];
  for (let x = '2025-01-01'; x <= AS_OF; x = addDays(x, 1)) allDates.push(x);
  const claimCount24m = memo(() => {
    const m = new Map<number, number>();
    for (const c of d.claims) m.set(c.policyKey, (m.get(c.policyKey) ?? 0) + 1);
    return m;
  });
  const lastCat = memo(() => {
    const m = new Map<number, { code: string; loss: number }>();
    for (const c of d.claims) if (c.catCode) {
      const cur = m.get(c.policyKey);
      m.set(c.policyKey, { code: c.catCode, loss: (cur?.loss ?? 0) + c.incurred });
    }
    return m;
  });

  const gold: SfObject[] = [
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_POLICY', layer: 'gold', type: 'TABLE', order: 1, comment: 'Conformed policy and policyholder dimension (current term)',
      columns: [
        col('POLICY_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('POLICY_ID', 'VARCHAR(16)', 'Policy number'),
        col('POLICYHOLDER_ID', 'VARCHAR(10)', 'Policyholder identifier', { termId: 'T-001', tags: ['CDE'] }), col('INSURED_NAME', 'VARCHAR(80)', 'Named insured', { tags: ['PII'] }),
        col('REGION', 'VARCHAR(10)', 'Region (state group)', { termId: 'T-003', tags: ['CDE'] }), col('STATE', 'VARCHAR(2)', 'Risk state'),
        col('LINE_CODE', 'VARCHAR(4)', 'Line of business code', { termId: 'T-004' }), col('AGENCY_KEY', 'NUMBER', 'Producing agency'),
        col('INCEPTION_DATE', 'DATE', 'Original inception date'), col('TERM_EFFECTIVE_DATE', 'DATE', 'Current term effective'), col('TERM_EXPIRY_DATE', 'DATE', 'Current term expiry'),
        col('POLICY_STATUS', 'VARCHAR(12)', 'In force / Lapsed / Cancelled', { termId: 'T-002', tags: ['CDE'] }), col('ANNUAL_PREMIUM', 'NUMBER(12,2)', 'Current term premium', { termId: 'T-006' }),
        col('RENEWED_FLAG', 'BOOLEAN', 'Renewed at its 2026 renewal date (null when not yet due)', { termId: 'T-016', tags: ['CDE'] }),
        col('TOTAL_INSURED_VALUE', 'NUMBER(14,0)', 'Total insured value (property lines)', { termId: 'T-021', tags: ['CDE'] }), col('CAT_ZONE', 'VARCHAR(20)', 'Catastrophe zone of the risk location'),
      ],
      rowCount: 6_140_288, bytes: 7.7e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:31:00', upstream: ['CURATED_SILVER.POLICY'], rowAccess: regionAccess,
      rows: memo(() => d.policies.map((p) => ({
        POLICY_KEY: p.key, POLICY_ID: p.policyNo, POLICYHOLDER_ID: p.holderId, INSURED_NAME: p.insuredName, REGION: p.region, STATE: p.state, LINE_CODE: p.line,
        AGENCY_KEY: p.agencyKey, INCEPTION_DATE: p.inception, TERM_EFFECTIVE_DATE: p.termStart, TERM_EXPIRY_DATE: p.expiry, POLICY_STATUS: p.status, ANNUAL_PREMIUM: p.premium,
        RENEWED_FLAG: p.due['2026'] ? Boolean(p.renewed['2026']) : null, TOTAL_INSURED_VALUE: p.tiv, CAT_ZONE: p.catZone,
      }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_LINE_OF_BUSINESS', layer: 'gold', type: 'TABLE', order: 2, comment: 'Lines of business with Annual Statement line mapping',
      columns: [col('LINE_CODE', 'VARCHAR(4)', 'Line code'), col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line of business', { termId: 'T-004', tags: ['CDE'] }), col('SEGMENT', 'VARCHAR(12)', 'Personal / Commercial'), col('ANNUAL_STATEMENT_LINE', 'VARCHAR(60)', 'Statutory line'), col('IBNR_FACTOR', 'NUMBER(5,3)', 'Reserving committee IBNR factor on trailing 12-month earned premium')],
      rowCount: LINES.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-07-01 02:00:00', upstream: ['CURATED_SILVER.POLICY'],
      rows: memo(() => LINES.map((l) => ({ LINE_CODE: l.code, LINE_OF_BUSINESS: l.name, SEGMENT: l.segment, ANNUAL_STATEMENT_LINE: STATEMENT_LINE[l.code], IBNR_FACTOR: l.ibnrFactor }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_PRODUCER', layer: 'gold', type: 'TABLE', order: 3, comment: 'Agencies, brokers and the direct channel',
      columns: [col('AGENCY_KEY', 'NUMBER', 'Surrogate key'), col('AGENCY_ID', 'VARCHAR(10)', 'Agency code', { termId: 'T-022' }), col('AGENCY_NAME', 'VARCHAR(60)', 'Agency name'), col('CHANNEL', 'VARCHAR(20)', 'Distribution channel'), col('REGION', 'VARCHAR(10)', 'Home region', { termId: 'T-003' }), col('STATE', 'VARCHAR(2)', 'Home state')],
      rowCount: 3_412, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-15 02:00:00', upstream: ['CURATED_SILVER.SUBMISSION'], rowAccess: regionAccess,
      rows: memo(() => d.agencies.map((a) => ({ AGENCY_KEY: a.key, AGENCY_ID: a.id, AGENCY_NAME: a.name, CHANNEL: a.channel, REGION: a.region, STATE: a.state }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_CAT_EVENT', layer: 'gold', type: 'TABLE', order: 4, comment: 'Catastrophe events from the cat-code list',
      columns: [col('CAT_EVENT_KEY', 'NUMBER', 'Surrogate key'), col('CAT_CODE', 'VARCHAR(10)', 'Catastrophe code', { termId: 'T-009', tags: ['CDE'] }), col('EVENT_NAME', 'VARCHAR(60)', 'Event'), col('PERIL', 'VARCHAR(20)', 'Peril'), col('START_DATE', 'DATE', 'Start'), col('END_DATE', 'DATE', 'End')],
      rowCount: CAT_EVENTS.length + 37, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-29 23:05:00', upstream: ['CURATED_SILVER.CAT_EVENT'],
      rows: memo(() => CAT_EVENTS.map((e, i) => ({ CAT_EVENT_KEY: i + 1, CAT_CODE: e.code, EVENT_NAME: e.name, PERIL: e.peril, START_DATE: e.start, END_DATE: e.end }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_DATE', layer: 'gold', type: 'TABLE', order: 5, comment: 'Calendar with fiscal periods (FY = calendar year) and month-end valuation flags',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'yyyymmdd'), col('CALENDAR_DATE', 'DATE', 'Date'), col('FISCAL_QUARTER', 'VARCHAR(7)', 'Fiscal quarter'), col('FISCAL_YEAR', 'NUMBER(4)', 'Fiscal year'), col('IS_MONTH_END', 'BOOLEAN', 'Reserve valuation date')],
      rowCount: allDates.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:05:00', upstream: [],
      rows: memo(() => allDates.slice().reverse().map((x) => ({ DATE_KEY: dateKey(x), CALENDAR_DATE: x, FISCAL_QUARTER: `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`, FISCAL_YEAR: Number(x.slice(0, 4)), IS_MONTH_END: addDays(x, 1).endsWith('-01') }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_PREMIUM', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 6, comment: 'Written, earned and billed premium at policy-month grain',
      columns: [
        col('PREMIUM_KEY', 'NUMBER', 'Row key'), col('POLICY_KEY', 'NUMBER', 'Policy'), col('MONTH_KEY', 'NUMBER(8)', 'First day of month'), col('LINE_CODE', 'VARCHAR(4)', 'Line', { termId: 'T-004' }),
        col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' }), col('WRITTEN_PREMIUM', 'NUMBER(12,2)', 'Premium written in the month', { termId: 'T-006', tags: ['CDE'] }),
        col('EARNED_PREMIUM', 'NUMBER(12,2)', 'Premium earned in the month', { termId: 'T-005', tags: ['CDE'] }), col('BILLED_AMOUNT', 'NUMBER(12,2)', 'Invoiced in the month'),
        col('DAYS_PAST_DUE', 'NUMBER(4)', 'Days past due at month end', { termId: 'T-023' }), col('UW_EXPENSE', 'NUMBER(12,2)', 'Commission and other underwriting expense', { termId: 'T-024' }),
      ],
      rowCount: 132_480_016, bytes: 6.1e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:08:20', upstream: ['CURATED_SILVER.PREMIUM_INVOICE', 'CONFORMED_GOLD.DIM_POLICY'], rowAccess: regionAccess,
      rows: memo(() => d.premiums.slice().reverse().map((p) => ({ PREMIUM_KEY: p.key, POLICY_KEY: p.policyKey, MONTH_KEY: monthKey(p.month), LINE_CODE: p.line, REGION: p.region, WRITTEN_PREMIUM: p.written, EARNED_PREMIUM: p.earned, BILLED_AMOUNT: p.billed, DAYS_PAST_DUE: p.daysPastDue, UW_EXPENSE: p.expense }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_CLAIM', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 7, comment: 'Claim fact at claim grain: incurred, paid, reserve, LAE, recoveries and cat code',
      columns: [
        col('CLAIM_KEY', 'NUMBER', 'Claim'), col('POLICY_KEY', 'NUMBER', 'Policy'), col('LOSS_DATE_KEY', 'NUMBER(8)', 'Loss date'), col('REPORT_DATE_KEY', 'NUMBER(8)', 'FNOL date'),
        col('CLOSE_DATE_KEY', 'NUMBER(8)', 'Close date'), col('LINE_CODE', 'VARCHAR(4)', 'Line', { termId: 'T-004', tags: ['CDE'] }), col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003', tags: ['CDE'] }),
        col('CLAIM_STATUS', 'VARCHAR(10)', 'Open / Closed / Reopened', { termId: 'T-014', tags: ['CDE'] }), col('CAT_CODE', 'VARCHAR(10)', 'Catastrophe code', { termId: 'T-009', tags: ['CDE'] }),
        col('INCURRED_LOSS', 'NUMBER(14,2)', 'Paid plus case reserve', { termId: 'T-007', tags: ['CDE'] }), col('PAID_LOSS', 'NUMBER(14,2)', 'Paid to date', { termId: 'T-027' }),
        col('CASE_RESERVE', 'NUMBER(14,2)', 'Outstanding case reserve', { termId: 'T-019' }), col('LAE_AMOUNT', 'NUMBER(12,2)', 'Loss adjustment expense', { termId: 'T-011', tags: ['CDE'] }),
        col('SUBRO_RECOVERED', 'NUMBER(12,2)', 'Subrogation recovered', { termId: 'T-015', tags: ['CDE'] }), col('CYCLE_DAYS', 'NUMBER(5)', 'FNOL to close days', { termId: 'T-013' }),
        col('FRAUD_SCORE', 'NUMBER(3)', 'Fraud propensity 0–100', { termId: 'T-026' }), col('CLAIMANT_NAME', 'VARCHAR(80)', 'Claimant name', { tags: ['PII'] }),
        col('INJURY_DESCRIPTION', 'VARCHAR(80)', 'Injury description', { tags: ['PHI'] }),
      ],
      rowCount: 9_402_115, bytes: 1.2e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:22:31', upstream: ['CURATED_SILVER.CLAIM', 'CONFORMED_GOLD.DIM_POLICY', 'CONFORMED_GOLD.DIM_CAT_EVENT'], rowAccess: regionAccess,
      rows: memo(() => d.claims.slice().reverse().map((c) => ({
        CLAIM_KEY: c.key, POLICY_KEY: c.policyKey, LOSS_DATE_KEY: dateKey(c.lossDate), REPORT_DATE_KEY: dateKey(c.reportDate), CLOSE_DATE_KEY: c.closeDate ? dateKey(c.closeDate) : null,
        LINE_CODE: c.line, REGION: c.region, CLAIM_STATUS: c.status, CAT_CODE: c.catCode, INCURRED_LOSS: c.incurred, PAID_LOSS: c.paid, CASE_RESERVE: c.reserve, LAE_AMOUNT: c.lae,
        SUBRO_RECOVERED: c.subroRecovered, CYCLE_DAYS: c.closeDate ? daysBetween(c.reportDate, c.closeDate) : null, FRAUD_SCORE: c.fraudScore,
        CLAIMANT_NAME: `${c.claimantFirst} ${c.claimantLast}`, INJURY_DESCRIPTION: c.injury,
      }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_CLAIM_TRANSACTION', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 8, comment: 'Claim financial transactions (highest-volume fact)',
      columns: [col('TXN_KEY', 'NUMBER', 'Transaction'), col('CLAIM_KEY', 'NUMBER', 'Claim'), col('DATE_KEY', 'NUMBER(8)', 'Transaction date'), col('TXN_TYPE', 'VARCHAR(24)', 'Initial reserve / Loss payment / Expense payment / Subrogation recovery'), col('AMOUNT_USD', 'NUMBER(14,2)', 'Amount', { termId: 'T-027', tags: ['CDE'] }), col('LINE_CODE', 'VARCHAR(4)', 'Line'), col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' })],
      rowCount: 412_660_118, bytes: 2.4e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:23:05', upstream: ['CURATED_SILVER.CLAIM_TRANSACTION', 'CONFORMED_GOLD.FCT_CLAIM'], rowAccess: regionAccess,
      rows: memo(() => d.txns.slice().reverse().map((t) => ({ TXN_KEY: t.key, CLAIM_KEY: t.claimKey, DATE_KEY: dateKey(t.date), TXN_TYPE: t.type, AMOUNT_USD: t.amount, LINE_CODE: t.line, REGION: t.region }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_RESERVE', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 day', order: 9, comment: 'Month-end loss reserve snapshots per open claim, with allocated IBNR',
      columns: [
        col('RESERVE_KEY', 'NUMBER', 'Row key'), col('CLAIM_KEY', 'NUMBER', 'Claim'), col('VALUATION_DATE_KEY', 'NUMBER(8)', 'Month-end valuation date'),
        col('LINE_CODE', 'VARCHAR(4)', 'Line', { termId: 'T-004' }), col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' }), col('ACCIDENT_YEAR', 'NUMBER(4)', 'Accident year'),
        col('CASE_RESERVE', 'NUMBER(14,2)', 'Case reserve at valuation', { termId: 'T-019', tags: ['CDE'] }), col('PAID_TO_DATE', 'NUMBER(14,2)', 'Paid to date at valuation', { termId: 'T-027' }),
        col('IBNR_ALLOCATED', 'NUMBER(14,2)', 'IBNR allocated pro rata to case reserve', { termId: 'T-020', tags: ['CDE'] }),
        col('CLAIMANT_DOB', 'DATE', 'Claimant date of birth (carried for reserving age bands)', { tags: ['PHI'], maskPendingFix: GATE6_CHECK }),
      ],
      rowCount: 48_906_220, bytes: 3.3e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 04:15:00', upstream: ['CONFORMED_GOLD.FCT_CLAIM', 'CONFORMED_GOLD.DIM_LINE_OF_BUSINESS'], rowAccess: regionAccess,
      rows: memo(() => d.reserves.slice().reverse().map((r) => ({ RESERVE_KEY: r.key, CLAIM_KEY: r.claimKey, VALUATION_DATE_KEY: dateKey(r.valuation), LINE_CODE: r.line, REGION: r.region, ACCIDENT_YEAR: r.accidentYear, CASE_RESERVE: r.caseReserve, PAID_TO_DATE: r.paidToDate, IBNR_ALLOCATED: r.ibnr, CLAIMANT_DOB: r.claimantDob }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_SUBMISSION', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 10, comment: 'Submission funnel fact: quoted, bound, premium and turnaround',
      columns: [
        col('SUBMISSION_KEY', 'NUMBER', 'Submission'), col('AGENCY_KEY', 'NUMBER', 'Agency'), col('DATE_KEY', 'NUMBER(8)', 'Received date'), col('QUOTE_DATE_KEY', 'NUMBER(8)', 'Quote date'),
        col('LINE_CODE', 'VARCHAR(4)', 'Line', { termId: 'T-004' }), col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' }), col('SUBMISSION_TYPE', 'VARCHAR(16)', 'New business / Rewrite / Reinstatement', { termId: 'T-018' }),
        col('IS_QUOTED', 'BOOLEAN', 'Quote issued'), col('IS_BOUND', 'BOOLEAN', 'Bound', { termId: 'T-017', tags: ['CDE'] }), col('QUOTED_PREMIUM', 'NUMBER(12,2)', 'Quoted premium'),
        col('BOUND_PREMIUM', 'NUMBER(12,2)', 'Bound premium', { termId: 'T-018' }), col('TURNAROUND_DAYS', 'NUMBER(5,1)', 'Days from submission to quote', { termId: 'T-028' }),
      ],
      rowCount: 13_902_551, bytes: 9.2e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:04:10', upstream: ['CURATED_SILVER.SUBMISSION', 'CONFORMED_GOLD.DIM_PRODUCER'], rowAccess: regionAccess,
      rows: memo(() => d.submissions.slice().reverse().map((s) => ({
        SUBMISSION_KEY: s.key, AGENCY_KEY: s.agencyKey, DATE_KEY: dateKey(s.received), QUOTE_DATE_KEY: s.quoteDate ? dateKey(s.quoteDate) : null, LINE_CODE: s.line, REGION: s.region,
        SUBMISSION_TYPE: s.type, IS_QUOTED: Boolean(s.quoteDate), IS_BOUND: Boolean(s.boundDate), QUOTED_PREMIUM: s.status === 'Declined' ? null : s.premium,
        BOUND_PREMIUM: s.boundDate ? s.premium : null, TURNAROUND_DAYS: s.turnaround ?? null,
      }))),
    },
  ];

  const products: SfObject[] = [
    {
      schema: 'DATA_PRODUCTS', name: 'DP_POLICYHOLDER_360', layer: 'product', type: 'SECURE VIEW', order: 3, comment: 'Output port of Policyholder 360',
      columns: [
        col('POLICY_ID', 'VARCHAR(16)', 'Policy number'), col('POLICYHOLDER_ID', 'VARCHAR(10)', 'Policyholder', { termId: 'T-001', tags: ['CDE'] }),
        col('INSURED_NAME', 'VARCHAR(80)', 'Named insured', { tags: ['PII'] }), col('EMAIL', 'VARCHAR(120)', 'Contact email', { tags: ['PII'] }),
        col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003', tags: ['CDE'] }), col('STATE', 'VARCHAR(2)', 'State'), col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line', { termId: 'T-004' }),
        col('AGENCY_NAME', 'VARCHAR(60)', 'Producing agency'), col('IS_IN_FORCE', 'BOOLEAN', 'Policy in force (rule BR-001)', { termId: 'T-002', tags: ['CDE'] }),
        col('ANNUAL_PREMIUM', 'NUMBER(12,2)', 'Current term premium', { termId: 'T-006' }), col('TENURE_YEARS', 'NUMBER(4,1)', 'Years since inception'),
        col('RENEWED_FLAG', 'BOOLEAN', 'Renewed at 2026 renewal', { termId: 'T-016', tags: ['CDE'] }), col('CLAIMS_21M', 'NUMBER(3)', 'Claims since Jan 2025'),
      ],
      rowCount: 6_140_288, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:00:00', upstream: ['CONFORMED_GOLD.DIM_POLICY', 'CONFORMED_GOLD.FCT_PREMIUM', 'CONFORMED_GOLD.FCT_CLAIM'], rowAccess: regionAccess,
      rows: memo(() => d.policies.map((p) => ({
        POLICY_ID: p.policyNo, POLICYHOLDER_ID: p.holderId, INSURED_NAME: p.insuredName, EMAIL: p.email, REGION: p.region, STATE: p.state, LINE_OF_BUSINESS: p.lineName,
        AGENCY_NAME: agencyByKey.get(p.agencyKey)!.name, IS_IN_FORCE: inForceOn(p, AS_OF), ANNUAL_PREMIUM: p.premium, TENURE_YEARS: round(daysBetween(p.inception, AS_OF) / 365.25, 1),
        RENEWED_FLAG: p.due['2026'] ? Boolean(p.renewed['2026']) : null, CLAIMS_21M: claimCount24m().get(p.key) ?? 0,
      }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CLAIMS_EXPERIENCE', layer: 'product', type: 'SECURE VIEW', order: 4, comment: 'Output port of Claims Experience',
      columns: [
        col('CLAIM_ID', 'VARCHAR(16)', 'Claim number'), col('POLICY_ID', 'VARCHAR(16)', 'Policy number'), col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line', { termId: 'T-004', tags: ['CDE'] }),
        col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003', tags: ['CDE'] }), col('STATE', 'VARCHAR(2)', 'Loss state'), col('LOSS_DATE', 'DATE', 'Loss date'), col('REPORT_DATE', 'DATE', 'FNOL date'),
        col('CLOSE_DATE', 'DATE', 'Close date'), col('CLAIM_STATUS', 'VARCHAR(10)', 'Status'), col('IS_OPEN', 'BOOLEAN', 'Open claim (rule BR-002)', { termId: 'T-014', tags: ['CDE'] }),
        col('CAT_CODE', 'VARCHAR(10)', 'Catastrophe code', { termId: 'T-009', tags: ['CDE'] }), col('INCURRED_LOSS', 'NUMBER(14,2)', 'Incurred loss', { termId: 'T-007', tags: ['CDE'] }),
        col('PAID_LOSS', 'NUMBER(14,2)', 'Paid loss', { termId: 'T-027' }), col('CASE_RESERVE', 'NUMBER(14,2)', 'Case reserve', { termId: 'T-019' }),
        col('LAE_AMOUNT', 'NUMBER(12,2)', 'LAE', { termId: 'T-011', tags: ['CDE'] }), col('SUBRO_RECOVERED', 'NUMBER(12,2)', 'Subrogation recovered', { termId: 'T-015' }),
        col('CYCLE_DAYS', 'NUMBER(5)', 'FNOL to close days', { termId: 'T-013' }), col('CLAIMANT_NAME', 'VARCHAR(80)', 'Claimant', { tags: ['PII'] }),
        col('INJURY_DESCRIPTION', 'VARCHAR(80)', 'Injury', { tags: ['PHI'] }),
      ],
      rowCount: 9_402_115, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:24:00', upstream: ['CONFORMED_GOLD.FCT_CLAIM', 'CONFORMED_GOLD.FCT_CLAIM_TRANSACTION', 'CONFORMED_GOLD.DIM_LINE_OF_BUSINESS', 'CONFORMED_GOLD.DIM_CAT_EVENT'], rowAccess: regionAccess,
      rows: memo(() => d.claims.slice().reverse().map((c) => ({
        CLAIM_ID: c.claimNo, POLICY_ID: polByKey.get(c.policyKey)!.policyNo, LINE_OF_BUSINESS: lineName(c.line), REGION: c.region, STATE: c.state, LOSS_DATE: c.lossDate, REPORT_DATE: c.reportDate,
        CLOSE_DATE: c.closeDate ?? null, CLAIM_STATUS: c.status, IS_OPEN: c.status !== 'Closed' && c.reserve > 0, CAT_CODE: c.catCode, INCURRED_LOSS: c.incurred, PAID_LOSS: c.paid,
        CASE_RESERVE: c.reserve, LAE_AMOUNT: c.lae, SUBRO_RECOVERED: c.subroRecovered, CYCLE_DAYS: c.closeDate ? daysBetween(c.reportDate, c.closeDate) : null,
        CLAIMANT_NAME: `${c.claimantFirst} ${c.claimantLast}`, INJURY_DESCRIPTION: c.injury,
      }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_PREMIUM_BILLING', layer: 'product', type: 'SECURE VIEW', order: 5, comment: 'Output port of Premium & Billing',
      columns: [
        col('POLICY_ID', 'VARCHAR(16)', 'Policy number'), col('PREMIUM_MONTH', 'DATE', 'Month'), col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line', { termId: 'T-004' }),
        col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003', tags: ['CDE'] }), col('WRITTEN_PREMIUM', 'NUMBER(12,2)', 'Written premium', { termId: 'T-006', tags: ['CDE'] }),
        col('EARNED_PREMIUM', 'NUMBER(12,2)', 'Earned premium', { termId: 'T-005', tags: ['CDE'] }), col('BILLED_AMOUNT', 'NUMBER(12,2)', 'Billed'),
        col('DAYS_PAST_DUE', 'NUMBER(4)', 'Days past due', { termId: 'T-023' }), col('UW_EXPENSE', 'NUMBER(12,2)', 'Underwriting expense', { termId: 'T-024' }), col('PAY_PLAN', 'VARCHAR(10)', 'Pay plan'),
      ],
      rowCount: 132_480_016, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:10:00', upstream: ['CONFORMED_GOLD.FCT_PREMIUM', 'CONFORMED_GOLD.DIM_POLICY'], rowAccess: regionAccess,
      rows: memo(() => d.premiums.slice().reverse().map((p) => ({ POLICY_ID: polByKey.get(p.policyKey)!.policyNo, PREMIUM_MONTH: `${p.month}-01`, LINE_OF_BUSINESS: lineName(p.line), REGION: p.region, WRITTEN_PREMIUM: p.written, EARNED_PREMIUM: p.earned, BILLED_AMOUNT: p.billed, DAYS_PAST_DUE: p.daysPastDue, UW_EXPENSE: p.expense, PAY_PLAN: polByKey.get(p.policyKey)!.payPlan }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_DISTRIBUTION_PERFORMANCE', layer: 'product', type: 'SECURE VIEW', order: 6, comment: 'Output port of Distribution Performance',
      columns: [
        col('SUBMISSION_ID', 'VARCHAR(16)', 'Submission'), col('AGENCY_NAME', 'VARCHAR(60)', 'Agency', { termId: 'T-022' }), col('CHANNEL', 'VARCHAR(20)', 'Channel'),
        col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line', { termId: 'T-004' }), col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' }), col('RECEIVED_DATE', 'DATE', 'Received'),
        col('QUOTE_DATE', 'DATE', 'Quoted'), col('BOUND_DATE', 'DATE', 'Bound'), col('SUBMISSION_TYPE', 'VARCHAR(16)', 'Submission type', { termId: 'T-018' }),
        col('IS_BOUND', 'BOOLEAN', 'Bound', { termId: 'T-017', tags: ['CDE'] }), col('QUOTED_PREMIUM', 'NUMBER(12,2)', 'Quoted premium'),
        col('BOUND_PREMIUM', 'NUMBER(12,2)', 'Bound premium', { termId: 'T-018' }), col('TURNAROUND_DAYS', 'NUMBER(5,1)', 'Quote turnaround', { termId: 'T-028' }),
      ],
      rowCount: 13_902_551, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:12:00', upstream: ['CONFORMED_GOLD.FCT_SUBMISSION', 'CONFORMED_GOLD.DIM_PRODUCER'], rowAccess: regionAccess,
      rows: memo(() => d.submissions.slice().reverse().map((s) => {
        const a = agencyByKey.get(s.agencyKey)!;
        return {
          SUBMISSION_ID: s.id, AGENCY_NAME: a.name, CHANNEL: a.channel, LINE_OF_BUSINESS: lineName(s.line), REGION: s.region, RECEIVED_DATE: s.received, QUOTE_DATE: s.quoteDate ?? null,
          BOUND_DATE: s.boundDate ?? null, SUBMISSION_TYPE: s.type, IS_BOUND: Boolean(s.boundDate), QUOTED_PREMIUM: s.status === 'Declined' ? null : s.premium, BOUND_PREMIUM: s.boundDate ? s.premium : null, TURNAROUND_DAYS: s.turnaround ?? null,
        };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_LOSS_RESERVES', layer: 'product', type: 'SECURE VIEW', order: 7, comment: 'Output port of Loss Reserves (in certification)',
      columns: [
        col('CLAIM_ID', 'VARCHAR(16)', 'Claim number'), col('VALUATION_DATE', 'DATE', 'Month-end valuation'), col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line', { termId: 'T-004' }),
        col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' }), col('ACCIDENT_YEAR', 'NUMBER(4)', 'Accident year'),
        col('CASE_RESERVE', 'NUMBER(14,2)', 'Case reserve', { termId: 'T-019', tags: ['CDE'] }), col('PAID_TO_DATE', 'NUMBER(14,2)', 'Paid to date', { termId: 'T-027' }),
        col('IBNR_ALLOCATED', 'NUMBER(14,2)', 'Allocated IBNR', { termId: 'T-020', tags: ['CDE'] }),
        col('CLAIMANT_DOB', 'DATE', 'Claimant date of birth (from FCT_RESERVE)', { tags: ['PHI'], maskPendingFix: GATE6_CHECK }),
      ],
      rowCount: 48_906_220, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 04:20:00', upstream: ['CONFORMED_GOLD.FCT_RESERVE', 'CONFORMED_GOLD.FCT_CLAIM'], rowAccess: regionAccess,
      rows: memo(() => d.reserves.slice().reverse().map((r) => ({ CLAIM_ID: claimByKey.get(r.claimKey)!.claimNo, VALUATION_DATE: r.valuation, LINE_OF_BUSINESS: lineName(r.line), REGION: r.region, ACCIDENT_YEAR: r.accidentYear, CASE_RESERVE: r.caseReserve, PAID_TO_DATE: r.paidToDate, IBNR_ALLOCATED: r.ibnr, CLAIMANT_DOB: r.claimantDob }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CATASTROPHE_EXPOSURE', layer: 'product', type: 'SECURE VIEW', order: 8, comment: 'Output port of Catastrophe Exposure (draft)',
      columns: [
        col('POLICY_ID', 'VARCHAR(16)', 'Policy number'), col('LINE_OF_BUSINESS', 'VARCHAR(30)', 'Line', { termId: 'T-004' }), col('STATE', 'VARCHAR(2)', 'Risk state'),
        col('REGION', 'VARCHAR(10)', 'Region', { termId: 'T-003' }), col('CAT_ZONE', 'VARCHAR(20)', 'Catastrophe zone'), col('IS_IN_FORCE', 'BOOLEAN', 'In force at as-of date', { termId: 'T-002' }),
        col('TOTAL_INSURED_VALUE', 'NUMBER(14,0)', 'Total insured value', { termId: 'T-021', tags: ['CDE'] }), col('LAST_CAT_CODE', 'VARCHAR(10)', 'Most recent cat event with a claim', { termId: 'T-009' }),
        col('CAT_LOSSES_21M', 'NUMBER(14,2)', 'Catastrophe incurred since Jan 2025'),
      ],
      rowCount: 2_604_550, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-29 02:00:00', upstream: ['CURATED_SILVER.CAT_EVENT', 'CONFORMED_GOLD.DIM_POLICY'], rowAccess: regionAccess,
      rows: memo(() => d.policies.filter((p) => p.tiv !== null).map((p) => ({
        POLICY_ID: p.policyNo, LINE_OF_BUSINESS: p.lineName, STATE: p.state, REGION: p.region, CAT_ZONE: p.catZone, IS_IN_FORCE: inForceOn(p, AS_OF), TOTAL_INSURED_VALUE: p.tiv,
        LAST_CAT_CODE: lastCat().get(p.key)?.code ?? null, CAT_LOSSES_21M: round(lastCat().get(p.key)?.loss ?? 0, 2),
      }))),
    },
  ];

  return [...bronze, ...silver, ...gold, ...products];
}
