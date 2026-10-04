import type { ContextLayer, VerifiedQuery } from '../../types';

const DB = 'SMI_AI_PLATFORM';

type VqSpec = [question: string, metrics: string, dims: string, where?: string];

const vq = (sv: string, items: VqSpec[], start: number, by: string[]): VerifiedQuery[] =>
  items.map(([question, metrics, dims, where], i) => ({
    id: `VQ-${String(start + i).padStart(3, '0')}`,
    semanticView: sv,
    question,
    sql: `SELECT *\n  FROM SEMANTIC_VIEW(\n    ${DB}.SEMANTIC.${sv}\n    METRICS ${metrics}${dims ? `\n    DIMENSIONS ${dims}` : ''}${where ? `\n    WHERE ${where}` : ''}\n  );`,
    verifiedBy: by[i % by.length],
    verifiedOn: `2026-0${7 + (i % 3)}-${String(3 + ((i * 5) % 25)).padStart(2, '0')}`,
  }));

const VQ_POLICYHOLDER: VqSpec[] = [
  ['How many policies do we have in force?', 'policies_in_force', ''],
  ['Policies in force by region', 'policies_in_force', 'policy.region'],
  ['What is our policy retention rate this year?', 'policy_retention_rate', '', "date.premium_month >= '2026-01-01'"],
  ['Retention by line of business', 'policy_retention_rate', 'line.line_of_business'],
  ['Average premium per policy by line', 'avg_premium_per_policy', 'line.line_of_business'],
  ['What is earned premium year to date?', 'earned_premium', '', "date.premium_month BETWEEN '2026-01-01' AND '2026-09-01'"],
  ['Written premium year to date by region', 'written_premium', 'policy.region', "date.premium_month >= '2026-01-01'"],
  ['What is premium growth versus last year?', 'premium_growth_pct', 'date.fiscal_year', 'MONTH(date.premium_month) <= 9'],
  ['Billing delinquency rate this month', 'billing_delinquency_rate', '', "date.premium_month = '2026-09-01'"],
  ['Average policyholder tenure by channel', 'avg_tenure_years', 'producer.channel'],
  ['Earned premium by month for 2026', 'earned_premium', 'date.premium_month', "date.premium_month >= '2026-01-01'"],
  ['Policies in force for personal lines', 'policies_in_force', 'line.segment', "line.segment = 'Personal'"],
  ['Delinquency rate by region', 'billing_delinquency_rate', 'policy.region'],
  ['Written premium by channel this year', 'written_premium', 'producer.channel', "date.premium_month >= '2026-01-01'"],
];
const VQ_CLAIMS: VqSpec[] = [
  ['What is the loss ratio by line of business this year, excluding catastrophe losses?', 'loss_ratio_ex_cat', 'line.line_of_business', "date.loss_date BETWEEN '2026-01-01' AND '2026-09-30'"],
  ['What is the all-in loss ratio year to date?', 'loss_ratio', '', "date.loss_date >= '2026-01-01'"],
  ['Catastrophe loss ratio by quarter', 'cat_loss_ratio', 'date.loss_quarter'],
  ['Compare the combined ratio this year with last year', 'combined_ratio, lae_ratio, expense_ratio', 'date.fiscal_year', 'MONTH(date.loss_date) <= 9'],
  ['Average claim severity by line of business year to date', 'avg_severity', 'line.line_of_business', "date.loss_date >= '2026-01-01'"],
  ['How many open claims do we have?', 'open_claims', 'line.line_of_business'],
  ['Claims cycle time by line this year', 'avg_cycle_days', 'line.line_of_business', "date.loss_date >= '2026-01-01'"],
  ['Subrogation recovery rate year to date', 'subrogation_recovery_rate', '', "date.loss_date >= '2026-01-01'"],
  ['Claim frequency per 100 policies by region', 'claim_frequency', 'claim.region'],
  ['Top 5 states by incurred losses this year', 'incurred_losses', 'policy.state', "date.loss_date >= '2026-01-01'"],
  ['Incurred losses by catastrophe peril', 'incurred_losses', 'cat.peril', 'claim.is_catastrophe'],
  ['Paid losses by month', 'paid_losses', 'date.loss_date'],
  ['Loss ratio excluding cats by region for Q3', 'loss_ratio_ex_cat', 'claim.region', "date.loss_quarter = '2026-Q3'"],
  ['Expense ratio trend by quarter', 'expense_ratio', 'date.loss_quarter'],
];
const VQ_DISTRIBUTION: VqSpec[] = [
  ['What was our quote-to-bind ratio last quarter?', 'quote_to_bind_ratio', '', "date.quote_quarter = '2026-Q3'"],
  ['Quote-to-bind ratio by channel', 'quote_to_bind_ratio', 'producer.channel'],
  ['Which agencies take longer than 3 days to quote?', 'quote_turnaround_days', 'producer.agency_name', 'quote_turnaround_days > 3'],
  ['New business premium this year by channel', 'new_business_premium', 'producer.channel', "date.quote_date >= '2026-01-01'"],
  ['Top 10 agencies by new business premium', 'new_business_premium', 'producer.agency_name'],
  ['Quote turnaround by line of business', 'quote_turnaround_days', 'line.line_of_business'],
  ['Quotes issued by month', 'submissions_quoted', 'date.quote_date'],
  ['Policies bound by region this year', 'policies_bound', 'submission.region', "date.quote_date >= '2026-01-01'"],
  ['Quote-to-bind trend by quarter', 'quote_to_bind_ratio', 'date.quote_quarter'],
  ['Which agencies have a bind rate below 15%?', 'quote_to_bind_ratio', 'producer.agency_name', 'quote_to_bind_ratio < 15'],
  ['New business premium for commercial lines', 'new_business_premium', 'line.line_of_business', "line.segment = 'Commercial'"],
  ['Rewrites and reinstatements bound this year', 'policies_bound', 'submission.submission_type', "submission.submission_type <> 'New business'"],
  ['Average quote turnaround for brokers', 'quote_turnaround_days', '', "producer.channel = 'Broker'"],
];
/** Exactly 7: DP-05 certification gate 4 needs 10 verified queries (spec section 7.6). */
const VQ_RESERVES: VqSpec[] = [
  ['What is our total case reserve balance this month?', 'case_reserve_balance', '', "date.valuation_date = '2026-09-30'"],
  ['IBNR reserve by line of business', 'ibnr_reserve', 'line.line_of_business', "date.valuation_date = '2026-09-30'"],
  ['Case reserves trend for the last six months', 'case_reserve_balance', 'date.valuation_month', "date.valuation_date >= '2026-04-30'"],
  ['Total loss reserves by accident year', 'total_loss_reserves', 'reserve.accident_year', "date.valuation_date = '2026-09-30'"],
  ['Average case reserve per open claim by line', 'avg_case_reserve', 'line.line_of_business'],
  ['Case reserves by region', 'case_reserve_balance', 'reserve.region', "date.valuation_date = '2026-09-30'"],
  ['IBNR as of the June quarter close', 'ibnr_reserve', '', "date.valuation_date = '2026-06-30'"],
];

