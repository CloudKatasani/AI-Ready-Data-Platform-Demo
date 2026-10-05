// Banking: source inventory (E5), legacy SAP BusinessObjects reports (E5) and incident scripts (E9).
import type { IncidentScript, InventoryTable, LegacyReport } from '../../../ext/types';

const CUST = 'RAW_BRONZE.CORE_CUSTOMER_CDC';
const ACCT = 'RAW_BRONZE.CORE_ACCOUNT_CDC';
const CARD = 'RAW_BRONZE.CARD_AUTH_CDC';
const DIG = 'RAW_BRONZE.DIGITAL_EVENT_CDC';
const AML = 'RAW_BRONZE.AML_ALERT_CDC';
const GL = 'RAW_BRONZE.GL_BALANCE_CDC';

type Row = [table: string, domain: string, landsOrLevel: string | 0 | 1, consumedBy?: string[], note?: string, carries?: string[]];
const sys = (source: string, rows: Row[]): InventoryTable[] =>
  rows.map(([table, domain, l, consumedBy, note, carries]) => (typeof l === 'string' ? { source, table, domain, level: 1, lands: l, consumedBy, note, carries } : { source, table, domain, level: l, note }));

export const sourceInventory: InventoryTable[] = [
  ...sys('Core banking', [
    ['CIF_MASTER', 'Retail banking', CUST], ['CIF_ADDRESS', 'Retail banking', CUST, undefined, 'Address and contact details', ['CURATED_SILVER.CUSTOMER.EMAIL']],
    ['CIF_RELATIONSHIP', 'Retail banking', CUST, undefined, 'Joint owners and relationship open dates', ['CONFORMED_GOLD.DIM_CUSTOMER.OPEN_DATE']],
    ['CIF_SEGMENT_HISTORY', 'Retail banking', CUST, undefined, undefined, ['CURATED_SILVER.CUSTOMER.SEGMENT', 'CONFORMED_GOLD.DIM_CUSTOMER.SEGMENT']],
    ['DIGITAL_ENROLMENT', 'Retail banking', CUST, ['DP-01'], undefined, ['CONFORMED_GOLD.DIM_CUSTOMER.DIGITAL_ENROLLED']],
    ['KYC_PROFILE', 'Financial crimes', CUST, ['DP-05'], 'Customer due-diligence risk rating', ['CONFORMED_GOLD.DIM_CUSTOMER.AML_RISK_RATING']],
    ['BRANCH_MASTER', 'Retail banking', CUST, undefined, undefined, ['CONFORMED_GOLD.DIM_BRANCH.BRANCH_MANAGER']],
    ['DDA_MASTER', 'Treasury', ACCT], ['DDA_DAILY_BALANCE', 'Treasury', ACCT, undefined, undefined, ['CURATED_SILVER.DEPOSIT_ACCOUNT.LEDGER_BALANCE', 'CONFORMED_GOLD.FCT_DEPOSIT_BALANCE.LEDGER_BALANCE']],
    ['TIME_DEPOSIT', 'Treasury', ACCT], ['SAVINGS_MMDA', 'Treasury', ACCT],
    ['LOAN_MASTER', 'Credit risk', ACCT, undefined, undefined, ['CURATED_SILVER.LOAN_ACCOUNT.PRINCIPAL_BALANCE', 'CONFORMED_GOLD.FCT_LOAN_BALANCE.PRINCIPAL_BALANCE']],
    ['LOAN_DELINQUENCY', 'Credit risk', ACCT, undefined, undefined, ['CONFORMED_GOLD.FCT_LOAN_BALANCE.DAYS_PAST_DUE', 'CONFORMED_GOLD.FCT_LOAN_BALANCE.NON_ACCRUAL_FLAG']],
    ['RATE_TABLE', 'Treasury', 1, undefined, 'Landed to a staging schema; CDC not yet enabled'], ['FEE_SCHEDULE', 'Finance', 1],
    ['OVERDRAFT_EVENT', 'Retail banking', 0], ['STOP_PAYMENT', 'Retail banking', 0], ['ESCHEAT_TRACKING', 'Retail banking', 0, undefined, 'Dormant-account unclaimed property tracking'],
  ]),
  ...sys('Card processing', [
    ['AUTH_LOG', 'Cards', CARD], ['FRAUD_CASE', 'Cards', CARD, undefined, undefined, ['CONFORMED_GOLD.FCT_CARD_TRANSACTION.IS_CONFIRMED_FRAUD', 'CONFORMED_GOLD.FCT_CARD_TRANSACTION.FRAUD_LOSS_USD']],
    ['CARD_MASTER', 'Cards', CARD, undefined, 'PAN vault reference; tokenisation pending', ['CURATED_SILVER.CARD_TRANSACTION.CARD_NUMBER']],
    ['MERCHANT_MCC', 'Cards', CARD, undefined, undefined, ['CONFORMED_GOLD.FCT_CARD_TRANSACTION.MERCHANT_CATEGORY']],
    ['SETTLEMENT', 'Cards', 1], ['CHARGEBACK', 'Cards', 1, undefined, 'Chargeback recoveries land in staging only'], ['DISPUTE', 'Cards', 0], ['REWARDS_LEDGER', 'Cards', 0],
  ]),
  ...sys('Digital banking events', [
    ['LOGIN_EVENT', 'Retail banking', DIG], ['SESSION_EVENT', 'Retail banking', DIG, undefined, undefined, ['CURATED_SILVER.DIGITAL_SESSION.DEVICE_ID']],
    ['MOBILE_DEPOSIT', 'Retail banking', DIG, ['DP-01'], undefined, ['CONFORMED_GOLD.FCT_DIGITAL_SESSION.EVENT_TYPE']],
    ['BILL_PAY', 'Retail banking', 1], ['P2P_TRANSFER', 'Retail banking', 0], ['DEVICE_REGISTRY', 'Retail banking', 0, undefined, 'Device fingerprints: needs a privacy review first'],
  ]),
  ...sys('AML case management', [
    ['ALERT', 'Financial crimes', AML, ['DP-05']], ['CASE', 'Financial crimes', AML, ['DP-05']], ['SAR_FILING', 'Financial crimes', AML, ['DP-05'], 'SAR decisions: confidential under BR-017'],
    ['SCENARIO_CONFIG', 'Financial crimes', 1], ['CTR_FILING', 'Financial crimes', 1, undefined, 'Currency transaction reports'], ['WATCHLIST_HIT', 'Financial crimes', 0], ['KYC_REFRESH', 'Financial crimes', 0],
  ]),
  ...sys('General ledger', [
    ['GL_BALANCE', 'Finance', GL, undefined, 'Lands straight into Gold; no Silver curation yet'], ['COST_CENTER', 'Finance', GL, undefined, 'Lands straight into Gold; no Silver curation yet'],
    ['GL_JOURNAL', 'Finance', 1], ['FTP_CURVE', 'Finance', 0, undefined, 'Funds transfer pricing curves, needed before DP-06 can be certified'],
  ]),
  ...sys('Loan origination', [
    ['APPLICATION', 'Credit risk', 0], ['CREDIT_DECISION', 'Credit risk', 0], ['COLLATERAL', 'Credit risk', 1], ['APPRAISAL', 'Credit risk', 0],
  ]),
  ...sys('Wire and ACH payments', [
    ['WIRE_TRANSFER', 'Financial crimes', 1], ['ACH_BATCH', 'Treasury', 1], ['OFAC_SCREENING', 'Financial crimes', 0],
  ]),
  ...sys('Treasury ALM', [
    ['HQLA_INVENTORY', 'Treasury', 0], ['DEPOSIT_PRICING', 'Treasury', 0],
  ]),
  ...sys('CRM', [
    ['OPPORTUNITY', 'Retail banking', 0], ['COMPLAINT', 'Retail banking', 0], ['CONTACT_LOG', 'Retail banking', 0],
  ]),
];

