import type { Kpi } from '../../types';

const k = (id: string, name: string, definition: string, formula: string, unit: string, termId: string, metric: string, productIds: string[], agentIds: string[]): Kpi =>
  ({ id, name, definition, formula, unit, termId, metric, productIds, agentIds });

export const KPIS: Kpi[] = [
  k('K-01', 'Active constituents', 'Constituents with Active status, an open program case and a contact in the last 12 months', 'count of constituents meeting rule BR-001, scaled to the county', 'constituents', 'T-002', 'SV_CONSTITUENT_360.active_constituents', ['DP-01'], ['AG-01']),
  k('K-02', 'Multi-program enrollment', 'Share of active constituents enrolled in two or more programs', 'active constituents with ≥ 2 open cases ÷ active constituents', '%', 'T-027', 'SV_CONSTITUENT_360.multi_program_rate', ['DP-01'], ['AG-01']),
  k('K-03', 'Constituent satisfaction', 'Share of 311 survey responses scoring 4 or 5', 'responses with score ≥ 4 ÷ responses', '%', 'T-019', 'SV_CONSTITUENT_360.constituent_satisfaction', ['DP-04'], ['AG-01']),
  k('K-04', 'Digital self-service rate', 'Share of benefit applications submitted online', 'online applications ÷ applications received (YTD)', '%', 'T-025', 'SV_CONSTITUENT_360.digital_self_service_rate', ['DP-01'], ['AG-01']),
  k('K-05', '311 service requests', '311 requests created in the month', 'count of 311 requests, scaled to the county', 'requests', 'T-017', 'SV_CONSTITUENT_360.service_requests', ['DP-04'], ['AG-01']),
  k('K-06', '311 resolution time', 'Average calendar days from 311 request creation to closure', 'mean of closure − creation (days), closed requests', 'days', 'T-018', 'SV_CONSTITUENT_360.avg_resolution_days', ['DP-04'], ['AG-01']),
  k('K-07', '311 on-time resolution', 'Share of closed 311 requests resolved within their SLA', 'requests closed within type SLA ÷ closed requests', '%', 'T-018', 'SV_CONSTITUENT_360.on_time_resolution_rate', ['DP-04'], ['AG-01']),
  k('K-08', '311 reopen rate', 'Share of closed 311 requests reopened', 'reopened requests ÷ closed requests', '%', 'T-017', 'SV_CONSTITUENT_360.reopen_rate', ['DP-04'], ['AG-01']),
  k('K-09', 'Case backlog', 'Open cases with an application, renewal or change awaiting a caseworker decision', "count of open cases where pending action ≠ 'NONE', scaled", 'cases', 'T-006', 'SV_CASE_MANAGEMENT.case_backlog', ['DP-02'], ['AG-02']),
  k('K-10', 'Average processing days', 'Average business days from a complete application to the decision', 'mean processing business days, applications decided YTD', 'days', 'T-009', 'SV_CASE_MANAGEMENT.avg_processing_days', ['DP-02'], ['AG-02']),
  k('K-11', 'Applications over 30-day standard', 'Decided applications that took more than 30 business days from a complete application', 'count of decided applications with processing days > 30 (YTD), scaled', 'applications', 'T-009', 'SV_CASE_MANAGEMENT.applications_over_standard', ['DP-02'], ['AG-02']),
  k('K-12', 'Timely processing rate', 'Share of decided applications processed within 30 business days', 'applications with processing days ≤ 30 ÷ applications decided', '%', 'T-010', 'SV_CASE_MANAGEMENT.timely_processing_rate', ['DP-02'], ['AG-02']),
  k('K-13', 'Approval rate', 'Approved applications as a share of approvals and denials', 'approved ÷ (approved + denied)', '%', 'T-011', 'SV_CASE_MANAGEMENT.approval_rate', ['DP-02'], ['AG-02']),
  k('K-14', 'Average caseload', 'Open cases per filled caseworker position', 'open cases ÷ filled caseworker positions', 'cases', 'T-012', 'SV_CASE_MANAGEMENT.avg_caseload', ['DP-02'], ['AG-02']),
  k('K-15', 'Applications received', 'Benefit applications received in the month', 'count of applications by received date, scaled', 'applications', 'T-007', 'SV_CASE_MANAGEMENT.applications_received', ['DP-02'], ['AG-02']),
  k('K-16', 'Benefits paid', 'Benefit dollars issued year to date', 'sum of payment amounts, scaled', 'USD', 'T-013', 'SV_BENEFIT_PAYMENTS.total_benefits_paid', ['DP-03'], ['AG-03']),
  k('K-17', 'Benefit payment accuracy', 'Share of payments issued in the correct amount to an eligible recipient', 'payments without an improper finding ÷ payments issued', '%', 'T-014', 'SV_BENEFIT_PAYMENTS.payment_accuracy_rate', ['DP-03'], ['AG-03']),
  k('K-18', 'Improper payment rate', 'Improper (over- and under-paid) dollars as a share of dollars issued', 'improper dollars ÷ dollars issued', '%', 'T-015', 'SV_BENEFIT_PAYMENTS.improper_payment_rate', ['DP-03'], ['AG-03']),
  k('K-19', 'Improper payment dollars', 'Dollars over- or under-paid year to date', 'sum of improper amounts, scaled', 'USD', 'T-015', 'SV_BENEFIT_PAYMENTS.improper_payment_amount', ['DP-03'], ['AG-03']),
  k('K-20', 'On-time payment rate', 'Share of payments issued by the scheduled issuance date', 'on-time payments ÷ payments issued', '%', 'T-016', 'SV_BENEFIT_PAYMENTS.on_time_payment_rate', ['DP-03'], ['AG-03']),
  k('K-21', 'Cost per case', 'Administrative cost per open case, trailing 12 months', 'administrative expenditure (12 months) ÷ open cases', 'USD', 'T-022', 'DP_WORKFORCE_BUDGET.cost_per_case', ['DP-06'], ['AG-02']),
  k('K-22', 'Cases flagged for review', 'Paying cases with an integrity flag in open review or referred', "count of cases with flag status in ('Open review', 'Referred'), scaled", 'cases', 'T-020', 'SV_PROGRAM_INTEGRITY.cases_flagged', ['DP-05'], ['AG-01', 'AG-03']),
  k('K-23', 'Integrity flag rate', 'Share of paying cases that carry an integrity flag this year', 'flagged paying cases ÷ paying cases (YTD)', '%', 'T-020', 'SV_PROGRAM_INTEGRITY.integrity_flag_rate', ['DP-05'], ['AG-01', 'AG-03']),
  k('K-24', 'Overpayment recovery rate', 'Share of established overpayments recovered', 'recovered ÷ overpayments established (YTD payments)', '%', 'T-021', 'SV_PROGRAM_INTEGRITY.recovery_rate', ['DP-05'], ['AG-01', 'AG-03']),
  k('K-25', 'Budget execution', 'Actual expenditure as a share of the adopted budget, year to date', 'actual ÷ budget (YTD)', '%', 'T-023', 'DP_WORKFORCE_BUDGET.budget_execution_pct', ['DP-06'], ['AG-02']),
  k('K-26', 'Caseworker vacancy rate', 'Unfilled authorised caseworker positions at month end', '(authorised − filled) ÷ authorised, eligibility and case management', '%', 'T-024', 'DP_WORKFORCE_BUDGET.vacancy_pct', ['DP-06'], ['AG-02']),
];