const verifiedQueries: VerifiedQuery[] = [
  ...vq('SV_POLICYHOLDER_360', VQ_POLICYHOLDER, 1, ['H. Quansah', 'C. Whitaker']),
  ...vq('SV_CLAIMS_EXPERIENCE', VQ_CLAIMS, 15, ['R. Mendes', 'H. Quansah']),
  ...vq('SV_DISTRIBUTION', VQ_DISTRIBUTION, 29, ['R. Mendes', 'J. Castellano']),
  ...vq('SV_LOSS_RESERVES', VQ_RESERVES, 42, ['P. Lindgren']),
];

export const CONTEXT: ContextLayer = {
  searchService: 'CS_INSURANCE_DOCS',
  instructions: [
    { id: 'AI-01', agentId: 'AG-01', type: 'persona', version: '1.4', text: 'You are Sentinel Mutual’s Claims Analyst agent. You help claims analysts understand claim volumes, severity, cycle time, payments, open inventory and reserves.' },
    { id: 'AI-02', agentId: 'AG-01', type: 'response', version: '1.4', text: 'Report currency to the dollar for averages and in millions for totals. Always say which claims a number covers (loss period, open per BR-002, line).' },
    { id: 'AI-03', agentId: 'AG-01', type: 'guardrail', version: '1.4', text: 'Never reveal claimant or policyholder names (PII) or injury details and dates of birth (PHI) unless the user’s role is allowed to see them. Never answer from a product the user cannot access.' },
    { id: 'AI-04', agentId: 'AG-01', type: 'orchestration', version: '1.4', text: 'Use Cortex Analyst on SV_CLAIMS_EXPERIENCE for claims metrics and SV_LOSS_RESERVES for reserves. Use CS_INSURANCE_DOCS for the claims handling standard and reserving policy.' },
    { id: 'AI-05', agentId: 'AG-02', type: 'persona', version: '2.1', text: 'You are the Underwriting Copilot. You answer questions about loss ratios, combined ratio, premium, catastrophe losses and exposure by line, state and region.' },
    { id: 'AI-06', agentId: 'AG-02', type: 'response', version: '2.1', text: 'Report ratios to one decimal on earned premium. Say whether catastrophe losses are included or excluded, and name the accident period.' },
    { id: 'AI-07', agentId: 'AG-02', type: 'guardrail', version: '2.1', text: 'Flag any answer that uses a product that is not certified. Never compute a loss ratio on written premium.' },
    { id: 'AI-08', agentId: 'AG-02', type: 'orchestration', version: '2.1', text: 'Use Cortex Analyst on SV_CLAIMS_EXPERIENCE and SV_POLICYHOLDER_360. Cite the NAIC statutory reporting guide from CS_INSURANCE_DOCS whenever catastrophe losses are excluded.' },
    { id: 'AI-09', agentId: 'AG-03', type: 'persona', version: '1.2', text: 'You are Distribution Insights. You help underwriting and distribution managers track agencies, quotes, binds, new business and speed to quote.' },
    { id: 'AI-10', agentId: 'AG-03', type: 'response', version: '1.2', text: 'Show premium in millions of dollars to one decimal, ratios to one decimal and turnaround in days to one decimal. Name the period.' },
    { id: 'AI-11', agentId: 'AG-03', type: 'guardrail', version: '1.2', text: 'Do not disclose commission rates or individual producer compensation; report production only.' },
    { id: 'AI-12', agentId: 'AG-03', type: 'orchestration', version: '1.2', text: 'Use Cortex Analyst on SV_DISTRIBUTION. Use the underwriting guidelines in CS_INSURANCE_DOCS for agency service standards.' },
    { id: 'AI-13', agentId: 'AG-04', type: 'persona', version: '0.9', text: 'You are the Data Steward Assistant. You help stewards find governance gaps in the glossary, CDE register and product registry.' },
    { id: 'AI-14', agentId: 'AG-04', type: 'response', version: '0.9', text: 'Answer with a table of items and a recommended next action for each.' },
    { id: 'AI-15', agentId: 'AG-04', type: 'guardrail', version: '0.9', text: 'Read metadata only; never query policyholder- or claimant-level data.' },
    { id: 'AI-16', agentId: 'AG-04', type: 'orchestration', version: '0.9', text: 'Use the SQL tool over GLOSSARY, GOVERNANCE and DATA_PRODUCTS.DP_REGISTRY. Read certification state live.' },
  ],
  rules: [
    { id: 'BR-001', domain: 'Policyholder', text: 'A Policy in Force has status In force, a current term that started on or before the as-of date, and no lapse or cancellation before it.', metric: 'SV_POLICYHOLDER_360.policies_in_force', sourceDoc: 'Underwriting guidelines 2026' },
    { id: 'BR-002', domain: 'Claims', text: 'An Open Claim has status Open or Reopened and a case reserve above zero; claims fully paid and awaiting only a subrogation recovery are not open.', metric: 'SV_CLAIMS_EXPERIENCE.open_claims', sourceDoc: 'Claims handling standard' },
    { id: 'BR-003', domain: 'Claims', text: 'Claim severity is the average incurred loss (paid plus case reserve) per claim with a loss date in the period; LAE is excluded.', metric: 'SV_CLAIMS_EXPERIENCE.avg_severity', sourceDoc: 'Claims handling standard' },
    { id: 'BR-004', domain: 'Claims', text: 'Claims cycle time runs from first notice of loss to closure and is measured on claims closed in the period.', metric: 'SV_CLAIMS_EXPERIENCE.avg_cycle_days', sourceDoc: 'Claims handling standard' },
    { id: 'BR-005', domain: 'Underwriting', text: 'Loss ratio uses earned premium, never written premium. Catastrophes are claims carrying a code on the cat-code list; the ex-cat loss ratio excludes them and reports them separately as cat points.', metric: 'SV_CLAIMS_EXPERIENCE.loss_ratio_ex_cat', sourceDoc: 'NAIC statutory reporting guide' },
    { id: 'BR-006', domain: 'Underwriting', text: 'Combined ratio is the all-in loss ratio plus the LAE ratio plus the underwriting expense ratio, each on earned premium.', metric: 'SV_CLAIMS_EXPERIENCE.combined_ratio', sourceDoc: 'NAIC statutory reporting guide' },
    { id: 'BR-007', domain: 'Underwriting', text: '"This year" means accident year to date: losses on claims with a loss date from 1 January, against premium earned in the same months.', metric: 'SV_CLAIMS_EXPERIENCE.loss_ratio', sourceDoc: 'NAIC statutory reporting guide' },
    { id: 'BR-008', domain: 'Claims', text: 'Subrogation recovery rate is recoveries divided by paid losses on subrogation-eligible claims closed in the period.', metric: 'SV_CLAIMS_EXPERIENCE.subrogation_recovery_rate', sourceDoc: 'Claims handling standard' },
    { id: 'BR-009', domain: 'Claims', text: 'Open injury claims with incurred losses above $50,000 are large losses and need a quarterly review by a claims manager.', metric: 'SV_CLAIMS_EXPERIENCE.incurred_losses', sourceDoc: 'Claims handling standard' },
    { id: 'BR-010', domain: 'Reserving', text: 'Case reserves are reported at month-end valuation; only open claims carry a case reserve.', metric: 'SV_LOSS_RESERVES.case_reserve_balance', sourceDoc: 'Loss reserving policy' },
    { id: 'BR-011', domain: 'Reserving', text: 'IBNR is set by line using reserving committee factors on trailing 12-month earned premium and allocated to open claims pro rata to case reserve.', metric: 'SV_LOSS_RESERVES.ibnr_reserve', sourceDoc: 'Loss reserving policy' },
    { id: 'BR-012', domain: 'Policyholder', text: 'Retention is policies renewed divided by policies that reached a renewal date in the period; mid-term cancellations are excluded from the denominator.', metric: 'SV_POLICYHOLDER_360.policy_retention_rate', sourceDoc: 'Underwriting guidelines 2026' },
    { id: 'BR-013', domain: 'Finance', text: 'Billing delinquency counts invoices more than 30 days past due at month end.', metric: 'SV_POLICYHOLDER_360.billing_delinquency_rate', sourceDoc: 'Billing and collections procedure' },
    { id: 'BR-014', domain: 'Distribution', text: 'Quote-to-bind is bound submissions divided by quoted submissions, by quote date; submissions declined before a quote are excluded.', metric: 'SV_DISTRIBUTION.quote_to_bind_ratio', sourceDoc: 'Underwriting guidelines 2026' },
    { id: 'BR-015', domain: 'Distribution', text: 'New business premium excludes renewals, rewrites of existing business and reinstatements.', metric: 'SV_DISTRIBUTION.new_business_premium', sourceDoc: 'Underwriting guidelines 2026' },
    { id: 'BR-016', domain: 'Distribution', text: 'Agencies averaging more than 3 days from submission to quote are flagged for a service review.', metric: 'SV_DISTRIBUTION.quote_turnaround_days', sourceDoc: 'Underwriting guidelines 2026' },
    { id: 'BR-017', domain: 'Catastrophe risk', text: 'Property TIV in hurricane and wildfire zones may not exceed 40% of total in-force property TIV.', metric: 'DP_CATASTROPHE_EXPOSURE.cat_zone_concentration_pct', sourceDoc: 'Underwriting guidelines 2026' },
    { id: 'BR-018', domain: 'Finance', text: 'Premium growth compares written premium year to date with the same months of the prior year.', metric: 'SV_POLICYHOLDER_360.premium_growth_pct', sourceDoc: 'NAIC statutory reporting guide' },
  ],
  verifiedQueries,
  synonyms: [
    { term: 'Loss Ratio', synonym: 'LR', scope: 'Underwriting' },
    { term: 'Loss Ratio', synonym: 'loss ratio ex cat', scope: 'Underwriting' },
    { term: 'Catastrophe Claim', synonym: 'cat', scope: 'Claims' },
    { term: 'Catastrophe Claim', synonym: 'cats', scope: 'Claims' },
    { term: 'Catastrophe Claim', synonym: 'CAT event', scope: 'Claims' },
    { term: 'Combined Ratio', synonym: 'COR', scope: 'Underwriting' },
    { term: 'Line of Business', synonym: 'LOB', scope: 'Underwriting' },
    { term: 'Policyholder', synonym: 'insured', scope: 'Policyholder' },
    { term: 'Policyholder', synonym: 'customer', scope: 'Policyholder' },
    { term: 'Policy in Force', synonym: 'PIF', scope: 'Policyholder' },
    { term: 'Loss Adjustment Expense', synonym: 'LAE', scope: 'Claims' },
    { term: 'Open Claim', synonym: 'pending claim', scope: 'Claims' },
    { term: 'Claim Severity', synonym: 'average claim cost', scope: 'Claims' },
    { term: 'Subrogation Recovery', synonym: 'subro', scope: 'Claims' },
    { term: 'Case Reserve', synonym: 'case OS', scope: 'Reserving' },
    { term: 'IBNR Reserve', synonym: 'IBNR', scope: 'Reserving' },
    { term: 'Quote-to-Bind Ratio', synonym: 'hit ratio', scope: 'Distribution' },
    { term: 'Quote-to-Bind Ratio', synonym: 'bind rate', scope: 'Distribution' },
    { term: 'Producer', synonym: 'agency', scope: 'Distribution' },
    { term: 'Producer', synonym: 'broker', scope: 'Distribution' },
    { term: 'Total Insured Value', synonym: 'TIV', scope: 'Catastrophe risk' },
    { term: 'Earned Premium', synonym: 'EP', scope: 'Finance' },
    { term: 'Written Premium', synonym: 'GWP', scope: 'Finance' },
  ],
  documents: [
    {
      id: 'DOC-01', title: 'Sentinel Mutual underwriting guidelines 2026', source: '@SMI_AI_PLATFORM.CONTEXT.DOCS/underwriting_guidelines_2026.pdf', chunkCount: 96, updatedAt: '2026-01-15 09:00:00',
      chunks: [
        { n: 4, text: 'Personal lines risks are eligible when the applicant has no more than two at-fault losses in three years. Commercial risks above $5 M total insured value require referral to a senior underwriter.' },
        { n: 12, text: 'Catastrophe accumulation: total insured value (TIV) of in-force property policies located in hurricane and wildfire zones must not exceed 40% of total property TIV. New property business in those zones is suspended when the share passes 38%.' },
        { n: 19, text: 'Renewal underwriting starts 60 days before expiry. Retention is measured on policies reaching their renewal date; mid-term cancellations are tracked separately.' },
        { n: 27, text: 'Agency service standard: a complete submission is quoted within 3 business days. Agencies averaging longer are reviewed quarterly with the distribution team.' },
      ],
    },
    {
      id: 'DOC-02', title: 'NAIC statutory reporting — Sentinel Mutual application guide', source: '@SMI_AI_PLATFORM.CONTEXT.DOCS/statutory_reporting_guide_2026.pdf', chunkCount: 74, updatedAt: '2026-02-03 08:00:00',
      chunks: [
        { n: 6, text: 'Loss ratio is incurred losses divided by earned premium, never written premium. Catastrophe losses are identified by the cat-code list: any claim carrying a code from the cat-code list is a catastrophe claim, excluded from the ex-cat loss ratio and reported separately as catastrophe points.' },
        { n: 11, text: 'The combined ratio adds the loss ratio, the loss adjustment expense ratio and the underwriting expense ratio. A combined ratio below 100% indicates an underwriting profit.' },
        { n: 17, text: 'Annual Statement lines group Sentinel products for statutory schedules; incurred losses by accident year support the loss development triangles filed each year.' },
      ],
    },
    {
      id: 'DOC-03', title: 'Loss reserving policy', source: '@SMI_AI_PLATFORM.CONTEXT.DOCS/loss_reserving_policy_v5.pdf', chunkCount: 41, updatedAt: '2026-03-20 10:30:00',
      chunks: [
        { n: 3, text: 'Case reserves are set by the adjuster at first notice of loss and reviewed at least every 30 days. Reserves are reported at each month-end valuation; closed claims carry no case reserve.' },
        { n: 8, text: 'IBNR is set quarterly by the reserving committee as a factor of trailing 12-month earned premium by line, and allocated to open claims in proportion to their case reserve.' },
        { n: 14, text: 'Claimant dates of birth and injury descriptions are protected health information. They may be carried for reserving age bands but must be masked for every role except the data steward.' },
      ],
    },
    {
      id: 'DOC-04', title: 'Claims handling standard', source: '@SMI_AI_PLATFORM.CONTEXT.DOCS/claims_handling_standard_2026.pdf', chunkCount: 58, updatedAt: '2025-12-08 14:00:00',
      chunks: [
        { n: 5, text: 'A claim is open while its status is Open or Reopened and a case reserve remains. Cycle time is measured from first notice of loss to closure.' },
        { n: 9, text: 'Subrogation is pursued on every claim where a third party is liable. Recoveries are credited when received and reported against paid losses on eligible claims.' },
        { n: 13, text: 'Large-loss review: open injury claims with incurred losses above $50,000 are reviewed quarterly by a claims manager and escalated to the reserving committee when reserves change by more than 25%.' },
      ],
    },
  ],
};