type Rep = [name: string, kpis: string[], missing?: string[]];
const REPORTS: Rep[] = [
  ['Monthly active customer count', ['K-01']], ['Digital adoption scorecard', ['K-02']], ['Products per customer (cross-sell)', ['K-03']],
  ['Deposit balance per customer by market', ['K-04']], ['Customer attrition watchlist', ['K-05'], ['Attrition reason code']], ['Retail banking executive pack', ['K-01', 'K-02', 'K-04', 'K-05']],
  ['Daily deposit position', ['K-06']], ['Deposit growth by market', ['K-07']], ['Branch deposit flows', ['K-06'], ['Rate-shopper flag']],
  ['ALCO pack: liquidity and funding', ['K-06', 'K-08', 'K-10']], ['Cost of deposits by product', ['K-09']], ['Deposit pricing exceptions', ['K-09'], ['Exception approver']],
  ['NIM bridge, quarter on quarter', ['K-11']], ['Efficiency ratio by market', ['K-12']], ['LCR daily estimate', ['K-10'], ['Intraday HQLA']],
  ['Loan portfolio summary', ['K-13', 'K-18']], ['NPL ratio by segment', ['K-14']], ['30+ delinquency trend', ['K-15']],
  ['Net charge-off report', ['K-16']], ['CECL allowance coverage', ['K-17']], ['Board risk dashboard', ['K-14', 'K-16', 'K-17', 'K-10']],
  ['CRE concentration report', ['K-13'], ['Property type', 'Occupancy rate']], ['Stress test loan inputs', ['K-13', 'K-14'], ['Scenario loss rates']],
  ['Card purchase volume', ['K-19']], ['Card fraud loss (bps)', ['K-20']], ['Authorization approval monitor', ['K-21']], ['Average ticket by merchant category', ['K-22']],
  ['Card portfolio monthly review', ['K-19', 'K-20', 'K-21', 'K-22']], ['Chargeback recovery report', ['K-20'], ['Chargeback recovery amount']],
  ['AML alert volume', ['K-23']], ['Alert-to-case rate by scenario', ['K-24']], ['SAR conversion report', ['K-25']], ['Alert aging and disposition time', ['K-26']],
  ['BSA/AML board report', ['K-23', 'K-24', 'K-25', 'K-26', 'K-20']],
  ['Customer profitability by segment', ['K-27', 'K-28']], ['Relationship pricing review', ['K-27', 'K-04'], ['FTP curve version']],
  ['Branch scorecard', ['K-06', 'K-01'], ['Branch staffing']], ['Loan pipeline', [], ['Application stage', 'Credit decision']],
  ['Wire transfer volume', [], ['Wire amount', 'Beneficiary country']], ['Complaint tracking', [], ['Complaint category', 'Resolution days']],
];
const OWNERS = ['Retail Banking', 'Treasury', 'Credit Risk', 'Card Services', 'BSA/AML Office', 'Finance'];
export const legacyReports: LegacyReport[] = REPORTS.map(([name, kpiIds, missing], i) => ({
  id: `RPT-${String(i + 1).padStart(3, '0')}`, name, tool: 'SAP BusinessObjects', owner: OWNERS[i % OWNERS.length], kpiIds, missing: missing ?? [],
}));

