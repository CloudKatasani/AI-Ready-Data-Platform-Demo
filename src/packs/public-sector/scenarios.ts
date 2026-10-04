// The 15 Public Sector agent scenarios (spec section 9). Every number is computed from the in-memory sample.
import type { GlossaryTerm, IndustryPack, Persona, Scenario } from '../../types';
import { sum } from '../../mock-snowflake/generators';
import { maskFor } from '../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import type { PsData } from './data';
import { PROGRAMS } from './generators.config';
import * as Q from './queries';

const DB = 'WCS_AI_PLATFORM';
const allowedDistricts = (p: Persona) => (p.rowFilter?.column === 'DISTRICT' ? p.rowFilter.allowed : undefined);
const rowNote = (p: Persona) => (allowedDistricts(p) ? ` Row access policy limited results to ${allowedDistricts(p)!.join(' and ')}.` : '');
const districtWhere = (p: Persona) => (allowedDistricts(p) ? `\n  -- RAP_DISTRICT_ACCESS applied by Snowflake: DISTRICT IN (${allowedDistricts(p)!.map((o) => `'${o}'`).join(', ')})` : '');

type PackLike = Pick<IndustryPack, 'glossary' | 'products' | 'agents' | 'semanticViews' | 'certificationScript' | 'context' | 'kpis'>;

