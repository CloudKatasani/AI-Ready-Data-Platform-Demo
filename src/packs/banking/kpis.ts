import type { Kpi } from '../../types';

const k = (id: string, name: string, definition: string, formula: string, unit: string, termId: string, metric: string, productIds: string[], agentIds: string[]): Kpi =>
  ({ id, name, definition, formula, unit, termId, metric, productIds, agentIds });

export const KPIS: Kpi[] = [
  k('K-01', 'Active customers', 'Customers with Active status, an open account and activity in the last 90 days', 'count of customers meeting rule BR-001', 'customers', 'T-002', 'SV_CUSTOMER_360.active_customers', ['DP-01'], ['AG-01']),
  k('K-02', 'Digital active rate', 'Share of active customers who used mobile or online banking in the last 30 days', 'digitally active customers ÷ active customers', '%', 'T-005', 'SV_CUSTOMER_360.digital_active_rate', ['DP-01'], ['AG-01']),
  k('K-03', 'Products per customer', 'Average open deposit accounts, loans and cards per active customer', 'open products ÷ active customers', 'products', 'T-029', 'SV_CUSTOMER_360.products_per_customer', ['DP-01'], ['AG-01']),
  k('K-04', 'Avg deposit balance per customer', 'Average month-end deposits held by an active customer', 'deposits of active customers ÷ active customers', 'USD', 'T-007', 'SV_CUSTOMER_360.avg_deposit_balance', ['DP-01'], ['AG-01']),
  k('K-05', 'Customer attrition rate', 'Share of customers whose relationship closed in the trailing 12 months', 'customers closed in 12 months ÷ customers at the start', '%', 'T-006', 'SV_CUSTOMER_360.attrition_rate', ['DP-01'], ['AG-01']),
  k('K-06', 'Total deposits', 'Month-end deposit balances across all markets', 'sum of month-end ledger balances', 'USD', 'T-007', 'SV_DEPOSITS_LIQUIDITY.total_deposits', ['DP-02'], ['AG-02']),
  k('K-07', 'Deposit growth (YTD)', 'Change in total deposits since 31 December', '(deposits at month-end ÷ deposits at 31 Dec − 1) × 100', '%', 'T-008', 'SV_DEPOSITS_LIQUIDITY.deposit_growth_pct', ['DP-02'], ['AG-02']),
  k('K-08', 'Loan-to-deposit ratio', 'Gross loans as a share of deposits at month-end', 'gross loans ÷ total deposits', '%', 'T-010', 'SV_DEPOSITS_LIQUIDITY.loan_to_deposit_ratio', ['DP-02'], ['AG-02']),
  k('K-09', 'Cost of deposits', 'Annualised interest paid on deposits as a share of balances', 'interest expense × 12 ÷ deposit balances', '%', 'T-009', 'SV_DEPOSITS_LIQUIDITY.cost_of_deposits', ['DP-02'], ['AG-02']),
  k('K-10', 'Liquidity coverage ratio', 'High-quality liquid assets over 30-day stressed net cash outflows', 'HQLA ÷ 30-day stressed outflows', '%', 'T-017', 'SV_DEPOSITS_LIQUIDITY.liquidity_coverage_ratio', ['DP-02'], ['AG-02']),
  k('K-11', 'Net interest margin', 'Annualised net interest income over average earning assets', '(interest income − interest expense) annualised ÷ average earning assets', '%', 'T-011', 'SV_DEPOSITS_LIQUIDITY.net_interest_margin', ['DP-02'], ['AG-02']),
  k('K-12', 'Cost-to-income ratio', 'Non-interest expense over total revenue (efficiency ratio)', 'non-interest expense ÷ (net interest income + non-interest income)', '%', 'T-024', 'SV_DEPOSITS_LIQUIDITY.cost_to_income_ratio', ['DP-02'], ['AG-02']),
  k('K-13', 'Total loans outstanding', 'Unpaid principal on funded loans at month-end', 'sum of principal balance', 'USD', 'T-026', 'SV_LOAN_PORTFOLIO.total_loans', ['DP-03'], ['AG-02']),
  k('K-14', 'NPL ratio', 'Non-performing loans (90+ days past due or non-accrual) as a share of total loans', 'non-performing principal ÷ total principal', '%', 'T-013', 'SV_LOAN_PORTFOLIO.npl_ratio', ['DP-03'], ['AG-02']),
  k('K-15', '30+ days past due rate', 'Loan balances 30 or more days past due as a share of total loans', 'principal with DPD ≥ 30 ÷ total principal', '%', 'T-014', 'SV_LOAN_PORTFOLIO.delinquency_30_plus_rate', ['DP-03'], ['AG-02']),
  k('K-16', 'Net charge-off ratio', 'Annualised net charge-offs over average loans, year to date', 'net charge-offs × 12 ÷ months ÷ average loans', '%', 'T-015', 'SV_LOAN_PORTFOLIO.net_charge_off_ratio', ['DP-03'], ['AG-02']),
  k('K-17', 'Allowance coverage of NPLs', 'Allowance for credit losses as a share of non-performing loans', 'allowance ÷ non-performing loans', '%', 'T-016', 'SV_LOAN_PORTFOLIO.allowance_coverage_ratio', ['DP-03'], ['AG-02']),
  k('K-18', 'Loan yield', 'Balance-weighted note rate on loans outstanding', 'Σ principal × rate ÷ Σ principal', '%', 'T-018', 'SV_LOAN_PORTFOLIO.loan_yield', ['DP-03'], ['AG-02']),
  k('K-19', 'Card purchase volume', 'Approved card purchase volume in the quarter', 'sum of approved purchase amounts', 'USD', 'T-031', 'SV_CUSTOMER_360.card_purchase_volume', ['DP-04'], ['AG-01', 'AG-03']),
  k('K-20', 'Card fraud loss (bps)', 'Confirmed fraud losses per 10,000 dollars of approved purchase volume', 'fraud losses net of recoveries ÷ approved volume × 10,000', 'bps', 'T-019', 'SV_CUSTOMER_360.card_fraud_loss_bps', ['DP-04'], ['AG-03']),
  k('K-21', 'Authorization approval rate', 'Share of card authorisations approved', 'approved authorisations ÷ all authorisations', '%', 'T-020', 'SV_CUSTOMER_360.auth_approval_rate', ['DP-04'], ['AG-03']),
  k('K-22', 'Average ticket', 'Average approved card purchase over the last 30 days', 'approved volume ÷ approved transactions', 'USD', 'T-027', 'SV_CUSTOMER_360.avg_ticket', ['DP-04'], ['AG-01']),
  k('K-23', 'AML alerts raised', 'Transaction-monitoring alerts generated in the quarter', 'count of alerts', 'alerts', 'T-021', 'SV_AML_ALERTS.alerts_raised', ['DP-05'], ['AG-01', 'AG-03']),
  k('K-24', 'AML alert-to-case rate', 'Share of dispositioned alerts escalated to an investigation case, year to date', 'escalated alerts ÷ dispositioned alerts', '%', 'T-022', 'SV_AML_ALERTS.alert_to_case_rate', ['DP-05'], ['AG-03']),
  k('K-25', 'SAR conversion rate', 'Share of closed AML cases that resulted in a SAR filing, year to date', 'SARs filed ÷ closed cases', '%', 'T-023', 'SV_AML_ALERTS.sar_conversion_rate', ['DP-05'], ['AG-03']),
  k('K-26', 'Alert disposition time', 'Average days from alert to disposition, year to date', 'mean of disposition date − alert date', 'days', 'T-021', 'SV_AML_ALERTS.avg_days_to_disposition', ['DP-05'], ['AG-03']),
  k('K-27', 'Net contribution per customer', 'Average trailing 12-month net contribution per customer after cost to serve and expected credit loss', 'Σ net contribution ÷ customers', 'USD', 'T-025', 'DP_CUSTOMER_PROFITABILITY.avg_net_contribution', ['DP-06'], ['AG-02']),
  k('K-28', 'Unprofitable customer share', 'Share of open customers with negative 12-month net contribution', 'customers with net contribution < 0 ÷ customers', '%', 'T-025', 'DP_CUSTOMER_PROFITABILITY.unprofitable_share', ['DP-06'], ['AG-02']),
];
