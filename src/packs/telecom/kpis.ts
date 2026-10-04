import type { Kpi } from '../../types';

const k = (id: string, name: string, definition: string, formula: string, unit: string, termId: string, metric: string, productIds: string[], agentIds: string[]): Kpi =>
  ({ id, name, definition, formula, unit, termId, metric, productIds, agentIds });

export const KPIS: Kpi[] = [
  k('K-01', 'Active subscribers', 'Mobile subscribers with Active status and an invoice in the latest closed month', 'count of mobile lines with status Active and an invoice in the month (scaled)', 'subscribers', 'T-002', 'SV_SUBSCRIBER_360.active_subscribers', ['DP-01'], ['AG-01']),
  k('K-02', 'ARPU', 'Average monthly service revenue per postpaid subscriber', 'postpaid service revenue ÷ postpaid subscribers invoiced', 'USD', 'T-009', 'SV_SUBSCRIBER_360.postpaid_arpu', ['DP-01', 'DP-03'], ['AG-01', 'AG-03']),
  k('K-03', 'Data usage per subscriber', 'Mobile data used per subscriber in the month', 'Σ data GB ÷ mobile subscribers with usage', 'GB', 'T-011', 'SV_SUBSCRIBER_360.data_gb_per_sub', ['DP-03'], ['AG-01']),
  k('K-04', 'Minutes of use per subscriber', 'Voice minutes per mobile subscriber in the month', 'Σ voice minutes ÷ mobile subscribers with usage', 'minutes', 'T-026', 'SV_SUBSCRIBER_360.voice_min_per_sub', ['DP-03'], ['AG-01']),
  k('K-05', 'Autopay enrolment', 'Share of active subscribers paying by autopay', 'active subscribers on autopay ÷ active subscribers', '%', 'T-027', 'SV_SUBSCRIBER_360.autopay_rate', ['DP-01'], ['AG-01']),
  k('K-06', 'Service revenue', 'Billed service revenue in the month, all segments', 'Σ service revenue (rated − leakage), scaled', 'USD', 'T-010', 'SV_SUBSCRIBER_360.service_revenue', ['DP-03'], ['AG-03']),
  k('K-07', 'Revenue leakage', 'Share of rated charges that were not billed in the quarter', 'Σ leakage ÷ Σ rated amount', '%', 'T-017', 'SV_SUBSCRIBER_360.revenue_leakage_pct', ['DP-03'], ['AG-03']),
  k('K-08', 'Roaming revenue share', 'Retail roaming revenue as a share of mobile service revenue in the quarter', 'Σ roaming revenue ÷ Σ mobile service revenue', '%', 'T-028', 'SV_SUBSCRIBER_360.roaming_revenue_share', ['DP-03'], ['AG-03']),
  k('K-09', 'Unbilled rated usage', 'Rated charges that did not reach an invoice in the month', 'Σ leakage amount, scaled', 'USD', 'T-017', 'SV_SUBSCRIBER_360.leakage_amount', ['DP-03'], ['AG-03']),
  k('K-10', 'Dropped call rate', 'Dropped calls as a share of call attempts in the quarter', 'Σ dropped calls ÷ Σ call attempts', '%', 'T-013', 'SV_NETWORK_PERFORMANCE.dropped_call_rate', ['DP-02'], ['AG-02']),
  k('K-11', 'Network availability', 'Share of site-minutes in service in the quarter', '100 − Σ downtime ÷ (site-days × 1,440)', '%', 'T-014', 'SV_NETWORK_PERFORMANCE.network_availability', ['DP-02'], ['AG-02']),
  k('K-12', 'Call setup success rate', 'Share of call attempts set up successfully in the quarter', '100 − Σ setup failures ÷ Σ call attempts', '%', 'T-015', 'SV_NETWORK_PERFORMANCE.call_setup_success_rate', ['DP-02'], ['AG-02']),
  k('K-13', 'Downlink throughput', 'Average user downlink speed across sites in the quarter', 'mean of site-day throughput', 'Mbps', 'T-030', 'SV_NETWORK_PERFORMANCE.avg_throughput_mbps', ['DP-02'], ['AG-02']),
  k('K-14', 'Site SLA compliance', 'Share of cell sites meeting 99.9% monthly availability', 'sites with monthly availability ≥ 99.9% ÷ sites', '%', 'T-029', 'SV_NETWORK_PERFORMANCE.site_sla_compliance', ['DP-02'], ['AG-02']),
  k('K-15', 'Mobile data traffic', 'Data carried by the mobile network in the month', 'Σ site data TB × site scale ÷ 1,000', 'PB', 'T-011', 'SV_NETWORK_PERFORMANCE.data_traffic_pb', ['DP-02'], ['AG-02']),
  k('K-16', 'Postpaid churn rate', 'Monthly postpaid churn: voluntary disconnects and port-outs over opening base', '(voluntary + port-outs) ÷ opening base; plan migrations excluded', '%', 'T-004', 'SV_CHURN_RETENTION.postpaid_churn_rate', ['DP-04'], ['AG-02']),
  k('K-17', 'Prepaid churn rate', 'Monthly prepaid churn', '(voluntary + port-outs) ÷ opening base', '%', 'T-004', 'SV_CHURN_RETENTION.prepaid_churn_rate', ['DP-04'], ['AG-02']),
  k('K-18', 'Postpaid net adds', 'Net change in the postpaid base in the month', 'gross adds − all disconnects', 'subscribers', 'T-007', 'SV_CHURN_RETENTION.net_adds', ['DP-04'], ['AG-02']),
  k('K-19', 'Postpaid gross adds', 'New postpaid connections in the month', 'Σ gross adds', 'subscribers', 'T-008', 'SV_CHURN_RETENTION.gross_adds', ['DP-04'], ['AG-02']),
  k('K-20', 'Port-out share of churn', 'Share of postpaid churn that ported to a competitor', 'port-outs ÷ (voluntary + port-outs)', '%', 'T-005', 'SV_CHURN_RETENTION.port_out_share', ['DP-04'], ['AG-02']),
  k('K-21', 'Broadband churn rate', 'Monthly fiber broadband churn', '(voluntary + port-outs) ÷ opening base', '%', 'T-004', 'SV_CHURN_RETENTION.broadband_churn_rate', ['DP-04'], ['AG-02']),
  k('K-22', 'Plan gross margin', 'Gross margin as a share of service revenue in the quarter', '(service revenue − cost of service − device subsidy) ÷ service revenue', '%', 'T-022', 'SV_DEVICE_PLAN_PROFITABILITY.plan_gross_margin_pct', ['DP-05'], ['AG-01']),
  k('K-23', 'Device subsidy per subscriber', 'Monthly amortised device subsidy per postpaid subscriber', 'Σ device subsidy ÷ postpaid invoices', 'USD', 'T-023', 'SV_DEVICE_PLAN_PROFITABILITY.device_subsidy_per_sub', ['DP-05'], ['AG-01']),
  k('K-24', 'Margin per subscriber', 'Monthly gross margin per subscriber in the quarter', 'Σ gross margin ÷ invoices', 'USD', 'T-022', 'SV_DEVICE_PLAN_PROFITABILITY.margin_per_subscriber', ['DP-05'], ['AG-01']),
  k('K-25', 'First-time fix rate', 'Share of work orders fixed on the first visit in the quarter', 'first-time fixes ÷ closed work orders', '%', 'T-021', 'DP_FIELD_SERVICE_EFFICIENCY.first_time_fix_rate', ['DP-06'], ['AG-02']),
  k('K-26', 'Hours to resolve', 'Average hours from opening to closing a work order in the quarter', 'mean of closed − opened (hours)', 'hours', 'T-031', 'DP_FIELD_SERVICE_EFFICIENCY.avg_hours_to_resolve', ['DP-06'], ['AG-02']),
];
