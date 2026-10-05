// Public Sector knockout questions (E1) and raw-data variants (E2). Every degraded and raw number is computed from
// the same synthetic data with the faulty logic applied: real CDC duplicates in Bronze, a real join fan-out to case
// records, calendar days instead of business days, and real flag statuses. Nothing is typed in.
import type { Persona, Row, SfObject } from '../../../types';
import type { KnockoutResult, KnockoutScenario, RawResult } from '../../../ext/types';
import { describe } from '../../../ext/knockout';
import { daysBetween, round, sum } from '../../../mock-snowflake/generators';
import { maskFor } from '../../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct } from '../../../lib/format';
import { businessDaysBetween, type Case, type PsData } from '../data';
import { APPS_PER_MONTH, AS_OF, CONSTITUENTS_TOTAL, DISTRICTS } from '../generators.config';
import * as Q from '../queries';

const DB = 'WCS_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'DISTRICT' ? p.rowFilter.allowed : undefined);
const okD = (allow: string[] | undefined, district: string) => !allow || allow.includes(district);
const pct = (a: number, b: number, dp = 1) => round((a / Math.max(1, b)) * 100, dp);
const ALL_FLAG_STATUSES = ['Open review', 'Referred', 'Overpayment established', 'Cleared'];

export function buildKnockout(d: PsData, objects: SfObject[]): KnockoutScenario[] {
  const rowsOf = (name: string): Row[] => {
    const o = objects.find((x) => x.name === name);
    return o?.rows ? o.rows({ productStatus: {}, productVersion: {}, fixes: {} }) : [];
  };
  /** Bronze over-count factor: CDC rows (I + U + D) per distinct key in the landed sample. */
  const cdcFactor = (table: string, key: string, filter: (r: Row) => boolean = () => true) => {
    const rows = rowsOf(table).filter(filter);
    const distinct = new Set(rows.map((r) => String(r[key]).trim())).size;
    return { factor: distinct ? rows.length / distinct : 1, dups: rows.filter((r) => r.OP_TYPE === 'U').length, deletes: rows.filter((r) => r.OP_TYPE === 'D').length, rows: rows.length, distinct };
  };
  const persons = () => cdcFactor('CM_PERSON_CDC', 'PERSON_ID', (r) => r.STAT_CD === 'A');
  const apps = () => cdcFactor('ELIG_APPLICATION_CDC', 'APP_NO');
  const pays = () => cdcFactor('BEN_PAYMENT_CDC', 'PMT_ID');

  const openBy = Q.openCasesByConstituent(d);
  const allBy = new Map<number, Case[]>();
  for (const c of d.cases) allBy.set(c.constituentKey, [...(allBy.get(c.constituentKey) ?? []), c]);
  /** Case records per constituent: the fan-out of a join from a fact to FCT_CASE on CONSTITUENT_KEY. */
  const casesOf = (key: number) => Math.max(1, allBy.get(key)?.length ?? 0);
  const ytd = Q.PERIODS.ytd;

  // ---------------------------------------------------------------------------------------------- K-1 multi-program
  const k1: KnockoutScenario = {
    id: 'KO-1', scenarioId: 'S-02', agentId: 'AG-01',
    question: 'How many active constituents are enrolled in more than one program?',
    affects: ['glossary', 'semantic', 'cleansing', 'governance'],
    links: { glossary: 'glossary/T-002', semantic: 'semantic/SV_CONSTITUENT_360', cleansing: 'explorer/RAW_BRONZE/CM_PERSON_CDC', governance: 'explorer/GOVERNANCE/RAP_DISTRICT_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      const progs = s.glossary ? openBy : allBy;
      const pop = s.glossary ? Q.activeConstituents(d, allow) : d.constituents.filter((c) => c.status === 'Active' && okD(allow, c.district));
      const multi = pop.filter((c) => (progs.get(c.key)?.length ?? 0) >= 2);
      let count = multi.length * d.scale;
      if (s.glossary) notes.push('Active Constituent (T-002): Active status, an open program case and a contact in the last 12 months; programs counted from open cases (T-027).');
      else notes.push('"Active" read as CONSTITUENT_STATUS = \'Active\' only, and every case record counted as a program, open or closed.');
      if (!s.semantic) {
        // Naive join to FCT_CASE without DISTINCT: one row per case record of each constituent.
        count = sum(multi.map((c) => progs.get(c.key)?.length ?? 0)) * d.scale;
        notes.push('No semantic view: counted joined case rows, not distinct constituents.');
      }
      if (!s.cleansing) {
        const f = persons();
        count *= f.factor;
        notes.push(`Counted CDC rows from RAW_BRONZE.CM_PERSON_CDC (${f.dups} update duplicates, ${f.deletes} deletes in the landed sample).`);
      }
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const lacks = !persona.unmasked.includes('PII');
      const sample = multi.slice(0, 3);
      const table: KnockoutResult['table'] = {
        columns: ['Constituent ID', 'Name', 'Government ID', 'District'],
        rows: sample.map((c) => [c.constituentId, String(s.governance ? maskFor(persona, 'PII', `${c.first} ${c.last}`) : `${c.first} ${c.last}`), String(s.governance ? maskFor(persona, 'GOV_ID', c.govId) : c.govId), c.district]),
        masked: s.governance && lacks ? [1, 2] : [],
        exposed: !s.governance && lacks ? [1, 2] : [],
      };
      return {
        value: Math.round(count), valueText: fmtCompact(count), caption: `active constituents in two or more programs${allow ? ` in ${allow.join(' and ')}` : ''}`,
        table,
        sql: s.semantic
          ? `SELECT COUNT(*) FROM ${DB}.DATA_PRODUCTS.DP_CONSTITUENT_360\n WHERE ${s.glossary ? 'is_active AND programs_enrolled >= 2  -- BR-001, T-027' : "constituent_status = 'Active' AND case_records >= 2"}`
          : `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.DIM_CONSTITUENT' : 'RAW_BRONZE.CM_PERSON_CDC'} c\n  JOIN ${DB}.CONFORMED_GOLD.FCT_CASE k ON k.constituent_key = c.constituent_key  -- no DISTINCT: one row per case`,
        sources: [{ productId: 'DP-01', version: '2.1.0', certified: true }], notes,
        exposed: !s.governance && lacks ? ['CONSTITUENT_NAME', 'GOV_ID'] : undefined,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('Without the glossary "active" meant any Active-status record and closed cases counted as programs:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined constituents to case records and counted rows:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Without Silver, CDC update duplicates and deleted person records were counted:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access and masking were bypassed: South and Riverside constituents were counted, and names and government IDs shown in clear.', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Constituent 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const people = rowsOf('CM_PERSON_CDC');
      const caseRows = rowsOf('CM_CASE_CDC');
      const perPerson = new Map<string, number>();
      for (const r of caseRows) perPerson.set(String(r.PERSON_ID), (perPerson.get(String(r.PERSON_ID)) ?? 0) + 1);
      // Raw agent: exact match on PERSON_ID (trailing spaces miss), every CDC row with STAT_CD = 'A', any case status.
      const matched = people.filter((r) => r.STAT_CD === 'A' && (perPerson.get(String(r.PERSON_ID)) ?? 0) >= 2);
      const sampled = new Set(people.map((r) => String(r.PERSON_ID).trim())).size;
      const v = Math.round(matched.length * (CONSTITUENTS_TOTAL / Math.max(1, sampled)));
      const f = persons();
      return {
        value: v, valueText: fmtCompact(v), caption: 'person rows guessed as "active, more than one program"',
        sql: "SELECT COUNT(*) FROM RAW_BRONZE.CM_PERSON_CDC p\n  JOIN RAW_BRONZE.CM_CASE_CDC c ON c.PERSON_ID = p.PERSON_ID\n WHERE p.STAT_CD = 'A'\n GROUP BY p.PERSON_ID HAVING COUNT(*) >= 2",
        tablesUsed: ['RAW_BRONZE.CM_PERSON_CDC', 'RAW_BRONZE.CM_CASE_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deleted person records counted in the landed sample`,
          'Wrong definition: no open-case or 12-month contact rule for "active"; closed cases counted as programs',
          'Untrimmed PERSON_ID values silently fail the join',
          `Unmasked PII and government IDs read for ${persona.roleId}: FIRST_NM, LAST_NM, SSN_NO`,
          'No district row access, lineage, owner or certification',
        ],
        rowsRead: { columns: ['PERSON_ID', 'FIRST_NM', 'LAST_NM', 'SSN_NO', 'DIST_CD', 'OP_TYPE'], rows: people.slice(0, 4).map((r) => [String(r.PERSON_ID), String(r.FIRST_NM), String(r.LAST_NM), String(r.SSN_NO), String(r.DIST_CD), String(r.OP_TYPE)]), exposed: [1, 2, 3] },
      } satisfies RawResult;
    },
  };

  // ---------------------------------------------------------------------------------------------- K-2 30-day standard (signature)
  const k2: KnockoutScenario = {
    id: 'KO-2', scenarioId: 'S-06', agentId: 'AG-02',
    question: 'How many benefit applications exceed the 30-day processing standard?',
    affects: ['glossary', 'context', 'semantic', 'cleansing', 'governance'],
    links: { glossary: 'glossary/T-009', context: 'context/rules?rule=BR-007', semantic: 'semantic/SV_CASE_MANAGEMENT', cleansing: 'explorer/RAW_BRONZE/ELIG_APPLICATION_CDC', governance: 'explorer/GOVERNANCE/RAP_DISTRICT_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      const outcomes = s.context ? ['Approved', 'Denied'] : ['Approved', 'Denied', 'Withdrawn'];
      const days = (a: (typeof d.applications)[number]) => (s.glossary ? a.bizDays : a.calDays);
      const decided = d.applications.filter((a) => a.decision && Q.inRange(a.decision, ytd) && outcomes.includes(a.outcome) && days(a) !== null && okD(allow, a.district));
      let over = decided.filter((a) => days(a)! > Q.STANDARD_DAYS);
      if (s.glossary) notes.push('Processing Days (T-009): business days from a complete application, weekends and county holidays excluded (BR-006).');
      else notes.push('"Processing days" not resolved: calendar days from receipt were counted.');
      if (s.context) notes.push('BR-007: decided applications only; pending and incomplete applications reported separately. Cited the Program eligibility rules manual, chunk 12.');
      else {
        // No BR-007: withdrawn decisions and pending applications already past 30 days are added to the count.
        const pending = d.applications.filter((a) => a.outcome === 'Pending' && okD(allow, a.district) && (s.glossary ? a.complete !== null && businessDaysBetween(a.complete, AS_OF) > Q.STANDARD_DAYS : daysBetween(a.received, AS_OF) > Q.STANDARD_DAYS));
        const withdrawn = over.filter((a) => a.outcome === 'Withdrawn').length;
        over = [...over, ...pending];
        notes.push(`No rule BR-007: ${withdrawn} withdrawn and ${pending.length} pending sample applications counted in; no citation.`);
      }
      let rows = over.length;
      if (!s.semantic) {
        // Naive join FCT_APPLICATION → FCT_CASE on CONSTITUENT_KEY: one row per case record of the applicant.
        rows = sum(over.map((a) => casesOf(a.constituentKey)));
        notes.push('No semantic view: joined applications to every case of the applicant (fan-out) and counted rows.');
      }
      let count = rows * d.appScale;
      if (!s.cleansing) {
        const f = apps();
        count *= f.factor;
        notes.push(`Ran on RAW_BRONZE.ELIG_APPLICATION_CDC: ${f.dups} update duplicates and ${f.deletes} deletes in the landed sample.`);
      }
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const v = Math.round(count);
      const byDistrict = DISTRICTS.filter((x) => okD(allow, x.name)).map((x) => [x.name, fmtInt(over.filter((a) => a.district === x.name).length * d.appScale)] as [string, string]);
      return {
        value: v, valueText: fmtInt(v), caption: `applications over the 30-day standard, decided 1 Jan – 30 Sep 2026${allow ? ` in ${allow.join(' and ')}` : ''}`,
        table: { columns: ['District', 'Applications over standard'], rows: byDistrict },
        sql: s.semantic
          ? `SELECT applications_over_standard FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_CASE_MANAGEMENT ...)\n WHERE decision_date BETWEEN '2026-01-01' AND '2026-09-30'${s.context ? "\n   AND decision IN ('Approved', 'Denied')  -- BR-007" : ''}`
          : `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_APPLICATION' : 'RAW_BRONZE.ELIG_APPLICATION_CDC'} a\n  JOIN ${DB}.CONFORMED_GOLD.FCT_CASE c ON c.constituent_key = a.constituent_key  -- fan-out\n WHERE ${s.glossary ? 'a.processing_business_days' : 'DATEDIFF(day, a.received_date, a.decision_date)'} > 30`,
        sources: [{ productId: 'DP-02', version: '1.6.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('"Processing days" was not resolved, so the agent counted calendar days from receipt instead of business days from a complete application:', g, x), severity: 'wrong' as const },
      context: { reason: describe('Without rule BR-007 withdrawn and pending applications were counted, and the eligibility rules manual was not cited:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined each application to every case of the applicant:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in ELIG_APPLICATION_CDC were counted:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so applications from all four districts were counted:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Case Management is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('ELIG_APPLICATION_CDC');
      const withDecision = r.filter((x) => x.DECN_DT);
      const late = withDecision.filter((x) => daysBetween(String(x.RCVD_DT), String(x.DECN_DT)) > Q.STANDARD_DAYS);
      // Raw agent scales the late share of landed rows to nine months of applications.
      const v = Math.round((late.length / Math.max(1, withDecision.length)) * APPS_PER_MONTH * 9);
      const f = apps();
      return {
        value: v, valueText: fmtInt(v), caption: 'landed rows with DECN_DT − RCVD_DT > 30, scaled to nine months',
        sql: 'SELECT COUNT(*) FROM RAW_BRONZE.ELIG_APPLICATION_CDC\n WHERE DATEDIFF(day, RCVD_DT, DECN_DT) > 30  -- calendar days, any decision code',
        tablesUsed: ['RAW_BRONZE.ELIG_APPLICATION_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes included`,
          'Wrong definition: calendar days from receipt, not business days from a complete application (BR-006)',
          `Withdrawn applications counted: ${withDecision.filter((x) => x.DECN_CD === 'W').length} landed rows have DECN_CD = 'W'`,
          'No county holiday calendar; no citation of the eligibility rules manual',
          'No district row access, owner or certification',
        ],
        rowsRead: { columns: ['APP_NO', 'PERSON_ID', 'PGM_CD', 'RCVD_DT', 'CMPLT_DT', 'DECN_DT', 'DECN_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.APP_NO), String(x.PERSON_ID), String(x.PGM_CD), String(x.RCVD_DT), x.CMPLT_DT === null ? null : String(x.CMPLT_DT), x.DECN_DT === null ? null : String(x.DECN_DT), String(x.DECN_CD), String(x.OP_TYPE)]), exposed: [] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- K-3 integrity review (product in certification)
  const k3: KnockoutScenario = {
    id: 'KO-3', scenarioId: 'S-04', agentId: 'AG-01',
    question: "Which of my district's cases are flagged for program integrity review?",
    affects: ['certification', 'context', 'semantic', 'governance'],
    links: { certification: 'certify/DP-05', context: 'context/rules?rule=BR-014', semantic: 'semantic/SV_PROGRAM_INTEGRITY', governance: 'explorer/GOVERNANCE/MP_MASK_GOV_ID' },
    compute: (s, { persona, live }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      const statuses = s.context ? Q.REVIEW_STATUSES : ALL_FLAG_STATUSES;
      const ytdPay = Q.paymentsIn(d, ytd).filter((p) => okD(allow, p.district));
      const paying = new Set(ytdPay.map((p) => p.caseKey));
      const flagged = d.cases.filter((c) => c.flag && paying.has(c.key) && statuses.includes(c.flag.status));
      let n = flagged.length;
      if (s.context) notes.push('BR-014: only Open review and Referred flags count; a flag is a review, not a finding. Cited the program integrity procedures, chunk 14.');
      else notes.push(`No rule BR-014: ${flagged.filter((c) => !Q.REVIEW_STATUSES.includes(c.flag!.status)).length} Cleared or Overpayment-established sample cases counted as under review.`);
      if (!s.semantic) {
        // Counted payment rows carrying a flag instead of distinct cases.
        n = ytdPay.filter((p) => p.flagged && statuses.includes(p.flagStatus ?? '')).length;
        notes.push('No semantic view: counted flagged payment rows in FCT_PAYMENT, not distinct cases.');
      }
      const status = live.productStatus['DP-05'] ?? 'In certification';
      const certified = status === 'Certified';
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      if (!certified && s.certification) notes.push(`Not certified: Program Integrity (DP-05) is ${status}; the answer carries a "Not certified" banner.`);
      const v = Math.round(n * d.scale);
      const lacks = !persona.unmasked.includes('GOV_ID');
      const sample = flagged.slice(0, 3);
      return {
        value: v, valueText: fmtCompact(v), caption: `paying cases flagged for integrity review, 2026 YTD${allow ? ` in ${allow.join(' and ')}` : ''}`,
        table: {
          columns: ['Case', 'Case head government ID', 'District', 'Flag reason', 'Status'],
          rows: sample.map((c) => [c.caseId, String(s.governance ? maskFor(persona, 'GOV_ID', c.govId) : c.govId), c.district, c.flag!.reason, c.flag!.status]),
          masked: s.governance && lacks ? [1] : [],
          exposed: !s.governance && lacks ? [1] : [],
        },
        sql: s.semantic
          ? `SELECT district, flag_reason, COUNT(DISTINCT case_id) FROM ${DB}.DATA_PRODUCTS.DP_PROGRAM_INTEGRITY\n${s.context ? " WHERE flag_status IN ('Open review', 'Referred')  -- BR-014\n" : ' WHERE integrity_flag\n'} GROUP BY 1, 2`
          : `SELECT COUNT(*) FROM ${DB}.CONFORMED_GOLD.FCT_PAYMENT\n WHERE integrity_flag${s.context ? " AND flag_status IN ('Open review', 'Referred')" : ''}  -- one row per payment`,
        sources: [{ productId: 'DP-05', version: '1.0.0-rc', certified }], notes,
        exposed: !s.governance && lacks ? ['CASE_GOV_ID'] : undefined,
        hiddenWarning: !certified && !s.certification ? `Program Integrity (DP-05) is ${status} and was used without a "Not certified" warning.` : undefined,
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used Program Integrity, which is still in certification (masking gate open), with no "Not certified" banner.', severity: 'unverified' as const },
      context: { reason: describe('Without rule BR-014 cleared flags and established overpayments were reported as open reviews:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent counted flagged payment rows instead of cases:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access and MP_MASK_GOV_ID were bypassed: cases outside your districts were listed and case-head government IDs shown in clear.', g, x), severity: 'unsafe' as const },
      cleansing: { reason: 'No visible effect: integrity flags exist only from Gold onward.', severity: 'unverified' as const },
      glossary: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
    })[layer],
  };

  // ---------------------------------------------------------------------------------------------- K-4 improper payment rate
  const isUnder = (p: (typeof d.payments)[number]) => Boolean(p.errorType?.startsWith('Underpayment'));
  const k4: KnockoutScenario = {
    id: 'KO-4', scenarioId: 'S-10', agentId: 'AG-03',
    question: 'What is the improper payment rate year to date?',
    affects: ['glossary', 'context', 'cleansing', 'semantic', 'governance'],
    links: { glossary: 'glossary/T-015', context: 'context/rules?rule=BR-011', cleansing: 'explorer/RAW_BRONZE/BEN_PAYMENT_CDC', semantic: 'semantic/SV_BENEFIT_PAYMENTS', governance: 'explorer/GOVERNANCE/RAP_DISTRICT_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      const xs = Q.paymentsIn(d, ytd, allow);
      const w = (p: (typeof xs)[number]) => (s.semantic ? 1 : casesOf(p.constituentKey));
      const counts = (p: (typeof xs)[number]) => p.improper && (s.context || !isUnder(p));
      const improperAmt = (p: (typeof xs)[number]) => (counts(p) ? (s.cleansing ? p.improperAmount : p.amount) : 0);
      const rate = s.glossary
        ? pct(sum(xs.map((p) => w(p) * improperAmt(p))), sum(xs.map((p) => w(p) * p.amount)), 2)
        : pct(sum(xs.map((p) => (counts(p) ? w(p) : 0))), sum(xs.map(w)), 2);
      if (s.glossary) notes.push('Improper Payment (T-015): dollar-based rate, improper dollars ÷ dollars issued.');
      else notes.push('"Improper payment rate" not resolved: reported the share of payments with a finding (count-based).');
      if (s.context) notes.push('BR-011: overpayments and underpayments both count. Cited the program integrity procedures, chunk 5.');
      else notes.push(`No rule BR-011: ${xs.filter((p) => p.improper && isUnder(p)).length} underpayments in the sample left out; no citation.`);
      if (!s.cleansing) notes.push('Ran on RAW_BRONZE.BEN_PAYMENT_CDC, which has no IMPROPER_AMOUNT: the full PMT_AMT of every payment with a QC_ERR_CD was counted as improper.');
      if (!s.semantic) notes.push('No semantic view: joined payments to FCT_CASE on CONSTITUENT_KEY, repeating each payment once per case of the recipient.');
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const byProgram = Q.paymentsByProgram(d, ytd, allow).map((x) => [x.program, fmtPct(x.improperRate, 2)] as [string, string]);
      return {
        value: rate, valueText: fmtPct(rate, 2), caption: `improper payment rate, 1 Jan – 30 Sep 2026${allow ? ` in ${allow.join(' and ')}` : ''}`,
        table: { columns: ['Program', 'Improper rate (governed)'], rows: byProgram },
        sql: s.semantic && s.cleansing
          ? `SELECT improper_payment_rate FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_BENEFIT_PAYMENTS ...)\n WHERE issue_date BETWEEN '2026-01-01' AND '2026-09-30'${s.context ? '  -- BR-011' : "\n   AND error_type NOT LIKE 'Underpayment%'"}`
          : `SELECT ${s.glossary ? `SUM(${s.cleansing ? 'improper_amount' : 'IFF(QC_ERR_CD IS NOT NULL, PMT_AMT, 0)'}) / SUM(${s.cleansing ? 'payment_amount' : 'PMT_AMT'})` : 'AVG(IFF(is_improper, 1, 0))'} * 100\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_PAYMENT' : 'RAW_BRONZE.BEN_PAYMENT_CDC'} p${s.semantic ? '' : `\n  JOIN ${DB}.CONFORMED_GOLD.FCT_CASE c ON c.constituent_key = p.constituent_key  -- fan-out`}`,
        sources: [{ productId: 'DP-03', version: '1.3.2', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('"Improper payment rate" was not resolved, so the agent reported the share of payments with a finding instead of a dollar rate:', g, x), severity: 'ambiguous' as const },
      context: { reason: describe('Without rule BR-011 underpayments were left out and the program integrity procedures were not cited:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Bronze has no improper amount, so the whole value of every payment with a QC error code was counted:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined payments to every case of the recipient, re-weighting the rate:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so payments from all four districts were included:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Benefits Payments is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('BEN_PAYMENT_CDC');
      const amt = (x: Row) => Number(x.PMT_AMT);
      const v = pct(sum(r.filter((x) => x.QC_ERR_CD).map(amt)), sum(r.map(amt)), 2);
      const f = pays();
      return {
        value: v, valueText: fmtPct(v, 2), caption: 'SUM(PMT_AMT with a QC error code) ÷ SUM(PMT_AMT) over landed rows',
        sql: 'SELECT SUM(IFF(QC_ERR_CD IS NOT NULL, PMT_AMT, 0)) / SUM(PMT_AMT) * 100\n  FROM RAW_BRONZE.BEN_PAYMENT_CDC  -- no improper amount, no period, no district',
        tablesUsed: ['RAW_BRONZE.BEN_PAYMENT_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes included`,
          'Wrong definition: the whole payment counted as improper when any QC error code is present',
          `Only ${fmtNum(f.distinct, 0)} recent payments landed in the sample: no year-to-date period`,
          `Unmasked government IDs read for ${persona.roleId}: RCPT_SSN`,
          'No district, owner, lineage or certification',
        ],
        rowsRead: { columns: ['PMT_ID', 'CASE_NO', 'PGM_CD', 'PMT_AMT', 'RCPT_SSN', 'QC_ERR_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.PMT_ID), String(x.CASE_NO), String(x.PGM_CD), amt(x), String(x.RCPT_SSN), x.QC_ERR_CD === null ? null : String(x.QC_ERR_CD), String(x.OP_TYPE)]), exposed: [4] },
      };
    },
  };

  return [k1, k2, k3, k4];
}
