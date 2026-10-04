// The 15 Healthcare agent scenarios (spec section 9). Every number is computed from the in-memory sample.
import type { GlossaryTerm, IndustryPack, Persona, Scenario } from '../../types';
import { sum } from '../../mock-snowflake/generators';
import { maskFor } from '../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import type { HcData } from './data';
import * as Q from './queries';

const DB = 'CVH_AI_PLATFORM';
const allowedMarkets = (p: Persona) => (p.rowFilter?.column === 'MARKET' ? p.rowFilter.allowed : undefined);
const rowNote = (p: Persona) => (allowedMarkets(p) ? ` Row access policy limited results to the ${allowedMarkets(p)!.join(' and ')} markets.` : '');
const mkWhere = (p: Persona) => (allowedMarkets(p) ? `\n  -- RAP_MARKET_ACCESS applied by Snowflake: MARKET IN (${allowedMarkets(p)!.map((m) => `'${m}'`).join(', ')})` : '');
const short = (h: string) => h.replace('Crestview ', '');

type PackLike = Pick<IndustryPack, 'glossary' | 'products' | 'agents' | 'semanticViews' | 'certificationScript' | 'context'>;

export function buildScenarios(d: HcData, packRef: () => PackLike): Scenario[] {
  return [
    {
      id: 'S-01', agentId: 'AG-01', pattern: 1, productIds: ['DP-03'], kpiIds: ['K-06'],
      question: 'What was the claim denial rate last quarter by payer?',
      paraphrases: ['claim denial rate by payer last quarter', 'denial rate per payer in Q3', 'which payers had the highest claim denial rate last quarter', 'Q3 denials by payer'],
      terms: [{ text: 'claim denial rate', termId: 'T-017' }, { text: 'payer', termId: 'T-020' }],
      ruleIds: ['BR-003'], instruction: 'Report rates to one decimal; say the period is by submission date.',
      semantic: { view: 'SV_PATIENT_REVENUE', metrics: ['denial_rate'], dimensions: ['payer.payer_name'], filters: ['submit_month in Q3 2026'] },
      doc: { docId: 'DOC-04', chunk: 3 },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const r = Q.denialByPayer(d, Q.PERIODS.quarter, allow);
        const top = r.rows[0];
        const reasons = Q.denialReasons(d, Q.PERIODS.quarter, allow);
        return {
          summary: `The initial claim denial rate for claims submitted in Q3 2026 (Jul–Sep) was ${fmtPct(r.rate)} — ${fmtInt(r.denied)} of ${fmtInt(r.claims)} sample claims. ${top.payer} had the highest rate at ${fmtPct(top.rate)} (top reason: ${top.topReason.toLowerCase()}). Across all payers, ${reasons[0].reason.toLowerCase()} was the leading denial reason (${fmtPct(reasons[0].pct)} of denials). Self-pay accounts are billed to the patient and cannot be denied.${rowNote(persona)}`,
          table: { columns: ['Payer', 'Payer class', 'Claims (sample)', 'Denied', 'Denial rate', 'Top reason'], rows: r.rows.map((x) => [x.payer, x.payerClass, fmtInt(x.claims), fmtInt(x.denied), fmtPct(x.rate), x.topReason]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.payer.split(' ')[0]), values: r.rows.map((x) => x.rate), unit: '%' },
          sql: `SELECT payer.payer_name, AVG(IFF(claim.is_denied, 1, 0)) * 100 AS denial_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_REVENUE_CYCLE -- via SV_PATIENT_REVENUE\n WHERE submit_date BETWEEN '2026-07-01' AND '2026-09-30'  -- BR-003 initial denials by submission date${mkWhere(persona)}\n GROUP BY payer.payer_name\n ORDER BY denial_rate DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-06': r.rate, 'K-07': r.cleanRate },
        };
      },
    },
    {
      id: 'S-02', agentId: 'AG-01', pattern: 2, productIds: ['DP-01'], kpiIds: ['K-01', 'K-02'],
      question: 'How many active patients are self-pay?',
      paraphrases: ['active patients with self-pay coverage', 'how many uninsured active patients do we have', 'self-pay share of active patients', 'count of active patients without insurance'],
      terms: [{ text: 'active patients', termId: 'T-002' }, { text: 'self-pay', termId: 'T-020' }],
      ruleIds: ['BR-001', 'BR-002'], instruction: 'State which patients count as active and how payer class is assigned.',
      semantic: { view: 'SV_PATIENT_REVENUE', metrics: ['active_patients', 'self_pay_share'], dimensions: ['patient.payer_class'], filters: ['Active Patient rule BR-001'] },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const r = Q.activeByPayerClass(d, allow);
        return {
          summary: `${fmtCompact(r.selfPay.patients)} active patients are self-pay — ${fmtPct(r.selfPay.share)} of ${fmtCompact(r.activeScaled)} active patients. "Active" follows rule BR-001: alive, with a completed inpatient discharge, ED visit or clinic visit in the last 12 months, which leaves out ${fmtInt(r.notActive * d.scale.patients)} living patients with no recent encounter. Self-pay means no active coverage on the current registration (BR-002).${rowNote(persona)}`,
          table: { columns: ['Payer class', 'Active patients', 'Share'], rows: [...r.rows.map((x) => [x.payerClass, fmtInt(x.patients), fmtPct(x.share)]), ['All active patients', fmtInt(r.activeScaled), '100.0%']] },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.payerClass), values: r.rows.map((x) => x.patients), unit: 'patients' },
          sql: `SELECT payer_class, COUNT(*) AS active_patients\n  FROM ${DB}.DATA_PRODUCTS.DP_PATIENT_360\n WHERE is_active  -- BR-001: alive AND completed encounter in the last 12 months${mkWhere(persona)}\n GROUP BY payer_class\n ORDER BY active_patients DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), note: `Sample of ${fmtInt(r.active)} active patients scaled ×${fmtNum(d.scale.patients, 0)} to the 1.24 M patient base.`,
          kpiValues: allow ? undefined : { 'K-01': r.activeScaled, 'K-02': r.selfPay.share, 'K-03': r.portalPct, 'K-04': r.avgRisk },
        };
      },
    },
    {
      id: 'S-03', agentId: 'AG-01', pattern: 3, productIds: ['DP-01'], kpiIds: ['K-09'],
      question: 'Which patients have an open balance over $5,000 older than 90 days?',
      paraphrases: ['patients with open balances above 5000 older than 90 days', 'list patient accounts over $5,000 aged past 90 days', 'aged patient balances over 5k', 'which patient accounts have balances older than 90 days'],
      terms: [{ text: 'open balance', termId: 'T-018' }, { text: 'older than 90 days', termId: 'T-028' }, { text: 'patients', termId: 'T-001' }],
      ruleIds: ['BR-006', 'BR-017'], instruction: 'Apply HIPAA minimum necessary: never reveal PHI unless the role may see it.',
      semantic: { view: 'SV_PATIENT_REVENUE', metrics: ['open_ar_balance'], dimensions: ['patient.mrn', 'patient.patient_name', 'patient.market'], filters: ['days_outstanding > 90', 'open balance > 5,000'] },
      doc: { docId: 'DOC-02', chunk: 6 },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const list = Q.agedBalances(d, 5000, 90, allow);
        const masked = !persona.unmasked.includes('PHI');
        const shown = list.slice(0, 8);
        return {
          summary: `${list.length} patient accounts in the sample carry open balances over $5,000 that are more than 90 days past the service date (≈ ${fmtCompact(list.length * d.scale.patients)} accounts system-wide), totalling ${fmtUsd(sum(list.map((x) => x.balance)), 0)} in the sample; ${list.filter((x) => x.denied).length} involve a denial still being worked. The largest ${shown.length} are listed.${masked ? ' Names and MRNs are masked by MP_MASK_PHI for your role (HIPAA minimum necessary).' : ''}${rowNote(persona)}`,
          table: {
            columns: ['MRN', 'Patient', 'Market', 'Payer', 'Open balance', 'Oldest (days)'],
            rows: shown.map((x) => [String(maskFor(persona, 'PHI', x.p.mrn)), String(maskFor(persona, 'PHI', `${x.p.first} ${x.p.last}`)), x.p.market, x.payer, fmtUsd(x.balance, 0), x.oldest]),
            masked: masked ? [0, 1] : [],
          },
          sql: `SELECT mrn, patient_name, market, primary_payer, aged_90_balance\n  FROM ${DB}.DATA_PRODUCTS.DP_PATIENT_360\n WHERE aged_90_balance > 5000  -- BR-006 aging from service date${mkWhere(persona)}\n ORDER BY aged_90_balance DESC\n LIMIT 8;`,
          rows: shown.length, maskedColumns: masked ? ['MRN', 'PATIENT_NAME'] : [], rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_PATIENT_360',
        };
      },
    },
    {
      id: 'S-04', agentId: 'AG-01', pattern: 4, productIds: ['DP-05'], kpiIds: ['K-22'],
      question: 'What is our supply cost per surgical case this quarter?',
      paraphrases: ['supply cost per surgical case this quarter', 'average supply cost per surgery in Q3', 'how much do supplies cost per surgical case', 'surgical case supply cost'],
      terms: [{ text: 'supply cost per surgical case', termId: 'T-024' }],
      ruleIds: ['BR-015'], instruction: 'Report dollars per case and the change from last quarter.',
      semantic: { view: 'SV_SUPPLY_CHAIN', metrics: ['supply_cost_per_case'], dimensions: ['encounter.service_line'], filters: ["fiscal_quarter = '2026-Q3'"] },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const cur = Q.supplyCostPerCase(d, Q.PERIODS.quarter, allow);
        const prev = Q.supplyCostPerCase(d, Q.PERIODS.priorQuarter, allow);
        const chg = ((cur.perCase - prev.perCase) / prev.perCase) * 100;
        const spend = Q.supplySpend(d, Q.PERIODS.quarter, allow);
        return {
          summary: `Supply cost per surgical case in Q3 2026 was ${fmtUsd(cur.perCase, 0)} across ${fmtInt(cur.cases)} sample surgical cases (≈ ${fmtCompact(cur.casesScaled)} system-wide), ${chg >= 0 ? 'up' : 'down'} ${fmtPct(Math.abs(chg))} from ${fmtUsd(prev.perCase, 0)} in Q2. ${cur.rows[0].serviceLine} is highest at ${fmtUsd(cur.rows[0].perCase, 0)} per case; implants and cardiac devices are ${fmtPct(cur.implantShare)} of surgical supply cost. Pharmacy is excluded (rule BR-015).${rowNote(persona)}`,
          table: { columns: ['Service line', 'Surgical cases (sample)', 'Supply cost', 'Cost per case'], rows: cur.rows.map((x) => [x.serviceLine, x.cases, fmtUsd(x.cost, 0), fmtUsd(x.perCase, 0)]) },
          chart: { kind: 'bar', labels: cur.rows.map((x) => x.serviceLine), values: cur.rows.map((x) => x.perCase), unit: 'USD' },
          sql: `SELECT service_line,\n       SUM(IFF(item_type = 'Supply', cost_usd, 0)) / COUNT(DISTINCT encounter_id) AS supply_cost_per_case -- BR-015\n  FROM ${DB}.DATA_PRODUCTS.DP_CLINICAL_SUPPLY_CHAIN\n WHERE is_surgical_case\n   AND usage_date BETWEEN '2026-07-01' AND '2026-09-30'${mkWhere(persona)}\n GROUP BY service_line\n ORDER BY supply_cost_per_case DESC;`,
          rows: cur.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-22': cur.perCase, 'K-23': Math.round(spend.scaled), 'K-24': spend.onContractPct },
        };
      },
    },
    {
      id: 'S-05', agentId: 'AG-01', pattern: 5, productIds: ['DP-03'], kpiIds: ['K-10', 'K-07'],
      question: 'Show daily claim submissions for the last 30 days',
      paraphrases: ['claims submitted per day over the last 30 days', 'daily claim volume this month', 'trend of claim submissions by day', 'claim submissions per day in September'],
      terms: [{ text: 'claim submissions', termId: 'T-015' }],
      ruleIds: ['BR-004'],
      semantic: { view: 'SV_PATIENT_REVENUE', metrics: ['claims_submitted', 'clean_claim_rate'], dimensions: ['claim.submit_date'], filters: ["submit_date BETWEEN '2026-09-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const r = Q.claimsDaily(d, Q.PERIODS.last30, allow);
        const weekdays = r.rows.filter((x) => { const w = new Date(`${x.day}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; });
        const peak = r.rows.reduce((a, b) => (b.scaled > a.scaled ? b : a));
        return {
          summary: `Crestview submitted ≈ ${fmtCompact(r.scaled)} claims in the last 30 days (1–30 Sep 2026), about ${fmtCompact(sum(weekdays.map((x) => x.scaled)) / Math.max(1, weekdays.length))} per weekday; the busiest day was ${peak.day} with ≈ ${fmtCompact(peak.scaled)}. The clean claim rate over the period was ${fmtPct(r.cleanRate)}.${rowNote(persona)}`,
          table: { columns: ['Submission date', 'Claims (system)', 'Clean %'], rows: r.rows.map((x) => [x.day, fmtInt(x.scaled), fmtPct(x.cleanPct)]) },
          chart: { kind: 'line', labels: r.rows.map((x) => x.day.slice(5)), values: r.rows.map((x) => x.scaled), unit: 'claims' },
          sql: `SELECT submit_date, COUNT(*) AS claims_submitted, AVG(IFF(is_clean, 1, 0)) * 100 AS clean_claim_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_REVENUE_CYCLE\n WHERE submit_date BETWEEN '2026-09-01' AND '2026-09-30'${mkWhere(persona)}\n GROUP BY submit_date\n ORDER BY submit_date;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), note: `FCT_CLAIM sample scaled ×${fmtNum(d.scale.claims, 0)} to system volume.`,
          kpiValues: allow ? undefined : { 'K-10': r.scaled, 'K-07': r.cleanRate },
        };
      },
    },
    {
      id: 'S-06', agentId: 'AG-02', pattern: 6, productIds: ['DP-04'], kpiIds: ['K-18'],
      question: 'What is our 30-day all-cause readmission rate by service line?',
      paraphrases: ['readmission rate by service line', '30 day readmissions per service line this year', 'all-cause readmission rate by service line', 'how often are patients readmitted within 30 days by service line'],
      terms: [{ text: '30-day all-cause readmission', termId: 'T-006' }, { text: 'service line', termId: 'T-009' }],
      ruleIds: ['BR-012', 'BR-013'], instruction: 'Use the CMS method; rates to one decimal; name the index discharge window.',
      semantic: { view: 'SV_QUALITY', metrics: ['readmission_rate_30d'], dimensions: ['readmit.service_line'], filters: ['is_eligible_index = TRUE', "discharge_date BETWEEN '2026-01-01' AND '2026-08-31'"] },
      doc: { docId: 'DOC-01', chunk: 11 },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const r = Q.readmissions(d, Q.PERIODS.readmitYtd, allow);
        const top = r.rows[0];
        const low = r.rows[r.rows.length - 1];
        return {
          summary: `The 30-day all-cause readmission rate for index discharges ${Q.PERIODS.readmitYtd.label} is ${fmtPct(r.rate)} (${fmtInt(r.readmits)} of ${fmtInt(r.index)} eligible index stays in the sample). ${top.serviceLine} is highest at ${fmtPct(top.rate)} and ${low.serviceLine} lowest at ${fmtPct(low.rate)}. Following the CMS method, ${r.plannedExcluded} stays followed only by a planned readmission were not counted, and ${r.transfers} transfers, ${r.expired} deaths and ${r.ama} discharges against medical advice were excluded from the denominator. September discharges are not reported yet because their 30-day window is still open.${rowNote(persona)}`,
          table: { columns: ['Service line', 'Eligible index stays', 'Readmissions', 'Readmission rate'], rows: r.rows.map((x) => [x.serviceLine, fmtInt(x.index), fmtInt(x.readmits), fmtPct(x.rate)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.serviceLine), values: r.rows.map((x) => x.rate), unit: '%' },
          sql: `SELECT service_line,\n       SUM(IFF(readmit_30d_flag, 1, 0)) / COUNT(*) * 100 AS readmission_rate_30d\n  FROM ${DB}.DATA_PRODUCTS.DP_QUALITY_READMISSIONS\n WHERE is_eligible_index        -- BR-012: transfers, deaths, AMA excluded; planned readmissions not counted\n   AND discharge_date BETWEEN '2026-01-01' AND '2026-08-31'  -- BR-013 closed 30-day window${mkWhere(persona)}\n GROUP BY service_line\n ORDER BY readmission_rate_30d DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-18': r.rate, 'K-21': Math.round(r.readmits * d.scale.ip) }, explorerTarget: 'DATA_PRODUCTS.DP_QUALITY_READMISSIONS',
        };
      },
    },
    {
      id: 'S-07', agentId: 'AG-02', pattern: 7, productIds: ['DP-02'], kpiIds: ['K-12'],
      question: 'Which five hospitals had the highest bed occupancy last quarter?',
      paraphrases: ['top 5 hospitals by bed occupancy', 'highest occupancy hospitals in Q3', 'top five hospitals by occupancy last quarter', 'which hospitals were fullest last quarter'],
      terms: [{ text: 'bed occupancy', termId: 'T-010' }],
      ruleIds: ['BR-009'],
      semantic: { view: 'SV_THROUGHPUT', metrics: ['bed_occupancy_pct'], dimensions: ['facility.facility_name', 'facility.market'], filters: ["fiscal_quarter = '2026-Q3'"] },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const r = Q.occupancy(d, Q.PERIODS.quarter, allow);
        const top = r.rows.slice(0, 5);
        return {
          summary: `In Q3 2026 (Jul–Sep) bed occupancy averaged ${fmtPct(r.occupancy)} ${allow ? 'across your markets' : 'system-wide'} — an average daily census of ${fmtInt(r.adc)} on ${fmtInt(r.beds)} staffed beds. The fullest hospital was ${top[0].hospital} at ${fmtPct(top[0].occupancy)}, followed by ${top.slice(1).map((x) => `${short(x.hospital)} (${fmtPct(x.occupancy)})`).join(', ')}.${rowNote(persona)}`,
          table: { columns: ['Hospital', 'Market', 'Staffed beds', 'Avg daily census', 'Occupancy'], rows: top.map((x) => [x.hospital, x.market, fmtInt(x.beds), fmtInt(x.adc), fmtPct(x.occupancy)]) },
          chart: { kind: 'bar', labels: top.map((x) => short(x.hospital)), values: top.map((x) => x.occupancy), unit: '%' },
          sql: `SELECT f.facility_name, f.market,\n       SUM(e.inpatient_nights) / (MAX(f.staffed_beds) * 92) * 100 AS bed_occupancy_pct  -- BR-009\n  FROM ${DB}.DATA_PRODUCTS.DP_ENCOUNTERS_THROUGHPUT e\n  JOIN ${DB}.CONFORMED_GOLD.DIM_FACILITY f USING (facility_name)\n WHERE e.encounter_type = 'Inpatient' AND e.census_date BETWEEN '2026-07-01' AND '2026-09-30'${mkWhere(persona)}\n GROUP BY 1, 2\n ORDER BY bed_occupancy_pct DESC\n LIMIT 5;`,
          rows: top.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-12': r.occupancy, 'K-15': Q.dischargesMonthly(d).scaled }, explorerTarget: 'CONFORMED_GOLD.DIM_FACILITY',
        };
      },
    },
    {
      id: 'S-08', agentId: 'AG-02', pattern: 8, productIds: ['DP-04', 'DP-06'], kpiIds: ['K-26', 'K-25'],
      question: 'How many patients have open care gaps, and what is their readmission rate?',
      paraphrases: ['patients with open care gaps and their readmission rate', 'open care gaps and readmissions', 'how many patients have open care gaps', 'care gap closure rate'],
      terms: [{ text: 'open care gaps', termId: 'T-026' }, { text: 'readmission rate', termId: 'T-006' }],
      ruleIds: ['BR-018', 'BR-012'],
      semantic: { view: 'SV_QUALITY', metrics: ['readmission_rate_30d'], dimensions: ['care_gap.gap_status'], filters: ["discharge_date BETWEEN '2026-01-01' AND '2026-08-31'"] },
      doc: { docId: 'DOC-03', chunk: 22 },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const g = Q.careGaps(d, allow);
        return {
          summary: `${fmtCompact(g.openPatientsScaled)} attributed patients — ${fmtPct(g.openPatientPct)} of patients with at least one eligible measure — have an open care gap, and the gap closure rate for 2026 is ${fmtPct(g.closureRate)}. Patients with an open gap had a 30-day readmission rate of ${fmtPct(g.readmitOpen.rate)} versus ${fmtPct(g.readmitClosed.rate)} for patients with all gaps closed (index discharges ${Q.PERIODS.readmitYtd.label}). The care-gap figures come from Care Gaps & Population Health, which is a Draft product.${rowNote(persona)}`,
          table: { columns: ['Measure', 'Eligible', 'Open gaps', 'Closure rate'], rows: g.measures.map((x) => [x.measure, fmtInt(x.eligible), fmtInt(x.open), fmtPct(x.closureRate)]) },
          chart: { kind: 'bar', labels: ['Open gap', 'All gaps closed'], values: [g.readmitOpen.rate, g.readmitClosed.rate], unit: '% readmitted' },
          sql: `SELECT measure, COUNT(*) AS eligible, COUNT_IF(gap_status = 'Open') AS open_gaps  -- BR-018\n  FROM ${DB}.DATA_PRODUCTS.DP_CARE_GAPS  -- DRAFT, not certified\n GROUP BY measure;\n\nSELECT IFF(g.patient_mrn IS NOT NULL, 'Open gap', 'All closed') AS cohort,\n       SUM(IFF(r.readmit_30d_flag, 1, 0)) / COUNT(*) * 100 AS readmission_rate_30d  -- BR-012\n  FROM ${DB}.DATA_PRODUCTS.DP_QUALITY_READMISSIONS r\n  LEFT JOIN (SELECT DISTINCT patient_mrn FROM ${DB}.DATA_PRODUCTS.DP_CARE_GAPS WHERE gap_status = 'Open') g USING (patient_mrn)\n WHERE r.is_eligible_index AND r.discharge_date BETWEEN '2026-01-01' AND '2026-08-31'${mkWhere(persona)}\n GROUP BY 1;`,
          rows: g.measures.length + 2, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-26': g.openPatientPct, 'K-25': g.closureRate },
        };
      },
    },
    {
      id: 'S-09', agentId: 'AG-02', pattern: 9, productIds: ['DP-02'], kpiIds: ['K-11'],
      question: 'Compare average length of stay this year with last year',
      paraphrases: ['average length of stay this year vs last year', 'ALOS year over year', 'how does average length of stay compare to 2025', 'length of stay this year compared with last year'],
      terms: [{ text: 'average length of stay', termId: 'T-005' }],
      ruleIds: ['BR-008'], instruction: 'Compare like-for-like months; days to two decimals.',
      semantic: { view: 'SV_THROUGHPUT', metrics: ['avg_length_of_stay'], dimensions: ['date.fiscal_year', 'facility.market'], filters: ['Jan–Sep of each year', "encounter_type = 'Inpatient'"] },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const cur = Q.alos(d, Q.PERIODS.ytd, allow);
        const prev = Q.alos(d, Q.PERIODS.priorYtd, allow);
        const chg = ((cur.alos - prev.alos) / prev.alos) * 100;
        const avoided = Math.round((prev.alos - cur.alos) * cur.discharges * d.scale.ip);
        return {
          summary: `Average length of stay for January–September 2026 is ${fmtNum(cur.alos, 2)} days, compared with ${fmtNum(prev.alos, 2)} days for the same months of 2025 — ${chg < 0 ? 'a reduction' : 'an increase'} of ${fmtPct(Math.abs(chg))}. ${chg < 0 ? `At this year's volume that is ≈ ${fmtCompact(avoided)} fewer bed days.` : `At this year's volume that is ≈ ${fmtCompact(-avoided)} more bed days.`}${rowNote(persona)}`,
          table: { columns: ['Market', 'ALOS 2025 YTD', 'ALOS 2026 YTD', 'Change'], rows: cur.rows.map((x, i) => [x.market, fmtNum(prev.rows[i].alos, 2), fmtNum(x.alos, 2), fmtPct(((x.alos - prev.rows[i].alos) / prev.rows[i].alos) * 100)]) },
          chart: { kind: 'bar', labels: ['2025 YTD', '2026 YTD'], values: [prev.alos, cur.alos], unit: 'days' },
          sql: `SELECT YEAR(discharge_date) AS fiscal_year, market, AVG(los_days) AS avg_length_of_stay  -- BR-008\n  FROM ${DB}.DATA_PRODUCTS.DP_ENCOUNTERS_THROUGHPUT\n WHERE encounter_type = 'Inpatient'\n   AND MONTH(discharge_date) <= 9 AND YEAR(discharge_date) IN (2025, 2026)${mkWhere(persona)}\n GROUP BY 1, 2;`,
          rows: cur.rows.length * 2, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-11': cur.alos, 'K-20': Q.mortality(d).rate },
        };
      },
    },
    {
      id: 'S-10', agentId: 'AG-03', pattern: 10, productIds: ['DP-02'], kpiIds: ['K-13', 'K-14'],
      question: 'What is our average ED wait time this month?',
      paraphrases: ['ED wait time this month', 'emergency department door to provider time in September', 'how long do patients wait in the ED this month', 'average ER wait time'],
      terms: [{ text: 'ED wait time', termId: 'T-011' }],
      ruleIds: ['BR-010'], instruction: 'Define the measure, give minutes to one decimal and compare with last month.',
      semantic: { view: 'SV_THROUGHPUT', metrics: ['ed_wait_minutes', 'lwbs_rate'], dimensions: ['facility.facility_name'], filters: ["encounter_date BETWEEN '2026-09-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const r = Q.edWait(d, Q.PERIODS.month, allow);
        const prev = Q.edWait(d, Q.PERIODS.priorMonth, allow);
        return {
          summary: `The average ED wait time in September 2026 was ${fmtNum(r.avgWait, 1)} minutes across ≈ ${fmtCompact(r.scaledVisits)} visits, versus ${fmtNum(prev.avgWait, 1)} minutes in August. ED wait time is door-to-provider: minutes from arrival to first contact with a provider. ${fmtPct(r.lwbsPct)} of visits left without being seen and are excluded from the wait (rule BR-010). The longest wait was at ${r.rows[0].hospital} (${fmtNum(r.rows[0].avgWait, 1)} min).${rowNote(persona)}`,
          table: { columns: ['Hospital', 'Market', 'Visits (sample)', 'Avg wait (min)', 'LWBS %'], rows: r.rows.map((x) => [x.hospital, x.market, x.visits, fmtNum(x.avgWait, 1), fmtPct(x.lwbsPct)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => short(x.hospital)), values: r.rows.map((x) => x.avgWait), unit: 'min' },
          sql: `SELECT facility_name, AVG(ed_wait_min) AS ed_wait_minutes,  -- BR-010 door to provider, LWBS excluded\n       AVG(IFF(lwbs_flag, 1, 0)) * 100 AS lwbs_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_ENCOUNTERS_THROUGHPUT\n WHERE encounter_type = 'Emergency'\n   AND encounter_date BETWEEN '2026-09-01' AND '2026-09-30'${mkWhere(persona)}\n GROUP BY facility_name\n ORDER BY ed_wait_minutes DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-13': r.avgWait, 'K-14': r.lwbsPct },
        };
      },
    },
    {
      id: 'S-11', agentId: 'AG-03', pattern: 11, productIds: ['DP-02'], kpiIds: ['K-16'],
      question: 'Which clinics have a no-show rate above 15%?',
      paraphrases: ['clinics with no-show rate over 15 percent', 'clinics where patients miss appointments most', 'high no-show clinics', 'clinics with a no show rate above 15'],
      terms: [{ text: 'no-show rate', termId: 'T-013' }],
      ruleIds: ['BR-011'],
      semantic: { view: 'SV_THROUGHPUT', metrics: ['no_show_rate'], dimensions: ['clinic.clinic_name', 'clinic.specialty'], filters: ['no_show_rate > 15', 'last 12 months'] },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const all = Q.noShowByClinic(d).filter((x) => !allow || allow.includes(x.market));
        const above = all.filter((x) => x.rate > 15);
        const bySpec = new Map<string, number>();
        for (const x of above) bySpec.set(x.specialty, (bySpec.get(x.specialty) ?? 0) + 1);
        const topSpec = [...bySpec.entries()].sort((a, b) => b[1] - a[1])[0];
        const shown = above.slice(0, 12);
        return {
          summary: `${above.length} of ${all.length} clinics with at least 25 scheduled visits had a no-show rate above 15% over the last 12 months (Oct 2025 – Sep 2026). The highest is ${above[0].clinic} (${above[0].specialty}) at ${fmtPct(above[0].rate)}; ${topSpec[0]} accounts for ${topSpec[1]} of them. The system no-show rate is ${fmtPct(Q.noShowRate(d, Q.PERIODS.last12, allow))}; cancellations more than 24 hours ahead are excluded (rule BR-011).${rowNote(persona)}`,
          table: { columns: ['Clinic', 'Specialty', 'Market', 'Scheduled', 'No-shows', 'No-show rate'], rows: shown.map((x) => [x.clinic, x.specialty, x.market, x.scheduled, x.noShows, fmtPct(x.rate)]) },
          sql: `SELECT clinic_name, specialty, market,\n       COUNT_IF(appt_status = 'No-show') / COUNT_IF(appt_status IN ('Completed', 'No-show')) * 100 AS no_show_rate  -- BR-011\n  FROM ${DB}.DATA_PRODUCTS.DP_ENCOUNTERS_THROUGHPUT\n WHERE encounter_type = 'Clinic' AND encounter_date >= '2025-10-01'${mkWhere(persona)}\n GROUP BY 1, 2, 3\nHAVING COUNT_IF(appt_status IN ('Completed', 'No-show')) >= 25 AND no_show_rate > 15\n ORDER BY no_show_rate DESC;`,
          rows: shown.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-16': Q.noShowRate(d, Q.PERIODS.last12), 'K-17': Q.newPatientLag(d) },
          explorerTarget: 'CONFORMED_GOLD.DIM_CLINIC',
        };
      },
    },
    {
      id: 'S-12', agentId: 'AG-03', pattern: 12, productIds: ['DP-04'], kpiIds: ['K-19'],
      question: 'What share of discharged patients had a follow-up visit within 7 days?',
      paraphrases: ['7-day follow-up rate after discharge', 'follow-up visits within seven days of discharge', 'post-discharge follow-up rate', 'share of discharged patients seen within 7 days'],
      terms: [{ text: 'follow-up visit within 7 days', termId: 'T-022' }, { text: 'discharged patients', termId: 'T-007' }],
      ruleIds: ['BR-014'],
      semantic: { view: 'SV_QUALITY', metrics: ['followup_7d_rate'], dimensions: ['patient.payer_class'], filters: ["discharge_date BETWEEN '2026-07-01' AND '2026-09-23'", "discharge_disposition IN ('Home', 'Home health')"] },
      doc: { docId: 'DOC-03', chunk: 7 },
      run: ({ persona }) => {
        const allow = allowedMarkets(persona);
        const r = Q.followup7(d, Q.PERIODS.followup, allow);
        const low = [...r.byPayer].filter((x) => x.discharges > 0).sort((a, b) => a.rate - b.rate)[0];
        return {
          summary: `${fmtPct(r.rate)} of patients discharged home or to home health between ${Q.PERIODS.followup.label} had a completed clinic follow-up visit within 7 days (${fmtInt(r.followed)} of ${fmtInt(r.eligible)} sample discharges). Post-Discharge Follow-Up (T-022) counts visits on day 1–7 after an eligible index discharge; discharges to skilled nursing, transfers and deaths are not in the denominator. ${low.payerClass} patients lag at ${fmtPct(low.rate)}.${rowNote(persona)}`,
          table: { columns: ['Payer class', 'Discharges home', 'Followed up ≤ 7 days', 'Rate'], rows: r.byPayer.map((x) => [x.payerClass, x.discharges, x.followed, fmtPct(x.rate)]) },
          chart: { kind: 'bar', labels: r.byMarket.map((x) => x.market), values: r.byMarket.map((x) => x.rate), unit: '%' },
          sql: `SELECT p.payer_class, AVG(IFF(r.followup_7d_flag, 1, 0)) * 100 AS followup_7d_rate  -- BR-014 visit on day 1–7\n  FROM ${DB}.DATA_PRODUCTS.DP_QUALITY_READMISSIONS r\n  JOIN ${DB}.DATA_PRODUCTS.DP_PATIENT_360 p USING (mrn)\n WHERE r.discharge_disposition IN ('Home', 'Home health')\n   AND r.discharge_date BETWEEN '2026-07-01' AND '2026-09-23'${mkWhere(persona)}\n GROUP BY p.payer_class;`,
          rows: r.byPayer.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-19': r.rate },
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
        return {
          summary: `${gaps.length} critical data element${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'has' : 'have'} no steward: ${gaps.map((t) => `${t.term} (${t.id}, owner ${t.owner})`).join(', ')}. It feeds the Draft product Care Gaps & Population Health. Also note ${draft.length} Draft term: ${draft.map((t) => t.term).join(', ')}.`,
          table: { columns: ['Term', 'Id', 'Domain', 'Owner', 'Steward', 'Next action'], rows: gaps.map((t) => [t.term, t.id, t.domain, t.owner, '— none —', 'Assign a population-health steward before DP-06 enters certification']) },
          sql: `SELECT t.term_id, t.term, t.domain, t.owner\n  FROM ${DB}.GLOSSARY.BUSINESS_TERM t\n  JOIN ${DB}.GLOSSARY.CDE_REGISTER c USING (term_id)\n WHERE t.is_cde AND c.steward IS NULL;`,
          rows: gaps.length, explorerTarget: 'GLOSSARY.CDE_REGISTER',
        };
      },
    },
    {
      id: 'S-14', agentId: 'AG-04', pattern: 14, productIds: [], kpiIds: [],
      question: 'Where is the term Active Patient used?',
      paraphrases: ['lineage of active patient', 'what uses the active patient definition', 'where does active patient appear'],
      terms: [{ text: 'Active Patient', termId: 'T-002' }],
      ruleIds: ['BR-001'],
      run: () => {
        const p = packRef();
        const t = p.glossary.find((x) => x.id === 'T-002') as GlossaryTerm;
        const metrics = t.metricRefs;
        const products = p.products.filter((pr) => pr.semanticView && metrics.some((m) => m.startsWith(pr.semanticView!)) && pr.kpiIds.includes('K-01'));
        const agents = p.agents.filter((a) => a.productIds.some((x) => products.some((pr) => pr.id === x)));
        return {
          summary: `"Active Patient" (T-002) is mapped to ${t.mappings.length} columns, defines the metric ${metrics.join(', ')}, is enforced by rule BR-001, and flows into ${products.map((x) => `${x.name} (${x.id})`).join(', ')} and the ${agents.map((a) => a.name).join(', ')} agent.`,
          table: { columns: ['Layer', 'Object', 'Usage'], rows: [
            ...t.mappings.map((m) => ['Column', `${m.fqn}.${m.column}`, m.kind]),
            ...metrics.map((m) => ['Semantic metric', m, 'defines']),
            ['Context rule', 'BR-001', 'business rule'],
            ...products.map((x) => ['Data product', `${x.id} ${x.name}`, 'KPI K-01']),
            ...agents.map((a) => ['Agent', a.objectName, 'answers with it']),
          ] },
          sql: `SELECT 'column' AS kind, object_fqn || '.' || column_name AS ref\n  FROM ${DB}.GLOSSARY.TERM_COLUMN_MAP WHERE term_id = 'T-002'\nUNION ALL\nSELECT 'rule', rule_id FROM ${DB}.CONTEXT.BUSINESS_RULES WHERE applies_to_metric ILIKE '%active_patients%'\nUNION ALL\nSELECT 'product', product_id FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY WHERE semantic_view = 'SV_PATIENT_REVENUE';`,
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
