import type { Kpi } from '../../types';

const k = (id: string, name: string, definition: string, formula: string, unit: string, termId: string, metric: string, productIds: string[], agentIds: string[]): Kpi =>
  ({ id, name, definition, formula, unit, termId, metric, productIds, agentIds });

export const KPIS: Kpi[] = [
  k('K-01', 'Active customers', 'Customers with Active status and a bill in the last 60 days', 'count of customers with status Active and a statement in the last 60 days', 'customers', 'T-002', 'SV_CUSTOMER_360.active_customers', ['DP-01'], ['AG-01']),
  k('K-02', 'Avg monthly bill', 'Average billed amount per residential statement', 'sum of billed amount ÷ number of statements (residential)', 'USD', 'T-009', 'SV_CUSTOMER_360.avg_monthly_bill', ['DP-01'], ['AG-01']),
  k('K-03', 'Arrears balance', 'Past-due balance across all customers on their latest statement', 'sum of arrears on each customer’s latest statement', 'USD', 'T-010', 'SV_CUSTOMER_360.arrears_balance', ['DP-01'], ['AG-01']),
  k('K-04', 'Digital adoption rate', 'Share of active customers on paperless billing', 'paperless active customers ÷ active customers', '%', 'T-011', 'SV_CUSTOMER_360.digital_adoption_rate', ['DP-01'], ['AG-01']),
  k('K-05', 'Churn risk score', 'Average model churn risk across active customers', 'mean churn risk score (0–100)', 'score', 'T-020', 'SV_CUSTOMER_360.avg_churn_risk', ['DP-01'], ['AG-01']),
  k('K-06', 'SAIDI', 'Average outage minutes per customer served', 'sum of customer minutes interrupted ÷ customers served, excluding Major Event Days', 'minutes', 'T-004', 'SV_RELIABILITY.saidi_minutes', ['DP-02'], ['AG-02']),
  k('K-07', 'SAIFI', 'Average number of sustained interruptions per customer served', 'sum of customers interrupted ÷ customers served, excluding Major Event Days', 'interruptions', 'T-005', 'SV_RELIABILITY.saifi', ['DP-02'], ['AG-02']),
  k('K-08', 'CAIDI', 'Average restoration time for interrupted customers', 'customer minutes interrupted ÷ customers interrupted', 'minutes', 'T-006', 'SV_RELIABILITY.caidi_minutes', ['DP-02'], ['AG-02']),
  k('K-09', 'Customers interrupted', 'Total customer interruptions in the period', 'sum of customers interrupted per sustained outage', 'customers', 'T-005', 'SV_RELIABILITY.customers_interrupted', ['DP-02'], ['AG-02']),
  k('K-10', 'Customer minutes interrupted', 'Total customer minutes of interruption', 'sum of customers interrupted × duration', 'minutes', 'T-008', 'SV_RELIABILITY.customer_minutes_interrupted', ['DP-02'], ['AG-02']),
  k('K-11', 'Daily consumption (kWh)', 'Average kWh per premise per day', 'sum of kWh ÷ premise-days', 'kWh', 'T-026', 'SV_CUSTOMER_360.daily_kwh', ['DP-03'], ['AG-01']),
  k('K-12', 'Peak demand (kW)', 'Average daily peak kW per premise', 'mean of daily maximum 15-minute kW', 'kW', 'T-014', 'SV_CUSTOMER_360.peak_kw', ['DP-03'], ['AG-01']),
  k('K-13', 'Read success rate', 'Share of 15-minute interval reads received and valid', 'valid intervals ÷ expected intervals', '%', 'T-013', 'SV_CUSTOMER_360.read_success_rate', ['DP-03'], ['AG-01']),
  k('K-14', 'Estimated reads', 'Share of intervals that had to be estimated', '100 − read success rate', '%', 'T-013', 'SV_CUSTOMER_360.estimated_read_pct', ['DP-03'], ['AG-01']),
  k('K-15', 'Total spend', 'All PO spend in the fiscal year', 'sum of PO line spend', 'USD', 'T-023', 'SV_PROCUREMENT.total_spend', ['DP-04'], ['AG-03']),
  k('K-16', 'Spend under contract %', 'Share of spend placed against a contract', 'on-contract spend ÷ total spend', '%', 'T-015', 'SV_PROCUREMENT.spend_under_contract_pct', ['DP-04'], ['AG-03']),
  k('K-17', 'Supplier OTIF %', 'Share of PO lines delivered on time and in full', 'OTIF lines ÷ received lines', '%', 'T-017', 'SV_PROCUREMENT.otif_pct', ['DP-04'], ['AG-03']),
  k('K-18', 'PO cycle time', 'Average days from PO creation to goods receipt', 'mean of receipt date − PO date', 'days', 'T-022', 'SV_PROCUREMENT.po_cycle_days', ['DP-04'], ['AG-03']),
  k('K-19', 'Maverick spend', 'Spend placed outside a contract', 'sum of spend where not on contract', 'USD', 'T-016', 'SV_PROCUREMENT.maverick_spend', ['DP-04'], ['AG-03']),
  k('K-20', 'Days sales outstanding', 'Days of billed revenue tied up in receivables', '(billed + arrears) ÷ billed revenue × 30', 'days', 'T-018', 'SV_BILLING_AR.dso_days', ['DP-05'], ['AG-01']),
  k('K-21', 'Bills issued', 'Billing statements issued in the month', 'count of statements', 'statements', 'T-009', 'SV_BILLING_AR.bills_issued', ['DP-05'], ['AG-01']),
  k('K-22', 'Estimated bill rate', 'Share of bills based on estimated reads', 'estimated bills ÷ bills issued', '%', 'T-021', 'SV_BILLING_AR.estimated_bill_rate', ['DP-05'], ['AG-01']),
  k('K-23', 'Collections rate', 'Share of billed revenue collected within 60 days', 'billed amount paid within 60 days ÷ billed amount', '%', 'T-024', 'SV_BILLING_AR.collections_rate', ['DP-05'], ['AG-01']),
  k('K-24', 'Spans overdue for trim', 'Share of spans past their trim cycle', 'overdue spans ÷ all spans', '%', 'T-019', 'DP_VEGETATION_RISK.spans_overdue_pct', ['DP-06'], ['AG-02']),
  k('K-25', 'Tree-caused outages', 'Sustained outages caused by tree contact in the quarter', "count of outages with cause 'Tree contact'", 'events', 'T-025', 'SV_RELIABILITY.tree_outages', ['DP-02', 'DP-06'], ['AG-02']),
  k('K-26', 'Trim cycle compliance', 'Share of spans trimmed within their cycle', '1 − spans overdue ÷ all spans', '%', 'T-019', 'DP_VEGETATION_RISK.trim_cycle_compliance', ['DP-06'], ['AG-02']),
];
