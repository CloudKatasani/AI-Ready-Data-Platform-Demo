import type { ContextLayer, VerifiedQuery } from '../../types';

const DB = 'WCS_AI_PLATFORM';

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

const VQ_CONSTITUENT: VqSpec[] = [
  ['What was the average 311 resolution time last quarter by district?', 'avg_resolution_days', 'office.district', "date.fiscal_quarter = '2026-Q3'"],
  ['How many active constituents do we serve?', 'active_constituents', ''],
  ['How many active constituents are enrolled in more than one program?', 'active_constituents, multi_program_rate', ''],
  ['Active constituents by district', 'active_constituents', 'office.district'],
  ['Show daily 311 service requests for the last 30 days', 'service_requests', 'date.request_date', "date.request_date >= '2026-09-01'"],
  ['Which 311 request types take longest to resolve?', 'avg_resolution_days', 'request.request_type'],
  ['311 on-time resolution rate by department', 'on_time_resolution_rate', 'request.department'],
  ['Constituent satisfaction by district this quarter', 'constituent_satisfaction', 'office.district', "date.fiscal_quarter = '2026-Q3'"],
  ['311 requests by channel year to date', 'service_requests', 'request.channel', "date.request_date >= '2026-01-01'"],
  ['What share of applications are submitted online?', 'digital_self_service_rate', ''],
  ['311 reopen rate by request type', 'reopen_rate', 'request.request_type'],
  ['Active constituents by preferred language', 'active_constituents', 'constituent.preferred_language'],
  ['Monthly 311 volume for 2026', 'service_requests', 'date.fiscal_quarter', "date.request_date >= '2026-01-01'"],
  ['Multi-program enrollment by age group', 'multi_program_rate', 'constituent.age_band'],
];
const VQ_CASE: VqSpec[] = [
  ['How many benefit applications exceed the 30-day processing standard?', 'applications_over_standard, timely_processing_rate', 'program.program_name', "application.decision_date BETWEEN '2026-01-01' AND '2026-09-30'"],
  ['What is the average processing days by program this year?', 'avg_processing_days', 'program.program_name', "application.decision_date >= '2026-01-01'"],
  ['Which five offices have the largest case backlog?', 'case_backlog', 'office.office_name'],
  ['Compare average processing days this year with last year', 'avg_processing_days', 'application.decision_date', "MONTH(application.decision_date) <= 9"],
  ['Timely processing rate by district', 'timely_processing_rate', 'office.district', "application.decision_date >= '2026-01-01'"],
  ['How many applications did we receive last month?', 'applications_received', '', "date.received_date BETWEEN '2026-09-01' AND '2026-09-30'"],
  ['Approval rate by program year to date', 'approval_rate', 'program.program_name', "application.decision_date >= '2026-01-01'"],
  ['What is the average caseload per caseworker by office?', 'avg_caseload', 'office.office_name'],
  ['Case backlog by district', 'case_backlog', 'office.district'],
  ['Open cases by program', 'open_cases', 'program.program_name'],
  ['Applications received by channel', 'applications_received', 'application.channel'],
  ['Processing days by quarter', 'avg_processing_days', 'date.decision_quarter'],
  ['Medical Assistance applications over the standard this quarter', 'applications_over_standard', '', "program.program_name = 'Medical Assistance' AND application.decision_date >= '2026-07-01'"],
  ['Timely processing rate for expedited food assistance', 'timely_processing_rate', '', "program.program_name = 'Food Assistance' AND application.is_expedited"],
];
const VQ_PAYMENTS: VqSpec[] = [
  ['What is the improper payment rate year to date?', 'improper_payment_rate, improper_payment_amount', '', "date.issue_date BETWEEN '2026-01-01' AND '2026-09-30'"],
  ['What is our payment accuracy rate by program this year?', 'payment_accuracy_rate', 'program.program_name', "date.issue_date >= '2026-01-01'"],
  ['Show improper payments over $300 issued last quarter', 'improper_payment_amount', 'payment.payment_id, program.program_name', "date.fiscal_quarter = '2026-Q3' AND payment.improper_amount > 300"],
  ['Total benefits paid by program year to date', 'total_benefits_paid', 'program.program_name', "date.issue_date >= '2026-01-01'"],
  ['On-time payment rate by month', 'on_time_payment_rate', 'date.issue_date'],
  ['Improper payment rate by district', 'improper_payment_rate', 'payment.district'],
  ['Improper payments by error type', 'improper_payment_amount', 'payment.error_type'],
  ['Average benefit payment by program', 'avg_payment_amount', 'program.program_name'],
  ['Payments issued last month', 'payments_issued', '', "date.issue_date BETWEEN '2026-09-01' AND '2026-09-30'"],
  ['Improper payment rate this year versus last year', 'improper_payment_rate', 'date.fiscal_quarter', "MONTH(date.issue_date) <= 9"],
  ['Energy assistance payments by quarter', 'total_benefits_paid', 'date.fiscal_quarter', "program.program_name = 'Energy Assistance'"],
  ['Payment accuracy for cash assistance', 'payment_accuracy_rate', '', "program.program_name = 'Cash Assistance'"],
  ['Improper dollars by program last quarter', 'improper_payment_amount', 'program.program_name', "date.fiscal_quarter = '2026-Q3'"],
];
/** Exactly 7: DP-05 certification gate 4 needs 10 verified queries (spec section 7.6). */
const VQ_INTEGRITY: VqSpec[] = [
  ['Which cases are flagged for program integrity review?', 'cases_flagged', 'payment.district, payment.flag_reason', "payment.flag_status IN ('Open review', 'Referred')"],
  ['What is the integrity flag rate this year?', 'integrity_flag_rate', '', "date.issue_date >= '2026-01-01'"],
  ['Overpayment recovery rate year to date', 'recovery_rate', '', "date.issue_date >= '2026-01-01'"],
  ['Flagged cases by reason', 'cases_flagged', 'payment.flag_reason'],
  ['Overpayments established by program', 'overpayments_established', 'program.program_name'],
  ['Cases flagged for review by district', 'cases_flagged', 'payment.district'],
  ['Recovery rate by program', 'recovery_rate', 'program.program_name'],
];

