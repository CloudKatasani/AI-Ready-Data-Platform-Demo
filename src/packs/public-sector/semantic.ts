// Semantic views for Westland County Services (spec sections 5 and 7.3).
import type { Row, SemanticView } from '../../types';
import { quarterOf, sum } from '../../mock-snowflake/generators';
import { memo } from '../shared/catalog-kit';
import type { PsData } from './data';
import { PERIODS, programName, STANDARD_DAYS } from './queries';

const n = (r: Row, k: string) => Number(r[k] ?? 0);
const share = (rs: Row[], f: (r: Row) => boolean) => (rs.filter(f).length / Math.max(1, rs.length)) * 100;

export function buildSemanticViews(d: PsData, vqIds: (sv: string) => string[]): SemanticView[] {
  // ---- SV_CONSTITUENT_360: constituents and 311 (DP-01, DP-04)
  const srRows = memo(() => d.requests.map((s) => ({
    district: s.district, request_type: s.type, channel: s.channel, quarter: quarterOf(s.created), date: s.created,
    closed: s.resolutionDays !== null, days: s.resolutionDays ?? 0, on_time: Boolean(s.onTime), reopened: s.reopened, survey: s.survey ?? 0,
  })));
  const constituent360: SemanticView = {
    name: 'SV_CONSTITUENT_360',
    description: 'Constituents, program enrollment and 311 service requests for constituent services',
    tables: [
      { alias: 'constituent', fqn: 'CONFORMED_GOLD.DIM_CONSTITUENT', pk: 'CONSTITUENT_KEY' },
      { alias: 'office', fqn: 'CONFORMED_GOLD.DIM_OFFICE', pk: 'OFFICE_KEY' },
      { alias: 'request', fqn: 'CONFORMED_GOLD.FCT_SERVICE_REQUEST', pk: 'SR_KEY' },
      { alias: 'cases', fqn: 'CONFORMED_GOLD.FCT_CASE', pk: 'CASE_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'constituent', to: 'office', on: 'OFFICE_KEY' },
      { from: 'cases', to: 'constituent', on: 'CONSTITUENT_KEY' },
      { from: 'request', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'request.resolution_days', expr: 'request.RESOLUTION_DAYS', description: 'Days from creation to closure' },
      { name: 'request.survey_score', expr: 'request.SURVEY_SCORE', description: 'Post-closure survey score (1–5)' },
      { name: 'cases.open_case', expr: "IFF(cases.CASE_STATUS = 'Open', 1, 0)", description: 'Open program case indicator' },
    ],
    dimensions: [
      { name: 'office.district', expr: 'office.DISTRICT', synonyms: ['district', 'service district', 'area', 'region'], description: 'Service district' },
      { name: 'office.office_name', expr: 'office.OFFICE_NAME', synonyms: ['office', 'service center'], description: 'Service office' },
      { name: 'constituent.age_band', expr: 'constituent.AGE_BAND', synonyms: ['age group'] },
      { name: 'constituent.preferred_language', expr: 'constituent.PREFERRED_LANGUAGE', synonyms: ['language'] },
      { name: 'request.request_type', expr: 'request.REQUEST_TYPE', synonyms: ['311 type', 'request category', 'issue type'] },
      { name: 'request.channel', expr: 'request.CHANNEL', synonyms: ['intake channel', 'source'] },
      { name: 'request.department', expr: 'request.DEPARTMENT', synonyms: ['agency', 'responsible department'] },
    ],
    timeDimensions: [
      { name: 'date.request_date', expr: 'date.CALENDAR_DATE', description: '311 request created date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter (FY = calendar year)' },
    ],
    metrics: [
      { name: 'active_constituents', expr: "COUNT(DISTINCT IFF(constituent.status = 'Active' AND cases.open_case = 1 AND constituent.last_contact_date > CURRENT_DATE - 365, constituent.constituent_key, NULL))", description: 'Constituents with Active status, an open program case and a contact in the last 12 months', synonyms: ['active clients', 'people served', 'constituent count'], termId: 'T-002', unit: 'constituents' },
      { name: 'multi_program_rate', expr: 'AVG(IFF(constituent.programs_enrolled >= 2, 1, 0)) * 100', description: 'Share of active constituents enrolled in two or more programs', synonyms: ['multi-program enrollment', 'more than one program'], termId: 'T-027', unit: '%' },
      { name: 'service_requests', expr: 'COUNT(request.sr_key)', description: '311 service requests created', synonyms: ['311 requests', '311 volume', 'requests'], termId: 'T-017', unit: 'requests' },
      { name: 'avg_resolution_days', expr: 'AVG(request.resolution_days)', description: 'Average days from 311 request creation to closure', synonyms: ['311 resolution time', 'time to close', 'turnaround'], termId: 'T-018', unit: 'days' },
      { name: 'on_time_resolution_rate', expr: 'AVG(IFF(request.within_sla, 1, 0)) * 100', description: 'Share of closed 311 requests resolved within the type SLA', synonyms: ['311 on time', 'sla compliance'], termId: 'T-018', unit: '%' },
      { name: 'reopen_rate', expr: 'AVG(IFF(request.reopened, 1, 0)) * 100', description: 'Share of closed 311 requests reopened', synonyms: ['reopened requests'], termId: 'T-017', unit: '%' },
      { name: 'constituent_satisfaction', expr: 'AVG(IFF(request.survey_score >= 4, 1, 0)) * 100', description: 'Share of 311 survey responses scoring 4 or 5', synonyms: ['csat', 'satisfaction', 'resident satisfaction'], termId: 'T-019', unit: '%' },
      { name: 'digital_self_service_rate', expr: "AVG(IFF(application.channel = 'Online', 1, 0)) * 100", description: 'Share of benefit applications submitted online', synonyms: ['online applications', 'digital channel share'], termId: 'T-025', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_CONSTITUENT_360'),
    productIds: ['DP-01', 'DP-04'],
    playground: {
      from: 'SEMANTIC.SV_CONSTITUENT_360',
      rows: srRows,
      dimensions: [
        { name: 'office.district', column: 'district' },
        { name: 'request.request_type', column: 'request_type' },
        { name: 'request.channel', column: 'channel' },
      ],
      filters: [
        { label: 'Q3 2026 (Jul–Sep)', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
        { label: 'Last 30 days', sql: `date.request_date >= '${PERIODS.last30.from}'`, test: (r) => String(r.date) >= PERIODS.last30.from },
        { label: 'Year to date', sql: "date.request_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => String(r.date) >= '2026-01-01' },
      ],
      metrics: [
        { name: 'avg_resolution_days', unit: 'days', decimals: 2, sqlExpr: 'avg_resolution_days', agg: (rs) => { const c = rs.filter((r) => r.closed); return sum(c.map((r) => n(r, 'days'))) / Math.max(1, c.length); } },
        { name: 'on_time_resolution_rate', unit: '%', decimals: 1, sqlExpr: 'on_time_resolution_rate', agg: (rs) => share(rs.filter((r) => r.closed), (r) => Boolean(r.on_time)) },
        { name: 'service_requests', unit: '', decimals: 0, sqlExpr: 'service_requests', agg: (rs) => Math.round(rs.length * d.srScale) },
        { name: 'constituent_satisfaction', unit: '%', decimals: 1, sqlExpr: 'constituent_satisfaction', agg: (rs) => share(rs.filter((r) => n(r, 'survey') > 0), (r) => n(r, 'survey') >= 4) },
        { name: 'reopen_rate', unit: '%', decimals: 1, sqlExpr: 'reopen_rate', agg: (rs) => share(rs.filter((r) => r.closed), (r) => Boolean(r.reopened)) },
      ],
    },
  };

  // ---- SV_CASE_MANAGEMENT: applications, processing days and caseload (DP-02)
  const appRows = memo(() => d.applications
    .filter((a) => a.decision && (a.outcome === 'Approved' || a.outcome === 'Denied'))
    .map((a) => ({ program: programName(a.program), district: a.district, decision_quarter: quarterOf(a.decision!), decided: a.decision!, days: a.bizDays!, over: a.bizDays! > STANDARD_DAYS, approved: a.outcome === 'Approved' })));
  const caseMgmt: SemanticView = {
    name: 'SV_CASE_MANAGEMENT',
    description: 'Benefit applications, processing days against the 30-day standard, case backlog and caseload',
    tables: [
      { alias: 'application', fqn: 'CONFORMED_GOLD.FCT_APPLICATION', pk: 'APPLICATION_KEY' },
      { alias: 'cases', fqn: 'CONFORMED_GOLD.FCT_CASE', pk: 'CASE_KEY' },
      { alias: 'program', fqn: 'CONFORMED_GOLD.DIM_PROGRAM', pk: 'PROGRAM_KEY' },
      { alias: 'office', fqn: 'CONFORMED_GOLD.DIM_OFFICE', pk: 'OFFICE_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'application', to: 'program', on: 'PROGRAM_KEY' },
      { from: 'application', to: 'office', on: 'OFFICE_KEY' },
      { from: 'application', to: 'date', on: 'DATE_KEY' },
      { from: 'cases', to: 'program', on: 'PROGRAM_KEY' },
      { from: 'cases', to: 'office', on: 'OFFICE_KEY' },
    ],
    facts: [
      { name: 'application.processing_business_days', expr: 'application.PROCESSING_BUSINESS_DAYS', description: 'Business days from a complete application to the decision' },
      { name: 'application.within_standard', expr: 'application.WITHIN_STANDARD', description: 'Decided within 30 business days' },
      { name: 'cases.pending_action', expr: 'cases.PENDING_ACTION', description: 'Action awaiting a caseworker decision' },
      { name: 'office.caseworkers', expr: 'office.CASEWORKERS', description: 'Filled caseworker positions' },
    ],
    dimensions: [
      { name: 'program.program_name', expr: 'program.PROGRAM_NAME', synonyms: ['program', 'benefit', 'benefit program'], description: 'Benefit program' },
      { name: 'office.district', expr: 'office.DISTRICT', synonyms: ['district', 'service district', 'area'], description: 'Service district' },
      { name: 'office.office_name', expr: 'office.OFFICE_NAME', synonyms: ['office', 'service center', 'unit'], description: 'Service office' },
      { name: 'application.channel', expr: 'application.CHANNEL', synonyms: ['submission channel', 'how applied'] },
      { name: 'application.decision', expr: 'application.DECISION', synonyms: ['outcome', 'determination'] },
    ],
    timeDimensions: [
      { name: 'date.received_date', expr: 'date.CALENDAR_DATE', description: 'Application received date' },
      { name: 'application.decision_date', expr: 'application.DECISION_DATE', description: 'Eligibility decision date' },
      { name: 'date.decision_quarter', expr: "DATE_TRUNC('quarter', application.DECISION_DATE)", description: 'Quarter of the decision' },
    ],
    metrics: [
      { name: 'applications_over_standard', expr: 'COUNT_IF(application.processing_business_days > 30)', description: 'Decided applications that took more than 30 business days from a complete application', synonyms: ['late applications', 'over the 30-day standard', 'untimely applications'], termId: 'T-009', unit: 'applications' },
      { name: 'avg_processing_days', expr: 'AVG(application.processing_business_days)', description: 'Average business days from a complete application to the eligibility decision', synonyms: ['processing time', 'days to decide', 'turnaround'], termId: 'T-009', unit: 'business days' },
      { name: 'timely_processing_rate', expr: 'AVG(IFF(application.within_standard, 1, 0)) * 100', description: 'Share of decided applications processed within 30 business days', synonyms: ['timeliness', 'on-time processing'], termId: 'T-010', unit: '%' },
      { name: 'approval_rate', expr: "COUNT_IF(application.decision = 'Approved') / COUNT_IF(application.decision IN ('Approved', 'Denied')) * 100", description: 'Approved applications as a share of approvals and denials', synonyms: ['approval share', 'grant rate'], termId: 'T-011', unit: '%' },
      { name: 'applications_received', expr: 'COUNT(application.application_key)', description: 'Benefit applications received', synonyms: ['applications', 'new applications', 'intake'], termId: 'T-007', unit: 'applications' },
      { name: 'case_backlog', expr: "COUNT_IF(cases.case_status = 'Open' AND cases.pending_action <> 'NONE')", description: 'Open cases with an application, renewal or change awaiting a caseworker decision', synonyms: ['backlog', 'pending work', 'work in queue'], termId: 'T-006', unit: 'cases' },
      { name: 'open_cases', expr: "COUNT_IF(cases.case_status = 'Open')", description: 'Open program cases', synonyms: ['active cases', 'caseload total'], termId: 'T-005', unit: 'cases' },
      { name: 'avg_caseload', expr: "COUNT_IF(cases.case_status = 'Open') / SUM(DISTINCT office.caseworkers)", description: 'Open cases per filled caseworker position', synonyms: ['caseload', 'cases per worker'], termId: 'T-012', unit: 'cases' },
    ],
    verifiedQueryIds: vqIds('SV_CASE_MANAGEMENT'),
    productIds: ['DP-02'],
    playground: {
      from: 'SEMANTIC.SV_CASE_MANAGEMENT',
      rows: appRows,
      dimensions: [
        { name: 'program.program_name', column: 'program' },
        { name: 'office.district', column: 'district' },
        { name: 'date.decision_quarter', column: 'decision_quarter' },
      ],
      filters: [
        { label: 'Decided year to date (2026)', sql: "application.decision_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => String(r.decided) >= '2026-01-01' },
        { label: 'Decided in Q3 2026', sql: "application.decision_date BETWEEN '2026-07-01' AND '2026-09-30'", test: (r) => String(r.decided) >= '2026-07-01' },
        { label: 'Decided Jan–Sep 2025 (prior year)', sql: "application.decision_date BETWEEN '2025-01-01' AND '2025-09-30'", test: (r) => String(r.decided) >= '2025-01-01' && String(r.decided) <= '2025-09-30' },
        { label: 'All decided applications', sql: 'TRUE', test: () => true },
      ],
      metrics: [
        { name: 'applications_over_standard', unit: '', decimals: 0, sqlExpr: 'applications_over_standard', agg: (rs) => Math.round(rs.filter((r) => r.over).length * d.appScale) },
        { name: 'avg_processing_days', unit: 'days', decimals: 1, sqlExpr: 'avg_processing_days', agg: (rs) => sum(rs.map((r) => n(r, 'days'))) / Math.max(1, rs.length) },
        { name: 'timely_processing_rate', unit: '%', decimals: 1, sqlExpr: 'timely_processing_rate', agg: (rs) => share(rs, (r) => !r.over) },
        { name: 'approval_rate', unit: '%', decimals: 1, sqlExpr: 'approval_rate', agg: (rs) => share(rs, (r) => Boolean(r.approved)) },
      ],
    },
  };

  // ---- SV_BENEFIT_PAYMENTS: payments, accuracy and improper payments (DP-03)
  const payRows = memo(() => d.payments.map((p) => ({ program: programName(p.program), district: p.district, quarter: quarterOf(p.date), date: p.date, amount: p.amount, improper: p.improper, improper_amount: p.improperAmount, on_time: p.onTime })));
  const payments: SemanticView = {
    name: 'SV_BENEFIT_PAYMENTS',
    description: 'Benefit payments issued, payment accuracy and improper payments',
    tables: [
      { alias: 'payment', fqn: 'CONFORMED_GOLD.FCT_PAYMENT', pk: 'PAYMENT_KEY' },
      { alias: 'program', fqn: 'CONFORMED_GOLD.DIM_PROGRAM', pk: 'PROGRAM_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'payment', to: 'program', on: 'PROGRAM_KEY' },
      { from: 'payment', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'payment.payment_amount', expr: 'payment.PAYMENT_AMOUNT' },
      { name: 'payment.improper_amount', expr: 'payment.IMPROPER_AMOUNT' },
    ],
    dimensions: [
      { name: 'program.program_name', expr: 'program.PROGRAM_NAME', synonyms: ['program', 'benefit'] },
      { name: 'payment.district', expr: 'payment.DISTRICT', synonyms: ['district', 'service district'] },
      { name: 'payment.error_type', expr: 'payment.ERROR_TYPE', synonyms: ['qc error', 'error cause'] },
    ],
    timeDimensions: [
      { name: 'date.issue_date', expr: 'date.CALENDAR_DATE' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER' },
    ],
    metrics: [
      { name: 'total_benefits_paid', expr: 'SUM(payment.payment_amount)', description: 'Total benefits issued', synonyms: ['benefits paid', 'disbursements', 'issuance'], termId: 'T-013', unit: 'USD' },
      { name: 'payments_issued', expr: 'COUNT(payment.payment_key)', description: 'Benefit payments issued', synonyms: ['payments', 'issuances'], termId: 'T-013', unit: 'payments' },
      { name: 'avg_payment_amount', expr: 'AVG(payment.payment_amount)', description: 'Average benefit payment', synonyms: ['average benefit'], termId: 'T-013', unit: 'USD' },
      { name: 'payment_accuracy_rate', expr: 'AVG(IFF(payment.is_improper, 0, 1)) * 100', description: 'Share of payments issued in the correct amount to an eligible recipient', synonyms: ['accuracy', 'payment accuracy'], termId: 'T-014', unit: '%' },
      { name: 'improper_payment_rate', expr: 'SUM(payment.improper_amount) / SUM(payment.payment_amount) * 100', description: 'Improper (over- and under-paid) dollars as a share of dollars issued', synonyms: ['improper rate', 'error rate'], termId: 'T-015', unit: '%' },
      { name: 'improper_payment_amount', expr: 'SUM(payment.improper_amount)', description: 'Dollars over- or under-paid', synonyms: ['improper dollars', 'payment errors'], termId: 'T-015', unit: 'USD' },
      { name: 'on_time_payment_rate', expr: 'AVG(IFF(payment.issued_on_time, 1, 0)) * 100', description: 'Share of payments issued by the scheduled issuance date', synonyms: ['timely payments'], termId: 'T-016', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_BENEFIT_PAYMENTS'),
    productIds: ['DP-03'],
    playground: {
      from: 'SEMANTIC.SV_BENEFIT_PAYMENTS',
      rows: payRows,
      dimensions: [
        { name: 'program.program_name', column: 'program' },
        { name: 'payment.district', column: 'district' },
        { name: 'date.fiscal_quarter', column: 'quarter' },
      ],
      filters: [
        { label: 'Year to date (2026)', sql: "date.issue_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => String(r.date) >= '2026-01-01' },
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
        { label: 'Jan–Sep 2025 (prior year)', sql: "date.issue_date BETWEEN '2025-01-01' AND '2025-09-30'", test: (r) => String(r.date) <= '2025-09-30' },
      ],
      metrics: [
        { name: 'improper_payment_rate', unit: '%', decimals: 2, sqlExpr: 'improper_payment_rate', agg: (rs) => (sum(rs.map((r) => n(r, 'improper_amount'))) / Math.max(1, sum(rs.map((r) => n(r, 'amount'))))) * 100 },
        { name: 'payment_accuracy_rate', unit: '%', decimals: 1, sqlExpr: 'payment_accuracy_rate', agg: (rs) => share(rs, (r) => !r.improper) },
        { name: 'total_benefits_paid', unit: 'USD', decimals: 0, sqlExpr: 'total_benefits_paid', agg: (rs) => sum(rs.map((r) => n(r, 'amount'))) * d.scale },
        { name: 'improper_payment_amount', unit: 'USD', decimals: 0, sqlExpr: 'improper_payment_amount', agg: (rs) => sum(rs.map((r) => n(r, 'improper_amount'))) * d.scale },
        { name: 'on_time_payment_rate', unit: '%', decimals: 1, sqlExpr: 'on_time_payment_rate', agg: (rs) => share(rs, (r) => Boolean(r.on_time)) },
      ],
    },
  };

  // ---- SV_PROGRAM_INTEGRITY: integrity flags and overpayment recovery (DP-05)
  const caseByKey = new Map(d.cases.map((c) => [c.key, c]));
  const intRows = memo(() => d.payments.map((p) => {
    const c = caseByKey.get(p.caseKey)!;
    return { case_key: p.caseKey, program: programName(p.program), district: p.district, date: p.date, flag_reason: c.flag?.reason ?? 'Not flagged', flag_status: c.flag?.status ?? 'Not flagged', flagged: Boolean(c.flag), overpayment: p.overpayment, recovered: p.recovered };
  }));
  const distinct = (rs: Row[], f: (r: Row) => boolean) => new Set(rs.filter(f).map((r) => r.case_key)).size;
  const integrity: SemanticView = {
    name: 'SV_PROGRAM_INTEGRITY',
    description: 'Program integrity flags, reviews and overpayment recovery on benefit cases',
    tables: [
      { alias: 'payment', fqn: 'CONFORMED_GOLD.FCT_PAYMENT', pk: 'PAYMENT_KEY' },
      { alias: 'cases', fqn: 'CONFORMED_GOLD.FCT_CASE', pk: 'CASE_KEY' },
      { alias: 'program', fqn: 'CONFORMED_GOLD.DIM_PROGRAM', pk: 'PROGRAM_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'payment', to: 'cases', on: 'CASE_KEY' },
      { from: 'payment', to: 'program', on: 'PROGRAM_KEY' },
      { from: 'payment', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'payment.overpayment_amount', expr: 'payment.OVERPAYMENT_AMOUNT' },
      { name: 'payment.recovered_amount', expr: 'payment.RECOVERED_AMOUNT' },
    ],
    dimensions: [
      { name: 'payment.district', expr: 'payment.DISTRICT', synonyms: ['district', 'service district'] },
      { name: 'payment.flag_reason', expr: 'payment.FLAG_REASON', synonyms: ['reason', 'flag type', 'match type'] },
      { name: 'payment.flag_status', expr: 'payment.FLAG_STATUS', synonyms: ['review status'] },
      { name: 'program.program_name', expr: 'program.PROGRAM_NAME', synonyms: ['program'] },
    ],
    timeDimensions: [{ name: 'date.issue_date', expr: 'date.CALENDAR_DATE' }],
    metrics: [
      { name: 'cases_flagged', expr: "COUNT(DISTINCT IFF(payment.flag_status IN ('Open review', 'Referred'), payment.case_key, NULL))", description: 'Cases with an integrity flag in open review or referred', synonyms: ['flagged cases', 'cases under review', 'integrity reviews'], termId: 'T-020', unit: 'cases' },
      { name: 'integrity_flag_rate', expr: 'COUNT(DISTINCT IFF(payment.integrity_flag, payment.case_key, NULL)) / COUNT(DISTINCT payment.case_key) * 100', description: 'Share of paying cases that carry an integrity flag', synonyms: ['flag rate'], termId: 'T-020', unit: '%' },
      { name: 'overpayments_established', expr: 'SUM(payment.overpayment_amount)', description: 'Overpayments established', synonyms: ['overpayments', 'claims established'], termId: 'T-021', unit: 'USD' },
      { name: 'recovery_rate', expr: 'SUM(payment.recovered_amount) / SUM(payment.overpayment_amount) * 100', description: 'Share of established overpayments recovered', synonyms: ['recovery', 'collections on overpayments'], termId: 'T-021', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_PROGRAM_INTEGRITY'),
    productIds: ['DP-05'],
    playground: {
      from: 'SEMANTIC.SV_PROGRAM_INTEGRITY',
      rows: intRows,
      dimensions: [
        { name: 'payment.district', column: 'district' },
        { name: 'payment.flag_reason', column: 'flag_reason' },
        { name: 'program.program_name', column: 'program' },
      ],
      filters: [
        { label: 'Year to date (2026)', sql: "date.issue_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => String(r.date) >= '2026-01-01' },
        { label: 'All history (Jan 2025 – Sep 2026)', sql: 'TRUE', test: () => true },
      ],
      metrics: [
        { name: 'cases_flagged', unit: '', decimals: 0, sqlExpr: 'cases_flagged', agg: (rs) => Math.round(distinct(rs, (r) => r.flag_status === 'Open review' || r.flag_status === 'Referred') * d.scale) },
        { name: 'integrity_flag_rate', unit: '%', decimals: 2, sqlExpr: 'integrity_flag_rate', agg: (rs) => (distinct(rs, (r) => Boolean(r.flagged)) / Math.max(1, distinct(rs, () => true))) * 100 },
        { name: 'overpayments_established', unit: 'USD', decimals: 0, sqlExpr: 'overpayments_established', agg: (rs) => sum(rs.map((r) => n(r, 'overpayment'))) * d.scale },
        { name: 'recovery_rate', unit: '%', decimals: 1, sqlExpr: 'recovery_rate', agg: (rs) => (sum(rs.map((r) => n(r, 'recovered'))) / Math.max(1, sum(rs.map((r) => n(r, 'overpayment'))))) * 100 },
      ],
    },
  };

  return [constituent360, caseMgmt, payments, integrity];
}
