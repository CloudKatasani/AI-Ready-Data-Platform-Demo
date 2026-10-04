import type { Kpi } from '../../types';

const k = (id: string, name: string, definition: string, formula: string, unit: string, termId: string, metric: string, productIds: string[], agentIds: string[]): Kpi =>
  ({ id, name, definition, formula, unit, termId, metric, productIds, agentIds });

export const KPIS: Kpi[] = [
  k('K-01', 'Active patients', 'Living patients with a completed encounter in the last 12 months', 'count of patients alive with an inpatient discharge, ED visit or completed appointment in the last 12 months', 'patients', 'T-002', 'SV_PATIENT_REVENUE.active_patients', ['DP-01'], ['AG-01']),
  k('K-02', 'Self-pay share', 'Share of active patients with no active coverage', 'self-pay active patients ÷ active patients', '%', 'T-020', 'SV_PATIENT_REVENUE.self_pay_share', ['DP-01'], ['AG-01']),
  k('K-03', 'Patient portal adoption', 'Share of active patients enrolled in the patient portal', 'portal-enrolled active patients ÷ active patients', '%', 'T-027', 'SV_PATIENT_REVENUE.portal_adoption_rate', ['DP-01'], ['AG-01']),
  k('K-04', 'Average patient risk score', 'Mean risk score of active patients (draft model)', 'mean RISK_SCORE over active patients', 'score', 'T-021', 'SV_PATIENT_REVENUE.avg_risk_score', ['DP-01'], ['AG-01']),
  k('K-05', 'Days in A/R', 'Days of net patient revenue tied up in open receivables', 'open A/R ÷ (expected net revenue last 90 days ÷ 90)', 'days', 'T-018', 'SV_PATIENT_REVENUE.days_in_ar', ['DP-03'], ['AG-01']),
  k('K-06', 'Claim denial rate', 'Share of submitted claims initially denied by the payer', 'initially denied claims ÷ claims submitted', '%', 'T-017', 'SV_PATIENT_REVENUE.denial_rate', ['DP-03'], ['AG-01']),
  k('K-07', 'Clean claim rate', 'Share of claims accepted on first submission without edits', 'clean claims ÷ claims submitted', '%', 'T-016', 'SV_PATIENT_REVENUE.clean_claim_rate', ['DP-03'], ['AG-01']),
  k('K-08', 'Net collection rate', 'Share of expected net reimbursement collected on resolved claims', 'payments ÷ expected net reimbursement', '%', 'T-019', 'SV_PATIENT_REVENUE.net_collection_rate', ['DP-03'], ['AG-01']),
  k('K-09', 'A/R over 90 days', 'Share of open A/R older than 90 days from service', 'open A/R aged > 90 days ÷ open A/R', '%', 'T-028', 'SV_PATIENT_REVENUE.ar_over_90_pct', ['DP-03'], ['AG-01']),
  k('K-10', 'Claims submitted', 'Claims submitted in the month (system total)', 'count of claims by submission date', 'claims', 'T-015', 'SV_PATIENT_REVENUE.claims_submitted', ['DP-03'], ['AG-01']),
  k('K-11', 'Average length of stay', 'Average midnights per inpatient discharge', 'Σ length of stay ÷ inpatient discharges', 'days', 'T-005', 'SV_THROUGHPUT.avg_length_of_stay', ['DP-02'], ['AG-02']),
  k('K-12', 'Bed occupancy', 'Share of staffed beds filled at the midnight census', 'inpatient nights ÷ (staffed beds × days)', '%', 'T-010', 'SV_THROUGHPUT.bed_occupancy_pct', ['DP-02'], ['AG-02']),
  k('K-13', 'ED wait time', 'Average door-to-provider minutes in the emergency department', 'mean minutes from arrival to first provider contact (LWBS excluded)', 'minutes', 'T-011', 'SV_THROUGHPUT.ed_wait_minutes', ['DP-02'], ['AG-03']),
  k('K-14', 'ED left without being seen', 'Share of ED visits that left before seeing a provider', 'LWBS visits ÷ ED visits', '%', 'T-012', 'SV_THROUGHPUT.lwbs_rate', ['DP-02'], ['AG-03']),
  k('K-15', 'Inpatient discharges', 'Average inpatient discharges per month in the quarter (system total)', 'count of inpatient discharges ÷ months', 'discharges', 'T-030', 'SV_THROUGHPUT.inpatient_discharges', ['DP-02'], ['AG-02']),
  k('K-16', 'No-show rate', 'Share of scheduled clinic appointments the patient missed', 'no-shows ÷ (completed + no-shows)', '%', 'T-013', 'SV_THROUGHPUT.no_show_rate', ['DP-02'], ['AG-03']),
  k('K-17', 'New patient appointment lag', 'Average days from booking to a new-patient appointment', 'mean of appointment date − booked date (new patients)', 'days', 'T-014', 'SV_THROUGHPUT.new_patient_lag_days', ['DP-02'], ['AG-03']),
  k('K-18', '30-day readmission rate', 'Unplanned readmissions within 30 days of an eligible index discharge (CMS method)', 'readmitted eligible index stays ÷ eligible index stays', '%', 'T-006', 'SV_QUALITY.readmission_rate_30d', ['DP-04'], ['AG-02']),
  k('K-19', '7-day follow-up rate', 'Share of discharges home with a completed clinic visit within 7 days', 'discharges with a visit on day 1–7 ÷ discharges home / home health', '%', 'T-022', 'SV_QUALITY.followup_7d_rate', ['DP-04'], ['AG-03']),
  k('K-20', 'Inpatient mortality rate', 'In-hospital deaths as a share of discharges', 'expired discharges ÷ discharges', '%', 'T-023', 'SV_QUALITY.inpatient_mortality_rate', ['DP-04'], ['AG-02']),
  k('K-21', '30-day readmissions', 'Unplanned 30-day readmissions year to date (system total)', 'count of readmitted eligible index stays', 'readmissions', 'T-006', 'SV_QUALITY.readmissions_30d', ['DP-04'], ['AG-02']),
  k('K-22', 'Supply cost per surgical case', 'Med-surg supply and implant cost per surgical case', 'supply + implant cost on surgical cases ÷ surgical cases', 'USD', 'T-024', 'SV_SUPPLY_CHAIN.supply_cost_per_case', ['DP-05'], ['AG-01']),
  k('K-23', 'Clinical supply spend', 'Supply, implant and pharmacy spend in the quarter (system total)', 'Σ supply and pharmacy cost', 'USD', 'T-029', 'SV_SUPPLY_CHAIN.supply_spend', ['DP-05'], ['AG-01']),
  k('K-24', 'On-contract supply spend', 'Share of supply spend bought under a contract', 'on-contract spend ÷ total spend', '%', 'T-025', 'SV_SUPPLY_CHAIN.on_contract_pct', ['DP-05'], ['AG-01']),
  k('K-25', 'Care gap closure rate', 'Share of eligible care gaps closed in the measurement year', 'closed gaps ÷ eligible gaps', '%', 'T-026', 'DP_CARE_GAPS.care_gap_closure_rate', ['DP-06'], ['AG-02']),
  k('K-26', 'Patients with open care gaps', 'Share of attributed patients with at least one open care gap', 'patients with ≥ 1 open gap ÷ patients with ≥ 1 eligible measure', '%', 'T-026', 'DP_CARE_GAPS.open_gap_patient_pct', ['DP-06'], ['AG-02']),
];
