import type { ContextLayer, VerifiedQuery } from '../../types';

const DB = 'CVH_AI_PLATFORM';

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

const VQ_PATIENT_REVENUE: VqSpec[] = [
  ['What was the claim denial rate last quarter by payer?', 'denial_rate', 'payer.payer_name', "claim.submit_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['How many active patients do we have?', 'active_patients', ''],
  ['How many active patients are self-pay?', 'active_patients, self_pay_share', 'patient.payer_class'],
  ['What is our days in A/R?', 'days_in_ar', ''],
  ['What is the clean claim rate this month?', 'clean_claim_rate', '', "claim.submit_month = '2026-09-01'"],
  ['Which patients have an open balance over $5,000 older than 90 days?', 'open_ar_balance', 'patient.mrn, patient.patient_name, patient.market', 'claim.days_outstanding > 90'],
  ['Show daily claim submissions for the last 30 days', 'claims_submitted, clean_claim_rate', 'claim.submit_date', "claim.submit_date >= '2026-09-01'"],
  ['What share of A/R is older than 90 days?', 'ar_over_90_pct', ''],
  ['Net collection rate by payer class', 'net_collection_rate', 'patient.payer_class'],
  ['Top denial reasons last quarter', 'denial_rate, claims_submitted', 'claim.denial_reason', "claim.submit_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['Patient portal adoption by market', 'portal_adoption_rate', 'patient.market'],
  ['Open A/R balance by market', 'open_ar_balance', 'patient.market'],
  ['Denial rate for inpatient claims by month', 'denial_rate', 'claim.submit_month', "claim.encounter_type = 'IP'"],
  ['Average risk score of active patients by payer class', 'avg_risk_score', 'patient.payer_class'],
];
const VQ_THROUGHPUT: VqSpec[] = [
  ['Compare average length of stay this year with last year', 'avg_length_of_stay', 'date.fiscal_year, facility.market', 'MONTH(date.encounter_date) <= 9'],
  ['Which five hospitals had the highest bed occupancy last quarter?', 'bed_occupancy_pct', 'facility.facility_name', "date.fiscal_quarter = '2026-Q3'"],
  ['What is our average ED wait time this month?', 'ed_wait_minutes, lwbs_rate', '', "date.encounter_date >= '2026-09-01'"],
  ['Which clinics have a no-show rate above 15%?', 'no_show_rate', 'clinic.clinic_name', 'no_show_rate > 15'],
  ['Average length of stay by service line', 'avg_length_of_stay', 'encounter.service_line'],
  ['ED wait time by hospital last month', 'ed_wait_minutes', 'facility.facility_name', "date.encounter_date >= '2026-09-01'"],
  ['Left without being seen rate by market', 'lwbs_rate', 'facility.market'],
  ['Inpatient discharges by month', 'inpatient_discharges', 'date.encounter_month'],
  ['Bed occupancy by market this quarter', 'bed_occupancy_pct', 'facility.market', "date.fiscal_quarter = '2026-Q3'"],
  ['No-show rate by specialty', 'no_show_rate', 'clinic.specialty'],
  ['New patient appointment lag by specialty', 'new_patient_lag_days', 'clinic.specialty'],
  ['Average length of stay at Crestview Regional Medical Center', 'avg_length_of_stay', '', "facility.facility_code = 'RMC'"],
  ['ED visits by hour of arrival', 'lwbs_rate', 'encounter.arrival_hour'],
  ['How many inpatients were discharged in Q3?', 'inpatient_discharges', '', "date.fiscal_quarter = '2026-Q3'"],
];
const VQ_QUALITY: VqSpec[] = [
  ['What is our 30-day all-cause readmission rate by service line?', 'readmission_rate_30d', 'readmit.service_line', "date.discharge_date BETWEEN '2026-01-01' AND '2026-08-31'"],
  ['Readmission rate by hospital this year', 'readmission_rate_30d', 'facility.facility_name', "date.discharge_date BETWEEN '2026-01-01' AND '2026-08-31'"],
  ['Compare readmission rate this year with last year', 'readmission_rate_30d', 'date.fiscal_year', 'MONTH(date.discharge_date) <= 8'],
  ['What share of discharged patients had a follow-up visit within 7 days?', 'followup_7d_rate', '', "date.discharge_date BETWEEN '2026-07-01' AND '2026-09-23'"],
  ['7-day follow-up rate by market', 'followup_7d_rate', 'facility.market'],
  ['Readmission rate by payer class', 'readmission_rate_30d', 'patient.payer_class'],
  ['Inpatient mortality rate by service line', 'inpatient_mortality_rate', 'readmit.service_line'],
  ['How many readmissions were there this year?', 'readmissions_30d, index_discharges', '', "date.discharge_date >= '2026-01-01'"],
  ['Readmission rate for patients discharged to skilled nursing', 'readmission_rate_30d', '', "readmit.discharge_disposition = 'Skilled nursing'"],
  ['Readmission rate by quarter', 'readmission_rate_30d', 'date.fiscal_quarter'],
  ['Heart failure and cardiology readmissions by hospital', 'readmissions_30d', 'facility.facility_name', "readmit.service_line = 'Cardiology'"],
  ['Follow-up rate by payer class', 'followup_7d_rate', 'patient.payer_class'],
  ['Index discharges by market this year', 'index_discharges', 'facility.market', "date.discharge_date >= '2026-01-01'"],
];
/** Exactly 7: DP-05 certification gate 4 needs 10 verified queries (spec section 7.6). */
const VQ_SUPPLY: VqSpec[] = [
  ['What is our supply cost per surgical case this quarter?', 'supply_cost_per_case', '', "date.fiscal_quarter = '2026-Q3'"],
  ['Supply cost per case by service line', 'supply_cost_per_case', 'encounter.service_line'],
  ['On-contract supply spend by category', 'on_contract_pct', 'usage.category'],
  ['Total supply spend by vendor this quarter', 'supply_spend', 'usage.vendor', "date.fiscal_quarter = '2026-Q3'"],
  ['Pharmacy spend by market', 'pharmacy_spend', 'facility.market'],
  ['How many surgical cases had supply capture last quarter?', 'surgical_cases', '', "date.fiscal_quarter = '2026-Q3'"],
  ['Implant spend trend by quarter', 'supply_spend', 'date.fiscal_quarter', "usage.category = 'Implants'"],
];

const verifiedQueries: VerifiedQuery[] = [
  ...vq('SV_PATIENT_REVENUE', VQ_PATIENT_REVENUE, 1, ['S. Farouk', 'K. Kilbride']),
  ...vq('SV_THROUGHPUT', VQ_THROUGHPUT, 15, ['O. Pritchard', 'M. Arriaga']),
  ...vq('SV_QUALITY', VQ_QUALITY, 29, ['J. Holloway', 'Dr. R. Valcourt']),
  ...vq('SV_SUPPLY_CHAIN', VQ_SUPPLY, 42, ['T. Quarshie']),
];

export const CONTEXT: ContextLayer = {
  searchService: 'CS_CVH_DOCS',
  instructions: [
    { id: 'AI-01', agentId: 'AG-01', type: 'persona', version: '1.4', text: 'You are Crestview’s Revenue Cycle Copilot. You help revenue cycle analysts understand patient accounts, claims, denials, receivables and supply cost per case.' },
    { id: 'AI-02', agentId: 'AG-01', type: 'response', version: '1.4', text: 'Report rates to one decimal, currency to the dollar and days to one decimal. Always name the period and whether it is by submission or service date.' },
    { id: 'AI-03', agentId: 'AG-01', type: 'guardrail', version: '1.4', text: 'Apply HIPAA minimum necessary: never reveal patient names, MRNs or dates of birth unless the user’s role may see unmasked PHI. Prefer aggregates; never answer from a product the user cannot access.' },
    { id: 'AI-04', agentId: 'AG-01', type: 'orchestration', version: '1.4', text: 'Use Cortex Analyst on SV_PATIENT_REVENUE for patient and claims metrics and on SV_SUPPLY_CHAIN for supply cost per case. Use CS_CVH_DOCS for revenue cycle definitions.' },
    { id: 'AI-05', agentId: 'AG-02', type: 'persona', version: '2.1', text: 'You are the Clinical Quality Analyst for Crestview’s hospitals. You answer questions about readmissions, length of stay, occupancy and care gaps.' },
    { id: 'AI-06', agentId: 'AG-02', type: 'response', version: '2.1', text: 'Report readmission rates with the CMS method (planned readmissions and transfers excluded) and only for periods whose 30-day window has closed. Rates to one decimal; name the index discharge window.' },
    { id: 'AI-07', agentId: 'AG-02', type: 'guardrail', version: '2.1', text: 'Flag any answer that uses a product that is not certified. Do not attribute readmissions to individual clinicians; report at service line, hospital or market level.' },
    { id: 'AI-08', agentId: 'AG-02', type: 'orchestration', version: '2.1', text: 'Use Cortex Analyst on SV_QUALITY and SV_THROUGHPUT. Cite the readmission measure definitions from CS_CVH_DOCS whenever planned readmissions or transfers are excluded.' },
    { id: 'AI-09', agentId: 'AG-03', type: 'persona', version: '1.2', text: 'You are the Patient Access Assistant. You help leaders track timely access: ED waits, clinic no-shows, appointment lag and follow-up after discharge.' },
    { id: 'AI-10', agentId: 'AG-03', type: 'response', version: '1.2', text: 'Give minutes and days to one decimal and rates to one decimal. Name the period and say which visits are excluded.' },
    { id: 'AI-11', agentId: 'AG-03', type: 'guardrail', version: '1.2', text: 'Report at clinic, hospital or market level; never list individual patients.' },
    { id: 'AI-12', agentId: 'AG-03', type: 'orchestration', version: '1.2', text: 'Use Cortex Analyst on SV_THROUGHPUT for ED and clinic access and on SV_QUALITY for post-discharge follow-up. Use the CMS measure specifications in CS_CVH_DOCS for follow-up definitions.' },
    { id: 'AI-13', agentId: 'AG-04', type: 'persona', version: '0.9', text: 'You are the Data Steward Assistant. You help stewards find governance gaps in the glossary, CDE register and product registry.' },
    { id: 'AI-14', agentId: 'AG-04', type: 'response', version: '0.9', text: 'Answer with a table of items and a recommended next action for each.' },
    { id: 'AI-15', agentId: 'AG-04', type: 'guardrail', version: '0.9', text: 'Read metadata only; never query patient-level data.' },
    { id: 'AI-16', agentId: 'AG-04', type: 'orchestration', version: '0.9', text: 'Use the SQL tool over GLOSSARY, GOVERNANCE and DATA_PRODUCTS.DP_REGISTRY. Read certification state live.' },
  ],
  rules: [
    { id: 'BR-001', domain: 'Patient access', text: 'An Active Patient is alive and has at least one completed encounter (inpatient discharge, ED visit or completed clinic appointment) in the last 12 months.', metric: 'SV_PATIENT_REVENUE.active_patients', sourceDoc: 'Patient access data standard v2' },
    { id: 'BR-002', domain: 'Revenue cycle', text: 'Payer class follows the primary coverage on the current registration: Medicare Advantage counts as Medicare, managed Medicaid as Medicaid, and Self-pay means no active coverage.', metric: 'SV_PATIENT_REVENUE.self_pay_share', sourceDoc: 'Revenue cycle KPI handbook' },
    { id: 'BR-003', domain: 'Revenue cycle', text: 'Denial rate counts initial denials over claims submitted in the period, by submission date; successful appeals do not reverse an initial denial.', metric: 'SV_PATIENT_REVENUE.denial_rate', sourceDoc: 'Revenue cycle KPI handbook' },
    { id: 'BR-004', domain: 'Revenue cycle', text: 'A clean claim passes every front-end edit and is accepted on first submission with no manual touch.', metric: 'SV_PATIENT_REVENUE.clean_claim_rate', sourceDoc: 'Revenue cycle KPI handbook' },
    { id: 'BR-005', domain: 'Revenue cycle', text: 'Days in A/R is open A/R at period end divided by average daily expected net revenue over the last 90 days.', metric: 'SV_PATIENT_REVENUE.days_in_ar', sourceDoc: 'Revenue cycle KPI handbook' },
    { id: 'BR-006', domain: 'Revenue cycle', text: 'A/R aging is measured from the service (discharge) date; the over-90 bucket includes open balances older than 90 days.', metric: 'SV_PATIENT_REVENUE.ar_over_90_pct', sourceDoc: 'Revenue cycle KPI handbook' },
    { id: 'BR-007', domain: 'Revenue cycle', text: 'Net collection rate is payments over expected net reimbursement on resolved claims; contractual adjustments are excluded from both.', metric: 'SV_PATIENT_REVENUE.net_collection_rate', sourceDoc: 'Revenue cycle KPI handbook' },
    { id: 'BR-008', domain: 'Hospital operations', text: 'Length of stay counts midnights from admission to discharge with a minimum of one day; observation stays are excluded and ALOS is reported by discharge date.', metric: 'SV_THROUGHPUT.avg_length_of_stay', sourceDoc: 'Hospital operations standard' },
    { id: 'BR-009', domain: 'Hospital operations', text: 'Bed occupancy is midnight census nights divided by staffed beds times days in the period.', metric: 'SV_THROUGHPUT.bed_occupancy_pct', sourceDoc: 'Hospital operations standard' },
    { id: 'BR-010', domain: 'Hospital operations', text: 'ED wait time is door-to-provider minutes; visits that left without being seen are excluded from the wait and reported as the LWBS rate.', metric: 'SV_THROUGHPUT.ed_wait_minutes', sourceDoc: 'Hospital operations standard' },
    { id: 'BR-011', domain: 'Patient access', text: 'No-show rate is no-shows over completed plus no-show appointments; cancellations more than 24 hours ahead are excluded.', metric: 'SV_THROUGHPUT.no_show_rate', sourceDoc: 'Patient access data standard v2' },
    { id: 'BR-012', domain: 'Quality & safety', text: 'Planned readmissions and transfers excluded (CMS method): a 30-day readmission is an unplanned admission within 30 days of an eligible index discharge; planned readmissions are not counted, and index stays ending in transfer to another acute hospital, death or discharge against medical advice are excluded.', metric: 'SV_QUALITY.readmission_rate_30d', sourceDoc: 'Readmission measure definitions (CMS method)' },
    { id: 'BR-013', domain: 'Quality & safety', text: 'Readmission rates are reported by index discharge date and only for discharges whose 30-day window has closed (through 31 Aug 2026 at the 30 Sep 2026 as-of date).', metric: 'SV_QUALITY.readmission_rate_30d', sourceDoc: 'Readmission measure definitions (CMS method)' },
    { id: 'BR-014', domain: 'Quality & safety', text: '7-day follow-up counts discharges to home or home health with a completed clinic visit on day 1 to 7 after discharge.', metric: 'SV_QUALITY.followup_7d_rate', sourceDoc: 'CMS quality measure specifications' },
    { id: 'BR-015', domain: 'Supply chain', text: 'Supply cost per surgical case includes med-surg supplies and implants captured at point of use, excludes pharmacy, and divides by surgical cases discharged in the period.', metric: 'SV_SUPPLY_CHAIN.supply_cost_per_case', sourceDoc: 'Clinical supply chain policy' },
    { id: 'BR-016', domain: 'Supply chain', text: 'Spend is on contract when the item was bought under an active GPO or local agreement on the usage date.', metric: 'SV_SUPPLY_CHAIN.on_contract_pct', sourceDoc: 'Clinical supply chain policy' },
    { id: 'BR-017', domain: 'Privacy', text: 'HIPAA minimum necessary: agents return identifiable patient data (name, MRN, date of birth) only to roles permitted to see unmasked PHI, and prefer aggregate answers.', metric: 'SV_PATIENT_REVENUE.open_ar_balance', sourceDoc: 'HIPAA minimum necessary policy' },
    { id: 'BR-018', domain: 'Population health', text: 'A care gap is open when an attributed patient is eligible for a measure and the numerator is not met in the measurement year; closure rate is closed gaps over eligible gaps.', metric: 'DP_CARE_GAPS.care_gap_closure_rate', sourceDoc: 'CMS quality measure specifications' },
  ],
  verifiedQueries,
  synonyms: [
    { term: '30-Day Readmission', synonym: 'bounce back', scope: 'Quality & safety' },
    { term: '30-Day Readmission', synonym: 'readmit', scope: 'Quality & safety' },
    { term: 'Length of Stay', synonym: 'LOS', scope: 'Hospital operations' },
    { term: 'Length of Stay', synonym: 'ALOS', scope: 'Hospital operations' },
    { term: 'Emergency Department', synonym: 'ED', scope: 'Hospital operations' },
    { term: 'Emergency Department', synonym: 'ER', scope: 'Hospital operations' },
    { term: 'Emergency Department', synonym: 'emergency room', scope: 'Hospital operations' },
    { term: 'Days in A/R', synonym: 'AR days', scope: 'Revenue cycle' },
    { term: 'Days in A/R', synonym: 'DAR', scope: 'Revenue cycle' },
    { term: 'Claim Denial', synonym: 'denied claims', scope: 'Revenue cycle' },
    { term: 'Payer', synonym: 'insurer', scope: 'Revenue cycle' },
    { term: 'Payer', synonym: 'health plan', scope: 'Revenue cycle' },
    { term: 'Hospital Market', synonym: 'region', scope: 'Enterprise' },
    { term: 'No-Show', synonym: 'missed appointment', scope: 'Patient access' },
    { term: 'Service Line', synonym: 'clinical service', scope: 'Hospital operations' },
    { term: 'Payer Class', synonym: 'uninsured', scope: 'Revenue cycle' },
    { term: 'Care Gap', synonym: 'gap in care', scope: 'Population health' },
    { term: 'Supply Cost per Case', synonym: 'cost per case', scope: 'Supply chain' },
    { term: 'Bed Occupancy', synonym: 'census', scope: 'Hospital operations' },
    { term: 'Clean Claim', synonym: 'first pass yield', scope: 'Revenue cycle' },
    { term: 'Post-Discharge Follow-Up', synonym: 'TCM visit', scope: 'Quality & safety' },
    { term: 'Hospital', synonym: 'facility', scope: 'Enterprise' },
  ],
  documents: [
    {
      id: 'DOC-01', title: 'Readmission measure definitions — Crestview application of the CMS method', source: '@CVH_AI_PLATFORM.CONTEXT.DOCS/readmission_definitions_2026.pdf', chunkCount: 38, updatedAt: '2026-02-09 09:00:00',
      chunks: [
        { n: 4, text: 'The 30-day all-cause readmission measure counts unplanned inpatient admissions to any Crestview hospital within 30 days of discharge from an eligible index stay, regardless of diagnosis. The rate is readmitted index stays divided by eligible index stays.' },
        { n: 11, text: 'Planned readmission and transfers are excluded, following the CMS method. A planned readmission identified by the CMS planned readmission algorithm (for example scheduled chemotherapy or a staged procedure) is not counted. Index stays ending in a transfer to another acute care hospital, in death, or in discharge against medical advice are excluded from the denominator.' },
        { n: 18, text: 'Readmission is attributed to the hospital and service line of the index stay. Each index stay can have at most one counted readmission; the readmission stay can itself be a new index stay.' },
        { n: 23, text: 'Rates are reported by index discharge date and only once the 30-day window has closed. At a month-end close, the latest reportable discharges are those at least 30 days before the as-of date.' },
      ],
    },
    {
      id: 'DOC-02', title: 'HIPAA minimum necessary policy', source: '@CVH_AI_PLATFORM.CONTEXT.DOCS/hipaa_minimum_necessary_v5.pdf', chunkCount: 21, updatedAt: '2026-01-15 08:00:00',
      chunks: [
        { n: 2, text: 'Workforce members, systems and AI agents may use or disclose only the minimum necessary protected health information (PHI) to accomplish the intended purpose. Aggregate or de-identified data is preferred for operational reporting.' },
        { n: 6, text: 'Patient names, medical record numbers, dates of birth, addresses, email addresses and ZIP codes are PHI and are masked for every role except data stewards and roles approved for treatment or payment operations.' },
        { n: 9, text: 'Access is limited by role and by hospital market. Requests for broader access are submitted through the Internal Marketplace with a documented business purpose and an expiry.' },
      ],
    },
    {
      id: 'DOC-03', title: 'CMS quality measure specifications — Crestview reference', source: '@CVH_AI_PLATFORM.CONTEXT.DOCS/cms_measure_specs_2026.pdf', chunkCount: 64, updatedAt: '2026-03-02 10:30:00',
      chunks: [
        { n: 7, text: 'Transitional care: a follow-up visit with a primary care or specialty clinician within 7 days of discharge to home or home health reduces the risk of readmission. The 7-day follow-up rate counts completed visits on day 1 to 7 after discharge.' },
        { n: 15, text: 'Care gap measures include breast cancer screening (women 50–74), colorectal cancer screening (45–75), HbA1c control below 8% for patients with diabetes, statin therapy for cardiovascular disease, controlling high blood pressure and the annual wellness visit for patients 65 and over.' },
        { n: 22, text: 'A gap is open when the patient is in the measure denominator and the numerator has not been met in the measurement year. Gap closure rate is closed gaps divided by eligible gaps.' },
      ],
    },
    {
      id: 'DOC-04', title: 'Revenue cycle KPI handbook', source: '@CVH_AI_PLATFORM.CONTEXT.DOCS/revenue_cycle_kpi_handbook_v3.pdf', chunkCount: 29, updatedAt: '2026-04-20 14:00:00',
      chunks: [
        { n: 3, text: 'Initial denial rate is the number of claims denied on first adjudication divided by claims submitted in the period. Denials are grouped by claim adjustment reason code: authorization, eligibility, coding, medical necessity, missing information, timely filing and duplicate.' },
        { n: 8, text: 'A clean claim passes all clearinghouse and payer front-end edits on first submission. The clean claim rate target is 90% or higher.' },
        { n: 12, text: 'Days in A/R equals open accounts receivable divided by average daily net patient revenue over the trailing 90 days. A/R older than 90 days from the service date should stay below 20% of total A/R.' },
      ],
    },
  ],
};
