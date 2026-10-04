// Bronze / Silver / Gold objects and product output ports for RLB_AI_PLATFORM (spec section 5).
import type { Row, SfObject } from '../../types';
import { cdcColumns, col, dateKey, GATE6_CHECK, memo, withCdc } from '../shared/catalog-kit';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, noisy, round, ts } from '../../mock-snowflake/generators';
import type { BankData } from './data';
import { AS_OF, DEPOSIT_PRODUCTS, MONTHS, REGION_BY_CODE, REGIONS } from './generators.config';
import { holdingsOf, isActive, profitability } from './queries';

export { GATE6_CHECK };

const cdc = cdcColumns();
const regionAccess = { column: 'REGION' };
const regionCodeAccess = (c: string) => ({ column: c, map: REGION_BY_CODE });
const SEG_CODE: Record<string, string> = { 'Mass retail': 'MR', Affluent: 'AF', 'Small business': 'SB', Commercial: 'CM' };

export function buildCatalog(d: BankData, seed: number): SfObject[] {
  const rng = new Rng(seed + 7);
  const custSample = d.customers.slice(0, 400);
  const custByKey = new Map(d.customers.map((c) => [c.key, c]));
  const branchByKey = new Map(d.branches.map((b) => [b.key, b]));
  const acctByKey = new Map(d.accounts.map((a) => [a.key, a]));
  const loanByKey = new Map(d.loans.map((l) => [l.key, l]));
  const cardByKey = new Map(d.cards.map((c) => [c.key, c]));
  const regionCode = (r: string) => REGIONS.find((x) => x.name === r)!.code;
  const sepDeposits = memo(() => d.deposits.filter((x) => x.month === '2026-09'));
  const sepLoans = memo(() => d.loanBals.filter((x) => x.month === '2026-09'));

  const bronze: SfObject[] = [
    {
      schema: 'RAW_BRONZE', name: 'CORE_CUSTOMER_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 1,
      comment: 'Customer information file (CIF) CDC from the core banking mainframe, landed as Apache Iceberg on S3',
      columns: [
        col('CIF_NO', 'VARCHAR(10)', 'Core CIF number (zero padded)', { nullable: false }),
        col('FIRST_NM', 'VARCHAR(40)', 'First name (raw)', { tags: ['PII'] }), col('LAST_NM', 'VARCHAR(40)', 'Last name (raw)', { tags: ['PII'] }),
        col('EMAIL_ADDR', 'VARCHAR(120)', 'Email (raw)', { tags: ['PII'] }), col('TAX_ID', 'VARCHAR(11)', 'SSN / EIN as captured', { tags: ['NPI'] }),
        col('PHONE_NO', 'VARCHAR(16)', 'Primary phone', { tags: ['PII'] }), col('BRANCH_CD', 'VARCHAR(8)', 'Home branch code'),
        col('REGION_CD', 'VARCHAR(4)', 'Market code (MTN, PLN, GLK, SE)'), col('SEG_CD', 'VARCHAR(2)', 'Segment code (MR, AF, SB, CM)'),
        col('CUST_STAT_CD', 'VARCHAR(1)', 'Status code (A active, D dormant, C closed)'), col('OPEN_DT', 'DATE', 'Relationship open date'), ...cdc,
      ],
      rowCount: 61_408_212, bytes: 8.4e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:52:18', upstream: ['ext:Core banking'],
      rowAccess: regionCodeAccess('REGION_CD'),
      rows: memo(() => withCdc(rng, custSample, (c) => ({
        CIF_NO: rng.chance(0.3) ? `${c.cifNo}  ` : c.cifNo, FIRST_NM: noisy(rng, c.first), LAST_NM: noisy(rng, c.last),
        EMAIL_ADDR: rng.chance(0.3) ? c.email.toUpperCase() : c.email, TAX_ID: rng.chance(0.25) ? c.taxId.replace(/-/g, '') : c.taxId, PHONE_NO: c.phone,
        BRANCH_CD: c.branchCode, REGION_CD: rng.chance(0.2) ? `${c.regionCode.toLowerCase()} ` : c.regionCode, SEG_CD: SEG_CODE[c.segment],
        CUST_STAT_CD: c.status[0], OPEN_DT: c.openDate,
      }), '2026-09-01', (c) => c.region === 'Mountain' || c.region === 'Plains')),
    },
    {
      schema: 'RAW_BRONZE', name: 'CORE_CUSTOMER_CDC_STRM', layer: 'bronze', type: 'STREAM', order: 2,
      comment: 'Append-only stream feeding CURATED_SILVER.CUSTOMER', columns: [], rowCount: 2_318, owner: 'INGEST_ADMIN',
      lastAltered: '2026-09-30 05:53:00', upstream: ['RAW_BRONZE.CORE_CUSTOMER_CDC'],
    },
    {
      schema: 'RAW_BRONZE', name: 'CORE_ACCOUNT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 3,
      comment: 'Deposit and loan account master and end-of-day balances from the core banking system',
      columns: [
        col('ACCT_NO', 'VARCHAR(12)', 'Account or loan number', { tags: ['NPI'] }), col('CIF_NO', 'VARCHAR(10)', 'Owning CIF'), col('ACCT_CLASS', 'VARCHAR(3)', 'DEP deposit / LN loan'),
        col('PROD_CD', 'VARCHAR(6)', 'Product code'), col('OPEN_DT', 'DATE', 'Open / origination date'), col('CUR_BAL', 'NUMBER(16,2)', 'Ledger / principal balance'),
        col('INT_RATE', 'NUMBER(7,4)', 'Interest rate %'), col('DPD_CNT', 'NUMBER(4)', 'Days past due (loans)'), col('NONACCR_FLG', 'VARCHAR(1)', 'Non-accrual flag (Y/N)'), ...cdc,
      ],
      rowCount: 412_660_118, bytes: 3.9e10, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:40:02', upstream: ['ext:Core banking'],
      rows: memo(() => {
        const dep = sepDeposits().slice(0, 200).map((x) => ({ kind: 'DEP' as const, x }));
        const ln = sepLoans().slice(0, 200).map((x) => ({ kind: 'LN' as const, x }));
        const items = dep.flatMap((a, i) => [a, ...(ln[i] ? [ln[i]] : [])]);
        return withCdc(rng, items, (it) => {
          if (it.kind === 'DEP') {
            const a = acctByKey.get(it.x.acctKey)!;
            return { ACCT_NO: a.acctNo, CIF_NO: custByKey.get(a.customerKey)!.cifNo, ACCT_CLASS: 'DEP', PROD_CD: a.productCode, OPEN_DT: a.openDate, CUR_BAL: it.x.balance, INT_RATE: it.x.rate, DPD_CNT: null, NONACCR_FLG: null };
          }
          const l = loanByKey.get(it.x.loanKey)!;
          return { ACCT_NO: l.loanNo, CIF_NO: custByKey.get(l.customerKey)!.cifNo, ACCT_CLASS: 'LN', PROD_CD: l.segCode, OPEN_DT: l.origDate, CUR_BAL: it.x.balance, INT_RATE: it.x.yield, DPD_CNT: it.x.dpd, NONACCR_FLG: it.x.nonAccrual ? 'Y' : 'N' };
        }, '2026-09-20');
      }),
    },
    {
      schema: 'RAW_BRONZE', name: 'CARD_AUTH_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 4,
      comment: 'Card authorisations and fraud dispositions from the card processor',
      columns: [
        col('AUTH_ID', 'VARCHAR(20)', 'Authorisation id'), col('PAN', 'VARCHAR(19)', 'Primary account number', { tags: ['PCI'] }), col('MCC_GRP', 'VARCHAR(30)', 'Merchant category group'),
        col('AUTH_AMT', 'NUMBER(12,2)', 'Authorised amount'), col('RESP_CD', 'VARCHAR(2)', 'Response code (00 approved)'), col('POS_ENTRY', 'VARCHAR(12)', 'Entry mode'),
        col('AUTH_TS', 'TIMESTAMP_NTZ', 'Authorisation time'), col('FRAUD_FLG', 'VARCHAR(1)', 'Confirmed fraud (Y/N)'), ...cdc,
      ],
      rowCount: 2_914_406_550, bytes: 2.6e11, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:11:47', upstream: ['ext:Card processing'],
      rows: memo(() => withCdc(rng, d.cardTxns.slice(-300).reverse(), (t) => ({
        AUTH_ID: t.id, PAN: cardByKey.get(t.cardKey)!.pan, MCC_GRP: noisy(rng, t.category), AUTH_AMT: t.amount, RESP_CD: t.approved ? '00' : rng.pick(['05', '51', '59']),
        POS_ENTRY: t.channel === 'E-commerce' ? 'ECOM' : t.channel === 'Contactless' ? 'NFC' : 'CHIP', AUTH_TS: ts(t.date, t.minute), FRAUD_FLG: t.fraud ? 'Y' : 'N',
      }), '2026-09-25')),
    },
    {
      schema: 'RAW_BRONZE', name: 'DIGITAL_EVENT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 5,
      comment: 'Mobile app and online banking events (clickstream, JSON flattened)',
      columns: [
        col('EVENT_ID', 'VARCHAR(24)', 'Event id'), col('CIF_NO', 'VARCHAR(10)', 'Signed-in customer'), col('CHANNEL', 'VARCHAR(16)', 'APP / WEB'),
        col('EVENT_TYPE', 'VARCHAR(24)', 'Event type'), col('EVENT_TS', 'TIMESTAMP_NTZ', 'Event time'), col('DEVICE_ID', 'VARCHAR(12)', 'Device fingerprint'),
        col('IP_ADDR', 'VARCHAR(15)', 'Client IP address', { tags: ['PII'] }), ...cdc,
      ],
      rowCount: 1_208_551_904, bytes: 9.1e10, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:14:09', upstream: ['ext:Digital banking events'],
      rows: memo(() => withCdc(rng, d.sessions.slice(-300).reverse(), (s) => ({
        EVENT_ID: s.id, CIF_NO: custByKey.get(s.customerKey)!.cifNo, CHANNEL: s.channel === 'Mobile app' ? 'APP' : 'WEB', EVENT_TYPE: noisy(rng, s.eventType.toUpperCase().replace(/ /g, '_')),
        EVENT_TS: ts(s.date, s.minute), DEVICE_ID: s.deviceId, IP_ADDR: `10.${(s.customerKey * 7) % 255}.${(s.key * 3) % 255}.${(s.key * 11) % 250}`,
      }), '2026-09-28')),
    },
    {
      schema: 'RAW_BRONZE', name: 'AML_ALERT_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 6,
      comment: 'Transaction-monitoring alerts and dispositions from AML case management',
      columns: [
        col('ALERT_ID', 'VARCHAR(16)', 'Alert id'), col('CIF_NO', 'VARCHAR(10)', 'Subject CIF'), col('ACCT_NO', 'VARCHAR(12)', 'Account alerted', { tags: ['NPI'] }),
        col('SCENARIO_CD', 'VARCHAR(8)', 'Monitoring scenario'), col('RISK_SCORE', 'NUMBER(3)', 'Alert score 0–100'), col('ALERT_DT', 'DATE', 'Alert date'),
        col('DISP_CD', 'VARCHAR(4)', 'Disposition (OPEN, CLNA, ESC)'), col('CASE_ID', 'VARCHAR(12)', 'Case id if escalated'), ...cdc,
      ],
      rowCount: 1_904_377, bytes: 3.1e8, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 04:58:31', upstream: ['ext:AML case management'],
      rows: memo(() => withCdc(rng, d.alerts.slice(-300).reverse(), (a) => ({
        ALERT_ID: a.id, CIF_NO: custByKey.get(a.customerKey)!.cifNo, ACCT_NO: a.acctNo, SCENARIO_CD: a.scenarioCode, RISK_SCORE: a.score, ALERT_DT: a.date,
        DISP_CD: a.disposition === 'Open' ? 'OPEN' : a.disposition === 'Escalated to case' ? 'ESC' : 'CLNA', CASE_ID: a.caseId ?? null,
      }), '2026-09-10')),
    },
    {
      schema: 'RAW_BRONZE', name: 'GL_BALANCE_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 7,
      comment: 'Monthly general-ledger balances and P&L by cost centre (market)',
      columns: [
        col('GL_ACCT', 'VARCHAR(6)', 'GL account'), col('COST_CTR', 'VARCHAR(6)', 'Cost centre (market code)'), col('PERIOD', 'VARCHAR(6)', 'Fiscal period YYYYMM'),
        col('AMT', 'NUMBER(18,2)', 'Period amount / balance'), col('CCY', 'VARCHAR(3)', 'Currency'), ...cdc,
      ],
      rowCount: 18_406_115, bytes: 1.2e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 03:15:00', upstream: ['ext:General ledger'],
      rowAccess: regionCodeAccess('COST_CTR'),
      rows: memo(() => withCdc(rng, d.gl.slice().reverse(), (g) => ({ GL_ACCT: g.glAccount, COST_CTR: regionCode(g.region), PERIOD: g.month.replace('-', ''), AMT: g.amount, CCY: 'USD' }), '2026-09-01')),
    },
  ];

  const silver: SfObject[] = [
    {
      schema: 'CURATED_SILVER', name: 'CUSTOMER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 1,
      comment: 'Deduplicated SCD2 customer entity (one row per customer version)',
      columns: [
        col('CUSTOMER_ID', 'NUMBER(10)', 'Customer identifier (from CIF_NO)', { nullable: false, termId: 'T-001', tags: ['CDE'] }),
        col('FIRST_NAME', 'VARCHAR(40)', 'First name', { tags: ['PII'] }), col('LAST_NAME', 'VARCHAR(40)', 'Last name', { tags: ['PII'] }),
        col('EMAIL', 'VARCHAR(120)', 'Email (lowercased)', { tags: ['PII'] }), col('TAX_ID', 'VARCHAR(11)', 'SSN / EIN, formatted', { tags: ['NPI'] }),
        col('HOME_BRANCH', 'VARCHAR(8)', 'Home branch code'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003', tags: ['CDE'] }),
        col('SEGMENT', 'VARCHAR(16)', 'Customer segment', { termId: 'T-004', tags: ['CDE'] }), col('CUSTOMER_STATUS', 'VARCHAR(10)', 'Active / Dormant / Closed', { termId: 'T-002' }),
        col('EFFECTIVE_FROM', 'DATE', 'SCD2 valid from'), col('EFFECTIVE_TO', 'DATE', 'SCD2 valid to'), col('IS_CURRENT', 'BOOLEAN', 'Current version flag'),
      ],
      rowCount: 3_412_806, bytes: 4.6e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:05:12', upstream: ['RAW_BRONZE.CORE_CUSTOMER_CDC_STRM'],
      rowAccess: regionAccess,
      rows: memo(() => custSample.flatMap((c) => {
        const cur = { CUSTOMER_ID: c.id, FIRST_NAME: c.first, LAST_NAME: c.last, EMAIL: c.email.toLowerCase(), TAX_ID: c.taxId, HOME_BRANCH: c.branchCode, REGION: c.region, SEGMENT: c.segment, CUSTOMER_STATUS: c.status };
        return c.priorSegment
          ? [{ ...cur, SEGMENT: c.priorSegment, EFFECTIVE_FROM: c.openDate < c.changedOn! ? c.openDate : '2019-04-01', EFFECTIVE_TO: addDays(c.changedOn!, -1), IS_CURRENT: false }, { ...cur, EFFECTIVE_FROM: c.changedOn!, EFFECTIVE_TO: null, IS_CURRENT: true }]
          : [{ ...cur, EFFECTIVE_FROM: c.effectiveFrom, EFFECTIVE_TO: null, IS_CURRENT: true }];
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'DEPOSIT_ACCOUNT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 2,
      comment: 'Typed deposit accounts with month-end ledger balances and rates',
      columns: [
        col('ACCOUNT_NUMBER', 'VARCHAR(12)', 'Deposit account number', { tags: ['NPI'] }), col('CUSTOMER_ID', 'NUMBER(10)', 'Owner', { termId: 'T-001' }),
        col('PRODUCT_TYPE', 'VARCHAR(24)', 'Checking, savings, money market, CD, business, sweep'), col('OPEN_DATE', 'DATE', 'Open date'),
        col('BALANCE_DATE', 'DATE', 'Month-end date'), col('LEDGER_BALANCE', 'NUMBER(16,2)', 'Month-end ledger balance', { termId: 'T-007' }),
        col('INTEREST_RATE', 'NUMBER(7,3)', 'Annual rate %', { termId: 'T-009' }), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }),
      ],
      rowCount: 5_102_448, bytes: 6.2e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:58:40', upstream: ['RAW_BRONZE.CORE_ACCOUNT_CDC'],
      rowAccess: regionAccess,
      rows: memo(() => sepDeposits().map((x) => {
        const a = acctByKey.get(x.acctKey)!;
        return { ACCOUNT_NUMBER: a.acctNo, CUSTOMER_ID: custByKey.get(a.customerKey)!.id, PRODUCT_TYPE: a.productLabel, OPEN_DATE: a.openDate, BALANCE_DATE: x.date, LEDGER_BALANCE: x.balance, INTEREST_RATE: x.rate, REGION: x.region };
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'LOAN_ACCOUNT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 3,
      comment: 'Typed loans with month-end principal, delinquency and accrual status',
      columns: [
        col('LOAN_NUMBER', 'VARCHAR(12)', 'Loan number', { tags: ['NPI'] }), col('CUSTOMER_ID', 'NUMBER(10)', 'Borrower', { termId: 'T-001' }),
        col('LOAN_SEGMENT', 'VARCHAR(30)', 'Loan segment', { termId: 'T-030' }), col('ORIGINATION_DATE', 'DATE', 'Origination date'), col('SNAPSHOT_DATE', 'DATE', 'Month-end'),
        col('PRINCIPAL_BALANCE', 'NUMBER(16,2)', 'Outstanding principal', { termId: 'T-026' }), col('DAYS_PAST_DUE', 'NUMBER(4)', 'Days past due', { termId: 'T-014' }),
        col('NON_ACCRUAL_FLAG', 'BOOLEAN', 'On non-accrual', { termId: 'T-012' }), col('RISK_GRADE', 'NUMBER(2)', 'Commercial risk grade 1–9 (0 for retail)'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }),
      ],
      rowCount: 412_380, bytes: 7.1e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:59:02', upstream: ['RAW_BRONZE.CORE_ACCOUNT_CDC'],
      rowAccess: regionAccess,
      rows: memo(() => sepLoans().map((x) => {
        const l = loanByKey.get(x.loanKey)!;
        return { LOAN_NUMBER: l.loanNo, CUSTOMER_ID: custByKey.get(l.customerKey)!.id, LOAN_SEGMENT: l.segment, ORIGINATION_DATE: l.origDate, SNAPSHOT_DATE: x.date, PRINCIPAL_BALANCE: x.balance, DAYS_PAST_DUE: x.dpd, NON_ACCRUAL_FLAG: x.nonAccrual, RISK_GRADE: l.riskGrade, REGION: x.region };
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'CARD_TRANSACTION', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 4,
      comment: 'Cleansed card authorisations joined to settlement and fraud outcome',
      columns: [
        col('TRANSACTION_ID', 'VARCHAR(20)', 'Authorisation id'), col('CARD_NUMBER', 'VARCHAR(19)', 'PAN', { tags: ['PCI'] }), col('CUSTOMER_ID', 'NUMBER(10)', 'Cardholder', { termId: 'T-001' }),
        col('TXN_TS', 'TIMESTAMP_NTZ', 'Authorisation time'), col('MERCHANT_CATEGORY', 'VARCHAR(30)', 'Merchant category'), col('CHANNEL', 'VARCHAR(14)', 'Card present / Contactless / E-commerce'),
        col('AMOUNT_USD', 'NUMBER(12,2)', 'Amount'), col('IS_APPROVED', 'BOOLEAN', 'Approved', { termId: 'T-020' }), col('IS_CONFIRMED_FRAUD', 'BOOLEAN', 'Confirmed fraud', { termId: 'T-019' }), col('REGION', 'VARCHAR(12)', 'Cardholder market', { termId: 'T-003' }),
      ],
      rowCount: 2_901_116_402, bytes: 1.9e11, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:12:30', upstream: ['RAW_BRONZE.CARD_AUTH_CDC'],
      rowAccess: regionAccess,
      rows: memo(() => d.cardTxns.slice().reverse().map((t) => ({
        TRANSACTION_ID: t.id, CARD_NUMBER: cardByKey.get(t.cardKey)!.pan, CUSTOMER_ID: custByKey.get(t.customerKey)!.id, TXN_TS: ts(t.date, t.minute), MERCHANT_CATEGORY: t.category,
        CHANNEL: t.channel, AMOUNT_USD: t.amount, IS_APPROVED: t.approved, IS_CONFIRMED_FRAUD: t.fraud, REGION: t.region,
      }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'DIGITAL_SESSION', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 5,
      comment: 'Sessionised digital banking activity per signed-in customer',
      columns: [
        col('SESSION_ID', 'VARCHAR(24)', 'Session id'), col('CUSTOMER_ID', 'NUMBER(10)', 'Customer', { termId: 'T-001' }), col('CHANNEL', 'VARCHAR(16)', 'Mobile app / Online banking'),
        col('EVENT_TYPE', 'VARCHAR(24)', 'Primary action'), col('SESSION_TS', 'TIMESTAMP_NTZ', 'Session start', { termId: 'T-005' }), col('DEVICE_ID', 'VARCHAR(12)', 'Device'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }),
      ],
      rowCount: 402_118_660, bytes: 2.8e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:15:40', upstream: ['RAW_BRONZE.DIGITAL_EVENT_CDC'],
      rowAccess: regionAccess,
      rows: memo(() => d.sessions.slice().reverse().map((s) => ({ SESSION_ID: s.id, CUSTOMER_ID: custByKey.get(s.customerKey)!.id, CHANNEL: s.channel, EVENT_TYPE: s.eventType, SESSION_TS: ts(s.date, s.minute), DEVICE_ID: s.deviceId, REGION: s.region }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'AML_ALERT', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 6,
      comment: 'Typed AML alerts with disposition, case and SAR outcome',
      columns: [
        col('ALERT_ID', 'VARCHAR(16)', 'Alert id'), col('CUSTOMER_ID', 'NUMBER(10)', 'Subject', { termId: 'T-001' }), col('ACCOUNT_NUMBER', 'VARCHAR(12)', 'Account alerted', { tags: ['NPI'] }),
        col('SCENARIO', 'VARCHAR(40)', 'Monitoring scenario'), col('RISK_SCORE', 'NUMBER(3)', 'Alert score'), col('ALERT_DATE', 'DATE', 'Alert date', { termId: 'T-021' }),
        col('DISPOSITION', 'VARCHAR(20)', 'Open / Closed – no action / Escalated to case', { termId: 'T-022' }), col('CASE_ID', 'VARCHAR(12)', 'Case id'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }),
      ],
      rowCount: 1_880_412, bytes: 2.4e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:05:10', upstream: ['RAW_BRONZE.AML_ALERT_CDC'],
      rowAccess: regionAccess,
      rows: memo(() => d.alerts.slice().reverse().map((a) => ({ ALERT_ID: a.id, CUSTOMER_ID: custByKey.get(a.customerKey)!.id, ACCOUNT_NUMBER: a.acctNo, SCENARIO: a.scenario, RISK_SCORE: a.score, ALERT_DATE: a.date, DISPOSITION: a.disposition, CASE_ID: a.caseId ?? null, REGION: a.region }))),
    },
  ];

  const allDates: string[] = [];
  for (let x = '2025-01-01'; x <= AS_OF; x = addDays(x, 1)) allDates.push(x);
  const monthEnds = new Set(MONTHS.map((m) => d.deposits.find((x) => x.month === m)!.date));

  const gold: SfObject[] = [
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_CUSTOMER', layer: 'gold', type: 'TABLE', order: 1, comment: 'Conformed customer dimension (current version)',
      columns: [
        col('CUSTOMER_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('CUSTOMER_ID', 'NUMBER(10)', 'Customer id', { termId: 'T-001', tags: ['CDE'] }),
        col('CUSTOMER_NAME', 'VARCHAR(80)', 'Customer or business name', { tags: ['PII'] }), col('BRANCH_KEY', 'NUMBER', 'Home branch'),
        col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003', tags: ['CDE'] }), col('SEGMENT', 'VARCHAR(16)', 'Customer segment', { termId: 'T-004', tags: ['CDE'] }),
        col('CUSTOMER_STATUS', 'VARCHAR(10)', 'Active / Dormant / Closed', { termId: 'T-002' }), col('LAST_ACTIVITY_DATE', 'DATE', 'Last customer-initiated activity', { termId: 'T-002' }),
        col('DIGITAL_ENROLLED', 'BOOLEAN', 'Enrolled in online or mobile banking', { termId: 'T-005' }), col('AML_RISK_RATING', 'VARCHAR(6)', 'Customer due-diligence risk rating'),
        col('OPEN_DATE', 'DATE', 'Relationship open date'), col('CLOSED_DATE', 'DATE', 'Relationship closed date', { termId: 'T-006' }),
      ],
      rowCount: 3_200_000, bytes: 3.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:20:00', upstream: ['CURATED_SILVER.CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.customers.map((c) => ({
        CUSTOMER_KEY: c.key, CUSTOMER_ID: c.id, CUSTOMER_NAME: c.name, BRANCH_KEY: c.branchKey, REGION: c.region, SEGMENT: c.segment, CUSTOMER_STATUS: c.status,
        LAST_ACTIVITY_DATE: c.lastActivity, DIGITAL_ENROLLED: c.digitalEnrolled, AML_RISK_RATING: c.amlRisk, OPEN_DATE: c.openDate, CLOSED_DATE: c.closedDate ?? null,
      }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_BRANCH', layer: 'gold', type: 'TABLE', order: 2, comment: 'Branches and markets',
      columns: [col('BRANCH_KEY', 'NUMBER', 'Surrogate key'), col('BRANCH_CODE', 'VARCHAR(8)', 'Branch code'), col('BRANCH_NAME', 'VARCHAR(40)', 'Branch'), col('CITY', 'VARCHAR(30)', 'City'), col('STATE', 'VARCHAR(2)', 'State'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003', tags: ['CDE'] }), col('BRANCH_MANAGER', 'VARCHAR(40)', 'Branch manager')],
      rowCount: 16, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-08-01 02:00:00', upstream: ['CURATED_SILVER.CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.branches.map((b) => ({ BRANCH_KEY: b.key, BRANCH_CODE: b.code, BRANCH_NAME: b.name, CITY: b.city, STATE: b.state, REGION: b.region, BRANCH_MANAGER: b.manager }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_DATE', layer: 'gold', type: 'TABLE', order: 3, comment: 'Calendar with month-ends and fiscal periods (FY = calendar year)',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'yyyymmdd'), col('CALENDAR_DATE', 'DATE', 'Date'), col('FISCAL_MONTH', 'VARCHAR(7)', 'yyyy-mm'), col('FISCAL_QUARTER', 'VARCHAR(7)', 'Fiscal quarter'), col('FISCAL_YEAR', 'NUMBER(4)', 'Fiscal year'), col('IS_MONTH_END', 'BOOLEAN', 'Month-end reporting date', { tags: ['CDE'] })],
      rowCount: allDates.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:05:00', upstream: [],
      rows: memo(() => allDates.slice().reverse().map((x) => ({ DATE_KEY: dateKey(x), CALENDAR_DATE: x, FISCAL_MONTH: x.slice(0, 7), FISCAL_QUARTER: `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`, FISCAL_YEAR: Number(x.slice(0, 4)), IS_MONTH_END: monthEnds.has(x) || addDays(x, 1).endsWith('-01') }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_DEPOSIT_BALANCE', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 4, comment: 'Month-end deposit balances at account grain',
      columns: [
        col('DATE_KEY', 'NUMBER(8)', 'Month-end'), col('ACCOUNT_KEY', 'NUMBER', 'Deposit account'), col('CUSTOMER_KEY', 'NUMBER', 'Customer'), col('BRANCH_KEY', 'NUMBER', 'Branch'),
        col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }), col('PRODUCT_TYPE', 'VARCHAR(24)', 'Deposit product'),
        col('LEDGER_BALANCE', 'NUMBER(16,2)', 'Month-end ledger balance', { termId: 'T-007', tags: ['CDE'] }), col('INTEREST_RATE', 'NUMBER(7,3)', 'Annual rate %', { termId: 'T-009', tags: ['CDE'] }),
        col('INTEREST_EXPENSE', 'NUMBER(14,2)', 'Interest expense for the month', { termId: 'T-009' }), col('LCR_RUNOFF_RATE', 'NUMBER(5,2)', 'Basel III 30-day outflow rate', { termId: 'T-017' }),
      ],
      rowCount: 76_536_720, bytes: 4.1e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:02:11', upstream: ['CURATED_SILVER.DEPOSIT_ACCOUNT', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.deposits.slice().reverse().map((x) => ({ DATE_KEY: dateKey(x.date), ACCOUNT_KEY: x.acctKey, CUSTOMER_KEY: x.customerKey, BRANCH_KEY: x.branchKey, REGION: x.region, PRODUCT_TYPE: acctByKey.get(x.acctKey)!.productLabel, LEDGER_BALANCE: x.balance, INTEREST_RATE: x.rate, INTEREST_EXPENSE: x.interest, LCR_RUNOFF_RATE: x.runoff }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_LOAN_BALANCE', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 5, comment: 'Month-end loan balances, delinquency, accrual status and allowance at loan grain',
      columns: [
        col('DATE_KEY', 'NUMBER(8)', 'Month-end'), col('LOAN_KEY', 'NUMBER', 'Loan'), col('CUSTOMER_KEY', 'NUMBER', 'Borrower'), col('BRANCH_KEY', 'NUMBER', 'Branch'),
        col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }), col('LOAN_SEGMENT', 'VARCHAR(30)', 'Loan segment', { termId: 'T-030', tags: ['CDE'] }),
        col('PRINCIPAL_BALANCE', 'NUMBER(16,2)', 'Outstanding principal', { termId: 'T-026', tags: ['CDE'] }), col('DAYS_PAST_DUE', 'NUMBER(4)', 'Days past due', { termId: 'T-014', tags: ['CDE'] }),
        col('NON_ACCRUAL_FLAG', 'BOOLEAN', 'On non-accrual status', { termId: 'T-012', tags: ['CDE'] }), col('IS_NON_PERFORMING', 'BOOLEAN', '90+ DPD or non-accrual (rule BR-007)', { termId: 'T-012', tags: ['CDE'] }),
        col('NET_CHARGE_OFF', 'NUMBER(14,2)', 'Net charge-off in the month', { termId: 'T-015', tags: ['CDE'] }), col('ALLOWANCE_AMOUNT', 'NUMBER(14,2)', 'CECL allowance for credit losses', { termId: 'T-016', tags: ['CDE'] }),
        col('INTEREST_RATE', 'NUMBER(6,2)', 'Note rate %', { termId: 'T-018' }),
      ],
      rowCount: 6_180_416, bytes: 7.9e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:03:45', upstream: ['CURATED_SILVER.LOAN_ACCOUNT', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.loanBals.slice().reverse().map((x) => ({ DATE_KEY: dateKey(x.date), LOAN_KEY: x.loanKey, CUSTOMER_KEY: x.customerKey, BRANCH_KEY: x.branchKey, REGION: x.region, LOAN_SEGMENT: x.segment, PRINCIPAL_BALANCE: x.balance, DAYS_PAST_DUE: x.dpd, NON_ACCRUAL_FLAG: x.nonAccrual, IS_NON_PERFORMING: x.npl, NET_CHARGE_OFF: x.nco, ALLOWANCE_AMOUNT: x.allowance, INTEREST_RATE: x.yield }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_CARD_TRANSACTION', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 6, comment: 'Card authorisations with approval and fraud loss at transaction grain',
      columns: [
        col('TRANSACTION_KEY', 'NUMBER', 'Transaction'), col('DATE_KEY', 'NUMBER(8)', 'Date'), col('CARD_KEY', 'NUMBER', 'Card'), col('CUSTOMER_KEY', 'NUMBER', 'Cardholder'),
        col('REGION', 'VARCHAR(12)', 'Cardholder market', { termId: 'T-003' }), col('MERCHANT_CATEGORY', 'VARCHAR(30)', 'Merchant category'), col('CHANNEL', 'VARCHAR(14)', 'Channel'),
        col('AMOUNT_USD', 'NUMBER(12,2)', 'Amount', { termId: 'T-031', tags: ['CDE'] }), col('IS_APPROVED', 'BOOLEAN', 'Approved', { termId: 'T-020' }),
        col('IS_CONFIRMED_FRAUD', 'BOOLEAN', 'Confirmed fraud', { termId: 'T-019', tags: ['CDE'] }), col('FRAUD_LOSS_USD', 'NUMBER(12,2)', 'Fraud loss net of recoveries', { termId: 'T-019', tags: ['CDE'] }),
      ],
      rowCount: 2_901_116_402, bytes: 1.4e11, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:13:02', upstream: ['CURATED_SILVER.CARD_TRANSACTION', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.cardTxns.slice().reverse().map((t) => ({ TRANSACTION_KEY: t.key, DATE_KEY: dateKey(t.date), CARD_KEY: t.cardKey, CUSTOMER_KEY: t.customerKey, REGION: t.region, MERCHANT_CATEGORY: t.category, CHANNEL: t.channel, AMOUNT_USD: t.amount, IS_APPROVED: t.approved, IS_CONFIRMED_FRAUD: t.fraud, FRAUD_LOSS_USD: t.fraudLoss }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_DIGITAL_SESSION', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 7, comment: 'Digital banking sessions at session grain',
      columns: [col('SESSION_KEY', 'NUMBER', 'Session'), col('DATE_KEY', 'NUMBER(8)', 'Date'), col('CUSTOMER_KEY', 'NUMBER', 'Customer'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }), col('CHANNEL', 'VARCHAR(16)', 'Mobile app / Online banking'), col('EVENT_TYPE', 'VARCHAR(24)', 'Primary action', { termId: 'T-005' })],
      rowCount: 402_118_660, bytes: 1.6e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:16:00', upstream: ['CURATED_SILVER.DIGITAL_SESSION', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.sessions.slice().reverse().map((s) => ({ SESSION_KEY: s.key, DATE_KEY: dateKey(s.date), CUSTOMER_KEY: s.customerKey, REGION: s.region, CHANNEL: s.channel, EVENT_TYPE: s.eventType }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_AML_ALERT', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 8, comment: 'AML alerts with disposition, escalation and SAR outcome at alert grain',
      columns: [
        col('ALERT_KEY', 'NUMBER', 'Alert'), col('DATE_KEY', 'NUMBER(8)', 'Alert date'), col('CUSTOMER_KEY', 'NUMBER', 'Subject'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }),
        col('ACCOUNT_NUMBER', 'VARCHAR(12)', 'Account alerted', { tags: ['NPI'], maskPendingFix: GATE6_CHECK }), col('SCENARIO', 'VARCHAR(40)', 'Monitoring scenario'), col('RISK_SCORE', 'NUMBER(3)', 'Alert score'),
        col('DISPOSITION', 'VARCHAR(20)', 'Disposition', { termId: 'T-021', tags: ['CDE'] }), col('IS_ESCALATED', 'BOOLEAN', 'Escalated to an AML case', { termId: 'T-022', tags: ['CDE'] }),
        col('CASE_ID', 'VARCHAR(12)', 'Case id'), col('SAR_FILED', 'BOOLEAN', 'Suspicious activity report filed', { termId: 'T-023', tags: ['CDE'] }), col('DAYS_TO_DISPOSITION', 'NUMBER(4)', 'Alert date to disposition', { termId: 'T-021' }),
      ],
      rowCount: 1_880_412, bytes: 1.7e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:06:30', upstream: ['CURATED_SILVER.AML_ALERT', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.alerts.slice().reverse().map((a) => ({ ALERT_KEY: a.key, DATE_KEY: dateKey(a.date), CUSTOMER_KEY: a.customerKey, REGION: a.region, ACCOUNT_NUMBER: a.acctNo, SCENARIO: a.scenario, RISK_SCORE: a.score, DISPOSITION: a.disposition, IS_ESCALATED: a.disposition === 'Escalated to case', CASE_ID: a.caseId ?? null, SAR_FILED: a.caseStatus === 'SAR filed', DAYS_TO_DISPOSITION: a.daysToDisposition ?? null }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_GL_MONTHLY', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 day', order: 9, comment: 'General-ledger balances and P&L by market and month, reconciled to loan and deposit sub-ledgers',
      columns: [
        col('DATE_KEY', 'NUMBER(8)', 'Month-end'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }), col('GL_ACCOUNT', 'VARCHAR(6)', 'GL account'),
        col('GL_LINE', 'VARCHAR(40)', 'Reporting line'), col('LINE_TYPE', 'VARCHAR(10)', 'Balance / Income / Expense / Liquidity'), col('AMOUNT_USD', 'NUMBER(18,2)', 'Amount', { termId: 'T-011', tags: ['CDE'] }),
      ],
      rowCount: d.gl.length * 6, bytes: 2.2e6, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 03:30:00', upstream: ['RAW_BRONZE.GL_BALANCE_CDC', 'CURATED_SILVER.LOAN_ACCOUNT', 'CURATED_SILVER.DEPOSIT_ACCOUNT'], rowAccess: regionAccess,
      rows: memo(() => d.gl.slice().reverse().map((g) => ({ DATE_KEY: dateKey(g.date), REGION: g.region, GL_ACCOUNT: g.glAccount, GL_LINE: g.line, LINE_TYPE: g.type, AMOUNT_USD: g.amount }))),
    },
  ];

  const products: SfObject[] = [
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CUSTOMER_360', layer: 'product', type: 'SECURE VIEW', order: 3, comment: 'Output port of Customer 360',
      columns: [
        col('CUSTOMER_ID', 'NUMBER(10)', 'Customer id', { termId: 'T-001', tags: ['CDE'] }), col('CUSTOMER_NAME', 'VARCHAR(80)', 'Customer or business name', { tags: ['PII'] }),
        col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003', tags: ['CDE'] }), col('HOME_BRANCH', 'VARCHAR(40)', 'Home branch'), col('SEGMENT', 'VARCHAR(16)', 'Segment', { termId: 'T-004', tags: ['CDE'] }),
        col('IS_ACTIVE', 'BOOLEAN', 'Active customer (rule BR-001)', { termId: 'T-002', tags: ['CDE'] }), col('IS_DIGITAL_ACTIVE', 'BOOLEAN', 'Digital login in the last 30 days', { termId: 'T-005' }),
        col('PRODUCTS_HELD', 'NUMBER(3)', 'Open deposit accounts, loans and cards', { termId: 'T-029' }), col('TOTAL_DEPOSITS', 'NUMBER(16,2)', 'Month-end deposits', { termId: 'T-007' }),
        col('TOTAL_LOANS', 'NUMBER(16,2)', 'Month-end loans outstanding', { termId: 'T-026' }), col('TENURE_YEARS', 'NUMBER(4,1)', 'Years since relationship opened'), col('CLOSED_DATE', 'DATE', 'Closed date', { termId: 'T-006' }),
      ],
      rowCount: 3_200_000, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:30:00', upstream: ['CONFORMED_GOLD.DIM_CUSTOMER', 'CONFORMED_GOLD.FCT_DEPOSIT_BALANCE', 'CONFORMED_GOLD.FCT_DIGITAL_SESSION'], rowAccess: regionAccess,
      rows: memo(() => d.customers.map((c) => {
        const h = holdingsOf(d, c.key);
        return {
          CUSTOMER_ID: c.id, CUSTOMER_NAME: c.name, REGION: c.region, HOME_BRANCH: c.branchName, SEGMENT: c.segment, IS_ACTIVE: isActive(d, c), IS_DIGITAL_ACTIVE: c.digitalActive,
          PRODUCTS_HELD: h.depositAccounts + h.loanCount + h.cards, TOTAL_DEPOSITS: round(h.deposits, 2), TOTAL_LOANS: round(h.loans, 2),
          TENURE_YEARS: round((Date.parse(AS_OF) - Date.parse(c.openDate)) / 31_557_600_000, 1), CLOSED_DATE: c.closedDate ?? null,
        };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_DEPOSITS_LIQUIDITY', layer: 'product', type: 'SECURE VIEW', order: 4, comment: 'Output port of Deposits & Liquidity',
      columns: [
        col('MONTH_END', 'DATE', 'Month-end'), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003', tags: ['CDE'] }), col('BRANCH_NAME', 'VARCHAR(40)', 'Branch'),
        col('PRODUCT_TYPE', 'VARCHAR(24)', 'Deposit product'), col('ACCOUNTS', 'NUMBER', 'Accounts (scaled)'), col('BALANCE_USD', 'NUMBER(18,2)', 'Deposit balance (scaled)', { termId: 'T-007', tags: ['CDE'] }),
        col('COST_OF_DEPOSITS_PCT', 'NUMBER(6,3)', 'Annualised interest expense ÷ balance', { termId: 'T-009', tags: ['CDE'] }), col('STRESS_OUTFLOW_USD', 'NUMBER(18,2)', 'Basel III 30-day stressed outflow', { termId: 'T-017' }),
      ],
      rowCount: 1_440, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:05:00', upstream: ['CONFORMED_GOLD.FCT_DEPOSIT_BALANCE', 'CONFORMED_GOLD.FCT_GL_MONTHLY', 'CONFORMED_GOLD.DIM_BRANCH'], rowAccess: regionAccess,
      rows: memo(() => {
        const out: Row[] = [];
        const key = (x: { month: string; branchKey: number; productCode: string }) => `${x.month}|${x.branchKey}|${x.productCode}`;
        const agg = new Map<string, { n: number; bal: number; int: number; out: number; x: (typeof d.deposits)[number] }>();
        for (const x of d.deposits) {
          const k = key(x);
          const cur = agg.get(k) ?? { n: 0, bal: 0, int: 0, out: 0, x };
          cur.n += 1; cur.bal += x.balance; cur.int += x.interest; cur.out += x.balance * x.runoff;
          agg.set(k, cur);
        }
        for (const v of agg.values()) {
          out.push({
            MONTH_END: v.x.date, REGION: v.x.region, BRANCH_NAME: branchByKey.get(v.x.branchKey)!.name, PRODUCT_TYPE: DEPOSIT_PRODUCTS.find((p) => p.code === v.x.productCode)!.label,
            ACCOUNTS: Math.round(v.n * d.scale), BALANCE_USD: round(v.bal * d.scale, 2), COST_OF_DEPOSITS_PCT: round((v.int * 1200) / v.bal, 3), STRESS_OUTFLOW_USD: round(v.out * d.scale, 2),
          });
        }
        return out.sort((a, b) => (String(b.MONTH_END) < String(a.MONTH_END) ? -1 : String(b.MONTH_END) > String(a.MONTH_END) ? 1 : 0));
      }),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_LOAN_PORTFOLIO', layer: 'product', type: 'SECURE VIEW', order: 5, comment: 'Output port of Loan Portfolio Risk',
      columns: [
        col('SNAPSHOT_DATE', 'DATE', 'Month-end'), col('LOAN_NUMBER', 'VARCHAR(12)', 'Loan number', { tags: ['NPI'] }), col('CUSTOMER_ID', 'NUMBER(10)', 'Borrower', { termId: 'T-001' }),
        col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003', tags: ['CDE'] }), col('LOAN_SEGMENT', 'VARCHAR(30)', 'Loan segment', { termId: 'T-030', tags: ['CDE'] }),
        col('PRINCIPAL_BALANCE', 'NUMBER(16,2)', 'Outstanding principal', { termId: 'T-026', tags: ['CDE'] }), col('DAYS_PAST_DUE', 'NUMBER(4)', 'Days past due', { termId: 'T-014', tags: ['CDE'] }),
        col('NON_ACCRUAL_FLAG', 'BOOLEAN', 'Non-accrual', { termId: 'T-012' }), col('IS_NON_PERFORMING', 'BOOLEAN', '90+ DPD or non-accrual (BR-007)', { termId: 'T-012', tags: ['CDE'] }),
        col('ALLOWANCE_AMOUNT', 'NUMBER(14,2)', 'Allowance for credit losses', { termId: 'T-016', tags: ['CDE'] }), col('NET_CHARGE_OFF', 'NUMBER(14,2)', 'Net charge-off in month', { termId: 'T-015', tags: ['CDE'] }),
      ],
      rowCount: 6_180_416, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:06:00', upstream: ['CONFORMED_GOLD.FCT_LOAN_BALANCE', 'CONFORMED_GOLD.DIM_CUSTOMER', 'CONFORMED_GOLD.DIM_BRANCH'], rowAccess: regionAccess,
      rows: memo(() => d.loanBals.slice().reverse().map((x) => {
        const l = loanByKey.get(x.loanKey)!;
        return { SNAPSHOT_DATE: x.date, LOAN_NUMBER: l.loanNo, CUSTOMER_ID: custByKey.get(l.customerKey)!.id, REGION: x.region, LOAN_SEGMENT: x.segment, PRINCIPAL_BALANCE: x.balance, DAYS_PAST_DUE: x.dpd, NON_ACCRUAL_FLAG: x.nonAccrual, IS_NON_PERFORMING: x.npl, ALLOWANCE_AMOUNT: x.allowance, NET_CHARGE_OFF: x.nco };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CARD_TRANSACTIONS', layer: 'product', type: 'SECURE VIEW', order: 6, comment: 'Output port of Card Transactions',
      columns: [
        col('TRANSACTION_DATE', 'DATE', 'Date'), col('TRANSACTION_ID', 'VARCHAR(20)', 'Authorisation id'), col('CARD_NUMBER', 'VARCHAR(19)', 'PAN', { tags: ['PCI'] }), col('CUSTOMER_ID', 'NUMBER(10)', 'Cardholder', { termId: 'T-001' }),
        col('REGION', 'VARCHAR(12)', 'Cardholder market', { termId: 'T-003', tags: ['CDE'] }), col('MERCHANT_CATEGORY', 'VARCHAR(30)', 'Merchant category'), col('CHANNEL', 'VARCHAR(14)', 'Channel'),
        col('AMOUNT_USD', 'NUMBER(12,2)', 'Amount', { termId: 'T-031' }), col('IS_APPROVED', 'BOOLEAN', 'Approved', { termId: 'T-020' }),
        col('IS_CONFIRMED_FRAUD', 'BOOLEAN', 'Confirmed fraud', { termId: 'T-019', tags: ['CDE'] }), col('FRAUD_LOSS_USD', 'NUMBER(12,2)', 'Fraud loss', { termId: 'T-019', tags: ['CDE'] }),
      ],
      rowCount: 2_901_116_402, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:14:00', upstream: ['CONFORMED_GOLD.FCT_CARD_TRANSACTION', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.cardTxns.slice().reverse().map((t) => ({ TRANSACTION_DATE: t.date, TRANSACTION_ID: t.id, CARD_NUMBER: cardByKey.get(t.cardKey)!.pan, CUSTOMER_ID: custByKey.get(t.customerKey)!.id, REGION: t.region, MERCHANT_CATEGORY: t.category, CHANNEL: t.channel, AMOUNT_USD: t.amount, IS_APPROVED: t.approved, IS_CONFIRMED_FRAUD: t.fraud, FRAUD_LOSS_USD: t.fraudLoss }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_AML_ALERTS', layer: 'product', type: 'SECURE VIEW', order: 7, comment: 'Output port of AML Alerts & Cases (in certification)',
      columns: [
        col('ALERT_ID', 'VARCHAR(16)', 'Alert id'), col('ALERT_DATE', 'DATE', 'Alert date', { termId: 'T-021' }), col('CUSTOMER_ID', 'NUMBER(10)', 'Subject', { termId: 'T-001' }),
        col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }), col('ACCOUNT_NUMBER', 'VARCHAR(12)', 'Account alerted (from FCT_AML_ALERT)', { tags: ['NPI'], maskPendingFix: GATE6_CHECK }),
        col('SCENARIO', 'VARCHAR(40)', 'Monitoring scenario'), col('RISK_SCORE', 'NUMBER(3)', 'Alert score'), col('DISPOSITION', 'VARCHAR(20)', 'Disposition', { termId: 'T-021', tags: ['CDE'] }),
        col('IS_ESCALATED', 'BOOLEAN', 'Escalated to case', { termId: 'T-022', tags: ['CDE'] }), col('CASE_ID', 'VARCHAR(12)', 'Case id'),
        col('SAR_FILED', 'BOOLEAN', 'SAR filed', { termId: 'T-023', tags: ['CDE'] }), col('DAYS_TO_DISPOSITION', 'NUMBER(4)', 'Days to disposition', { termId: 'T-021' }),
      ],
      rowCount: 1_880_412, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:10:00', upstream: ['CONFORMED_GOLD.FCT_AML_ALERT', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => d.alerts.slice().reverse().map((a) => ({ ALERT_ID: a.id, ALERT_DATE: a.date, CUSTOMER_ID: custByKey.get(a.customerKey)!.id, REGION: a.region, ACCOUNT_NUMBER: a.acctNo, SCENARIO: a.scenario, RISK_SCORE: a.score, DISPOSITION: a.disposition, IS_ESCALATED: a.disposition === 'Escalated to case', CASE_ID: a.caseId ?? null, SAR_FILED: a.caseStatus === 'SAR filed', DAYS_TO_DISPOSITION: a.daysToDisposition ?? null }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CUSTOMER_PROFITABILITY', layer: 'product', type: 'SECURE VIEW', order: 8, comment: 'Output port of Customer Profitability (draft)',
      columns: [
        col('CUSTOMER_ID', 'NUMBER(10)', 'Customer', { termId: 'T-001' }), col('REGION', 'VARCHAR(12)', 'Market region', { termId: 'T-003' }), col('SEGMENT', 'VARCHAR(16)', 'Segment', { termId: 'T-004' }),
        col('DEPOSIT_SPREAD_INCOME', 'NUMBER(12,2)', 'Deposit balances × (FTP credit − rate paid), 12 months'), col('LOAN_SPREAD_INCOME', 'NUMBER(12,2)', 'Loan balances × (yield − FTP charge), 12 months'),
        col('CARD_INTERCHANGE', 'NUMBER(12,2)', 'Interchange net of fraud, annualised'), col('FEE_INCOME', 'NUMBER(12,2)', 'Service fees, 12 months'),
        col('COST_TO_SERVE', 'NUMBER(12,2)', 'Allocated operating cost', { termId: 'T-028' }), col('EXPECTED_CREDIT_LOSS', 'NUMBER(12,2)', 'Charge-offs plus allowance build', { termId: 'T-016' }),
        col('NET_CONTRIBUTION_12M', 'NUMBER(12,2)', 'Net contribution, trailing 12 months', { termId: 'T-025', tags: ['CDE'] }), col('IS_UNPROFITABLE', 'BOOLEAN', 'Net contribution below zero', { termId: 'T-025' }),
      ],
      rowCount: 2_947_200, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-28 02:00:00', upstream: ['CONFORMED_GOLD.FCT_DEPOSIT_BALANCE', 'CONFORMED_GOLD.FCT_LOAN_BALANCE', 'CONFORMED_GOLD.FCT_CARD_TRANSACTION', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess,
      rows: memo(() => profitability(d).map((r) => ({
        CUSTOMER_ID: r.c.id, REGION: r.c.region, SEGMENT: r.c.segment, DEPOSIT_SPREAD_INCOME: r.depositSpread, LOAN_SPREAD_INCOME: r.loanSpread, CARD_INTERCHANGE: r.interchange,
        FEE_INCOME: r.fees, COST_TO_SERVE: r.costToServe, EXPECTED_CREDIT_LOSS: r.ecl, NET_CONTRIBUTION_12M: r.net, IS_UNPROFITABLE: r.unprofitable,
      }))),
    },
  ];

  return [...bronze, ...silver, ...gold, ...products];
}