export function buildScenarios(d: PsData, packRef: () => PackLike): Scenario[] {
  return [
    {
      id: 'S-01', agentId: 'AG-01', pattern: 1, productIds: ['DP-04'], kpiIds: ['K-06', 'K-07'],
      question: 'What was the average 311 resolution time last quarter by district?',
      paraphrases: ['average 311 resolution time by district last quarter', '311 time to close per district in Q3', 'how long did 311 requests take to resolve by district last quarter'],
      terms: [{ text: '311 resolution time', termId: 'T-018' }, { text: 'district', termId: 'T-003' }],
      ruleIds: ['BR-003', 'BR-004'], instruction: 'Report days to two decimals; name the period and say only closed requests count.',
      semantic: { view: 'SV_CONSTITUENT_360', metrics: ['avg_resolution_days', 'on_time_resolution_rate'], dimensions: ['office.district'], filters: ["fiscal_quarter = '2026-Q3'", 'closed requests only'] },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const r = Q.srByDistrict(d, Q.PERIODS.quarter.months, allow);
        const top = [...r.rows].sort((a, b) => b.avgDays - a.avgDays)[0];
        return {
          summary: `In Q3 2026 (Jul–Sep) closed 311 requests took ${fmtNum(r.avgDays, 2)} days on average to resolve${allow ? ' in your districts' : ' county-wide'}, and ${fmtPct(r.onTimePct)} were closed within their SLA. ${top.district} was slowest at ${fmtNum(top.avgDays, 2)} days.${rowNote(persona)}`,
          table: { columns: ['District', 'Avg resolution (days)', 'On time %', 'Closed requests (sample)'], rows: r.rows.map((x) => [x.district, fmtNum(x.avgDays, 2), fmtPct(x.onTimePct), fmtInt(x.closed)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.district.replace(' District', '')), values: r.rows.map((x) => x.avgDays), unit: 'days' },
          sql: `SELECT office.district, AVG(request.resolution_days) AS avg_resolution_days,\n       AVG(IFF(request.within_sla, 1, 0)) * 100 AS on_time_resolution_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_SERVICE_REQUESTS_311 -- via SV_CONSTITUENT_360\n WHERE created_date BETWEEN '2026-07-01' AND '2026-09-30'\n   AND closed_date IS NOT NULL  -- BR-003${districtWhere(persona)}\n GROUP BY office.district\n ORDER BY avg_resolution_days DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-06': r.avgDays, 'K-07': r.onTimePct, 'K-08': r.reopenPct },
        };
      },
    },
    {
      id: 'S-02', agentId: 'AG-01', pattern: 2, productIds: ['DP-01'], kpiIds: ['K-01', 'K-02'],
      question: 'How many active constituents are enrolled in more than one program?',
      paraphrases: ['active constituents in more than one program', 'how many active clients have multiple programs', 'multi-program enrollment among active constituents', 'active residents enrolled in two or more programs'],
      terms: [{ text: 'active constituents', termId: 'T-002' }, { text: 'more than one program', termId: 'T-027' }],
      ruleIds: ['BR-001', 'BR-002'], instruction: 'State which constituents count as active.',
      semantic: { view: 'SV_CONSTITUENT_360', metrics: ['active_constituents', 'multi_program_rate'], dimensions: [], filters: ['Active Constituent rule BR-001'] },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const m = Q.multiProgram(d, allow);
        return {
          summary: `${fmtCompact(m.multi * d.scale)} active constituents are enrolled in two or more programs — ${fmtPct(m.pct)} of ${fmtCompact(m.active * d.scale)} active constituents. "Active" follows rule BR-001: Active status, an open program case and a contact in the last 12 months, which excludes ${fmtInt((m.statusOnly - m.active) * d.scale)} Active-status records with no open case or no recent contact.${rowNote(persona)}`,
          table: { columns: ['Programs enrolled', 'Active constituents', 'Share'], rows: m.byPrograms.map((x) => [x.n === 4 ? '4 or more' : String(x.n), fmtInt(x.count * d.scale), fmtPct((x.count / m.active) * 100)]) },
          chart: { kind: 'bar', labels: m.byPrograms.map((x) => (x.n === 4 ? '4+' : String(x.n))), values: m.byPrograms.map((x) => Math.round(x.count * d.scale)), unit: 'constituents' },
          sql: `SELECT programs_enrolled, COUNT(*) AS active_constituents\n  FROM ${DB}.DATA_PRODUCTS.DP_CONSTITUENT_360\n WHERE is_active  -- BR-001: Active status, open case, contact in last 12 months${districtWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: m.byPrograms.length, rowFiltered: Boolean(allow), note: `Sample of ${fmtInt(m.active)} active constituents scaled ×${fmtNum(d.scale, 0)} to the county's constituent records.`,
          kpiValues: allow ? undefined : { 'K-01': Math.round(m.active * d.scale), 'K-02': m.pct },
        };
      },
    },
    {
      id: 'S-03', agentId: 'AG-01', pattern: 3, productIds: ['DP-01'], kpiIds: [],
      question: 'Which constituents in three or more programs have a renewal due in the next 30 days?',
      paraphrases: ['list constituents with 3+ programs and a renewal due in 30 days', 'renewals due next 30 days for constituents in three programs', 'which multi-program constituents have renewals coming due'],
      terms: [{ text: 'constituents', termId: 'T-001' }, { text: 'three or more programs', termId: 'T-027' }],
      ruleIds: ['BR-001', 'BR-017'], instruction: 'Never reveal names or identifiers unless the role may see them.',
      semantic: { view: 'SV_CONSTITUENT_360', metrics: ['active_constituents'], dimensions: ['constituent.constituent_id', 'constituent.constituent_name', 'office.district'], filters: ['programs_enrolled >= 3', "next_renewal_date BETWEEN '2026-10-01' AND '2026-10-30'"] },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const list = Q.renewalsDue(d, allow);
        const masked = !persona.unmasked.includes('PII');
        const shown = list.slice(0, 8);
        return {
          summary: `${list.length} active constituents in the sample are enrolled in three or more programs and have a renewal due between 1 and 30 October 2026 (≈ ${fmtCompact(list.length * d.scale)} county-wide). The earliest ${shown.length} are listed so caseworkers can bundle the renewals into one contact.${masked ? ' Names are masked by MP_MASK_PII for your role.' : ''}${rowNote(persona)}`,
          table: {
            columns: ['Constituent ID', 'Name', 'District', 'Programs', 'Renewal due'],
            rows: shown.map((x) => [x.c.constituentId, String(maskFor(persona, 'PII', `${x.c.first} ${x.c.last}`)), x.c.district, x.programs.join(', '), x.due!]),
            masked: masked ? [1] : [],
          },
          sql: `SELECT constituent_id, constituent_name, district, program_codes, next_renewal_date\n  FROM ${DB}.DATA_PRODUCTS.DP_CONSTITUENT_360\n WHERE is_active AND programs_enrolled >= 3\n   AND next_renewal_date BETWEEN '2026-10-01' AND '2026-10-30'${districtWhere(persona)}\n ORDER BY next_renewal_date\n LIMIT 8;`,
          rows: shown.length, maskedColumns: masked ? ['CONSTITUENT_NAME'] : [], rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_CONSTITUENT_360',
        };
      },
    },
    {
      id: 'S-04', agentId: 'AG-01', pattern: 4, productIds: ['DP-05'], kpiIds: ['K-22'],
      question: "Which of my district's cases are flagged for program integrity review?",
      paraphrases: ['cases flagged for program integrity review in my district', 'which cases are under integrity review', 'flagged cases for integrity review by district', 'program integrity flags in my districts'],
      terms: [{ text: 'flagged for program integrity review', termId: 'T-020' }, { text: 'district', termId: 'T-003' }],
      ruleIds: ['BR-014'], instruction: 'Report counts by district and reason; a flag is a review, not a finding.',
      semantic: { view: 'SV_PROGRAM_INTEGRITY', metrics: ['cases_flagged'], dimensions: ['payment.district', 'payment.flag_reason'], filters: ["flag_status IN ('Open review', 'Referred')"] },
      doc: { docId: 'DOC-04', chunk: 14 },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const r = Q.integrityReview(d, allow);
        const top = r.reasons[0];
        return {
          summary: `${r.flagged} paying cases in the sample${allow ? ' in your districts' : ''} are flagged for program integrity review (≈ ${fmtCompact(r.flaggedScaled)} county-wide): ${sum(r.rows.map((x) => x.openReview))} in open review and ${sum(r.rows.map((x) => x.referred))} referred for investigation. The most common reason is ${top ? `${top.reason.toLowerCase()} (${top.cases})` : 'none'}. A flag is a review, not a finding of fraud.${rowNote(persona)}`,
          table: { columns: ['District', 'Open review', 'Referred', 'Flagged cases (sample)', 'Est. county cases'], rows: r.rows.map((x) => [x.district, x.openReview, x.referred, x.total, fmtInt(x.scaled)]) },
          chart: { kind: 'bar', labels: r.reasons.map((x) => x.reason), values: r.reasons.map((x) => x.cases), unit: 'cases' },
          sql: `SELECT district, flag_reason, flag_status, COUNT(DISTINCT case_id) AS cases_flagged\n  FROM ${DB}.DATA_PRODUCTS.DP_PROGRAM_INTEGRITY\n WHERE flag_status IN ('Open review', 'Referred')  -- BR-014${districtWhere(persona)}\n GROUP BY 1, 2, 3\n ORDER BY cases_flagged DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-22': r.flaggedScaled, 'K-23': r.flagRate, 'K-24': r.recoveryPct },
        };
      },
    },
    {
      id: 'S-05', agentId: 'AG-01', pattern: 5, productIds: ['DP-04'], kpiIds: ['K-05'],
      question: 'Show daily 311 service requests for the last 30 days',
      paraphrases: ['daily 311 requests last 30 days', '311 service request volume per day this month', 'trend of 311 requests over the past 30 days'],
      terms: [{ text: '311 service requests', termId: 'T-017' }],
      ruleIds: ['BR-018'],
      semantic: { view: 'SV_CONSTITUENT_360', metrics: ['service_requests'], dimensions: ['date.request_date', 'request.request_type'], filters: [`request_date >= '${Q.PERIODS.last30.from}'`] },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const r = Q.srDaily(d, allow);
        const peak = r.daily.reduce((a, b) => (b.requests > a.requests ? b : a));
        return {
          summary: `In the last 30 days (1–30 Sep 2026) residents logged about ${fmtInt(r.total)} 311 service requests${allow ? ' in your districts' : ''} — roughly ${fmtInt(r.total / 30)} a day, with weekday peaks; the busiest day was ${peak.day} (${fmtInt(peak.requests)}). ${r.byType[0].type} and ${r.byType[1].type} were the top request types.${rowNote(persona)}`,
          table: { columns: ['Request type', 'Requests (30 days)'], rows: r.byType.map((x) => [x.type, fmtInt(x.requests)]) },
          chart: { kind: 'line', labels: r.daily.map((x) => x.day.slice(5)), values: r.daily.map((x) => x.requests), unit: 'requests' },
          sql: `SELECT created_date, request_type, COUNT(*) AS service_requests\n  FROM ${DB}.DATA_PRODUCTS.DP_SERVICE_REQUESTS_311\n WHERE created_date BETWEEN '${Q.PERIODS.last30.from}' AND '${Q.PERIODS.last30.to}'${districtWhere(persona)}\n GROUP BY 1, 2 ORDER BY 1, 2;`,
          rows: r.daily.length, rowFiltered: Boolean(allow), note: `Sample of ${fmtInt(r.sample)} requests scaled ×${fmtNum(d.srScale, 0)} to county volume.`,
          kpiValues: allow ? undefined : { 'K-05': r.total },
        };
      },
    },
    {
      id: 'S-06', agentId: 'AG-02', pattern: 6, productIds: ['DP-02'], kpiIds: ['K-11', 'K-12'],
      question: 'How many benefit applications exceed the 30-day processing standard?',
      paraphrases: ['benefit applications over the 30-day processing standard', 'how many applications took longer than 30 days to process', 'applications exceeding the processing standard by program', 'late benefit applications past 30 business days'],
      terms: [{ text: 'benefit applications', termId: 'T-007' }, { text: '30-day processing standard', termId: 'T-009' }],
      ruleIds: ['BR-006', 'BR-007'], instruction: 'Count business days from a complete application; report decided and pending separately.',
      semantic: { view: 'SV_CASE_MANAGEMENT', metrics: ['applications_over_standard', 'timely_processing_rate'], dimensions: ['program.program_name'], filters: ['decision_date YTD 2026', 'processing_business_days > 30'] },
      doc: { docId: 'DOC-01', chunk: 12 },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const r = Q.processingStandard(d, allow);
        const worst = [...r.rows].sort((a, b) => a.timelyPct - b.timelyPct)[0];
        return {
          summary: `${fmtInt(r.overScaled)} benefit applications decided this year (1 Jan – 30 Sep 2026) exceeded the 30-day processing standard — ${fmtPct(100 - r.timelyPct)} of decisions, so ${fmtPct(r.timelyPct)} were timely. Another ${fmtInt(r.pendingOverScaled)} complete applications are still pending past 30 business days. Processing days count business days from a complete application (rule BR-006); counting calendar days from receipt would have flagged ${fmtInt(r.calendarOverScaled)}. ${worst.program} has the lowest timeliness at ${fmtPct(worst.timelyPct)}.${rowNote(persona)}`,
          table: { columns: ['Program', 'Decided (sample)', 'Over 30 business days', 'Timely %', 'Avg processing days', 'Pending past standard'], rows: r.rows.map((x) => [x.program, fmtInt(x.decided), fmtInt(x.over), fmtPct(x.timelyPct), fmtNum(x.avgDays, 1), x.pendingOver]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.program), values: r.rows.map((x) => Math.round(x.over * d.appScale)), unit: 'applications' },
          sql: `SELECT program_code,\n       COUNT_IF(processing_business_days > 30) AS applications_over_standard,  -- BR-007\n       AVG(IFF(within_standard, 1, 0)) * 100 AS timely_processing_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_CASE_MANAGEMENT\n WHERE decision_date BETWEEN '2026-01-01' AND '2026-09-30'\n   AND decision IN ('Approved', 'Denied')\n   -- BR-006: business days from COMPLETE_DATE, weekends and county holidays excluded${districtWhere(persona)}\n GROUP BY program_code\n ORDER BY applications_over_standard DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), note: `${fmtInt(r.decided)} decided applications in the sample, scaled ×${fmtNum(d.appScale, 0)}; ${r.incompleteExcluded} incomplete applications excluded.`,
          kpiValues: allow ? undefined : { 'K-11': r.overScaled, 'K-12': r.timelyPct, 'K-10': r.avgDays }, explorerTarget: 'DATA_PRODUCTS.DP_CASE_MANAGEMENT',
        };
      },
    },
    {
      id: 'S-07', agentId: 'AG-02', pattern: 7, productIds: ['DP-02'], kpiIds: ['K-09'],
      question: 'Which five offices have the largest case backlog?',
      paraphrases: ['top 5 offices by case backlog', 'offices with the biggest backlog', 'largest backlog by service center'],
      terms: [{ text: 'case backlog', termId: 'T-006' }],
      ruleIds: ['BR-008', 'BR-009'],
      semantic: { view: 'SV_CASE_MANAGEMENT', metrics: ['case_backlog', 'avg_caseload'], dimensions: ['office.office_name', 'office.district'], filters: ["case_status = 'Open'", "pending_action <> 'NONE'"] },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const r = Q.backlogByOffice(d, allow);
        const top = r.rows.slice(0, 5);
        return {
          summary: `${top[0].office} (${top[0].district}) has the largest case backlog: about ${fmtInt(top[0].backlog)} open cases with an application, renewal or change awaiting a decision, at a caseload of ${fmtInt(top[0].caseload)} cases per caseworker. The top five offices hold ${fmtInt(sum(top.map((x) => x.backlog)))} of ${fmtInt(r.backlog)} backlogged cases.${rowNote(persona)}`,
          table: { columns: ['Office', 'District', 'Case backlog', 'Open cases', 'Caseload', 'Oldest pending (business days)'], rows: top.map((x) => [x.office, x.district, fmtInt(x.backlog), fmtInt(x.openCases), fmtInt(x.caseload), x.oldestDays]) },
          chart: { kind: 'bar', labels: top.map((x) => x.code), values: top.map((x) => x.backlog), unit: 'cases' },
          sql: `SELECT o.office_name, o.district, COUNT_IF(c.pending_action <> 'NONE') AS case_backlog,  -- BR-008\n       COUNT(*) / MAX(o.caseworkers) AS avg_caseload\n  FROM ${DB}.CONFORMED_GOLD.FCT_CASE c\n  JOIN ${DB}.CONFORMED_GOLD.DIM_OFFICE o USING (office_key)\n WHERE c.case_status = 'Open'${districtWhere(persona)}\n GROUP BY 1, 2\n ORDER BY case_backlog DESC\n LIMIT 5;`,
          rows: top.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-09': r.backlog, 'K-14': r.caseload }, explorerTarget: 'CONFORMED_GOLD.DIM_OFFICE',
        };
      },
    },
    {
      id: 'S-08', agentId: 'AG-02', pattern: 8, productIds: ['DP-02', 'DP-06'], kpiIds: ['K-21', 'K-26'],
      question: 'What is our cost per case and caseworker vacancy rate?',
      paraphrases: ['cost per case and vacancy rate', 'administrative cost per case this year', 'caseworker vacancies and budget execution', 'how much does each case cost to administer'],
      terms: [{ text: 'cost per case', termId: 'T-022' }, { text: 'caseworker vacancy rate', termId: 'T-024' }],
      ruleIds: ['BR-016', 'BR-009'],
      semantic: { view: 'SV_CASE_MANAGEMENT', metrics: ['open_cases', 'avg_caseload'], dimensions: [], filters: ["case_status = 'Open'"] },
      run: ({ persona }) => {
        const w = Q.workforce(d);
        const bl = Q.backlogByOffice(d);
        return {
          summary: `Administrative cost per case is ${fmtUsd(w.costPerCase)} a year: ${fmtCompact(w.adminT12, 'USD')} of administrative spend over the last 12 months across ${fmtCompact(w.openCases)} open cases. ${fmtPct(w.vacancyPct)} of authorised caseworker positions are vacant, which keeps the caseload at ${fmtNum(bl.caseload, 1)} cases per caseworker, and year-to-date budget execution is ${fmtPct(w.budgetExecPct)}. Spend and position figures come from Workforce & Budget, which is a Draft product.${allowedDistricts(persona) ? ' Budget figures are county-wide; they carry no district.' : ''}`,
          table: { columns: ['Department', 'YTD budget', 'YTD actual', 'Execution %', 'Authorised FTE', 'Filled FTE', 'Vacancy %'], rows: w.rows.map((x) => [x.dept, fmtCompact(x.budget, 'USD'), fmtCompact(x.actual, 'USD'), fmtPct(x.execPct), fmtInt(x.fteBudget), fmtInt(x.fteFilled), fmtPct(x.vacancyPct)]) },
          chart: { kind: 'bar', labels: w.rows.map((x) => x.dept), values: w.rows.map((x) => x.vacancyPct), unit: '%' },
          sql: `SELECT SUM(IFF(is_administrative, actual_amount, 0)) / MAX(open_cases) AS cost_per_case  -- BR-016\n  FROM ${DB}.DATA_PRODUCTS.DP_WORKFORCE_BUDGET  -- DRAFT, not certified\n WHERE period_month BETWEEN '2025-10-01' AND '2026-09-01';\n\nSELECT department, (fte_budgeted - fte_filled) / fte_budgeted * 100 AS vacancy_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_WORKFORCE_BUDGET\n WHERE period_month = '2026-09-01';`,
          rows: w.rows.length + 1, kpiValues: { 'K-21': w.costPerCase, 'K-26': w.vacancyPct, 'K-25': w.budgetExecPct, 'K-14': bl.caseload },
        };
      },
    },
    {
      id: 'S-09', agentId: 'AG-02', pattern: 9, productIds: ['DP-02'], kpiIds: ['K-10'],
      question: 'Compare average processing days this year with last year',
      paraphrases: ['average processing days this year vs last year', 'processing time year over year', 'how does processing time compare to 2025'],
      terms: [{ text: 'processing days', termId: 'T-009' }],
      ruleIds: ['BR-006', 'BR-010'], instruction: 'Compare like-for-like months; processing days to one decimal.',
      semantic: { view: 'SV_CASE_MANAGEMENT', metrics: ['avg_processing_days', 'approval_rate'], dimensions: ['program.program_name', 'date.decision_quarter'], filters: ['Jan–Sep of each year'] },
      doc: { docId: 'DOC-01', chunk: 12 },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const r = Q.processingYoY(d, allow);
        const chg = r.cur.avgDays - r.prev.avgDays;
        return {
          summary: `Applications decided January–September 2026 took ${fmtNum(r.cur.avgDays, 1)} business days on average from a complete application, compared with ${fmtNum(r.prev.avgDays, 1)} for the same months of 2025 — ${chg < 0 ? 'an improvement' : 'a deterioration'} of ${fmtNum(Math.abs(chg), 1)} days. Timeliness moved from ${fmtPct(r.prev.timelyPct)} to ${fmtPct(r.cur.timelyPct)}, and the approval rate is ${fmtPct(r.cur.approvalPct)}.${rowNote(persona)}`,
          table: { columns: ['Program', 'Avg days 2025 YTD', 'Avg days 2026 YTD', 'Change', 'Timely % 2026'], rows: r.rows.map((x) => [x.program, fmtNum(x.prev.avgDays, 1), fmtNum(x.cur.avgDays, 1), fmtNum(x.cur.avgDays - x.prev.avgDays, 1), fmtPct(x.cur.timelyPct)]) },
          chart: { kind: 'bar', labels: ['2025 YTD', '2026 YTD'], values: [r.prev.avgDays, r.cur.avgDays], unit: 'business days' },
          sql: `SELECT YEAR(decision_date) AS decision_year, program_code,\n       AVG(processing_business_days) AS avg_processing_days  -- BR-006\n  FROM ${DB}.DATA_PRODUCTS.DP_CASE_MANAGEMENT\n WHERE MONTH(decision_date) <= 9 AND YEAR(decision_date) IN (2025, 2026)\n   AND decision IN ('Approved', 'Denied')${districtWhere(persona)}\n GROUP BY 1, 2;`,
          rows: r.rows.length * 2, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-10': r.cur.avgDays, 'K-13': r.cur.approvalPct },
        };
      },
    },
    {
      id: 'S-10', agentId: 'AG-03', pattern: 10, productIds: ['DP-03'], kpiIds: ['K-18'],
      question: 'What is the improper payment rate year to date?',
      paraphrases: ['improper payment rate ytd', 'how much was paid improperly this year', 'payment error rate year to date'],
      terms: [{ text: 'improper payment rate', termId: 'T-015' }],
      ruleIds: ['BR-011'],
      semantic: { view: 'SV_BENEFIT_PAYMENTS', metrics: ['improper_payment_rate', 'improper_payment_amount', 'total_benefits_paid'], dimensions: [], filters: ["issue_date BETWEEN '2026-01-01' AND '2026-09-30'"] },
      doc: { docId: 'DOC-04', chunk: 5 },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const r = Q.paymentSummary(d, Q.PERIODS.ytd, allow);
        const prev = Q.paymentSummary(d, Q.PERIODS.priorYtd, allow);
        return {
          summary: `The improper payment rate year to date (Jan–Sep 2026) is ${fmtPct(r.improperRate, 2)}: $${fmtNum(r.improper / 1e6, 1)} M of $${fmtNum(r.paid / 1e6, 1)} M in benefits issued was over- or under-paid. An improper payment is any payment made in the wrong amount or to an ineligible recipient, measured in dollars. The same months of 2025 ran at ${fmtPct(prev.improperRate, 2)}.${rowNote(persona)}`,
          table: { columns: ['Measure', 'Jan–Sep 2025', 'Jan–Sep 2026'], rows: [['Benefits paid', fmtCompact(prev.paid, 'USD'), fmtCompact(r.paid, 'USD')], ['Improper dollars', fmtCompact(prev.improper, 'USD'), fmtCompact(r.improper, 'USD')], ['Improper payment rate', fmtPct(prev.improperRate, 2), fmtPct(r.improperRate, 2)], ['Payment accuracy', fmtPct(prev.accuracyPct), fmtPct(r.accuracyPct)]] },
          chart: { kind: 'bar', labels: ['2025 YTD', '2026 YTD'], values: [prev.improperRate, r.improperRate], unit: '%' },
          sql: `SELECT SUM(improper_amount) / SUM(payment_amount) * 100 AS improper_payment_rate,  -- BR-011\n       SUM(improper_amount) AS improper_payment_amount, SUM(payment_amount) AS total_benefits_paid\n  FROM ${DB}.DATA_PRODUCTS.DP_BENEFIT_PAYMENTS\n WHERE issue_date BETWEEN '2026-01-01' AND '2026-09-30'${districtWhere(persona)};`,
          rows: 1, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-18': r.improperRate, 'K-19': Math.round(r.improper), 'K-16': Math.round(r.paid) },
        };
      },
    },
    {
      id: 'S-11', agentId: 'AG-03', pattern: 11, productIds: ['DP-03'], kpiIds: ['K-19'],
      question: 'Show improper payments over $300 issued last quarter',
      paraphrases: ['improper payments above $300 last quarter', 'list improper payments greater than 300 dollars in Q3', 'large improper payments issued last quarter'],
      terms: [{ text: 'improper payments', termId: 'T-015' }],
      ruleIds: ['BR-011', 'BR-012'],
      semantic: { view: 'SV_BENEFIT_PAYMENTS', metrics: ['improper_payment_amount'], dimensions: ['program.program_name', 'payment.error_type'], filters: ["fiscal_quarter = '2026-Q3'", 'improper_amount > 300'] },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const list = Q.largeImproper(d, 300, allow);
        const shown = list.slice(0, 10);
        const byProg = PROGRAMS.filter((p) => p.pays).map((p) => ({ p: p.name, n: list.filter((x) => x.program === p.code).length })).filter((x) => x.n);
        return {
          summary: `${list.length} payments issued in Q3 2026 had an improper amount over $300 in the sample, totalling ${fmtUsd(sum(list.map((x) => x.improperAmount)), 0)} (≈ ${fmtCompact(sum(list.map((x) => x.improperAmount)) * d.scale, 'USD')} county-wide). Most are ${byProg.sort((a, b) => b.n - a.n)[0]?.p ?? 'n/a'} payments; the largest ${shown.length} are listed. Government identifiers are never shown.${rowNote(persona)}`,
          table: { columns: ['Payment', 'Program', 'District', 'Issued', 'Amount', 'Improper amount', 'Error type'], rows: shown.map((x) => [x.paymentId, Q.programName(x.program), x.district, x.date, fmtUsd(x.amount), fmtUsd(x.improperAmount), x.errorType ?? '']) },
          sql: `SELECT payment_id, program_code, district, issue_date, payment_amount, improper_amount, error_type\n  FROM ${DB}.DATA_PRODUCTS.DP_BENEFIT_PAYMENTS\n WHERE issue_date BETWEEN '2026-07-01' AND '2026-09-30'\n   AND is_improper AND improper_amount > 300${districtWhere(persona)}\n ORDER BY improper_amount DESC\n LIMIT 10;`,
          rows: shown.length, rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_BENEFIT_PAYMENTS',
        };
      },
    },
    {
      id: 'S-12', agentId: 'AG-03', pattern: 12, productIds: ['DP-03'], kpiIds: ['K-17'],
      question: 'What is our payment accuracy rate by program this year?',
      paraphrases: ['payment accuracy by program', 'accuracy rate of benefit payments per program', 'which programs have the best payment accuracy'],
      terms: [{ text: 'payment accuracy', termId: 'T-014' }],
      ruleIds: ['BR-012', 'BR-013'],
      semantic: { view: 'SV_BENEFIT_PAYMENTS', metrics: ['payment_accuracy_rate', 'on_time_payment_rate'], dimensions: ['program.program_name'], filters: ["issue_date BETWEEN '2026-01-01' AND '2026-09-30'"] },
      doc: { docId: 'DOC-04', chunk: 9 },
      run: ({ persona }) => {
        const allow = allowedDistricts(persona);
        const rows = Q.paymentsByProgram(d, Q.PERIODS.ytd, allow);
        const all = Q.paymentSummary(d, Q.PERIODS.ytd, allow);
        const best = [...rows].sort((a, b) => b.accuracyPct - a.accuracyPct)[0];
        const worst = [...rows].sort((a, b) => a.accuracyPct - b.accuracyPct)[0];
        return {
          summary: `Payment accuracy — the share of payments issued in the correct amount to an eligible recipient (term T-014) — is ${fmtPct(all.accuracyPct)} year to date against the county target of 96%. ${best.program} is most accurate (${fmtPct(best.accuracyPct)}) and ${worst.program} least (${fmtPct(worst.accuracyPct)}). ${fmtPct(all.onTimePct)} of payments were issued on time.${rowNote(persona)}`,
          table: { columns: ['Program', 'Payments (county)', 'Benefits paid', 'Accuracy %', 'Improper rate %', 'On time %'], rows: rows.map((x) => [x.program, fmtCompact(x.payments), fmtCompact(x.paid, 'USD'), fmtPct(x.accuracyPct), fmtPct(x.improperRate, 2), fmtPct(x.onTimePct)]) },
          chart: { kind: 'bar', labels: rows.map((x) => x.code), values: rows.map((x) => x.accuracyPct), unit: '%' },
          sql: `SELECT program_code,\n       AVG(IFF(is_improper, 0, 1)) * 100 AS payment_accuracy_rate,  -- T-014 / BR-012\n       AVG(IFF(issued_on_time, 1, 0)) * 100 AS on_time_payment_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_BENEFIT_PAYMENTS\n WHERE issue_date BETWEEN '2026-01-01' AND '2026-09-30'${districtWhere(persona)}\n GROUP BY program_code\n ORDER BY payment_accuracy_rate DESC;`,
          rows: rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-17': all.accuracyPct, 'K-20': all.onTimePct },
        };
      },
    },
    {
      id: 'S-13', agentId: 'AG-04', pattern: 13, productIds: [], kpiIds: [],
      question: 'Which critical data elements lack a steward?',
      paraphrases: ['cdes without a steward', 'unowned critical data elements', 'which CDEs have no steward assigned'],
      terms: [],
      ruleIds: [],
      run: () => {
        const p = packRef();
        const gaps = p.glossary.filter((t) => t.isCde && !t.steward);
        const draft = p.glossary.filter((t) => t.status === 'Draft');
        const feeds = (t: GlossaryTerm) => p.products.filter((pr) => pr.kpiIds.some((k) => p.kpis.find((x) => x.id === k)?.termId === t.id));
        const fed = [...new Set(gaps.flatMap((t) => feeds(t)))];
        return {
          summary: `${gaps.length} critical data element${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'has' : 'have'} no steward: ${gaps.map((t) => `${t.term} (${t.id}, owner ${t.owner})`).join(', ')}. It feeds ${fed.map((x) => `the ${x.status} product ${x.name}`).join(' and ') || 'no product yet'}. Also note ${draft.length} Draft term: ${draft.map((t) => t.term).join(', ')}.`,
          table: { columns: ['Term', 'Id', 'Domain', 'Owner', 'Steward', 'Next action'], rows: gaps.map((t) => [t.term, t.id, t.domain, t.owner, '— none —', `Assign a finance steward before ${feeds(t).map((x) => x.id).join(', ') || 'use'} enters certification`]) },
          sql: `SELECT t.term_id, t.term, t.domain, t.owner\n  FROM ${DB}.GLOSSARY.BUSINESS_TERM t\n  JOIN ${DB}.GLOSSARY.CDE_REGISTER c USING (term_id)\n WHERE t.is_cde AND c.steward IS NULL;`,
          rows: gaps.length, explorerTarget: 'GLOSSARY.CDE_REGISTER',
        };
      },
    },
    {
      id: 'S-14', agentId: 'AG-04', pattern: 14, productIds: [], kpiIds: [],
      question: 'Where is the term Active Constituent used?',
      paraphrases: ['lineage of active constituent', 'what uses the active constituent definition', 'where does active constituent appear'],
      terms: [{ text: 'Active Constituent', termId: 'T-002' }],
      ruleIds: ['BR-001'],
      run: () => {
        const p = packRef();
        const t = p.glossary.find((x) => x.id === 'T-002') as GlossaryTerm;
        const metrics = t.metricRefs;
        const products = p.products.filter((pr) => pr.semanticView && metrics.some((m) => m.startsWith(pr.semanticView!)) && pr.kpiIds.includes('K-01'));
        const agents = p.agents.filter((a) => a.productIds.some((x) => products.some((pr) => pr.id === x)));
        return {
          summary: `"Active Constituent" (T-002) is mapped to ${t.mappings.length} columns, defines the metric ${metrics.join(', ')}, is enforced by rule BR-001, and flows into ${products.map((x) => `${x.name} (${x.id})`).join(', ')} and the ${agents.map((a) => a.name).join(', ')} agent.`,
          table: { columns: ['Layer', 'Object', 'Usage'], rows: [
            ...t.mappings.map((m) => ['Column', `${m.fqn}.${m.column}`, m.kind]),
            ...metrics.map((m) => ['Semantic metric', m, 'defines']),
            ['Context rule', 'BR-001', 'business rule'],
            ...products.map((x) => ['Data product', `${x.id} ${x.name}`, 'KPI K-01']),
            ...agents.map((a) => ['Agent', a.objectName, 'answers with it']),
          ] },
          sql: `SELECT 'column' AS kind, object_fqn || '.' || column_name AS ref\n  FROM ${DB}.GLOSSARY.TERM_COLUMN_MAP WHERE term_id = 'T-002'\nUNION ALL\nSELECT 'rule', rule_id FROM ${DB}.CONTEXT.BUSINESS_RULES WHERE applies_to_metric ILIKE '%active_constituents%'\nUNION ALL\nSELECT 'product', product_id FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY WHERE semantic_view = 'SV_CONSTITUENT_360';`,
          rows: t.mappings.length + metrics.length + products.length + agents.length + 1, explorerTarget: 'GLOSSARY.TERM_COLUMN_MAP',
        };
      },
    },
    {
      id: 'S-15', agentId: 'AG-04', pattern: 15, productIds: [], kpiIds: [],
      question: 'Which data products are not yet certified, and what is blocking them?',
      paraphrases: ['uncertified products and blockers', 'what is blocking certification', 'which products are still in certification or draft'],
      terms: [],
      ruleIds: [],
      run: ({ live }) => {
        const p = packRef();
        const script = p.certificationScript;
        const pending = p.products.filter((x) => (live.productStatus[x.id] ?? x.status) !== 'Certified');
        const blockers = (id: string): string => {
          if (id === script.productId) {
            const fixed = live.fixes[id] ?? [];
            const open = script.failures.filter((f) => !fixed.includes(f.checkId));
            return open.length ? open.map((f) => `Gate ${f.gate}: ${f.detail}`).join('; ') : 'All gates pass — awaiting steward sign-off (Certify & publish)';
          }
          const prod = p.products.find((x) => x.id === id)!;
          return `${prod.steward ? '' : 'Gate 1: no steward assigned; '}no semantic view; gates 3–8 not started`;
        };
        return {
          summary: pending.length
            ? `${pending.length} data product${pending.length > 1 ? 's are' : ' is'} not yet certified: ${pending.map((x) => `${x.name} (${live.productStatus[x.id] ?? x.status})`).join(' and ')}. ${pending.some((x) => x.id === script.productId) ? `${p.products.find((x) => x.id === script.productId)!.name} is the closest to certification.` : ''}`
            : 'Every data product is certified.',
          table: { columns: ['Product', 'Status', 'Version', 'Blocking'], rows: pending.map((x) => [`${x.id} ${x.name}`, live.productStatus[x.id] ?? x.status, live.productVersion[x.id] ?? x.version, blockers(x.id)]) },
          sql: `SELECT product_id, name, status, version\n  FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY\n WHERE status <> 'Certified';  -- read live`,
          rows: pending.length, explorerTarget: 'DATA_PRODUCTS.DP_REGISTRY',
        };
      },
    },
  ];
}