export const incidents: IncidentScript[] = [
  {
    id: 'INC-1', title: 'Late CDC feed', fault: 'CARD_AUTH_CDC stops receiving rows for 5 h (card processor file transfer stalled).',
    objectFqn: CARD, dmf: { metric: 'FRESHNESS', value: 300, threshold: 30, unit: ' min' },
    affects: [{ productId: 'DP-04', status: 'Degraded' }],
    agentEffect: [
      { agentId: 'AG-03', mode: 'warn', scenarioIds: ['S-10', 'S-11'], message: 'Data as of 5 h ago: card authorisations have not arrived since 01:10 ET, so fraud loss and volume for today are understated.' },
      { agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-05'], message: 'Card spending for the last day is incomplete: the card processor feed is 5 h late.' },
    ],
    resolution: 'Processor SFTP job restarted; 5 h of authorisations replayed into CARD_AUTH_CDC and CARD_TRANSACTION refreshed.', ttdMin: 18, ttrMin: 52,
  },
  {
    id: 'INC-2', title: 'Null spike in a CDE', fault: '14% nulls in FCT_LOAN_BALANCE.DAYS_PAST_DUE after the loan servicing extract changed its delinquency field.',
    objectFqn: 'CONFORMED_GOLD.FCT_LOAN_BALANCE', column: 'DAYS_PAST_DUE', dmf: { metric: 'NULL_COUNT', value: 14, threshold: 0.5, unit: '%' },
    affects: [{ productId: 'DP-03', status: 'Degraded' }, { productId: 'DP-06', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-02', mode: 'block', scenarioIds: ['S-06'], message: 'I can’t give the NPL ratio right now: 14% of loans arrived with no days past due (DAYS_PAST_DUE, a critical data element) in the last load, so non-performing balances would be understated. The credit data steward has been alerted; ask again once the incident is resolved.' }],
    resolution: 'Servicing extract re-run with the corrected DPD_CNT mapping; affected snapshots reloaded and DMFs re-checked.', ttdMin: 11, ttrMin: 105,
  },
  {
    id: 'INC-3', title: 'Duplicate load', fault: 'A replayed core banking batch doubles 61,000 end-of-day deposit balance rows.',
    objectFqn: ACCT, dmf: { metric: 'DUPLICATE_COUNT', value: 61000, threshold: 0, unit: ' rows' },
    affects: [{ productId: 'DP-02', status: 'Down' }, { productId: 'DP-01', status: 'Degraded' }],
    agentEffect: [
      { agentId: 'AG-02', mode: 'block', scenarioIds: ['S-07', 'S-09'], message: 'Deposit answers are paused: a replayed core banking batch doubled 61,000 balance rows, so deposits and margins would be overstated. The last good snapshot is the 29 September close; I can answer as of then once Deposits & Liquidity is restored.' },
      { agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-01', 'S-03'], message: 'Deposit balances may be overstated: a duplicate core banking load is being removed.' },
    ],
    resolution: 'Duplicate batch removed with a MERGE on (ACCT_NO, OP_TS); downstream dynamic tables refreshed.', ttdMin: 7, ttrMin: 70,
  },
  {
    id: 'INC-4', title: 'Schema drift', fault: 'Core banking adds SEG_CD_V2 (six segment codes) and stops filling SEG_CD.',
    objectFqn: CUST, column: 'SEG_CD', dmf: { metric: 'CONTRACT_CHECK (SEG_CD null %)', value: 100, threshold: 1, unit: '%' },
    affects: [{ productId: 'DP-01', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-01', mode: 'warn', scenarioIds: ['S-02', 'S-03'], message: 'Segment breakdowns are incomplete: the core added SEG_CD_V2 and stopped filling SEG_CD, so customers changed since yesterday show no segment.' }],
    resolution: 'Data contract updated to map SEG_CD_V2 to SEGMENT; Silver CUSTOMER rebuilt.', ttdMin: 40, ttrMin: 190,
  },
  {
    id: 'INC-5', title: 'Volume anomaly', fault: 'AML alerts drop 65% day over day after a monitoring scenario was disabled.',
    objectFqn: AML, dmf: { metric: 'ROW_COUNT change', value: -65, threshold: -30, unit: '%' },
    affects: [{ productId: 'DP-05', status: 'Degraded' }],
    agentEffect: [{ agentId: 'AG-03', mode: 'warn', scenarioIds: ['S-12'], message: 'Volume caveat: AML alerts dropped 65% day over day, so alert counts and rates for the last day are likely incomplete.' }],
    resolution: 'Structuring scenario re-enabled in the monitoring engine; the missed day re-scored and alerts backfilled.', ttdMin: 25, ttrMin: 140,
  },
];
