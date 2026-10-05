// Healthcare knockout questions (E1) and raw-data variants (E2). Every degraded and raw number is computed from the
// same synthetic data with the faulty logic applied: real CDC duplicates and cancelled ADT rows from Bronze, a real
// SCD2 / encounter fan-out, planned readmissions and transfers left in, pharmacy cost left in. Nothing is typed in.
import type { Persona, Row, SfObject } from '../../../types';
import type { KnockoutResult, KnockoutScenario, LayerSwitches, RawResult } from '../../../ext/types';
import { describe } from '../../../ext/knockout';
import { avg, groupBy, round, sum } from '../../../mock-snowflake/generators';
import { maskFor } from '../../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtPct, fmtUsd } from '../../../lib/format';
import type { Claim, HcData, Stay } from '../data';
import { AS_OF, SERVICE_LINES } from '../generators.config';
import * as Q from '../queries';

const DB = 'CVH_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'MARKET' ? p.rowFilter.allowed : undefined);
const inMk = (m: string, allow?: string[]) => !allow || allow.includes(m);
const pct = (a: number, b: number) => round(b ? (a / b) * 100 : 0, 1);
const rowNote = (allow?: string[]) => (allow ? [`Row access: ${allow.join(' and ')} markets only.`] : []);

export function buildKnockout(d: HcData, objects: SfObject[]): KnockoutScenario[] {
  const rowsOf = (name: string): Row[] => {
    const o = objects.find((x) => x.name === name);
    return o?.rows ? o.rows({ productStatus: {}, productVersion: {}, fixes: {} }) : [];
  };
  /** Bronze over-count: CDC rows (I + U + D) per distinct key in the landed sample. */
  const cdcFactor = (table: string, key: string, filter: (r: Row) => boolean = () => true) => {
    const rows = rowsOf(table).filter(filter);
    const distinct = new Set(rows.map((r) => String(r[key]).trim())).size;
    return { factor: distinct ? rows.length / distinct : 1, dups: rows.filter((r) => r.OP_TYPE === 'U').length, deletes: rows.filter((r) => r.OP_TYPE === 'D').length, rows: rows.length, distinct };
  };
  const pat = () => cdcFactor('EHR_PATIENT_CDC', 'MRN');
  const clm = () => cdcFactor('CLM_837_835_CDC', 'CLAIM_ID');
  const enc = () => cdcFactor('EHR_ENCOUNTER_CDC', 'ENC_ID', (r) => r.ENC_TYPE_CD === 'IP');
  const sup = () => cdcFactor('SUPPLY_USAGE_CDC', 'USAGE_ID');
  const payerClass = (k: number) => d.payers[k - 1].payerClass;

  // ---------------------------------------------------------------------------------------------- K-1 self-pay active patients
  const k1: KnockoutScenario = {
    id: 'KO-1', scenarioId: 'S-02', agentId: 'AG-01',
    question: 'How many active patients are self-pay?',
    affects: ['glossary', 'cleansing', 'semantic', 'governance'],
    links: { glossary: 'glossary/T-002', cleansing: 'explorer/RAW_BRONZE/EHR_PATIENT_CDC', semantic: 'semantic/SV_PATIENT_REVENUE', governance: 'explorer/GOVERNANCE/RAP_MARKET_ACCESS' },
    compute: (s: LayerSwitches, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const active = s.glossary ? Q.activePatients(d, allow) : d.patients.filter((p) => !p.deathDate && inMk(p.market, allow));
      const selfPay = active.filter((p) => payerClass(p.payerKey) === 'Self-pay');
      let count = Math.round(selfPay.length * d.scale.patients);
      const notes: string[] = [];
      if (s.glossary) notes.push('Active Patient (T-002, rule BR-001): alive with a completed encounter in the last 12 months.');
      else notes.push('"Active" read as PATIENT_STATUS = \'Active\' (alive) only: patients with no encounter in 12 months counted.');
      if (!s.semantic) {
        // Naive join to FCT_CLAIM without DISTINCT: one row per claim of each self-pay patient.
        const keys = new Set(selfPay.map((p) => p.key));
        count = d.claims.filter((c) => keys.has(c.patientKey)).length * d.scale.patients;
        notes.push('No semantic view: joined patients to claims and counted claim rows, not distinct patients.');
      }
      if (!s.cleansing) {
        const f = pat();
        count *= f.factor;
        notes.push(`Counted CDC rows from RAW_BRONZE.EHR_PATIENT_CDC (${f.dups} update duplicates and ${f.deletes} deletes in the landed sample, untrimmed MRNs).`);
      }
      notes.push(...rowNote(allow));
      const v = Math.round(count);
      // Sample rows behind the answer: PHI masked for roles without PHI access, in clear when governance is off.
      const masked = s.governance && !persona.unmasked.includes('PHI');
      const exposedNow = !s.governance && !persona.unmasked.includes('PHI');
      const sample = selfPay.slice(0, 3);
      const table: KnockoutResult['table'] = {
        columns: ['MRN', 'Patient', 'Market'],
        rows: sample.map((p) => [String(s.governance ? maskFor(persona, 'PHI', p.mrn) : p.mrn), String(s.governance ? maskFor(persona, 'PHI', `${p.first} ${p.last}`) : `${p.first} ${p.last}`), p.market]),
        masked: masked ? [0, 1] : [],
        exposed: exposedNow ? [0, 1] : [],
      };
      return {
        value: v, valueText: fmtCompact(v), caption: `active self-pay patients${allow ? ` in the ${allow.join(' and ')} markets` : ''}`,
        table,
        sql: s.semantic
          ? `SELECT COUNT(*) FROM ${DB}.DATA_PRODUCTS.DP_PATIENT_360\n WHERE ${s.glossary ? 'is_active  -- BR-001' : "patient_status = 'Active'"} AND payer_class = 'Self-pay'`
          : `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.DIM_PATIENT' : 'RAW_BRONZE.EHR_PATIENT_CDC'} p\n  JOIN ${DB}.CONFORMED_GOLD.FCT_CLAIM c ON c.patient_key = p.patient_key\n WHERE p.payer_class = 'Self-pay'  -- no DISTINCT: one row per claim`,
        sources: [{ productId: 'DP-01', version: '2.1.0', certified: true }], notes,
        exposed: exposedNow ? ['MRN', 'PATIENT_NAME'] : undefined,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('Without the glossary the agent counted every living self-pay patient, ignoring the 12-month encounter rule in T-002:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Without Silver, ADT update duplicates, deleted registrations and untrimmed MRNs were counted:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined patients to claims and counted claim rows instead of patients:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Masking and row access were bypassed: MRNs and names shown in clear, and patients outside your markets counted:', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Patient 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('EHR_PATIENT_CDC');
      // Raw agent: counts every CDC row with PAT_STATUS_CD = 'A' and the self-pay payer id, then scales by row share.
      const selfRows = r.filter((x) => x.PAT_STATUS_CD === 'A' && x.PRIMARY_PAYER_ID === 'SELF');
      const sampleDistinct = new Set(r.map((x) => String(x.MRN).trim())).size;
      const v = Math.round(selfRows.length * (d.patients.length / Math.max(1, sampleDistinct)) * d.scale.patients);
      const f = pat();
      return {
        value: v, valueText: fmtCompact(v), caption: 'CDC rows guessed as "active self-pay patients"',
        sql: "SELECT COUNT(*) FROM RAW_BRONZE.EHR_PATIENT_CDC\n WHERE PAT_STATUS_CD = 'A' AND PRIMARY_PAYER_ID = 'SELF'",
        tablesUsed: ['RAW_BRONZE.EHR_PATIENT_CDC'],
        risks: [
          `Duplicates: ${f.dups} ADT update rows and ${f.deletes} deleted registrations counted in the landed sample`,
          'Wrong definition: no 12-month encounter rule for "active" (BR-001)',
          'Untrimmed MRN values make one patient look like two',
          `Unmasked PHI read for ${persona.roleId}: MRN, PAT_FIRST_NM, PAT_LAST_NM, BIRTH_DT`,
          'No market filter: RAP_MARKET_ACCESS does not apply to an ad hoc extract',
          'No lineage, owner or certification for the table used',
        ],
        rowsRead: { columns: ['MRN', 'PAT_FIRST_NM', 'PAT_LAST_NM', 'BIRTH_DT', 'PRIMARY_PAYER_ID', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.MRN), String(x.PAT_FIRST_NM), String(x.PAT_LAST_NM), String(x.BIRTH_DT), String(x.PRIMARY_PAYER_ID), String(x.OP_TYPE)]), exposed: [0, 1, 2, 3] },
      } satisfies RawResult;
    },
  };

  // ---------------------------------------------------------------------------------------------- K-2 denial rate by payer
  const q3 = Q.PERIODS.quarter;
  /** Still denied at the as-of date: denied and not overturned by a paid appeal. */
  const stillDenied = (c: Claim) => c.denied && !(c.resolvedDate <= AS_OF && c.paid > 0);
  const k2: KnockoutScenario = {
    id: 'KO-2', scenarioId: 'S-01', agentId: 'AG-01',
    question: 'What was the claim denial rate last quarter by payer?',
    affects: ['context', 'glossary', 'semantic', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-003', glossary: 'glossary/T-017', semantic: 'semantic/SV_PATIENT_REVENUE', cleansing: 'explorer/RAW_BRONZE/CLM_837_835_CDC', governance: 'explorer/GOVERNANCE/RAP_MARKET_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      // BR-003: initial denials by submission date. Without it: final status, by service date.
      const inPeriod = (c: Claim) => (s.context ? c.submitDate : c.serviceDate) >= q3.from && (s.context ? c.submitDate : c.serviceDate) <= q3.to;
      const ruleDenied = s.context ? (c: Claim) => c.denied : stillDenied;
      // Without Silver there is no IS_DENIED derived from the first 835: only CLM_STATUS_CD = '4' (denial still pending) is visible.
      const isDenied = s.cleansing ? ruleDenied : (c: Claim) => ruleDenied(c) && c.resolvedDate > AS_OF;
      const cs = d.claims.filter((c) => inPeriod(c) && inMk(c.market, allow));
      if (s.context) notes.push('BR-003: initial denials over claims submitted in Q3 2026, by submission date.');
      else notes.push('No rule BR-003: counted only claims still denied after appeals, by service date.');
      // Glossary off: "denial rate" read as share of expected dollars denied, not share of claims.
      const rate = (xs: Claim[]) => (s.glossary ? pct(xs.filter(isDenied).length, xs.length) : pct(sum(xs.filter(isDenied).map((c) => c.expected)), sum(xs.map((c) => c.expected))));
      if (!s.glossary) notes.push('"Claim denial rate" not resolved to T-017: reported the share of expected dollars denied.');
      const byPayer = d.payers.map((p) => ({ p, xs: cs.filter((c) => c.payerKey === p.key) })).filter((x) => x.xs.length > 0).map((x) => ({ payer: x.p.name, claims: x.xs.length, rate: rate(x.xs) })).sort((a, b) => b.rate - a.rate);
      // Semantic off: the agent averaged the per-payer rates (grain lost: payers weighted equally, not claims).
      let value = s.semantic ? rate(cs) : round(avg(byPayer.map((x) => x.rate)), 1);
      if (!s.semantic) notes.push(`No semantic view: averaged ${byPayer.length} payer rates instead of dividing denied claims by all claims.`);
      if (!s.cleansing) {
        const f = clm();
        const overturned = cs.filter((c) => ruleDenied(c) && !isDenied(c)).length;
        notes.push(`Ran on RAW_BRONZE.CLM_837_835_CDC: denials read from CLM_STATUS_CD = '4', which misses ${fmtInt(overturned)} sample denials already worked by a later 835; ${f.dups} update duplicates and ${f.deletes} deletes in the landed sample.`);
      }
      notes.push(...rowNote(allow));
      return {
        value, valueText: fmtPct(value), caption: `initial claim denial rate, claims submitted Q3 2026${allow ? ` (${allow.join(' and ')})` : ''}`,
        table: { columns: ['Payer', 'Claims (sample)', 'Denial rate'], rows: byPayer.map((x) => [x.payer, fmtInt(x.claims), fmtPct(x.rate)]) },
        sql: s.semantic && s.glossary
          ? `SELECT payer.payer_name, denial_rate FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_PATIENT_REVENUE ...)\n WHERE ${s.context ? "submit_date BETWEEN '2026-07-01' AND '2026-09-30'  -- BR-003" : "service_date BETWEEN '2026-07-01' AND '2026-09-30' AND final_status = 'DENIED'"}`
          : `SELECT AVG(rate) FROM (\n  SELECT payer_id, ${s.glossary ? 'AVG(IFF(is_denied, 1, 0))' : 'SUM(IFF(is_denied, expected_net_usd, 0)) / SUM(expected_net_usd)'} * 100 AS rate\n    FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_CLAIM' : 'RAW_BRONZE.CLM_837_835_CDC'} GROUP BY payer_id)  -- grain lost`,
        sources: [{ productId: 'DP-03', version: '3.2.1', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-003 the agent counted only denials still open after appeals, by service date:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"Claim denial rate" was not resolved, so the agent reported the share of dollars denied:', g, x), severity: 'ambiguous' as const },
      semantic: { reason: describe('Without the semantic view the agent averaged payer rates, so a payer with a handful of claims weighed as much as Medicare:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe("Without Silver there is no initial-denial flag: CLM_STATUS_CD = '4' in CLM_837_835_CDC only marks denials still pending, so denials already worked were missed:", g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so claims from all four markets were included:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Revenue Cycle is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('CLM_837_835_CDC');
      // Raw agent: CLM_STATUS_CD = '4' (denied) over every landed row. Only pending denials still carry status 4.
      const v = pct(r.filter((x) => x.CLM_STATUS_CD === '4').length, r.length);
      const f = clm();
      return {
        value: v, valueText: fmtPct(v), caption: "rows with CLM_STATUS_CD = '4' over every landed claim row",
        sql: "SELECT COUNT_IF(CLM_STATUS_CD = '4') / COUNT(*) * 100\n  FROM RAW_BRONZE.CLM_837_835_CDC  -- no period, no payer names, no dedup",
        tablesUsed: ['RAW_BRONZE.CLM_837_835_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes included`,
          'Wrong definition: status 4 marks only denials still pending, not initial denials (BR-003)',
          'No period: rows are not limited to claims submitted in Q3 2026',
          'No payer names: PAYER_ID is not joined to DIM_PAYER',
          'No owner, lineage or certification',
        ],
        rowsRead: { columns: ['CLAIM_ID', 'PAYER_ID', 'SUBMIT_DT', 'CLM_STATUS_CD', 'CARC_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.CLAIM_ID), String(x.PAYER_ID), String(x.SUBMIT_DT), String(x.CLM_STATUS_CD), x.CARC_CD === null ? null : String(x.CARC_CD), String(x.OP_TYPE)]), exposed: [] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- K-3 readmissions (signature)
  const rw = Q.PERIODS.readmitYtd;
  const staysByPatient = groupBy(d.stays, (s) => String(s.patientKey));
  /** Any admission (planned or not) 1–30 days after this stay's discharge. */
  const anyReadmit = (s: Stay) => (staysByPatient.get(String(s.patientKey)) ?? []).some((x) => { const g = Q.daysBetween(s.discharge, x.admit); return x.key !== s.key && g >= 1 && g <= 30; });
  const encCount = new Map<number, number>();
  for (const s of d.stays) encCount.set(s.patientKey, (encCount.get(s.patientKey) ?? 0) + 1);
  for (const v of d.ed) encCount.set(v.patientKey, (encCount.get(v.patientKey) ?? 0) + 1);
  const k3: KnockoutScenario = {
    id: 'KO-3', scenarioId: 'S-06', agentId: 'AG-02',
    question: 'What is our 30-day all-cause readmission rate by service line?',
    affects: ['context', 'semantic', 'glossary', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-012', semantic: 'semantic/SV_QUALITY', glossary: 'glossary/T-006', cleansing: 'explorer/RAW_BRONZE/EHR_ENCOUNTER_CDC', governance: 'explorer/GOVERNANCE/RAP_MARKET_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const f = Q.flagsOf(d);
      const notes: string[] = [];
      const disch = d.stays.filter((x) => !x.inHouse && x.discharge >= rw.from && x.discharge <= rw.to && inMk(x.market, allow));
      // BR-012 (CMS method): eligible index stays only; planned readmissions not counted.
      const index = s.context ? disch.filter((x) => f.get(x.key)!.eligible) : disch;
      // Without Silver the planned-admission flag does not exist, so a planned readmission counts like any other.
      const readmitted = (x: Stay) => (s.context ? f.get(x.key)!.readmit || (!s.cleansing && f.get(x.key)!.plannedExcluded) : anyReadmit(x));
      if (s.context) notes.push('BR-012: transfers, deaths and AMA discharges excluded; planned readmissions not counted. Cited the readmission definitions, chunk 11.');
      else notes.push(`No rule BR-012: ${disch.length - disch.filter((x) => f.get(x.key)!.eligible).length} transfers, deaths and AMA discharges kept and planned readmissions counted; no citation.`);
      const ofLine = (xs: Stay[], sl?: string) => (sl ? xs.filter((x) => x.serviceLine === sl) : xs);
      /** Rate for the whole population (no service line) or one service line. */
      let rateOf = (sl?: string) => { const xs = ofLine(index, sl); return pct(xs.filter(readmitted).length, xs.length); };
      let caption = `30-day readmission rate, index discharges ${rw.label}`;
      if (!s.glossary) {
        // "Readmission rate" not resolved: share of admissions in the window that followed a discharge within 30 days.
        const admits = d.stays.filter((x) => x.admit >= rw.from && x.admit <= rw.to && inMk(x.market, allow) && (!s.context || !s.cleansing || !x.planned));
        const isReadmit = (x: Stay) => (staysByPatient.get(String(x.patientKey)) ?? []).some((p) => { const g = Q.daysBetween(p.discharge, x.admit); return p.key !== x.key && !p.inHouse && g >= 1 && g <= 30; });
        rateOf = (sl?: string) => { const ys = ofLine(admits, sl); return pct(ys.filter(isReadmit).length, ys.length); };
        caption = 'share of admissions that were readmissions — "30-day all-cause readmission" was not resolved';
        notes.push('Term not resolved: reported readmissions as a share of all admissions, not of eligible index discharges.');
      } else if (!s.semantic) {
        // Join FCT_READMISSION to FCT_ENCOUNTER on PATIENT_KEY: each index stay repeats once per encounter of the patient.
        const w = (x: Stay) => encCount.get(x.patientKey) ?? 1;
        rateOf = (sl?: string) => { const xs = ofLine(index, sl); return pct(sum(xs.filter(readmitted).map(w)), sum(xs.map(w))); };
        notes.push('No semantic view: joined readmissions to encounters on patient, so frequent patients were counted once per encounter.');
      }
      const value = rateOf();
      const rows = SERVICE_LINES.filter((sl) => index.some((x) => x.serviceLine === sl.name)).map((sl) => ({ sl: sl.name, rate: rateOf(sl.name) })).sort((a, b) => b.rate - a.rate);
      if (!s.cleansing) {
        const e = enc();
        notes.push(`Ran on RAW_BRONZE.EHR_ENCOUNTER_CDC: no IS_PLANNED flag (derived in Silver), so planned readmissions counted; ${e.dups} ADT update duplicates and ${e.deletes} cancelled admissions in the landed sample.`);
      }
      notes.push(...rowNote(allow));
      return {
        value, valueText: fmtPct(value), caption,
        table: { columns: ['Service line', 'Rate'], rows: rows.map((x) => [x.sl, fmtPct(x.rate)]) },
        sql: s.semantic && s.glossary
          ? `SELECT readmit.service_line, readmission_rate_30d FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_QUALITY ...)\n WHERE discharge_date BETWEEN '2026-01-01' AND '2026-08-31'${s.context ? '\n   AND is_eligible_index  -- BR-012' : ''}`
          : `SELECT r.service_line, ${s.glossary ? 'SUM(IFF(r.readmit_30d_flag, 1, 0)) / COUNT(*)' : 'COUNT_IF(prior_discharge_within_30d) / COUNT(*)'} * 100\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_READMISSION' : 'RAW_BRONZE.EHR_ENCOUNTER_CDC'} r\n  JOIN ${DB}.CONFORMED_GOLD.FCT_ENCOUNTER e ON e.patient_key = r.patient_key  -- fan-out\n GROUP BY 1`,
        sources: [{ productId: 'DP-04', version: '2.0.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-012 planned readmissions were counted, transfers, deaths and AMA discharges stayed in the denominator, and the CMS definitions were not cited:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined each index stay to every encounter of the patient:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"30-day all-cause readmission" was not resolved, so the agent divided by all admissions:', g, x), severity: 'ambiguous' as const },
      cleansing: { reason: describe('EHR_ENCOUNTER_CDC has no planned-admission flag (Silver derives it), so planned readmissions were counted:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so all four markets were reported:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Quality & Readmissions is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('EHR_ENCOUNTER_CDC').filter((x) => x.ENC_TYPE_CD === 'IP');
      // Raw agent: rows with a discharge, readmitted when the same MRN has another admit row within 30 days.
      const byMrn = groupBy(r, (x) => String(x.MRN).trim());
      const dis = r.filter((x) => x.DISCH_TS);
      const re = dis.filter((x) => (byMrn.get(String(x.MRN).trim()) ?? []).some((y) => { const g = Q.daysBetween(String(x.DISCH_TS).slice(0, 10), String(y.ADMIT_TS).slice(0, 10)); return g >= 0 && g <= 30 && y !== x; }));
      const v = pct(re.length, dis.length);
      const e = enc();
      return {
        value: v, valueText: fmtPct(v), caption: 'discharge rows with another admit row for the same MRN within 30 days',
        sql: 'SELECT COUNT_IF(EXISTS (SELECT 1 FROM RAW_BRONZE.EHR_ENCOUNTER_CDC b\n         WHERE b.MRN = a.MRN AND b.ADMIT_TS BETWEEN a.DISCH_TS AND a.DISCH_TS + 30)) / COUNT(*) * 100\n  FROM RAW_BRONZE.EHR_ENCOUNTER_CDC a WHERE ENC_TYPE_CD = \'IP\'',
        tablesUsed: ['RAW_BRONZE.EHR_ENCOUNTER_CDC'],
        risks: [
          `Duplicates: ${e.dups} ADT update rows and ${e.deletes} cancelled admissions kept`,
          'Wrong definition: planned readmissions counted; transfers, deaths and AMA discharges not excluded (BR-012)',
          'Open 30-day windows included: no closed-window rule (BR-013)',
          `Unmasked PHI read for ${persona.roleId}: MRN`,
          'No owner, lineage or certification',
        ],
        rowsRead: { columns: ['ENC_ID', 'MRN', 'FACILITY_CD', 'ADMIT_TS', 'DISCH_TS', 'DISCH_DISP_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.ENC_ID), String(x.MRN), String(x.FACILITY_CD), String(x.ADMIT_TS), x.DISCH_TS === null ? null : String(x.DISCH_TS), x.DISCH_DISP_CD === null ? null : String(x.DISCH_DISP_CD), String(x.OP_TYPE)]), exposed: [1] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- K-4 supply cost per case (DP-05 in certification)
  const k4: KnockoutScenario = {
    id: 'KO-4', scenarioId: 'S-04', agentId: 'AG-01',
    question: 'What is our supply cost per surgical case this quarter?',
    affects: ['certification', 'context', 'semantic', 'cleansing', 'governance'],
    links: { certification: 'certify/DP-05', context: 'context/rules?rule=BR-015', semantic: 'semantic/SV_SUPPLY_CHAIN', cleansing: 'explorer/RAW_BRONZE/SUPPLY_USAGE_CDC', governance: 'explorer/GOVERNANCE/RAP_MARKET_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const cases = d.stays.filter((x) => x.surgical && !x.inHouse && x.discharge >= q3.from && x.discharge <= q3.to && inMk(x.market, allow));
      const keys = new Set(cases.map((x) => x.key));
      const lines = d.supply.filter((l) => keys.has(l.stayKey) && (!s.context || l.itemType === 'Supply'));
      let cost = sum(lines.map((l) => l.cost));
      const notes: string[] = [];
      if (s.context) notes.push('BR-015: med-surg supplies and implants only; pharmacy excluded.');
      else notes.push(`No rule BR-015: ${fmtUsd(sum(lines.filter((l) => l.itemType === 'Pharmacy').map((l) => l.cost)), 0)} of pharmacy cost on surgical stays included.`);
      // Semantic off: COUNT(*) of usage lines as the denominator instead of COUNT(DISTINCT encounter_id).
      const den = s.semantic ? cases.length : lines.length;
      if (!s.semantic) notes.push(`No semantic view: divided by ${fmtInt(lines.length)} usage lines instead of ${fmtInt(cases.length)} surgical cases.`);
      if (!s.cleansing) {
        const f = sup();
        cost *= f.factor;
        notes.push(`Summed RAW_BRONZE.SUPPLY_USAGE_CDC rows, including ${f.dups} update duplicates and ${f.deletes} deleted lines in the landed sample.`);
      }
      notes.push(...rowNote(allow));
      const v = round(cost / Math.max(1, den), 0);
      return {
        value: v, valueText: fmtUsd(v, 0), caption: `per surgical case, Q3 2026 (${fmtInt(cases.length)} sample cases)`,
        sql: `SELECT SUM(${s.context ? "IFF(item_type = 'Supply', cost_usd, 0)" : 'cost_usd'}) / ${s.semantic ? 'COUNT(DISTINCT encounter_id)' : 'COUNT(*)'}\n  FROM ${DB}.${s.cleansing ? 'DATA_PRODUCTS.DP_CLINICAL_SUPPLY_CHAIN' : 'RAW_BRONZE.SUPPLY_USAGE_CDC'}\n WHERE is_surgical_case AND usage_date BETWEEN '2026-07-01' AND '2026-09-30'`,
        sources: [{ productId: 'DP-05', version: '1.0.0-rc', certified: false }],
        notes: s.certification ? [...notes, 'Not certified: Clinical Supply Chain is in certification (quality score 94.6; PATIENT_MRN masking open at gate 6).'] : notes,
        hiddenWarning: s.certification ? undefined : 'In-certification product used without a warning; quality score 94.6 and the open gate 6 masking failure hidden.',
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used Clinical Supply Chain (in certification) with no "Not certified" banner, hiding its 94.6 quality score and the open PHI masking failure.', severity: 'unverified' as const },
      context: { reason: describe('Without rule BR-015 pharmacy dispenses on surgical stays were added to supply cost:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent divided by usage lines instead of surgical cases:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in SUPPLY_USAGE_CDC were summed:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so cases from all four markets were included:', g, x), severity: 'unsafe' as const },
      glossary: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
    })[layer],
  };

  return [k1, k2, k3, k4];
}
