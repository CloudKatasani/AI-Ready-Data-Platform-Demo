import type { ContextLayer, VerifiedQuery } from '../../types';

const DB = 'ALT_AI_PLATFORM';

type VqSpec = [question: string, metrics: string, dims: string, where?: string];

const vq = (sv: string, items: VqSpec[], start: number, by: string[]): VerifiedQuery[] =>
  items.map(([question, metrics, dims, where], i) => ({
    id: `VQ-${String(start + i).padStart(3, '0')}`,
    semanticView: sv,
    question,
    sql: `SELECT *\n  FROM SEMANTIC_VIEW(\n    ${DB}.SEMANTIC.${sv}\n    METRICS ${metrics}${dims ? `\n    DIMENSIONS ${dims}` : ''}${where ? `\n    WHERE ${where}` : ''}\n  );`,
    verifiedBy: by[i % by.length],
    verifiedOn: `2026-0${7 + (i % 3)}-${String(2 + ((i * 7) % 26)).padStart(2, '0')}`,
  }));

const VQ_SUBSCRIBER: VqSpec[] = [
  ['What was postpaid ARPU last quarter by region?', 'postpaid_arpu', 'subscriber.region', "billing.invoice_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['How many active subscribers do we have?', 'active_subscribers', ''],
  ['How many active subscribers are enrolled in autopay?', 'active_subscribers, autopay_rate', 'subscriber.autopay'],
  ['What was postpaid ARPU last month?', 'postpaid_arpu', '', "billing.invoice_month = '2026-09-01'"],
  ['Postpaid ARPU by rate plan', 'postpaid_arpu', 'plan.plan_name', "plan.segment = 'Postpaid'"],
  ['Service revenue by month for the last 12 months', 'service_revenue', 'billing.invoice_month'],
  ['What is our revenue leakage rate this quarter?', 'revenue_leakage_pct', '', "billing.invoice_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['Which markets had revenue leakage above 0.8% last quarter?', 'revenue_leakage_pct, leakage_amount', 'subscriber.market', 'revenue_leakage_pct > 0.8'],
  ['What share of mobile service revenue came from roaming last quarter?', 'roaming_revenue_share', 'billing.invoice_month', "billing.invoice_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['Average data usage per subscriber by plan', 'data_gb_per_sub', 'plan.plan_name', "usage.usage_date >= '2026-09-01'"],
  ['Daily mobile data usage for the last 30 days', 'data_gb_per_sub', 'usage.usage_date', "usage.usage_date >= '2026-09-01'"],
  ['Voice minutes of use per subscriber by region', 'voice_min_per_sub', 'subscriber.region'],
  ['Autopay rate by segment', 'autopay_rate', 'plan.segment'],
  ['Average churn propensity of out-of-contract postpaid subscribers', 'avg_churn_propensity', '', "plan.segment = 'Postpaid' AND subscriber.out_of_contract"],
];
const VQ_NETWORK: VqSpec[] = [
  ['What is the dropped call rate by region this quarter?', 'dropped_call_rate', 'site.region', "date.fiscal_quarter = '2026-Q3'"],
  ['Compare dropped call rate this quarter with last quarter', 'dropped_call_rate', 'date.fiscal_quarter, site.region', "date.fiscal_quarter IN ('2026-Q2', '2026-Q3')"],
  ['Top 10 cell sites by dropped call rate in the last 30 days', 'dropped_call_rate', 'site.site_id, site.market', "date.kpi_date >= '2026-09-01'"],
  ['What is network availability year to date?', 'network_availability', '', "date.kpi_date BETWEEN '2026-01-01' AND '2026-09-30'"],
  ['Network availability by market last month', 'network_availability', 'site.market', "date.kpi_date >= '2026-09-01'"],
  ['How many sites met the availability SLA in September?', 'site_sla_compliance', '', "date.kpi_date >= '2026-09-01'"],
  ['Call setup success rate by vendor', 'call_setup_success_rate', 'site.vendor'],
  ['Average downlink throughput for 5G versus LTE', 'avg_throughput_mbps', 'site.technology'],
  ['Mobile data traffic by month', 'data_traffic_pb', 'date.month'],
  ['Dropped call rate trend by week', 'dropped_call_rate', 'date.week'],
  ['Which markets have availability below 99.95%?', 'network_availability', 'site.market', 'network_availability < 99.95'],
  ['Throughput by region last quarter', 'avg_throughput_mbps', 'site.region', "date.fiscal_quarter = '2026-Q3'"],
  ['Dropped call rate for small cells', 'dropped_call_rate', '', "site.site_type = 'Small cell'"],
  ['Call setup success rate by region this quarter', 'call_setup_success_rate', 'site.region', "date.fiscal_quarter = '2026-Q3'"],
];
const VQ_CHURN: VqSpec[] = [
  ['What was postpaid churn last month by plan and region?', 'postpaid_churn_rate', 'plan.plan_name, market.region', "date.month = '2026-09'"],
  ['What is postpaid churn this quarter?', 'postpaid_churn_rate', '', "date.fiscal_quarter = '2026-Q3'"],
  ['Prepaid churn by month', 'prepaid_churn_rate', 'date.month'],
  ['Broadband churn last month', 'broadband_churn_rate', '', "date.month = '2026-09'"],
  ['What share of churn was port-outs last month?', 'port_out_share', '', "date.month = '2026-09' AND plan.segment = 'Postpaid'"],
  ['Postpaid net adds by month', 'net_adds', 'date.month', "plan.segment = 'Postpaid'"],
  ['Postpaid gross adds last month by region', 'gross_adds', 'market.region', "date.month = '2026-09' AND plan.segment = 'Postpaid'"],
  ['How many plan migrations were there last month?', 'plan_migrations', 'plan.segment', "date.month = '2026-09'"],
  ['Postpaid churn trend for the last 12 months', 'postpaid_churn_rate', 'date.month'],
  ['Which market has the highest postpaid churn?', 'postpaid_churn_rate', 'market.market_name', "date.month = '2026-09'"],
  ['Net adds by segment this quarter', 'net_adds', 'plan.segment', "date.fiscal_quarter = '2026-Q3'"],
  ['Port-out share by region this quarter', 'port_out_share', 'market.region', "date.fiscal_quarter = '2026-Q3'"],
  ['Postpaid churn for Essentials 15GB by month', 'postpaid_churn_rate', 'date.month', "plan.plan_name = 'Essentials 15GB'"],
];
/** Exactly 7: DP-05 certification gate 4 needs 10 verified queries (spec section 7.6). */
const VQ_PROFITABILITY: VqSpec[] = [
  ['What is gross margin per subscriber by plan this quarter?', 'margin_per_subscriber, plan_gross_margin_pct', 'plan.plan_name', "billing.invoice_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['What is plan gross margin this month?', 'plan_gross_margin_pct', '', "billing.invoice_month = '2026-09-01'"],
  ['Device subsidy per postpaid subscriber', 'device_subsidy_per_sub', '', "plan.segment = 'Postpaid'"],
  ['Gross margin by device model', 'plan_gross_margin_pct', 'subscriber.device_model'],
  ['Margin per subscriber by region', 'margin_per_subscriber', 'subscriber.region'],
  ['Plan gross margin trend by month', 'plan_gross_margin_pct', 'billing.invoice_month'],
  ['Which plans have gross margin below 45%?', 'plan_gross_margin_pct', 'plan.plan_name', 'plan_gross_margin_pct < 45'],
];

const verifiedQueries: VerifiedQuery[] = [
  ...vq('SV_SUBSCRIBER_360', VQ_SUBSCRIBER, 1, ['R. Mensah', 'J. Whitfield']),
  ...vq('SV_NETWORK_PERFORMANCE', VQ_NETWORK, 15, ['P. Okonkwo', 'S. Varga']),
  ...vq('SV_CHURN_RETENTION', VQ_CHURN, 29, ['R. Mensah', 'K. Albright']),
  ...vq('SV_DEVICE_PLAN_PROFITABILITY', VQ_PROFITABILITY, 42, ['J. Whitfield']),
];

export const CONTEXT: ContextLayer = {
  searchService: 'CS_TELECOM_DOCS',
  instructions: [
    { id: 'AI-01', agentId: 'AG-01', type: 'persona', version: '1.4', text: 'You are Altair’s Subscriber Insights agent. You help subscriber analysts understand the active base, ARPU, usage, autopay and plan profitability.' },
    { id: 'AI-02', agentId: 'AG-01', type: 'response', version: '1.4', text: 'Report currency to the cent for ARPU and margins and in millions for revenue. Always say which period and which subscribers (postpaid, prepaid, active) a number covers.' },
    { id: 'AI-03', agentId: 'AG-01', type: 'guardrail', version: '1.4', text: 'Never reveal subscriber names, emails or MSISDNs unless the role may see unmasked PII and CPNI. Never answer from a product the user cannot access.' },
    { id: 'AI-04', agentId: 'AG-01', type: 'orchestration', version: '1.4', text: 'Use Cortex Analyst on SV_SUBSCRIBER_360 for subscriber, usage and revenue metrics and on SV_DEVICE_PLAN_PROFITABILITY for margins. Use CS_TELECOM_DOCS for CPNI questions.' },
    { id: 'AI-05', agentId: 'AG-02', type: 'persona', version: '2.1', text: 'You are the Network Operations Analyst for Altair’s mobile network. You answer questions about network quality, availability, field repairs and churn driven by network experience.' },
    { id: 'AI-06', agentId: 'AG-02', type: 'response', version: '2.1', text: 'Report rates to two decimals and availability to three. Count churn as voluntary disconnects plus port-outs and say how many plan migrations were excluded.' },
    { id: 'AI-07', agentId: 'AG-02', type: 'guardrail', version: '2.1', text: 'Flag any answer that uses a product that is not certified. Do not attribute churn to the network unless the data shows it.' },
    { id: 'AI-08', agentId: 'AG-02', type: 'orchestration', version: '2.1', text: 'Use Cortex Analyst on SV_NETWORK_PERFORMANCE and SV_CHURN_RETENTION. Cite the Subscriber KPI definitions standard from CS_TELECOM_DOCS whenever churn is reported.' },
    { id: 'AI-09', agentId: 'AG-03', type: 'persona', version: '1.2', text: 'You are the Revenue Assurance Copilot. You help the revenue assurance team track ARPU, service revenue, leakage between rating and billing, and roaming revenue.' },
    { id: 'AI-10', agentId: 'AG-03', type: 'response', version: '1.2', text: 'Show revenue in millions of dollars to one decimal, ARPU to the cent and leakage to two decimals of a percent. Name the period.' },
    { id: 'AI-11', agentId: 'AG-03', type: 'guardrail', version: '1.2', text: 'Report at market or plan level; never list individual subscribers’ usage or numbers called (CPNI).' },
    { id: 'AI-12', agentId: 'AG-03', type: 'orchestration', version: '1.2', text: 'Use Cortex Analyst on SV_SUBSCRIBER_360. Use the roaming agreements summary in CS_TELECOM_DOCS for roaming definitions.' },
    { id: 'AI-13', agentId: 'AG-04', type: 'persona', version: '0.9', text: 'You are the Data Steward Assistant. You help stewards find governance gaps in the glossary, CDE register and product registry.' },
    { id: 'AI-14', agentId: 'AG-04', type: 'response', version: '0.9', text: 'Answer with a table of items and a recommended next action for each.' },
    { id: 'AI-15', agentId: 'AG-04', type: 'guardrail', version: '0.9', text: 'Read metadata only; never query subscriber-level data or CPNI.' },
    { id: 'AI-16', agentId: 'AG-04', type: 'orchestration', version: '0.9', text: 'Use the SQL tool over GLOSSARY, GOVERNANCE and DATA_PRODUCTS.DP_REGISTRY. Read certification state live.' },
  ],
  rules: [
    { id: 'BR-001', domain: 'Subscriber', text: 'An Active Subscriber has status Active and an invoice in the latest closed month; dormant prepaid lines without a top-up are excluded.', metric: 'SV_SUBSCRIBER_360.active_subscribers', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-002', domain: 'Revenue', text: 'ARPU is monthly service revenue per postpaid subscriber invoiced in the month. Device installments are excluded; roaming and overage are included.', metric: 'SV_SUBSCRIBER_360.postpaid_arpu', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-003', domain: 'Enterprise', text: 'Report by the four regions (Northeast, Southeast, Central, West) from DIM_MARKET; each region has two markets.', metric: 'SV_SUBSCRIBER_360.postpaid_arpu', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-004', domain: 'Subscriber', text: 'Churn counts voluntary disconnects and port-outs; plan migrations excluded. Monthly churn = (voluntary disconnects + port-outs) ÷ opening base.', metric: 'SV_CHURN_RETENTION.postpaid_churn_rate', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-005', domain: 'Subscriber', text: 'Involuntary (non-pay and fraud) disconnects are not churn; they are reported separately and do reduce net adds.', metric: 'SV_CHURN_RETENTION.net_adds', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-006', domain: 'Subscriber', text: 'High churn propensity means a score of 70 or above. Out of contract means no device agreement or term commitment remains.', metric: 'SV_SUBSCRIBER_360.avg_churn_propensity', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-007', domain: 'Privacy', text: 'MSISDN and usage detail are CPNI: show them only to roles cleared for CPNI; everyone else sees masked values or aggregates.', metric: 'SV_SUBSCRIBER_360.active_subscribers', sourceDoc: 'CPNI handling rules' },
    { id: 'BR-008', domain: 'Revenue', text: 'Revenue leakage compares rated and billed amounts at invoice level; a market above 0.8% leakage in a quarter is escalated to revenue assurance.', metric: 'SV_SUBSCRIBER_360.revenue_leakage_pct', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-009', domain: 'Revenue', text: 'Roaming revenue share counts retail outbound roaming billed to Altair subscribers over mobile service revenue; inbound wholesale settlements are excluded.', metric: 'SV_SUBSCRIBER_360.roaming_revenue_share', sourceDoc: 'Roaming agreements summary' },
    { id: 'BR-010', domain: 'Network', text: 'Dropped call rate uses network counters from FCT_NETWORK_DAILY, not handset reports, and compares whole calendar quarters.', metric: 'SV_NETWORK_PERFORMANCE.dropped_call_rate', sourceDoc: 'Network SLA definitions' },
    { id: 'BR-011', domain: 'Network', text: 'Network availability excludes planned maintenance inside the approved 00:00–05:00 local window.', metric: 'SV_NETWORK_PERFORMANCE.network_availability', sourceDoc: 'Network SLA definitions' },
    { id: 'BR-012', domain: 'Network', text: 'A cell site breaches its SLA when monthly availability falls below 99.9%.', metric: 'SV_NETWORK_PERFORMANCE.site_sla_compliance', sourceDoc: 'Network SLA definitions' },
    { id: 'BR-013', domain: 'Revenue', text: 'Plan gross margin deducts cost of service and amortised device subsidy from service revenue; device installment revenue is not margin.', metric: 'SV_DEVICE_PLAN_PROFITABILITY.plan_gross_margin_pct', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-014', domain: 'Field service', text: 'A work order is a first-time fix when no repeat visit for the same fault happens within 30 days.', metric: 'DP_FIELD_SERVICE_EFFICIENCY.first_time_fix_rate', sourceDoc: 'Network SLA definitions' },
    { id: 'BR-015', domain: 'Usage', text: 'Data usage per subscriber counts mobile lines with usage in the month; broadband homes are excluded.', metric: 'SV_SUBSCRIBER_360.data_gb_per_sub', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-016', domain: 'Subscriber', text: 'Port-out share is port-outs divided by churn (voluntary disconnects plus port-outs).', metric: 'SV_CHURN_RETENTION.port_out_share', sourceDoc: 'Subscriber KPI definitions standard' },
    { id: 'BR-017', domain: 'Subscriber', text: 'Gross adds include port-ins and exclude reactivations within 30 days of disconnect.', metric: 'SV_CHURN_RETENTION.gross_adds', sourceDoc: 'Subscriber KPI definitions standard' },
  ],
  verifiedQueries,
  synonyms: [
    { term: 'Subscriber', synonym: 'customer', scope: 'Subscriber' },
    { term: 'Subscriber', synonym: 'line', scope: 'Subscriber' },
    { term: 'Churn Rate', synonym: 'churn', scope: 'Subscriber' },
    { term: 'Churn Rate', synonym: 'attrition', scope: 'Subscriber' },
    { term: 'Churn Rate', synonym: 'deactivations', scope: 'Subscriber' },
    { term: 'Port-Out', synonym: 'ported', scope: 'Subscriber' },
    { term: 'Plan Migration', synonym: 'plan change', scope: 'Subscriber' },
    { term: 'Rate Plan', synonym: 'tariff', scope: 'Subscriber' },
    { term: 'Region', synonym: 'territory', scope: 'Enterprise' },
    { term: 'ARPU', synonym: 'average revenue per user', scope: 'Revenue' },
    { term: 'Revenue Leakage', synonym: 'unbilled usage', scope: 'Revenue' },
    { term: 'Roaming Revenue', synonym: 'roaming', scope: 'Revenue' },
    { term: 'Dropped Call Rate', synonym: 'dcr', scope: 'Network' },
    { term: 'Dropped Call Rate', synonym: 'call drops', scope: 'Network' },
    { term: 'Network Availability', synonym: 'uptime', scope: 'Network' },
    { term: 'Cell Site', synonym: 'tower', scope: 'Network' },
    { term: 'First-Time Fix', synonym: 'ftf', scope: 'Field service' },
    { term: 'Work Order', synonym: 'truck roll', scope: 'Field service' },
    { term: 'MSISDN', synonym: 'phone number', scope: 'Privacy' },
    { term: 'Data Usage', synonym: 'data consumption', scope: 'Usage' },
  ],
  documents: [
    {
      id: 'DOC-01', title: 'Subscriber KPI definitions standard', source: '@ALT_AI_PLATFORM.CONTEXT.DOCS/subscriber_kpi_standard_v3.pdf', chunkCount: 38, updatedAt: '2026-02-09 09:00:00',
      chunks: [
        { n: 4, text: 'ARPU is monthly service revenue divided by postpaid subscribers invoiced in the month. Service revenue includes plan charges, overage and retail roaming and excludes device installments and one-off fees.' },
        { n: 6, text: 'Churn counts voluntary disconnects and port-outs. Plan migrations are excluded: a subscriber who moves from one rate plan to another stays with Altair and is not churn. Monthly churn is (voluntary disconnects + port-outs) ÷ opening base, reported by segment, plan and region.' },
        { n: 9, text: 'Involuntary disconnects for non-payment or fraud are reported separately from churn. Net adds equal gross adds minus all disconnects; plan migrations net to zero across a segment.' },
        { n: 12, text: 'An active subscriber has status Active and was invoiced in the latest closed month. Prepaid lines with no top-up in 60 days are dormant and excluded.' },
      ],
    },
    {
      id: 'DOC-02', title: 'Network SLA definitions', source: '@ALT_AI_PLATFORM.CONTEXT.DOCS/network_sla_definitions_2026.pdf', chunkCount: 44, updatedAt: '2026-01-20 08:30:00',
      chunks: [
        { n: 3, text: 'Every cell site must achieve at least 99.9% availability in each calendar month. Downtime counts service-affecting outages; planned maintenance inside the 00:00–05:00 local window is excluded.' },
        { n: 8, text: 'Dropped call rate is the number of abnormally released voice calls divided by call attempts, measured from network counters. The target is below 0.85% per region per quarter; quarter-over-quarter changes above 0.05 points are reviewed.' },
        { n: 15, text: 'Field repairs on network sites target a first-time fix rate of 80%. A repeat visit for the same fault within 30 days means the original work order was not fixed first time.' },
      ],
    },
    {
      id: 'DOC-03', title: 'CPNI handling rules', source: '@ALT_AI_PLATFORM.CONTEXT.DOCS/cpni_handling_rules_v5.pdf', chunkCount: 21, updatedAt: '2026-03-02 11:15:00',
      chunks: [
        { n: 2, text: 'Customer proprietary network information (CPNI) includes the numbers a subscriber calls, call times and durations, location and the services used. The MSISDN joined to usage is CPNI.' },
        { n: 5, text: 'CPNI may be used internally only by roles cleared by the Privacy Office. All other roles see masked values; analytics use aggregates. Every access to CPNI columns is logged in ACCESS_HISTORY.' },
        { n: 9, text: 'Any new data product that exposes a CPNI column must attach MP_MASK_CPNI before certification.' },
      ],
    },
    {
      id: 'DOC-04', title: 'Roaming agreements summary', source: '@ALT_AI_PLATFORM.CONTEXT.DOCS/roaming_agreements_2026.pdf', chunkCount: 29, updatedAt: '2026-05-14 14:00:00',
      chunks: [
        { n: 3, text: 'Altair holds bilateral roaming agreements with 112 partner networks across three zones. Zone 1 (Canada and Mexico) is included in Unlimited Max; Zones 2 and 3 are billed per day pass.' },
        { n: 7, text: 'Roaming revenue reported to finance is retail outbound roaming billed to Altair subscribers. Wholesale inbound roaming settled with partners through the clearing house is excluded from roaming revenue share.' },
        { n: 11, text: 'Roaming usage peaks in July and August; day-pass revenue is recognised in the month the pass is used.' },
      ],
    },
  ],
};
