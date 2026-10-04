// Semantic views for Ridgeline Bank (spec sections 5 and 7.3).
import type { Row, SemanticView } from '../../types';
import { sum } from '../../mock-snowflake/generators';
import type { BankData } from './data';
import { holdingsOf, isActive } from './queries';

const n = (r: Row, k: string) => Number(r[k] ?? 0);
const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const months = (rs: Row[]) => Math.max(1, new Set(rs.map((r) => r.month)).size);

export function buildSemanticViews(d: BankData, vqIds: (sv: string) => string[]): SemanticView[] {
  const branchName = new Map(d.branches.map((b) => [b.key, b.name]));

  // ---- Customer 360 (DP-01 Customer 360, DP-04 Card Transactions)
  const custRows = () => d.customers.map((c) => {
    const h = holdingsOf(d, c.key);
    return {
      region: c.region, segment: c.segment, branch: c.branchName, active: isActive(d, c), digital: c.digitalActive, deposits: h.deposits,
      products: h.depositAccounts + h.loanCount + h.cards, inBase: c.openDate < '2025-10-01' && (!c.closedDate || c.closedDate >= '2025-10-01'), closed: Boolean(c.closedDate),
    };
  });
  const customer360: SemanticView = {
    name: 'SV_CUSTOMER_360',
    description: 'Customers, relationships, digital engagement and card spending for relationship managers and analysts',
    tables: [
      { alias: 'customer', fqn: 'CONFORMED_GOLD.DIM_CUSTOMER', pk: 'CUSTOMER_KEY' },
      { alias: 'branch', fqn: 'CONFORMED_GOLD.DIM_BRANCH', pk: 'BRANCH_KEY' },
      { alias: 'deposit', fqn: 'CONFORMED_GOLD.FCT_DEPOSIT_BALANCE', pk: 'DATE_KEY, ACCOUNT_KEY' },
      { alias: 'digital', fqn: 'CONFORMED_GOLD.FCT_DIGITAL_SESSION', pk: 'SESSION_KEY' },
      { alias: 'card', fqn: 'CONFORMED_GOLD.FCT_CARD_TRANSACTION', pk: 'TRANSACTION_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'customer', to: 'branch', on: 'BRANCH_KEY' },
      { from: 'deposit', to: 'customer', on: 'CUSTOMER_KEY' },
      { from: 'digital', to: 'customer', on: 'CUSTOMER_KEY' },
      { from: 'card', to: 'customer', on: 'CUSTOMER_KEY' },
      { from: 'card', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'deposit.ledger_balance', expr: 'deposit.LEDGER_BALANCE', description: 'Month-end ledger balance per account' },
      { name: 'card.amount_usd', expr: 'card.AMOUNT_USD', description: 'Authorised amount' },
      { name: 'card.fraud_loss_usd', expr: 'card.FRAUD_LOSS_USD', description: 'Confirmed fraud loss net of recoveries' },
      { name: 'digital.session_key', expr: 'digital.SESSION_KEY', description: 'Digital banking session' },
    ],
    dimensions: [
      { name: 'customer.region', expr: 'customer.REGION', synonyms: ['market', 'region', 'footprint'], description: 'Market region' },
      { name: 'customer.segment', expr: 'customer.SEGMENT', synonyms: ['customer segment', 'customer type', 'tier'], description: 'Mass retail, Affluent, Small business, Commercial' },
      { name: 'branch.branch_name', expr: 'branch.BRANCH_NAME', synonyms: ['branch', 'financial center'], description: 'Home branch' },
      { name: 'customer.digital_enrolled', expr: 'customer.DIGITAL_ENROLLED', synonyms: ['online banking', 'mobile banking'], description: 'Enrolled in digital banking' },
      { name: 'card.merchant_category', expr: 'card.MERCHANT_CATEGORY', synonyms: ['mcc', 'merchant type', 'spend category'], description: 'Merchant category group' },
      { name: 'card.channel', expr: 'card.CHANNEL', synonyms: ['entry mode', 'card present', 'e-commerce'], description: 'Card present, contactless or e-commerce' },
    ],
    timeDimensions: [
      { name: 'date.calendar_date', expr: 'date.CALENDAR_DATE', description: 'Transaction / balance date' },
      { name: 'date.fiscal_month', expr: 'date.FISCAL_MONTH', description: 'Month' },
    ],
    metrics: [
      { name: 'active_customers', expr: "COUNT(DISTINCT IFF(customer.customer_status = 'Active' AND customer.last_activity_date > CURRENT_DATE - 90 AND deposit.ledger_balance IS NOT NULL, customer.customer_key, NULL))", description: 'Customers with Active status, an open account and activity in the last 90 days', synonyms: ['active accounts', 'customer count', 'active relationships'], termId: 'T-002', unit: 'customers' },
      { name: 'digital_active_rate', expr: 'COUNT(DISTINCT digital.customer_key) / active_customers * 100', description: 'Share of active customers with a digital banking session in the last 30 days', synonyms: ['digital adoption', 'online banking usage', 'mobile adoption'], termId: 'T-005', unit: '%' },
      { name: 'products_per_customer', expr: 'COUNT(DISTINCT deposit.account_key) + loans + cards / active_customers', description: 'Average open deposit accounts, loans and cards per active customer', synonyms: ['cross-sell ratio', 'products held', 'share of wallet'], termId: 'T-029', unit: 'products' },
      { name: 'avg_deposit_balance', expr: 'SUM(deposit.ledger_balance) / COUNT(DISTINCT customer.customer_key)', description: 'Average month-end deposits per customer', synonyms: ['average deposits', 'deposit balance per customer', 'average relationship balance'], termId: 'T-007', unit: 'USD' },
      { name: 'attrition_rate', expr: "COUNT_IF(customer.closed_date BETWEEN '2025-10-01' AND '2026-09-30') / COUNT_IF(customer.open_date < '2025-10-01') * 100", description: 'Customers whose relationship closed in the trailing 12 months ÷ customers at the start', synonyms: ['churn', 'customer attrition', 'closed relationships'], termId: 'T-006', unit: '%' },
      { name: 'card_purchase_volume', expr: 'SUM(IFF(card.is_approved, card.amount_usd, 0))', description: 'Approved card purchase volume', synonyms: ['card spend', 'purchase volume', 'card sales'], termId: 'T-031', unit: 'USD' },
      { name: 'card_fraud_loss_bps', expr: 'SUM(card.fraud_loss_usd) / SUM(IFF(card.is_approved, card.amount_usd, 0)) * 10000', description: 'Confirmed fraud losses net of recoveries per 10,000 dollars of approved purchase volume', synonyms: ['fraud loss rate', 'fraud bps', 'card fraud'], termId: 'T-019', unit: 'bps' },
      { name: 'auth_approval_rate', expr: 'AVG(IFF(card.is_approved, 1, 0)) * 100', description: 'Share of card authorisations approved', synonyms: ['approval rate', 'decline rate'], termId: 'T-020', unit: '%' },
      { name: 'avg_ticket', expr: 'AVG(IFF(card.is_approved, card.amount_usd, NULL))', description: 'Average approved purchase amount', synonyms: ['average ticket', 'ticket size', 'average purchase'], termId: 'T-027', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_CUSTOMER_360'),
    productIds: ['DP-01', 'DP-04'],
    playground: {
      from: 'SEMANTIC.SV_CUSTOMER_360',
      rows: custRows,
      dimensions: [
        { name: 'customer.region', column: 'region' },
        { name: 'customer.segment', column: 'segment' },
        { name: 'branch.branch_name', column: 'branch' },
      ],
      filters: [
        { label: 'Active customers (rule BR-001)', sql: 'active_customers rule BR-001 applied', test: (r) => Boolean(r.active) },
        { label: 'Retail segments, active', sql: "customer.segment IN ('Mass retail', 'Affluent') AND active", test: (r) => Boolean(r.active) && (r.segment === 'Mass retail' || r.segment === 'Affluent') },
        { label: 'All customers', sql: 'TRUE', test: () => true },
      ],
      metrics: [
        { name: 'active_customers', unit: '', decimals: 0, sqlExpr: 'active_customers', agg: (rs) => Math.round(rs.filter((r) => r.active).length * d.scale) },
        { name: 'digital_active_rate', unit: '%', decimals: 1, sqlExpr: 'digital_active_rate', agg: (rs) => { const a = rs.filter((r) => r.active); return (a.filter((r) => r.digital).length / Math.max(1, a.length)) * 100; } },
        { name: 'avg_deposit_balance', unit: 'USD', decimals: 0, sqlExpr: 'avg_deposit_balance', agg: (rs) => sum(rs.map((r) => n(r, 'deposits'))) / Math.max(1, rs.length) },
        { name: 'products_per_customer', unit: '', decimals: 2, sqlExpr: 'products_per_customer', agg: (rs) => sum(rs.map((r) => n(r, 'products'))) / Math.max(1, rs.length) },
        { name: 'attrition_rate', unit: '%', decimals: 1, sqlExpr: 'attrition_rate', agg: (rs) => { const b = rs.filter((r) => r.inBase); return (b.filter((r) => r.closed).length / Math.max(1, b.length)) * 100; } },
      ],
    },
  };

  // ---- Deposits & Liquidity (DP-02)
  const deposits: SemanticView = {
    name: 'SV_DEPOSITS_LIQUIDITY',
    description: 'Deposits, funding cost, liquidity coverage, net interest margin and efficiency from core banking and the general ledger',
    tables: [
      { alias: 'deposit', fqn: 'CONFORMED_GOLD.FCT_DEPOSIT_BALANCE', pk: 'DATE_KEY, ACCOUNT_KEY' },
      { alias: 'gl', fqn: 'CONFORMED_GOLD.FCT_GL_MONTHLY', pk: 'DATE_KEY, REGION, GL_ACCOUNT' },
      { alias: 'branch', fqn: 'CONFORMED_GOLD.DIM_BRANCH', pk: 'BRANCH_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'deposit', to: 'branch', on: 'BRANCH_KEY' },
      { from: 'deposit', to: 'date', on: 'DATE_KEY' },
      { from: 'gl', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'deposit.ledger_balance', expr: 'deposit.LEDGER_BALANCE', description: 'Month-end ledger balance' },
      { name: 'deposit.interest_expense', expr: 'deposit.INTEREST_EXPENSE', description: 'Interest expense for the month' },
      { name: 'deposit.stressed_outflow', expr: 'deposit.LEDGER_BALANCE * deposit.LCR_RUNOFF_RATE', description: 'Basel III 30-day stressed outflow' },
      { name: 'gl.amount_usd', expr: 'gl.AMOUNT_USD', description: 'GL amount by account' },
    ],
    dimensions: [
      { name: 'branch.region', expr: 'branch.REGION', synonyms: ['market', 'region'], description: 'Market region' },
      { name: 'branch.branch_name', expr: 'branch.BRANCH_NAME', synonyms: ['branch', 'financial center'], description: 'Branch' },
      { name: 'deposit.product_type', expr: 'deposit.PRODUCT_TYPE', synonyms: ['deposit product', 'account type'], description: 'Deposit product' },
      { name: 'gl.gl_line', expr: 'gl.GL_LINE', synonyms: ['ledger line', 'p&l line'], description: 'GL reporting line' },
    ],
    timeDimensions: [
      { name: 'date.month_end', expr: 'date.CALENDAR_DATE', description: 'Month-end reporting date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter' },
    ],
    metrics: [
      { name: 'total_deposits', expr: 'SUM(deposit.ledger_balance)', description: 'Total month-end deposits', synonyms: ['deposits', 'deposit base', 'funding'], termId: 'T-007', unit: 'USD' },
      { name: 'deposit_growth_pct', expr: "(SUM(IFF(date.month_end = '2026-09-30', deposit.ledger_balance, 0)) / SUM(IFF(date.month_end = '2025-12-31', deposit.ledger_balance, 0)) - 1) * 100", description: 'Year-to-date change in month-end deposits versus 31 December', synonyms: ['deposit growth', 'deposit change'], termId: 'T-008', unit: '%' },
      { name: 'cost_of_deposits', expr: 'SUM(deposit.interest_expense) * 12 / SUM(deposit.ledger_balance) * 100', description: 'Annualised interest expense on deposits ÷ deposit balances', synonyms: ['deposit cost', 'cost of funds', 'deposit beta'], termId: 'T-009', unit: '%' },
      { name: 'deposit_accounts', expr: 'COUNT(DISTINCT deposit.account_key)', description: 'Open deposit accounts at month-end', synonyms: ['accounts', 'account count'], termId: 'T-007', unit: 'accounts' },
      { name: 'stressed_outflows', expr: 'SUM(deposit.stressed_outflow)', description: '30-day stressed deposit outflows (LCR denominator)', synonyms: ['net cash outflows', 'runoff'], termId: 'T-017', unit: 'USD' },
      { name: 'loan_to_deposit_ratio', expr: "SUM(IFF(gl.gl_account = '1100', gl.amount_usd, 0)) / SUM(IFF(gl.gl_account = '2100', gl.amount_usd, 0)) * 100", description: 'Gross loans ÷ total deposits at month-end', synonyms: ['ldr', 'loan to deposit', 'loans to deposits'], termId: 'T-010', unit: '%' },
      { name: 'liquidity_coverage_ratio', expr: "SUM(IFF(gl.gl_account = '9100', gl.amount_usd, 0)) / SUM(IFF(gl.gl_account = '9200', gl.amount_usd, 0)) * 100", description: 'High-quality liquid assets ÷ 30-day stressed net cash outflows', synonyms: ['lcr', 'liquidity coverage'], termId: 'T-017', unit: '%' },
      { name: 'net_interest_margin', expr: "(SUM(IFF(gl.gl_account IN ('4100','4200','4300'), gl.amount_usd, 0)) - SUM(IFF(gl.gl_account IN ('5100','5200'), gl.amount_usd, 0))) * 4 / AVG(earning assets) * 100", description: 'Annualised net interest income ÷ average earning assets', synonyms: ['nim', 'margin', 'net interest margin'], termId: 'T-011', unit: '%' },
      { name: 'cost_to_income_ratio', expr: "SUM(IFF(gl.gl_account = '6000', gl.amount_usd, 0)) / (net interest income + SUM(IFF(gl.gl_account = '4500', gl.amount_usd, 0))) * 100", description: 'Non-interest expense ÷ (net interest income + non-interest income)', synonyms: ['efficiency ratio', 'cost income ratio', 'cost to income'], termId: 'T-024', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_DEPOSITS_LIQUIDITY'),
    productIds: ['DP-02'],
    playground: {
      from: 'SEMANTIC.SV_DEPOSITS_LIQUIDITY',
      rows: () => d.deposits.map((x) => ({ region: x.region, branch: branchName.get(x.branchKey)!, product: x.productCode, month: x.month, bal: x.balance, int: x.interest, out: x.balance * x.runoff })),
      dimensions: [
        { name: 'branch.region', column: 'region' },
        { name: 'deposit.product_type', column: 'product' },
        { name: 'branch.branch_name', column: 'branch' },
      ],
      filters: [
        { label: 'September 2026 month-end', sql: "date.month_end = '2026-09-30'", test: (r) => r.month === '2026-09' },
        { label: 'Q3 2026 month-ends', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => String(r.month) >= '2026-07' },
        { label: 'December 2025 month-end', sql: "date.month_end = '2025-12-31'", test: (r) => r.month === '2025-12' },
      ],
      metrics: [
        { name: 'total_deposits', unit: 'USD', decimals: 0, sqlExpr: 'total_deposits', agg: (rs) => (sum(rs.map((r) => n(r, 'bal'))) * d.scale) / months(rs) },
        { name: 'cost_of_deposits', unit: '%', decimals: 2, sqlExpr: 'cost_of_deposits', agg: (rs) => (sum(rs.map((r) => n(r, 'int'))) * 1200) / Math.max(1, sum(rs.map((r) => n(r, 'bal')))) },
        { name: 'deposit_accounts', unit: '', decimals: 0, sqlExpr: 'deposit_accounts', agg: (rs) => Math.round((rs.length * d.scale) / months(rs)) },
        { name: 'stressed_outflows', unit: 'USD', decimals: 0, sqlExpr: 'stressed_outflows', agg: (rs) => (sum(rs.map((r) => n(r, 'out'))) * d.scale) / months(rs) },
      ],
    },
  };

  // ---- Loan Portfolio Risk (DP-03) — signature view
  const loans: SemanticView = {
    name: 'SV_LOAN_PORTFOLIO',
    description: 'Loans outstanding, delinquency, non-performing loans, charge-offs and allowance by segment, market and month-end',
    tables: [
      { alias: 'loan', fqn: 'CONFORMED_GOLD.FCT_LOAN_BALANCE', pk: 'DATE_KEY, LOAN_KEY' },
      { alias: 'customer', fqn: 'CONFORMED_GOLD.DIM_CUSTOMER', pk: 'CUSTOMER_KEY' },
      { alias: 'branch', fqn: 'CONFORMED_GOLD.DIM_BRANCH', pk: 'BRANCH_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'loan', to: 'customer', on: 'CUSTOMER_KEY' },
      { from: 'loan', to: 'branch', on: 'BRANCH_KEY' },
      { from: 'loan', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'loan.principal_balance', expr: 'loan.PRINCIPAL_BALANCE', description: 'Outstanding principal at month-end' },
      { name: 'loan.npl_balance', expr: 'IFF(loan.DAYS_PAST_DUE >= 90 OR loan.NON_ACCRUAL_FLAG, loan.PRINCIPAL_BALANCE, 0)', description: 'Principal of non-performing loans (rule BR-007)' },
      { name: 'loan.net_charge_off', expr: 'loan.NET_CHARGE_OFF', description: 'Net charge-offs in the month' },
      { name: 'loan.allowance_amount', expr: 'loan.ALLOWANCE_AMOUNT', description: 'Allowance for credit losses' },
    ],
    dimensions: [
      { name: 'loan.loan_segment', expr: 'loan.LOAN_SEGMENT', synonyms: ['loan segment', 'loan type', 'portfolio', 'book', 'asset class'], description: 'CRE, C&I, residential mortgage, home equity, consumer & auto' },
      { name: 'loan.region', expr: 'loan.REGION', synonyms: ['market', 'region'], description: 'Market region' },
      { name: 'customer.segment', expr: 'customer.SEGMENT', synonyms: ['customer segment'], description: 'Borrower segment' },
      { name: 'branch.branch_name', expr: 'branch.BRANCH_NAME', synonyms: ['branch'], description: 'Booking branch' },
      { name: 'loan.non_accrual_flag', expr: 'loan.NON_ACCRUAL_FLAG', synonyms: ['non-accrual', 'nonaccrual'], description: 'Placed on non-accrual' },
    ],
    timeDimensions: [
      { name: 'date.snapshot_month', expr: 'date.FISCAL_MONTH', description: 'Month-end snapshot' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter' },
    ],
    metrics: [
      { name: 'total_loans', expr: 'SUM(loan.principal_balance)', description: 'Total loans outstanding', synonyms: ['loans outstanding', 'loan book', 'gross loans'], termId: 'T-026', unit: 'USD' },
      { name: 'npl_balance', expr: 'SUM(loan.npl_balance)', description: 'Principal of loans 90+ days past due or on non-accrual', synonyms: ['non-performing loans', 'npls', 'bad loans'], termId: 'T-012', unit: 'USD' },
      { name: 'npl_ratio', expr: 'SUM(loan.npl_balance) / SUM(loan.principal_balance) * 100', description: 'Non-performing loans (90+ days past due or non-accrual) ÷ total loans', synonyms: ['npl ratio', 'non-performing loan ratio', 'npl rate', 'non-performing ratio'], termId: 'T-013', unit: '%' },
      { name: 'delinquency_30_plus_rate', expr: 'SUM(IFF(loan.days_past_due >= 30, loan.principal_balance, 0)) / SUM(loan.principal_balance) * 100', description: 'Balance 30 or more days past due ÷ total loans', synonyms: ['delinquency rate', '30+ dpd', 'past due rate'], termId: 'T-014', unit: '%' },
      { name: 'net_charge_off_ratio', expr: 'SUM(loan.net_charge_off) * 12 / COUNT(DISTINCT date.snapshot_month) / AVG(month total loans) * 100', description: 'Annualised net charge-offs ÷ average loans', synonyms: ['nco ratio', 'charge-off rate', 'net charge offs'], termId: 'T-015', unit: '%' },
      { name: 'allowance_coverage_ratio', expr: 'SUM(loan.allowance_amount) / SUM(loan.npl_balance) * 100', description: 'Allowance for credit losses ÷ non-performing loans', synonyms: ['reserve coverage', 'acl coverage', 'npl coverage'], termId: 'T-016', unit: '%' },
      { name: 'loan_yield', expr: 'SUM(loan.principal_balance * loan.interest_rate) / SUM(loan.principal_balance)', description: 'Balance-weighted note rate', synonyms: ['yield', 'loan rate'], termId: 'T-018', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_LOAN_PORTFOLIO'),
    productIds: ['DP-03'],
    playground: {
      from: 'SEMANTIC.SV_LOAN_PORTFOLIO',
      rows: () => d.loanBals.map((x) => ({ segment: x.segment, region: x.region, month: x.month, bal: x.balance, npl: x.npl ? x.balance : 0, dpd30: x.dpd >= 30 ? x.balance : 0, nco: x.nco, acl: x.allowance })),
      dimensions: [
        { name: 'loan.loan_segment', column: 'segment' },
        { name: 'loan.region', column: 'region' },
        { name: 'date.snapshot_month', column: 'month' },
      ],
      filters: [
        { label: 'September 2026 month-end', sql: "date.snapshot_month = '2026-09'", test: (r) => r.month === '2026-09' },
        { label: 'Year to date 2026 (Jan–Sep month-ends)', sql: "date.snapshot_month BETWEEN '2026-01' AND '2026-09'", test: (r) => String(r.month) >= '2026-01' },
        { label: 'Q3 2026 month-ends', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => String(r.month) >= '2026-07' },
        { label: 'All month-ends (Jul 2025 – Sep 2026)', sql: 'TRUE', test: () => true },
      ],
      metrics: [
        { name: 'npl_ratio', unit: '%', decimals: 2, sqlExpr: 'npl_ratio', agg: (rs) => (sum(rs.map((r) => n(r, 'npl'))) / Math.max(1, sum(rs.map((r) => n(r, 'bal'))))) * 100 },
        { name: 'delinquency_30_plus_rate', unit: '%', decimals: 2, sqlExpr: 'delinquency_30_plus_rate', agg: (rs) => (sum(rs.map((r) => n(r, 'dpd30'))) / Math.max(1, sum(rs.map((r) => n(r, 'bal'))))) * 100 },
        { name: 'total_loans', unit: 'USD', decimals: 0, sqlExpr: 'total_loans', agg: (rs) => (sum(rs.map((r) => n(r, 'bal'))) * d.loanScale) / months(rs) },
        { name: 'allowance_coverage_ratio', unit: '%', decimals: 1, sqlExpr: 'allowance_coverage_ratio', agg: (rs) => (sum(rs.map((r) => n(r, 'acl'))) / Math.max(1, sum(rs.map((r) => n(r, 'npl'))))) * 100 },
        { name: 'net_charge_off_ratio', unit: '%', decimals: 2, sqlExpr: 'net_charge_off_ratio', agg: (rs) => (sum(rs.map((r) => n(r, 'nco'))) * 12 * 100) / Math.max(1, sum(rs.map((r) => n(r, 'bal')))) },
      ],
    },
  };

  // ---- AML Alerts & Cases (DP-05)
  const aml: SemanticView = {
    name: 'SV_AML_ALERTS',
    description: 'Transaction-monitoring alerts, dispositions, case escalation and SAR outcomes',
    tables: [
      { alias: 'alert', fqn: 'CONFORMED_GOLD.FCT_AML_ALERT', pk: 'ALERT_KEY' },
      { alias: 'customer', fqn: 'CONFORMED_GOLD.DIM_CUSTOMER', pk: 'CUSTOMER_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'alert', to: 'customer', on: 'CUSTOMER_KEY' },
      { from: 'alert', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'alert.alert_key', expr: 'alert.ALERT_KEY', description: 'Alert' },
      { name: 'alert.days_to_disposition', expr: 'alert.DAYS_TO_DISPOSITION', description: 'Days from alert to disposition' },
    ],
    dimensions: [
      { name: 'alert.scenario', expr: 'alert.SCENARIO', synonyms: ['typology', 'rule', 'monitoring scenario'], description: 'Monitoring scenario' },
      { name: 'alert.disposition', expr: 'alert.DISPOSITION', synonyms: ['outcome', 'status'], description: 'Alert disposition' },
      { name: 'alert.region', expr: 'alert.REGION', synonyms: ['market', 'region'], description: 'Market region' },
      { name: 'customer.aml_risk_rating', expr: 'customer.AML_RISK_RATING', synonyms: ['cdd rating', 'risk rating'], description: 'Customer due-diligence rating' },
    ],
    timeDimensions: [
      { name: 'date.alert_date', expr: 'date.CALENDAR_DATE', description: 'Alert date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter' },
    ],
    metrics: [
      { name: 'alerts_raised', expr: 'COUNT(alert.alert_key)', description: 'Transaction-monitoring alerts generated', synonyms: ['aml alerts', 'alerts', 'alert volume'], termId: 'T-021', unit: 'alerts' },
      { name: 'alert_to_case_rate', expr: "COUNT_IF(alert.is_escalated) / COUNT_IF(alert.disposition <> 'Open') * 100", description: 'Escalated alerts ÷ dispositioned alerts (open alerts excluded)', synonyms: ['alert to case', 'escalation rate', 'productive alert rate'], termId: 'T-022', unit: '%' },
      { name: 'sar_conversion_rate', expr: "COUNT_IF(alert.sar_filed) / COUNT_IF(alert.is_escalated AND case closed) * 100", description: 'SARs filed ÷ closed cases', synonyms: ['sar rate', 'sar conversion'], termId: 'T-023', unit: '%' },
      { name: 'avg_days_to_disposition', expr: 'AVG(alert.days_to_disposition)', description: 'Average days from alert to disposition', synonyms: ['alert ageing', 'disposition time', 'time to close'], termId: 'T-021', unit: 'days' },
    ],
    verifiedQueryIds: vqIds('SV_AML_ALERTS'),
    productIds: ['DP-05'],
    playground: {
      from: 'SEMANTIC.SV_AML_ALERTS',
      rows: () => d.alerts.map((a) => ({ region: a.region, scenario: a.scenario, quarter: quarterOf(a.date), date: a.date, open: a.disposition === 'Open', esc: a.disposition === 'Escalated to case', sar: a.caseStatus === 'SAR filed', caseClosed: a.disposition === 'Escalated to case' && a.caseStatus !== 'Under investigation', dtd: a.daysToDisposition ?? 0 })),
      dimensions: [
        { name: 'alert.region', column: 'region' },
        { name: 'alert.scenario', column: 'scenario' },
        { name: 'date.fiscal_quarter', column: 'quarter' },
      ],
      filters: [
        { label: 'Year to date 2026', sql: "date.alert_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => String(r.date) >= '2026-01-01' },
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
        { label: 'All alerts since Jan 2025', sql: 'TRUE', test: () => true },
      ],
      metrics: [
        { name: 'alerts_raised', unit: '', decimals: 0, sqlExpr: 'alerts_raised', agg: (rs) => Math.round(rs.length * d.alertScale) },
        { name: 'alert_to_case_rate', unit: '%', decimals: 1, sqlExpr: 'alert_to_case_rate', agg: (rs) => (rs.filter((r) => r.esc).length / Math.max(1, rs.filter((r) => !r.open).length)) * 100 },
        { name: 'sar_conversion_rate', unit: '%', decimals: 1, sqlExpr: 'sar_conversion_rate', agg: (rs) => (rs.filter((r) => r.sar).length / Math.max(1, rs.filter((r) => r.caseClosed).length)) * 100 },
        { name: 'avg_days_to_disposition', unit: 'days', decimals: 1, sqlExpr: 'avg_days_to_disposition', agg: (rs) => { const c = rs.filter((r) => !r.open); return sum(c.map((r) => n(r, 'dtd'))) / Math.max(1, c.length); } },
      ],
    },
  };

  return [customer360, deposits, loans, aml];
}