const verifiedQueries: VerifiedQuery[] = [
  ...vq('SV_CONSTITUENT_360', VQ_CONSTITUENT, 1, ['O. Fitzgerald', 'N. Bergstrom']),
  ...vq('SV_CASE_MANAGEMENT', VQ_CASE, 15, ['K. Yamamoto', 'S. Brandt']),
  ...vq('SV_BENEFIT_PAYMENTS', VQ_PAYMENTS, 29, ['J. Alvarez', 'A. Kowalczyk']),
  ...vq('SV_PROGRAM_INTEGRITY', VQ_INTEGRITY, 42, ['J. Alvarez']),
];

export const CONTEXT: ContextLayer = {
  searchService: 'CS_WCS_DOCS',
  instructions: [
    { id: 'AI-01', agentId: 'AG-01', type: 'persona', version: '1.2', text: 'You are Westland County’s Constituent Services Assistant. You help caseworker analysts and constituent services staff understand who the county serves, program enrollment, renewals and 311 service requests.' },
    { id: 'AI-02', agentId: 'AG-01', type: 'response', version: '1.2', text: 'Name the period and the population (active constituents, closed 311 requests) behind every number. Report days to two decimals and rates to one decimal.' },
    { id: 'AI-03', agentId: 'AG-01', type: 'guardrail', version: '1.2', text: 'Never reveal names, contact details or government identifiers unless the user’s role may see them unmasked. Never answer from a product the user cannot access, and only return rows for the user’s service districts.' },
    { id: 'AI-04', agentId: 'AG-01', type: 'orchestration', version: '1.2', text: 'Use Cortex Analyst on SV_CONSTITUENT_360 for constituents and 311, and on SV_PROGRAM_INTEGRITY for integrity reviews. Use CS_WCS_DOCS for records retention and open-data questions.' },
    { id: 'AI-05', agentId: 'AG-02', type: 'persona', version: '2.1', text: 'You are the Program Analyst for Westland County human services. You answer questions about applications, processing timeliness, case backlog, caseload and program operations.' },
    { id: 'AI-06', agentId: 'AG-02', type: 'response', version: '2.1', text: 'Always count processing days in business days from a complete application, and say so. Report processing days to one decimal and counts scaled to the county total.' },
    { id: 'AI-07', agentId: 'AG-02', type: 'guardrail', version: '2.1', text: 'Flag any answer that uses a product that is not certified. Do not compare individual caseworkers; report at office or district level.' },
    { id: 'AI-08', agentId: 'AG-02', type: 'orchestration', version: '2.1', text: 'Use Cortex Analyst on SV_CASE_MANAGEMENT. Cite the Program eligibility rules manual from CS_WCS_DOCS whenever the processing standard is applied.' },
    { id: 'AI-09', agentId: 'AG-03', type: 'persona', version: '1.0', text: 'You are the Fraud & Integrity Copilot. You help finance officers and integrity staff track benefits paid, payment accuracy and improper payments.' },
    { id: 'AI-10', agentId: 'AG-03', type: 'response', version: '1.0', text: 'Show dollars in millions to one decimal and rates to two decimals for improper payments. Name the period and whether figures are scaled to the county total.' },
    { id: 'AI-11', agentId: 'AG-03', type: 'guardrail', version: '1.0', text: 'Do not label any individual as committing fraud; an integrity flag is a review, not a finding. Never display government identifiers.' },
    { id: 'AI-12', agentId: 'AG-03', type: 'orchestration', version: '1.0', text: 'Use Cortex Analyst on SV_BENEFIT_PAYMENTS. Use the program integrity procedures in CS_WCS_DOCS for definitions of improper payments.' },
    { id: 'AI-13', agentId: 'AG-04', type: 'persona', version: '0.9', text: 'You are the Data Steward Assistant. You help stewards find governance gaps in the glossary, CDE register and product registry.' },
    { id: 'AI-14', agentId: 'AG-04', type: 'response', version: '0.9', text: 'Answer with a table of items and a recommended next action for each.' },
    { id: 'AI-15', agentId: 'AG-04', type: 'guardrail', version: '0.9', text: 'Read metadata only; never query constituent-level data.' },
    { id: 'AI-16', agentId: 'AG-04', type: 'orchestration', version: '0.9', text: 'Use the SQL tool over GLOSSARY, GOVERNANCE and DATA_PRODUCTS.DP_REGISTRY. Read certification state live.' },
  ],
  rules: [
    { id: 'BR-001', domain: 'Constituent', text: 'An Active Constituent has Active status, at least one open program case and a contact in the last 12 months.', metric: 'SV_CONSTITUENT_360.active_constituents', sourceDoc: 'Constituent data standard v2' },
    { id: 'BR-002', domain: 'Constituent', text: 'Multi-program enrollment means two or more open program cases at the same time; Medical Assistance counts as a program.', metric: 'SV_CONSTITUENT_360.multi_program_rate', sourceDoc: 'Constituent data standard v2' },
    { id: 'BR-003', domain: '311', text: '311 resolution time is measured in calendar days from creation to closure; merged duplicates and open requests are excluded.', metric: 'SV_CONSTITUENT_360.avg_resolution_days', sourceDoc: '311 service level standard' },
    { id: 'BR-004', domain: '311', text: 'A 311 request is on time when it is closed within the SLA for its request type (for example 1 day for water leaks, 5 days for potholes).', metric: 'SV_CONSTITUENT_360.on_time_resolution_rate', sourceDoc: '311 service level standard' },
    { id: 'BR-005', domain: '311', text: 'Constituent satisfaction counts survey responses of 4 or 5 on the five-point post-closure survey.', metric: 'SV_CONSTITUENT_360.constituent_satisfaction', sourceDoc: '311 service level standard' },
    { id: 'BR-006', domain: 'Eligibility', text: 'Processing days count business days from a complete application to the eligibility decision; weekends, county holidays and days waiting for the applicant’s documents are excluded.', metric: 'SV_CASE_MANAGEMENT.applications_over_standard', sourceDoc: 'Program eligibility rules manual' },
    { id: 'BR-007', domain: 'Eligibility', text: 'An application exceeds the 30-day processing standard when its processing days are greater than 30. Pending complete applications already older than 30 business days are reported separately; incomplete applications are excluded.', metric: 'SV_CASE_MANAGEMENT.applications_over_standard', sourceDoc: 'Program eligibility rules manual' },
    { id: 'BR-008', domain: 'Case management', text: 'Case backlog counts open cases with an application, renewal or reported change awaiting a caseworker decision at period end.', metric: 'SV_CASE_MANAGEMENT.case_backlog', sourceDoc: 'Case management operating procedures' },
    { id: 'BR-009', domain: 'Case management', text: 'Caseload is open cases divided by filled caseworker positions; vacant positions are not counted.', metric: 'SV_CASE_MANAGEMENT.avg_caseload', sourceDoc: 'Case management operating procedures' },
    { id: 'BR-010', domain: 'Eligibility', text: 'Approval rate excludes withdrawn applications: approved ÷ (approved + denied).', metric: 'SV_CASE_MANAGEMENT.approval_rate', sourceDoc: 'Program eligibility rules manual' },
    { id: 'BR-011', domain: 'Payments', text: 'The improper payment rate is dollar-based and counts both overpayments and underpayments: improper dollars ÷ dollars issued.', metric: 'SV_BENEFIT_PAYMENTS.improper_payment_rate', sourceDoc: 'Program integrity and payment accuracy procedures' },
    { id: 'BR-012', domain: 'Payments', text: 'Payment accuracy is count-based: payments without an improper quality-control finding ÷ payments issued.', metric: 'SV_BENEFIT_PAYMENTS.payment_accuracy_rate', sourceDoc: 'Program integrity and payment accuracy procedures' },
    { id: 'BR-013', domain: 'Payments', text: 'A payment is on time when issued on or before the scheduled issuance date for its benefit month.', metric: 'SV_BENEFIT_PAYMENTS.on_time_payment_rate', sourceDoc: 'Program integrity and payment accuracy procedures' },
    { id: 'BR-014', domain: 'Program integrity', text: 'A case is flagged for review when its integrity flag status is Open review or Referred; Cleared and Overpayment established flags are closed.', metric: 'SV_PROGRAM_INTEGRITY.cases_flagged', sourceDoc: 'Program integrity and payment accuracy procedures' },
    { id: 'BR-015', domain: 'Program integrity', text: 'Recovery rate is amounts recovered ÷ overpayments established on payments issued in the period.', metric: 'SV_PROGRAM_INTEGRITY.recovery_rate', sourceDoc: 'Program integrity and payment accuracy procedures' },
    { id: 'BR-016', domain: 'Finance', text: 'Cost per case is administrative expenditure over the trailing 12 months divided by open cases at period end.', metric: 'DP_WORKFORCE_BUDGET.cost_per_case', sourceDoc: 'Budget office methodology note' },
    { id: 'BR-017', domain: 'Governance', text: 'Constituent case records are retained for 7 years after case closure; government identifiers are shown only to data stewards.', metric: 'SV_CONSTITUENT_360.active_constituents', sourceDoc: 'Records retention schedule' },
    { id: 'BR-018', domain: 'Governance', text: 'Open-data publications may only include aggregates; any cell describing fewer than 11 constituents is suppressed.', metric: 'SV_CONSTITUENT_360.service_requests', sourceDoc: 'Open-data policy' },
  ],
  verifiedQueries,
  synonyms: [
    { term: 'Constituent', synonym: 'resident', scope: 'Constituent' },
    { term: 'Constituent', synonym: 'client', scope: 'Constituent' },
    { term: 'Service District', synonym: 'district', scope: 'Enterprise' },
    { term: 'Service District', synonym: 'service area', scope: 'Enterprise' },
    { term: 'Benefit Application', synonym: 'claim', scope: 'Eligibility' },
    { term: 'Processing Days', synonym: 'processing time', scope: 'Eligibility' },
    { term: 'Processing Days', synonym: 'turnaround', scope: 'Eligibility' },
    { term: 'Case Backlog', synonym: 'backlog', scope: 'Case management' },
    { term: 'Case Backlog', synonym: 'work queue', scope: 'Case management' },
    { term: 'Caseload', synonym: 'workload', scope: 'Case management' },
    { term: 'Improper Payment', synonym: 'payment error', scope: 'Payments' },
    { term: 'Benefit Payment', synonym: 'issuance', scope: 'Payments' },
    { term: 'Benefit Payment', synonym: 'disbursement', scope: 'Payments' },
    { term: 'Integrity Flag', synonym: 'fraud flag', scope: 'Program integrity' },
    { term: 'Integrity Flag', synonym: 'integrity review', scope: 'Program integrity' },
    { term: 'Service Request (311)', synonym: '311 ticket', scope: '311' },
    { term: 'Service Request (311)', synonym: 'service call', scope: '311' },
    { term: 'Constituent Satisfaction', synonym: 'csat', scope: '311' },
    { term: 'Cost per Case', synonym: 'unit cost', scope: 'Finance' },
    { term: 'Caseworker Vacancy Rate', synonym: 'vacancies', scope: 'Finance' },
  ],
  documents: [
    {
      id: 'DOC-01', title: 'Program eligibility rules manual (2026 edition)', source: '@WCS_AI_PLATFORM.CONTEXT.DOCS/eligibility_rules_manual_2026.pdf', chunkCount: 64, updatedAt: '2026-01-08 09:00:00',
      chunks: [
        { n: 4, text: 'Applications may be submitted online, in person at any service center, by phone or by mail. The date of receipt is the date the county first receives a signed application with a name and address.' },
        { n: 12, text: 'Processing days count business days from a complete application to the eligibility decision. An application is complete when every required verification has been received. Weekends, county holidays and days spent waiting for the applicant’s documents do not count. The county processing standard is 30 business days from a complete application; expedited food assistance is decided within 7 business days.' },
        { n: 18, text: 'Approval rate is reported as approvals divided by approvals plus denials. Withdrawn applications are excluded from both the numerator and the denominator.' },
        { n: 26, text: 'Renewals are due every 12 months (6 months for Cash Assistance). A renewal that awaits a caseworker decision counts toward the case backlog.' },
      ],
    },
    {
      id: 'DOC-02', title: 'Records retention schedule — Human Services', source: '@WCS_AI_PLATFORM.CONTEXT.DOCS/records_retention_schedule_hs.pdf', chunkCount: 22, updatedAt: '2025-11-20 14:00:00',
      chunks: [
        { n: 3, text: 'Case files, eligibility determinations and benefit payment records are retained for seven years after case closure, then destroyed under a certified destruction log.' },
        { n: 7, text: 'Government identifiers collected at intake are classified GOV_ID. They may be stored only in governed tables and must be masked for every role except the data steward.' },
        { n: 11, text: '311 service request records are retained for three years; anonymous requests carry no personal data and may be retained in aggregate indefinitely.' },
      ],
    },
    {
      id: 'DOC-03', title: 'Open-data policy', source: '@WCS_AI_PLATFORM.CONTEXT.DOCS/open_data_policy_v3.pdf', chunkCount: 18, updatedAt: '2026-02-14 10:30:00',
      chunks: [
        { n: 2, text: 'The county publishes 311 request volumes, resolution times and service levels monthly on the open-data portal at district level.' },
        { n: 6, text: 'Published tables contain aggregates only. Any cell that describes fewer than 11 constituents is suppressed, and no names, addresses or identifiers are ever published.' },
        { n: 9, text: 'Program statistics such as caseload, applications received and processing timeliness are published quarterly after steward review.' },
      ],
    },
    {
      id: 'DOC-04', title: 'Program integrity and payment accuracy procedures', source: '@WCS_AI_PLATFORM.CONTEXT.DOCS/program_integrity_procedures_2026.pdf', chunkCount: 31, updatedAt: '2026-04-02 11:15:00',
      chunks: [
        { n: 5, text: 'An improper payment is any payment that should not have been made or was made in an incorrect amount. Overpayments and underpayments both count toward the improper payment rate, which is measured in dollars.' },
        { n: 9, text: 'Payment accuracy is the share of sampled payments with no quality-control finding. The county target is 96% accuracy and an improper payment rate below 3%.' },
        { n: 14, text: 'Data matches (income, employment, address and duplicate participation) raise an integrity flag. A flagged case is placed in open review and may be referred for investigation; a flag is a review, not a finding of fraud.' },
      ],
    },
  ],
};
