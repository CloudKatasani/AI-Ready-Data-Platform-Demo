// Semantic views for Crestview Health System (spec sections 5 and 7.3).
import type { Row, SemanticView } from '../../types';
import { sum } from '../../mock-snowflake/generators';
import type { HcData } from './data';
import { AS_OF } from './generators.config';
import { daysBetween, flagsOf } from './queries';

const n = (r: Row, k: string) => Number(r[k] ?? 0);
const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

export function buildSemanticViews(d: HcData, vqIds: (sv: string) => string[]): SemanticView[] {
  const payerOf = (k: number) => d.payers[k - 1];

  // ---------------------------------------------------------------- Patient 360 + Revenue cycle (DP-01, DP-03)
  const patientRevenue: SemanticView = {
    name: 'SV_PATIENT_REVENUE',
    description: 'Patients, payers, claims and receivables for Patient 360 and Revenue Cycle analytics',
    tables: [
      { alias: 'patient', fqn: 'CONFORMED_GOLD.DIM_PATIENT', pk: 'PATIENT_KEY' },
      { alias: 'payer', fqn: 'CONFORMED_GOLD.DIM_PAYER', pk: 'PAYER_KEY' },
      { alias: 'claim', fqn: 'CONFORMED_GOLD.FCT_CLAIM', pk: 'CLAIM_KEY' },
      { alias: 'encounter', fqn: 'CONFORMED_GOLD.FCT_ENCOUNTER', pk: 'ENCOUNTER_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'claim', to: 'patient', on: 'PATIENT_KEY' },
      { from: 'claim', to: 'payer', on: 'PAYER_KEY' },
      { from: 'claim', to: 'date', on: 'DATE_KEY' },
      { from: 'encounter', to: 'patient', on: 'PATIENT_KEY' },
    ],
    facts: [
      { name: 'claim.expected_net_usd', expr: 'claim.EXPECTED_NET_USD', description: 'Expected net reimbursement per claim' },
      { name: 'claim.paid_usd', expr: 'claim.PAID_USD', description: 'Paid to date' },
      { name: 'claim.open_ar_usd', expr: 'claim.OPEN_AR_USD', description: 'Open A/R at the as-of date' },
      { name: 'claim.days_outstanding', expr: 'claim.DAYS_OUTSTANDING', description: 'Days since service while open' },
      { name: 'patient.risk_score', expr: 'patient.RISK_SCORE', description: 'Patient risk score' },
    ],
    dimensions: [
      { name: 'patient.market', expr: 'patient.MARKET', synonyms: ['market', 'region', 'hospital market'], description: 'Hospital market' },
      { name: 'patient.payer_class', expr: 'patient.PAYER_CLASS', synonyms: ['financial class', 'coverage', 'insurance type'], description: 'Payer class of primary coverage' },
      { name: 'patient.portal_enrolled', expr: 'patient.PORTAL_ENROLLED', synonyms: ['patient portal', 'portal'], description: 'Portal enrolment' },
      { name: 'payer.payer_name', expr: 'payer.PAYER_NAME', synonyms: ['payer', 'insurer', 'health plan'], description: 'Payer' },
      { name: 'claim.encounter_type', expr: 'claim.ENCOUNTER_TYPE', synonyms: ['setting', 'patient type'], description: 'Inpatient, emergency or outpatient' },
      { name: 'claim.denial_reason', expr: 'claim.DENIAL_REASON', synonyms: ['denial reason', 'carc'], description: 'Denial category' },
    ],
    timeDimensions: [
      { name: 'claim.submit_month', expr: "DATE_TRUNC('month', date.CALENDAR_DATE)", description: 'Claim submission month' },
      { name: 'claim.service_date', expr: 'claim.SERVICE_DATE', description: 'Service or discharge date' },
    ],
    metrics: [
      { name: 'active_patients', expr: "COUNT(DISTINCT IFF(patient.patient_status = 'Active' AND encounter.last_completed_date > DATEADD(month, -12, CURRENT_DATE), patient.patient_key, NULL))", description: 'Living patients with a completed encounter in the last 12 months', synonyms: ['active patient count', 'patient panel'], termId: 'T-002', unit: 'patients' },
      { name: 'self_pay_share', expr: "AVG(IFF(patient.payer_class = 'Self-pay', 1, 0)) * 100", description: 'Share of active patients with no active coverage', synonyms: ['uninsured share', 'self pay mix'], termId: 'T-020', unit: '%' },
      { name: 'portal_adoption_rate', expr: 'AVG(IFF(patient.portal_enrolled, 1, 0)) * 100', description: 'Share of active patients enrolled in the patient portal', synonyms: ['portal adoption', 'digital front door'], termId: 'T-027', unit: '%' },
      { name: 'avg_risk_score', expr: 'AVG(patient.risk_score)', description: 'Average patient risk score (draft model)', synonyms: ['risk score', 'acuity'], termId: 'T-021', unit: 'score' },
      { name: 'days_in_ar', expr: 'SUM(claim.open_ar_usd) / (SUM(IFF(claim.service_date > CURRENT_DATE - 90, claim.expected_net_usd, 0)) / 90)', description: 'Open A/R ÷ average daily expected net revenue (90 days)', synonyms: ['days in ar', 'ar days', 'dar'], termId: 'T-018', unit: 'days' },
      { name: 'denial_rate', expr: 'AVG(IFF(claim.is_denied, 1, 0)) * 100', description: 'Share of submitted claims initially denied', synonyms: ['denial rate', 'claim denials'], termId: 'T-017', unit: '%' },
      { name: 'clean_claim_rate', expr: 'AVG(IFF(claim.is_clean, 1, 0)) * 100', description: 'Share of claims accepted on first submission without edits', synonyms: ['first pass yield', 'clean claims'], termId: 'T-016', unit: '%' },
      { name: 'net_collection_rate', expr: 'SUM(claim.paid_usd) / SUM(claim.expected_net_usd) * 100', description: 'Payments ÷ expected net reimbursement on resolved claims', synonyms: ['ncr', 'collection rate'], termId: 'T-019', unit: '%' },
      { name: 'claims_submitted', expr: 'COUNT(claim.claim_key)', description: 'Claims submitted', synonyms: ['claim volume', 'claims billed'], termId: 'T-015', unit: 'claims' },
      { name: 'ar_over_90_pct', expr: 'SUM(IFF(claim.days_outstanding > 90, claim.open_ar_usd, 0)) / SUM(claim.open_ar_usd) * 100', description: 'Share of open A/R older than 90 days from service', synonyms: ['aged ar', 'ar over 90'], termId: 'T-028', unit: '%' },
      { name: 'open_ar_balance', expr: 'SUM(claim.open_ar_usd)', description: 'Open accounts receivable', synonyms: ['ar balance', 'outstanding balance'], termId: 'T-018', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_PATIENT_REVENUE'),
    productIds: ['DP-01', 'DP-03'],
    playground: {
      from: 'SEMANTIC.SV_PATIENT_REVENUE',
      rows: () => d.claims.map((c) => ({
        market: c.market, payer: payerOf(c.payerKey).name, payer_class: payerOf(c.payerKey).payerClass, enc: c.encType, submit: c.submitDate, service: c.serviceDate,
        clean: c.clean, denied: c.denied, expected: c.expected, paid: c.resolvedDate <= AS_OF ? c.paid : 0, resolved: c.resolvedDate <= AS_OF, open: c.resolvedDate > AS_OF ? c.expected : 0,
        aged: c.resolvedDate > AS_OF && daysBetween(c.serviceDate, AS_OF) > 90 ? c.expected : 0,
      })),
      dimensions: [
        { name: 'payer.payer_name', column: 'payer' },
        { name: 'patient.payer_class', column: 'payer_class' },
        { name: 'patient.market', column: 'market' },
      ],
      filters: [
        { label: 'Submitted Q3 2026', sql: "claim.submit_month BETWEEN '2026-07-01' AND '2026-09-01'", test: (r) => String(r.submit) >= '2026-07-01' },
        { label: 'Submitted September 2026', sql: "claim.submit_month = '2026-09-01'", test: (r) => String(r.submit) >= '2026-09-01' },
        { label: 'Inpatient claims, last 12 months', sql: "claim.encounter_type = 'IP'", test: (r) => r.enc === 'IP' },
        { label: 'All claims, last 12 months', sql: 'TRUE', test: () => true },
      ],
      metrics: [
        { name: 'denial_rate', unit: '%', decimals: 1, sqlExpr: 'denial_rate', agg: (rs) => (rs.filter((r) => r.denied).length / Math.max(1, rs.length)) * 100 },
        { name: 'clean_claim_rate', unit: '%', decimals: 1, sqlExpr: 'clean_claim_rate', agg: (rs) => (rs.filter((r) => r.clean).length / Math.max(1, rs.length)) * 100 },
        { name: 'claims_submitted', unit: '', decimals: 0, sqlExpr: 'claims_submitted', agg: (rs) => Math.round(rs.length * d.scale.claims) },
        { name: 'open_ar_balance', unit: 'USD', decimals: 0, sqlExpr: 'open_ar_balance', agg: (rs) => sum(rs.map((r) => n(r, 'open'))) * d.scale.claims },
        { name: 'ar_over_90_pct', unit: '%', decimals: 1, sqlExpr: 'ar_over_90_pct', agg: (rs) => (sum(rs.map((r) => n(r, 'aged'))) / Math.max(1, sum(rs.map((r) => n(r, 'open'))))) * 100 },
      ],
    },
  };

  // ---------------------------------------------------------------- Encounters & throughput (DP-02)
  const hospName = new Map(d.hospitals.map((h) => [h.code, h.name]));
  const throughput: SemanticView = {
    name: 'SV_THROUGHPUT',
    description: 'Inpatient length of stay, bed occupancy, ED wait and clinic access by hospital, market and period',
    tables: [
      { alias: 'encounter', fqn: 'CONFORMED_GOLD.FCT_ENCOUNTER', pk: 'ENCOUNTER_KEY' },
      { alias: 'facility', fqn: 'CONFORMED_GOLD.DIM_FACILITY', pk: 'FACILITY_KEY' },
      { alias: 'appointment', fqn: 'CONFORMED_GOLD.FCT_APPOINTMENT', pk: 'APPOINTMENT_KEY' },
      { alias: 'clinic', fqn: 'CONFORMED_GOLD.DIM_CLINIC', pk: 'CLINIC_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'encounter', to: 'facility', on: 'FACILITY_KEY' },
      { from: 'encounter', to: 'date', on: 'DATE_KEY' },
      { from: 'appointment', to: 'clinic', on: 'CLINIC_KEY' },
      { from: 'appointment', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'encounter.los_days', expr: 'encounter.LOS_DAYS', description: 'Length of stay in midnights' },
      { name: 'encounter.ed_wait_min', expr: 'encounter.ED_WAIT_MIN', description: 'Door-to-provider minutes' },
      { name: 'facility.staffed_beds', expr: 'facility.STAFFED_BEDS', description: 'Staffed beds (occupancy denominator)' },
      { name: 'appointment.lead_days', expr: 'appointment.LEAD_DAYS', description: 'Booking-to-appointment days' },
    ],
    dimensions: [
      { name: 'facility.market', expr: 'facility.MARKET', synonyms: ['market', 'region', 'hospital market'], description: 'Hospital market' },
      { name: 'facility.facility_name', expr: 'facility.FACILITY_NAME', synonyms: ['hospital', 'facility', 'campus'], description: 'Hospital' },
      { name: 'encounter.service_line', expr: 'encounter.SERVICE_LINE', synonyms: ['service line', 'clinical service'], description: 'Service line' },
      { name: 'encounter.encounter_type', expr: 'encounter.ENCOUNTER_TYPE', synonyms: ['patient type', 'setting'], description: 'Inpatient / Emergency' },
      { name: 'clinic.clinic_name', expr: 'clinic.CLINIC_NAME', synonyms: ['clinic', 'practice', 'department'], description: 'Clinic' },
      { name: 'clinic.specialty', expr: 'clinic.SPECIALTY', synonyms: ['specialty'], description: 'Clinic specialty' },
    ],
    timeDimensions: [
      { name: 'date.encounter_date', expr: 'date.CALENDAR_DATE', description: 'Admission, arrival or appointment date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter (FY = calendar year)' },
    ],
    metrics: [
      { name: 'avg_length_of_stay', expr: "AVG(IFF(encounter.encounter_type = 'Inpatient', encounter.los_days, NULL))", description: 'Average length of stay of inpatient discharges', synonyms: ['alos', 'los', 'length of stay'], termId: 'T-005', unit: 'days' },
      { name: 'bed_occupancy_pct', expr: 'SUM(encounter.inpatient_nights) / (MAX(facility.staffed_beds) * COUNT(DISTINCT date.calendar_date)) * 100', description: 'Midnight census ÷ staffed bed-days', synonyms: ['occupancy', 'census', 'bed utilization'], termId: 'T-010', unit: '%' },
      { name: 'ed_wait_minutes', expr: 'AVG(encounter.ed_wait_min)', description: 'Average ED door-to-provider minutes (LWBS excluded)', synonyms: ['ed wait', 'door to provider', 'er wait time'], termId: 'T-011', unit: 'minutes' },
      { name: 'lwbs_rate', expr: "AVG(IFF(encounter.encounter_type = 'Emergency', IFF(encounter.lwbs_flag, 1, 0), NULL)) * 100", description: 'Share of ED visits that left without being seen', synonyms: ['lwbs', 'left without being seen'], termId: 'T-012', unit: '%' },
      { name: 'inpatient_discharges', expr: "COUNT_IF(encounter.encounter_type = 'Inpatient' AND encounter.discharge_date IS NOT NULL)", description: 'Inpatient discharges', synonyms: ['discharges', 'admissions'], termId: 'T-030', unit: 'discharges' },
      { name: 'no_show_rate', expr: "COUNT_IF(appointment.appt_status = 'No-show') / COUNT_IF(appointment.appt_status IN ('Completed', 'No-show')) * 100", description: 'No-shows ÷ (completed + no-show) appointments', synonyms: ['no show rate', 'missed appointments', 'dna rate'], termId: 'T-013', unit: '%' },
      { name: 'new_patient_lag_days', expr: "AVG(IFF(appointment.visit_type = 'New', appointment.lead_days, NULL))", description: 'Average days from booking to a new-patient appointment', synonyms: ['appointment lag', 'access lag', 'wait for appointment'], termId: 'T-014', unit: 'days' },
    ],
    verifiedQueryIds: vqIds('SV_THROUGHPUT'),
    productIds: ['DP-02'],
    playground: {
      from: 'SEMANTIC.SV_THROUGHPUT',
      rows: () => [
        ...d.stays.filter((s) => !s.inHouse).map((s) => ({ type: 'Inpatient', market: s.market, hospital: hospName.get(s.hospitalCode)!, quarter: quarterOf(s.discharge), date: s.discharge, los: s.los, wait: null, lwbs: false })),
        ...d.ed.map((v) => ({ type: 'Emergency', market: v.market, hospital: hospName.get(v.hospitalCode)!, quarter: quarterOf(v.date), date: v.date, los: null, wait: v.waitMin, lwbs: v.lwbs })),
      ],
      dimensions: [
        { name: 'facility.market', column: 'market' },
        { name: 'facility.facility_name', column: 'hospital' },
        { name: 'date.fiscal_quarter', column: 'quarter' },
      ],
      filters: [
        { label: 'Year to date 2026', sql: "date.encounter_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => String(r.date) >= '2026-01-01' },
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
        { label: 'September 2026', sql: "date.encounter_date >= '2026-09-01'", test: (r) => String(r.date) >= '2026-09-01' },
        { label: 'Prior year to date (Jan–Sep 2025)', sql: "date.encounter_date BETWEEN '2025-01-01' AND '2025-09-30'", test: (r) => String(r.date) >= '2025-01-01' && String(r.date) <= '2025-09-30' },
      ],
      metrics: [
        { name: 'avg_length_of_stay', unit: 'days', decimals: 2, sqlExpr: 'avg_length_of_stay', agg: (rs) => { const ip = rs.filter((r) => r.type === 'Inpatient'); return sum(ip.map((r) => n(r, 'los'))) / Math.max(1, ip.length); } },
        { name: 'ed_wait_minutes', unit: 'min', decimals: 1, sqlExpr: 'ed_wait_minutes', agg: (rs) => { const e = rs.filter((r) => r.type === 'Emergency' && !r.lwbs); return sum(e.map((r) => n(r, 'wait'))) / Math.max(1, e.length); } },
        { name: 'lwbs_rate', unit: '%', decimals: 1, sqlExpr: 'lwbs_rate', agg: (rs) => { const e = rs.filter((r) => r.type === 'Emergency'); return (e.filter((r) => r.lwbs).length / Math.max(1, e.length)) * 100; } },
        { name: 'inpatient_discharges', unit: '', decimals: 0, sqlExpr: 'inpatient_discharges', agg: (rs) => Math.round(rs.filter((r) => r.type === 'Inpatient').length * d.scale.ip) },
      ],
    },
  };

  // ---------------------------------------------------------------- Quality & readmissions (DP-04)
  const followedSet = new Set<number>();
  {
    const visits = new Map<number, string[]>();
    for (const a of d.appts) if (a.status === 'Completed') { const xs = visits.get(a.patientKey) ?? []; xs.push(a.date); visits.set(a.patientKey, xs); }
    for (const s of d.stays) if (!s.inHouse && (visits.get(s.patientKey) ?? []).some((v) => { const g = daysBetween(s.discharge, v); return g >= 1 && g <= 7; })) followedSet.add(s.key);
  }
  const quality: SemanticView = {
    name: 'SV_QUALITY',
    description: '30-day all-cause readmissions (CMS method), 7-day follow-up and inpatient mortality by service line, hospital and period',
    tables: [
      { alias: 'readmit', fqn: 'CONFORMED_GOLD.FCT_READMISSION', pk: 'INDEX_STAY_KEY' },
      { alias: 'facility', fqn: 'CONFORMED_GOLD.DIM_FACILITY', pk: 'FACILITY_KEY' },
      { alias: 'patient', fqn: 'CONFORMED_GOLD.DIM_PATIENT', pk: 'PATIENT_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'readmit', to: 'facility', on: 'FACILITY_KEY' },
      { from: 'readmit', to: 'patient', on: 'PATIENT_KEY' },
      { from: 'readmit', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'readmit.is_eligible_index', expr: 'readmit.IS_ELIGIBLE_INDEX', description: 'Eligible index stay (excludes transfers, deaths, AMA)' },
      { name: 'readmit.readmit_30d_flag', expr: 'readmit.READMIT_30D_FLAG', description: 'Unplanned readmission within 30 days' },
      { name: 'readmit.followup_7d_flag', expr: 'readmit.FOLLOWUP_7D_FLAG', description: 'Completed visit 1–7 days after discharge' },
      { name: 'readmit.days_to_readmit', expr: 'readmit.DAYS_TO_READMIT', description: 'Days from discharge to readmission' },
    ],
    dimensions: [
      { name: 'readmit.service_line', expr: 'readmit.SERVICE_LINE', synonyms: ['service line', 'clinical service', 'specialty'], description: 'Service line of the index stay' },
      { name: 'facility.market', expr: 'facility.MARKET', synonyms: ['market', 'region', 'hospital market'], description: 'Hospital market' },
      { name: 'facility.facility_name', expr: 'facility.FACILITY_NAME', synonyms: ['hospital', 'facility'], description: 'Hospital' },
      { name: 'readmit.discharge_disposition', expr: 'readmit.DISCHARGE_DISPOSITION', synonyms: ['disposition', 'discharged to'], description: 'Discharge disposition' },
      { name: 'patient.payer_class', expr: 'patient.PAYER_CLASS', synonyms: ['payer class', 'coverage'], description: 'Payer class' },
    ],
    timeDimensions: [
      { name: 'date.discharge_date', expr: 'date.CALENDAR_DATE', description: 'Index discharge date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter of index discharge' },
    ],
    metrics: [
      { name: 'readmission_rate_30d', expr: 'SUM(IFF(readmit.readmit_30d_flag, 1, 0)) / COUNT_IF(readmit.is_eligible_index) * 100', description: '30-day all-cause unplanned readmission rate (CMS method: planned readmissions and transfers excluded)', synonyms: ['readmission rate', '30 day readmissions', 'bounce back rate'], termId: 'T-006', unit: '%' },
      { name: 'readmissions_30d', expr: 'COUNT_IF(readmit.readmit_30d_flag)', description: 'Unplanned readmissions within 30 days', synonyms: ['readmissions', 'readmits'], termId: 'T-006', unit: 'readmissions' },
      { name: 'index_discharges', expr: 'COUNT_IF(readmit.is_eligible_index)', description: 'Eligible index discharges (denominator)', synonyms: ['index stays', 'eligible discharges'], termId: 'T-007', unit: 'discharges' },
      { name: 'followup_7d_rate', expr: "AVG(IFF(readmit.followup_7d_flag, 1, 0)) * 100", description: 'Share of discharges home with a completed visit within 7 days', synonyms: ['7 day follow up', 'post discharge follow up', 'tcm visit rate'], termId: 'T-022', unit: '%' },
      { name: 'inpatient_mortality_rate', expr: 'AVG(IFF(readmit.expired_flag, 1, 0)) * 100', description: 'In-hospital deaths ÷ inpatient discharges', synonyms: ['mortality', 'death rate'], termId: 'T-023', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_QUALITY'),
    productIds: ['DP-04'],
    playground: {
      from: 'SEMANTIC.SV_QUALITY',
      rows: () => {
        const f = flagsOf(d);
        return d.stays.filter((s) => !s.inHouse).map((s) => {
          const x = f.get(s.key)!;
          return { service_line: s.serviceLine, market: s.market, quarter: quarterOf(s.discharge), date: s.discharge, eligible: x.eligible, readmit: x.readmit, home: ['Home', 'Home health'].includes(s.disposition), followed: followedSet.has(s.key), expired: s.disposition === 'Expired' };
        });
      },
      dimensions: [
        { name: 'readmit.service_line', column: 'service_line' },
        { name: 'facility.market', column: 'market' },
        { name: 'date.fiscal_quarter', column: 'quarter' },
      ],
      filters: [
        { label: 'Index discharges 1 Jan – 31 Aug 2026 (30-day window closed)', sql: "date.discharge_date BETWEEN '2026-01-01' AND '2026-08-31'", test: (r) => String(r.date) >= '2026-01-01' && String(r.date) <= '2026-08-31' },
        { label: 'Same months of 2025', sql: "date.discharge_date BETWEEN '2025-01-01' AND '2025-08-31'", test: (r) => String(r.date) >= '2025-01-01' && String(r.date) <= '2025-08-31' },
        { label: 'Q2 2026', sql: "date.fiscal_quarter = '2026-Q2'", test: (r) => r.quarter === '2026-Q2' },
      ],
      metrics: [
        { name: 'readmission_rate_30d', unit: '%', decimals: 1, sqlExpr: 'readmission_rate_30d', agg: (rs) => { const e = rs.filter((r) => r.eligible); return (e.filter((r) => r.readmit).length / Math.max(1, e.length)) * 100; } },
        { name: 'readmissions_30d', unit: '', decimals: 0, sqlExpr: 'readmissions_30d', agg: (rs) => Math.round(rs.filter((r) => r.eligible && r.readmit).length * d.scale.ip) },
        { name: 'index_discharges', unit: '', decimals: 0, sqlExpr: 'index_discharges', agg: (rs) => Math.round(rs.filter((r) => r.eligible).length * d.scale.ip) },
        { name: 'followup_7d_rate', unit: '%', decimals: 1, sqlExpr: 'followup_7d_rate', agg: (rs) => { const h = rs.filter((r) => r.home); return (h.filter((r) => r.followed).length / Math.max(1, h.length)) * 100; } },
        { name: 'inpatient_mortality_rate', unit: '%', decimals: 2, sqlExpr: 'inpatient_mortality_rate', agg: (rs) => (rs.filter((r) => r.expired).length / Math.max(1, rs.length)) * 100 },
      ],
    },
  };

  // ---------------------------------------------------------------- Clinical supply chain (DP-05, in certification)
  const supply: SemanticView = {
    name: 'SV_SUPPLY_CHAIN',
    description: 'Clinical supply, implant and pharmacy cost per case, spend and contract compliance',
    tables: [
      { alias: 'usage', fqn: 'CONFORMED_GOLD.FCT_SUPPLY_USAGE', pk: 'USAGE_KEY' },
      { alias: 'encounter', fqn: 'CONFORMED_GOLD.FCT_ENCOUNTER', pk: 'ENCOUNTER_KEY' },
      { alias: 'facility', fqn: 'CONFORMED_GOLD.DIM_FACILITY', pk: 'FACILITY_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'usage', to: 'encounter', on: 'ENCOUNTER_KEY' },
      { from: 'encounter', to: 'facility', on: 'FACILITY_KEY' },
      { from: 'usage', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'usage.cost_usd', expr: 'usage.COST_USD', description: 'Extended cost' },
      { name: 'usage.is_surgical_case', expr: 'usage.IS_SURGICAL_CASE', description: 'Stay is a surgical case' },
    ],
    dimensions: [
      { name: 'facility.market', expr: 'facility.MARKET', synonyms: ['market', 'region'], description: 'Hospital market' },
      { name: 'usage.category', expr: 'usage.CATEGORY', synonyms: ['supply category', 'commodity'], description: 'Category' },
      { name: 'usage.vendor', expr: 'usage.VENDOR', synonyms: ['supplier', 'manufacturer'], description: 'Vendor' },
      { name: 'encounter.service_line', expr: 'encounter.SERVICE_LINE', synonyms: ['service line'], description: 'Service line' },
      { name: 'usage.item_type', expr: 'usage.ITEM_TYPE', synonyms: ['supply or drug'], description: 'Supply / Pharmacy' },
    ],
    timeDimensions: [
      { name: 'date.usage_date', expr: 'date.CALENDAR_DATE', description: 'Usage date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter' },
    ],
    metrics: [
      { name: 'supply_cost_per_case', expr: "SUM(IFF(usage.item_type = 'Supply' AND usage.is_surgical_case, usage.cost_usd, 0)) / COUNT(DISTINCT IFF(usage.is_surgical_case, usage.encounter_key, NULL))", description: 'Med-surg supply and implant cost per surgical case (pharmacy excluded)', synonyms: ['cost per case', 'supply cost per surgery', 'cpc'], termId: 'T-024', unit: 'USD' },
      { name: 'supply_spend', expr: 'SUM(usage.cost_usd)', description: 'Supply, implant and pharmacy spend', synonyms: ['supply spend', 'clinical spend'], termId: 'T-029', unit: 'USD' },
      { name: 'on_contract_pct', expr: 'SUM(IFF(usage.on_contract, usage.cost_usd, 0)) / SUM(usage.cost_usd) * 100', description: 'Share of spend under a GPO or local contract', synonyms: ['contract compliance', 'on contract spend'], termId: 'T-025', unit: '%' },
      { name: 'pharmacy_spend', expr: "SUM(IFF(usage.item_type = 'Pharmacy', usage.cost_usd, 0))", description: 'Pharmacy dispense cost', synonyms: ['drug spend', 'pharmacy cost'], termId: 'T-029', unit: 'USD' },
      { name: 'surgical_cases', expr: 'COUNT(DISTINCT IFF(usage.is_surgical_case, usage.encounter_key, NULL))', description: 'Surgical cases with supply capture', synonyms: ['surgeries', 'cases'], termId: 'T-024', unit: 'cases' },
    ],
    verifiedQueryIds: vqIds('SV_SUPPLY_CHAIN'),
    productIds: ['DP-05'],
    playground: {
      from: 'SEMANTIC.SV_SUPPLY_CHAIN',
      rows: () => d.supply.map((l) => ({ market: l.market, category: l.category, vendor: l.vendor, quarter: quarterOf(l.date), type: l.itemType, cost: l.cost, on: l.onContract, surgical: l.surgical, stay: l.stayKey })),
      dimensions: [
        { name: 'facility.market', column: 'market' },
        { name: 'usage.category', column: 'category' },
        { name: 'usage.vendor', column: 'vendor' },
      ],
      filters: [
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
        { label: 'Last 12 months (Oct 2025 – Sep 2026)', sql: "date.usage_date BETWEEN '2025-10-01' AND '2026-09-30'", test: () => true },
        { label: 'Surgical cases only', sql: 'usage.is_surgical_case = TRUE', test: (r) => Boolean(r.surgical) },
      ],
      metrics: [
        { name: 'supply_spend', unit: 'USD', decimals: 0, sqlExpr: 'supply_spend', agg: (rs) => sum(rs.map((r) => n(r, 'cost'))) * d.scale.ip },
        { name: 'on_contract_pct', unit: '%', decimals: 1, sqlExpr: 'on_contract_pct', agg: (rs) => (sum(rs.filter((r) => r.on).map((r) => n(r, 'cost'))) / Math.max(1, sum(rs.map((r) => n(r, 'cost'))))) * 100 },
        { name: 'supply_cost_per_case', unit: 'USD', decimals: 0, sqlExpr: 'supply_cost_per_case', agg: (rs) => { const s = rs.filter((r) => r.surgical && r.type === 'Supply'); return sum(s.map((r) => n(r, 'cost'))) / Math.max(1, new Set(s.map((r) => r.stay)).size); } },
        { name: 'pharmacy_spend', unit: 'USD', decimals: 0, sqlExpr: 'pharmacy_spend', agg: (rs) => sum(rs.filter((r) => r.type === 'Pharmacy').map((r) => n(r, 'cost'))) * d.scale.ip },
      ],
    },
  };

  return [patientRevenue, throughput, quality, supply];
}
