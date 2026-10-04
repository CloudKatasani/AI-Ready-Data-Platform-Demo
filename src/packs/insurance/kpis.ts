import type { Kpi } from '../../types';

const k = (id: string, name: string, definition: string, formula: string, unit: string, termId: string, metric: string, productIds: string[], agentIds: string[]): Kpi =>
  ({ id, name, definition, formula, unit, termId, metric, productIds, agentIds });

export const KPIS: Kpi[] = [
  k('K-01', 'Loss ratio (ex-cat)', 'Incurred losses excluding catastrophe-coded claims as a share of earned premium, accident year to date', 'ex-cat incurred losses ÷ earned premium', '%', 'T-008', 'SV_CLAIMS_EXPERIENCE.loss_ratio_ex_cat', ['DP-02', 'DP-03'], ['AG-02']),
  k('K-02', 'Combined ratio', 'Loss ratio plus LAE ratio plus expense ratio, year to date', '(incurred + LAE + underwriting expense) ÷ earned premium', '%', 'T-010', 'SV_CLAIMS_EXPERIENCE.combined_ratio', ['DP-02', 'DP-03'], ['AG-02']),
  k('K-03', 'Claims cycle time', 'Average days from first notice of loss to closure, claims closed this year', 'mean of close date − report date', 'days', 'T-013', 'SV_CLAIMS_EXPERIENCE.avg_cycle_days', ['DP-02'], ['AG-01']),
  k('K-04', 'Average severity', 'Average incurred loss per claim, loss date this year', 'incurred losses ÷ claim count', 'USD', 'T-012', 'SV_CLAIMS_EXPERIENCE.avg_severity', ['DP-02'], ['AG-01']),
  k('K-05', 'Subrogation recovery rate', 'Recoveries as a share of paid losses on subrogation-eligible claims closed this year', 'recovered ÷ paid on eligible claims', '%', 'T-015', 'SV_CLAIMS_EXPERIENCE.subrogation_recovery_rate', ['DP-02'], ['AG-01']),
  k('K-06', 'Claim frequency', 'Claims per 100 policies in force, annualised', 'claims ÷ (policy-months ÷ 12) × 100', 'per 100', 'T-025', 'SV_CLAIMS_EXPERIENCE.claim_frequency', ['DP-02'], ['AG-02']),
  k('K-07', 'Open claims', 'Claims open with a case reserve at the as-of date', 'count of claims with status Open or Reopened and case reserve > 0', 'claims', 'T-014', 'SV_CLAIMS_EXPERIENCE.open_claims', ['DP-02'], ['AG-01']),
  k('K-08', 'Catastrophe loss ratio', 'Catastrophe incurred losses as points of earned premium, year to date', 'cat-coded incurred losses ÷ earned premium', 'pts', 'T-009', 'SV_CLAIMS_EXPERIENCE.cat_loss_ratio', ['DP-02', 'DP-03'], ['AG-02']),
  k('K-09', 'LAE ratio', 'Loss adjustment expense as a share of earned premium', 'LAE ÷ earned premium', '%', 'T-011', 'SV_CLAIMS_EXPERIENCE.lae_ratio', ['DP-02', 'DP-03'], ['AG-02']),
  k('K-10', 'Incurred losses', 'Paid plus case reserves on claims with a loss date this year', 'sum of incurred loss', 'USD', 'T-007', 'SV_CLAIMS_EXPERIENCE.incurred_losses', ['DP-02'], ['AG-01', 'AG-02']),
  k('K-11', 'Paid losses', 'Loss payments made this year', 'sum of loss payment transactions', 'USD', 'T-027', 'SV_CLAIMS_EXPERIENCE.paid_losses', ['DP-02'], ['AG-01']),
  k('K-12', 'Earned premium', 'Premium earned this year', 'sum of earned premium', 'USD', 'T-005', 'SV_POLICYHOLDER_360.earned_premium', ['DP-03'], ['AG-02']),
  k('K-13', 'Written premium', 'Premium written this year', 'sum of written premium', 'USD', 'T-006', 'SV_POLICYHOLDER_360.written_premium', ['DP-03'], ['AG-02']),
  k('K-14', 'Premium growth', 'Written premium year to date versus the same months of last year', '(written YTD ÷ prior-year written YTD) − 1', '%', 'T-006', 'SV_POLICYHOLDER_360.premium_growth_pct', ['DP-03'], ['AG-02']),
  k('K-15', 'Expense ratio', 'Commission and underwriting expense as a share of earned premium', 'underwriting expense ÷ earned premium', '%', 'T-024', 'SV_CLAIMS_EXPERIENCE.expense_ratio', ['DP-03'], ['AG-02']),
  k('K-16', 'Average premium per policy', 'Average current term premium of policies in force', 'sum of term premium ÷ policies in force', 'USD', 'T-006', 'SV_POLICYHOLDER_360.avg_premium_per_policy', ['DP-01', 'DP-03'], ['AG-01']),
  k('K-17', 'Billing delinquency rate', 'Share of this month’s invoices more than 30 days past due', 'invoices > 30 days past due ÷ invoices', '%', 'T-023', 'SV_POLICYHOLDER_360.billing_delinquency_rate', ['DP-03'], ['AG-02']),
  k('K-18', 'Policy retention', 'Share of policies reaching a renewal date this year that renewed', 'renewed ÷ due for renewal', '%', 'T-016', 'SV_POLICYHOLDER_360.policy_retention_rate', ['DP-01'], ['AG-01', 'AG-03']),
  k('K-19', 'Policies in force', 'Policies in force at the as-of date', 'count of policies in force (BR-001)', 'policies', 'T-002', 'SV_POLICYHOLDER_360.policies_in_force', ['DP-01'], ['AG-01']),
  k('K-20', 'Policyholder tenure', 'Average years since original inception, policies in force', 'mean of as-of date − inception date', 'years', 'T-001', 'SV_POLICYHOLDER_360.avg_tenure_years', ['DP-01'], ['AG-01']),
  k('K-21', 'Quote-to-bind ratio', 'Share of quoted submissions that bound', 'bound ÷ quoted submissions', '%', 'T-017', 'SV_DISTRIBUTION.quote_to_bind_ratio', ['DP-04'], ['AG-03']),
  k('K-22', 'New business premium', 'Premium bound on new business this year, excluding rewrites and reinstatements', 'sum of bound premium on new business', 'USD', 'T-018', 'SV_DISTRIBUTION.new_business_premium', ['DP-04'], ['AG-03']),
  k('K-23', 'Quote turnaround', 'Average days from submission to quote, this year', 'mean of quote date − received date', 'days', 'T-028', 'SV_DISTRIBUTION.quote_turnaround_days', ['DP-04'], ['AG-03']),
  k('K-24', 'Case reserve balance', 'Case reserves on open claims at the latest month-end valuation', 'sum of case reserve at valuation', 'USD', 'T-019', 'SV_LOSS_RESERVES.case_reserve_balance', ['DP-05'], ['AG-01']),
  k('K-25', 'IBNR reserve', 'Incurred-but-not-reported reserve at the latest valuation', 'sum of allocated IBNR', 'USD', 'T-020', 'SV_LOSS_RESERVES.ibnr_reserve', ['DP-05'], ['AG-01']),
  k('K-26', 'Average reserve per open claim', 'Average case reserve on open claims at the latest valuation', 'case reserves ÷ open claims with a reserve', 'USD', 'T-019', 'SV_LOSS_RESERVES.avg_case_reserve', ['DP-05'], ['AG-01']),
  k('K-27', 'TIV in cat zones', 'Total insured value of in-force property in hurricane and wildfire zones', 'sum of TIV where cat zone in (Hurricane, Wildfire)', 'USD', 'T-021', 'DP_CATASTROPHE_EXPOSURE.tiv_in_cat_zones', ['DP-06'], ['AG-02']),
  k('K-28', 'Cat-zone concentration', 'Share of property TIV in hurricane and wildfire zones', 'TIV in cat zones ÷ total property TIV', '%', 'T-021', 'DP_CATASTROPHE_EXPOSURE.cat_zone_concentration_pct', ['DP-06'], ['AG-02']),
];
