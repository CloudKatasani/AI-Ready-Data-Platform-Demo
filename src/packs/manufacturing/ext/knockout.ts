// Manufacturing knockout questions (E1) and raw-data variants (E2). Every degraded and raw number is computed from the
// same synthetic data with the faulty logic applied: real CDC update duplicates from RAW_BRONZE, scheduled time used as
// the OEE time base, an unweighted mean of shift OEE, a join fan-out to shift rows. Nothing is typed in.
import type { Persona, Row, SfObject } from '../../../types';
import type { KnockoutScenario, LayerSwitches, RawResult } from '../../../ext/types';
import { describe } from '../../../ext/knockout';
import { avg, groupBy, pad, round, sum } from '../../../mock-snowflake/generators';
import { fmtInt, fmtNum, fmtPct } from '../../../lib/format';
import type { MfgData, Production } from '../data';
import { BUSINESS_UNITS } from '../generators.config';
import * as Q from '../queries';

const DB = 'FPI_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'BUSINESS_UNIT' ? p.rowFilter.allowed : undefined);
const okBu = (bu: string, allow?: string[]) => !allow || allow.includes(bu);
const evtId = (p: Production) => `EV${p.date.replace(/-/g, '')}${pad(p.lineKey, 3)}${p.shift}`;

/** How an OEE number is computed when layers are switched off. The governed setting reproduces Q.oeeOf exactly. */
interface OeeOpts {
  /** BR-001: planned production time (planned downtime excluded) or full scheduled time. */
  plannedBase: boolean;
  /** Semantic view: ratio of sums over the period, or an unweighted mean of per-shift OEE. */
  ratio: boolean;
  /** Silver: GOOD_UNITS = total − scrap − rework; raw MES only has total − scrap. */
  silverGood: boolean;
  /** Glossary: "OEE" resolved, or read as availability only. */
  oee: boolean;
}
function oeeWith(rows: Production[], o: OeeOpts): number {
  const base = (p: Production) => (o.plannedBase ? p.plannedMin : p.plannedMin + p.plannedDownMin);
  const good = (p: Production) => (o.silverGood ? p.good : p.total - p.scrap);
  const one = (xs: Production[]) => {
    const b = sum(xs.map(base));
    const run = sum(xs.map((x) => x.runMin));
    const total = sum(xs.map((x) => x.total));
    const a = b ? run / b : 0;
    const pf = run ? sum(xs.map((x) => x.idealMin)) / run : 0;
    const q = total ? sum(xs.map(good)) / total : 0;
    return (o.oee ? a * pf * q : a) * 100;
  };
  return round(o.ratio ? one(rows) : avg(rows.map((r) => one([r]))), 1);
}

export function buildKnockout(d: MfgData, objects: SfObject[]): KnockoutScenario[] {
  const rowsOf = (name: string): Row[] => {
    const o = objects.find((x) => x.name === name);
    return o?.rows ? o.rows({ productStatus: {}, productVersion: {}, fixes: {} }) : [];
  };
  /** Landed MES shift records: CDC update duplicates and deletes, by event id. */
  const mes = () => {
    const rows = rowsOf('MES_LINE_EVENT_CDC');
    const dupIds = new Set(rows.filter((r) => r.OP_TYPE === 'U').map((r) => String(r.EVT_ID)));
    return { rows, dupIds, dups: dupIds.size, deletes: rows.filter((r) => r.OP_TYPE === 'D').length };
  };
  /** Cleansing off: shifts with a CDC update are counted twice, as they sit in RAW_BRONZE. */
  const withDuplicates = (rows: Production[]) => {
    const { dupIds } = mes();
    return [...rows, ...rows.filter((p) => dupIds.has(evtId(p)))];
  };
  const optsOf = (s: LayerSwitches): OeeOpts => ({ plannedBase: s.context, ratio: s.semantic, silverGood: s.cleansing, oee: s.glossary });
  const roster = () => {
    const rows = rowsOf('MES_OPERATOR_CDC');
    return new Map(rows.map((r) => [String(r.BADGE_NO), r]));
  };

  // ---------------------------------------------------------------------------------------------- K-1 active lines
  const k1: KnockoutScenario = {
    id: 'KO-1', scenarioId: 'S-02', agentId: 'AG-01',
    question: 'How many active production lines ran last month?',
    affects: ['glossary', 'semantic', 'governance'],
    links: { glossary: 'glossary/T-002', semantic: 'semantic/SV_PLANT_PERFORMANCE', governance: 'explorer/GOVERNANCE/RAP_BU_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const r = Q.activeLines(d, allow);
      const scoped = d.lines.filter((l) => okBu(l.bu, allow));
      const counted = s.glossary ? r.active : scoped.filter((l) => l.status === 'Active');
      const notes: string[] = [];
      if (s.glossary) notes.push('Active Production Line (T-002): status Active and scheduled production in the last 30 days.');
      else notes.push(`"Active" read as LINE_STATUS = 'Active' only: ${counted.length - r.active.length} idle line${counted.length - r.active.length === 1 ? '' : 's'} counted.`);
      let v = counted.length;
      if (!s.semantic) {
        // No semantic view: the agent joined lines to FCT_LINE_PRODUCTION and counted rows (one per shift), not lines.
        const keys = new Set(counted.map((l) => l.key));
        v = d.production.filter((p) => keys.has(p.lineKey) && Q.inRange(p.date, Q.PERIODS.last30)).length;
        notes.push('Counted joined shift rows from FCT_LINE_PRODUCTION, not distinct lines.');
      }
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const bus = BUSINESS_UNITS.map((b) => b.name).filter((b) => okBu(b, allow));
      return {
        value: v, valueText: fmtInt(v), caption: `production lines active in September 2026${allow ? ` in ${allow.join(' and ')}` : ''}`,
        table: { columns: ['Business unit', 'Lines in master', 'Counted'], rows: bus.map((b) => [b, d.lines.filter((l) => l.bu === b).length, counted.filter((l) => l.bu === b).length]) },
        sql: s.semantic
          ? `SELECT COUNT(DISTINCT line_id) FROM ${DB}.DATA_PRODUCTS.DP_PRODUCTION_OEE p\n  JOIN ${DB}.CONFORMED_GOLD.DIM_LINE USING (line_id)\n WHERE line_status = 'Active'${s.glossary ? "\n   AND p.production_date > DATEADD(day, -30, '2026-09-30')  -- BR-003" : ''}`
          : `SELECT COUNT(*) FROM ${DB}.CONFORMED_GOLD.DIM_LINE l\n  JOIN ${DB}.CONFORMED_GOLD.FCT_LINE_PRODUCTION p USING (line_key)\n WHERE l.line_status = 'Active'  -- no DISTINCT: one row per shift`,
        sources: [{ productId: 'DP-01', version: '2.1.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('Without the glossary the agent counted every Active-status line, including lines with no shifts in the last 30 days (T-002):', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined lines to shift records and counted rows instead of lines:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so lines outside your business units were counted:', g, x), severity: 'unsafe' as const },
      cleansing: { reason: 'No visible effect: the line master is small and clean.', severity: 'unverified' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Production & OEE is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('MES_OPERATOR_CDC');
      // Raw agent: no line master in RAW_BRONZE, so it counts distinct LINE_CD strings in the roster CDC feed.
      const codes = new Set(r.map((x) => String(x.LINE_CD)));
      const clean = new Set(r.map((x) => String(x.LINE_CD).trim().toUpperCase()));
      return {
        value: codes.size, valueText: fmtInt(codes.size), caption: 'distinct LINE_CD values in the MES roster feed',
        sql: 'SELECT COUNT(DISTINCT LINE_CD) FROM RAW_BRONZE.MES_OPERATOR_CDC\n -- no line status, no production calendar, no row access',
        tablesUsed: ['RAW_BRONZE.MES_OPERATOR_CDC'],
        risks: [
          `Untrimmed and mixed-case codes: ${codes.size} raw values for ${clean.size} real lines in the landed sample`,
          `Duplicates: ${r.filter((x) => x.OP_TYPE === 'U').length} CDC update rows and ${r.filter((x) => x.OP_TYPE === 'D').length} deletes read`,
          'Wrong definition: no line status and no 30-day production rule (T-002)',
          `Unmasked PII read for ${persona.roleId}: FIRST_NM, LAST_NM, EMAIL_ADDR`,
          'No lineage, owner or certification for the table used',
        ],
        rowsRead: { columns: ['BADGE_NO', 'FIRST_NM', 'LAST_NM', 'EMAIL_ADDR', 'LINE_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.BADGE_NO), String(x.FIRST_NM), String(x.LAST_NM), String(x.EMAIL_ADDR), String(x.LINE_CD), String(x.OP_TYPE)]), exposed: [1, 2, 3] },
      } satisfies RawResult;
    },
  };

  // ---------------------------------------------------------------------------------------------- K-2 OEE by business unit
  const q3 = Q.PERIODS.quarter.months;
  const k2: KnockoutScenario = {
    id: 'KO-2', scenarioId: 'S-01', agentId: 'AG-01',
    question: 'What was OEE by business unit last quarter?',
    affects: ['context', 'semantic', 'glossary', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-001', semantic: 'semantic/SV_PLANT_PERFORMANCE', glossary: 'glossary/T-004', cleansing: 'explorer/RAW_BRONZE/MES_LINE_EVENT_CDC', governance: 'explorer/GOVERNANCE/RAP_BU_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      let rows = Q.prodIn(d, (p) => Q.inMonths(p.date, q3) && okBu(p.bu, allow));
      const notes: string[] = [];
      if (s.context) notes.push('BR-001: OEE = availability × performance × quality; planned downtime excluded. Cited OPS-STD-014.');
      else notes.push('No rule BR-001: scheduled shift time (planned downtime included) used as the time base; no citation.');
      if (!s.glossary) notes.push('"OEE" not resolved: reported run time ÷ time base (availability) as equipment effectiveness.');
      if (!s.semantic) notes.push('No semantic view: averaged per-shift OEE instead of summing time and units over the quarter.');
      if (!s.cleansing) {
        const m = mes();
        rows = withDuplicates(rows);
        notes.push(`Ran on RAW_BRONZE.MES_LINE_EVENT_CDC: good units = TOTAL_CNT − SCRAP_CNT (rework counted as good), ${m.dups} update duplicates in the landed sample.`);
      }
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const o = optsOf(s);
      const by = groupBy(rows, (p) => p.bu);
      const v = oeeWith(rows, o);
      return {
        value: v, valueText: fmtPct(v), caption: `${s.glossary ? 'OEE' : 'availability reported as OEE'}, Q3 2026${allow ? `, ${allow.join(' and ')}` : ''}`,
        table: { columns: ['Business unit', s.glossary ? 'OEE' : 'Value'], rows: BUSINESS_UNITS.filter((b) => by.has(b.name)).map((b) => [b.name, fmtPct(oeeWith(by.get(b.name)!, o))]) },
        sql: s.semantic
          ? `SELECT line.business_unit, ${s.glossary ? 'oee_pct' : 'availability_pct'}\n  FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_PLANT_PERFORMANCE ...)\n WHERE date.fiscal_quarter = '2026-Q3'${s.context ? '  -- BR-001 planned downtime excluded' : ''}`
          : `SELECT business_unit, AVG(${s.glossary ? 'oee_pct' : 'availability_pct'})  -- unweighted mean of shifts\n  FROM ${DB}.${s.cleansing ? 'DATA_PRODUCTS.DP_PRODUCTION_OEE' : 'RAW_BRONZE.MES_LINE_EVENT_CDC'}\n GROUP BY 1`,
        sources: [{ productId: 'DP-01', version: '2.1.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-001 planned downtime stayed in the time base, so breaks and planned maintenance counted as losses:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent averaged shift OEE, so short and long shifts weighed the same:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"OEE" was not resolved, so the agent reported availability only:', g, x), severity: 'ambiguous' as const },
      cleansing: { reason: describe('Raw MES counts rework as good and keeps CDC update duplicates:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so business units outside your scope were included:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Production & OEE is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const m = mes();
      const r = m.rows;
      const n = (x: Row, k: string) => Number(x[k]);
      const a = sum(r.map((x) => n(x, 'PLAN_MIN') - n(x, 'PLAN_DOWN_MIN') - n(x, 'DOWN_MIN'))) / Math.max(1, sum(r.map((x) => n(x, 'PLAN_MIN'))));
      const q = sum(r.map((x) => n(x, 'TOTAL_CNT') - n(x, 'SCRAP_CNT'))) / Math.max(1, sum(r.map((x) => n(x, 'TOTAL_CNT'))));
      const v = round(a * q * 100, 1);
      const people = roster();
      return {
        value: v, valueText: fmtPct(v), caption: 'availability × yield over every landed MES row (no performance term)',
        sql: 'SELECT SUM(PLAN_MIN - PLAN_DOWN_MIN - DOWN_MIN) / SUM(PLAN_MIN)\n     * SUM(TOTAL_CNT - SCRAP_CNT) / SUM(TOTAL_CNT) * 100\n  FROM RAW_BRONZE.MES_LINE_EVENT_CDC  -- no ideal cycle time, no business unit, no dedup',
        tablesUsed: ['RAW_BRONZE.MES_LINE_EVENT_CDC', 'RAW_BRONZE.MES_OPERATOR_CDC'],
        risks: [
          `Duplicates: ${m.dups} CDC update rows and ${m.deletes} deletes included`,
          'Wrong definition: no performance term (ideal cycle time lives in DIM_LINE), planned downtime in the time base, rework counted as good',
          `Wrong period: only the landed sample (${String(r[r.length - 1]?.SHIFT_DT)} to ${String(r[0]?.SHIFT_DT)}), not Q3`,
          'No business unit: LINE_CD is not mapped to a business unit',
          'Shift lead names read in clear from the roster feed; no owner or certification',
        ],
        rowsRead: {
          columns: ['EVT_ID', 'LINE_CD', 'SHIFT_DT', 'DOWN_MIN', 'LEAD_BADGE', 'FIRST_NM', 'LAST_NM', 'OP_TYPE'],
          rows: r.slice(0, 4).map((x) => { const p = people.get(String(x.LEAD_BADGE)); return [String(x.EVT_ID), String(x.LINE_CD), String(x.SHIFT_DT), n(x, 'DOWN_MIN'), String(x.LEAD_BADGE), p ? String(p.FIRST_NM) : null, p ? String(p.LAST_NM) : null, String(x.OP_TYPE)]; }),
          exposed: [5, 6],
        },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- K-3 lines below 65% (signature)
  const k3: KnockoutScenario = {
    id: 'KO-3', scenarioId: 'S-06', agentId: 'AG-02',
    question: 'Which lines had OEE below 65% last week, and what drove the losses?',
    affects: ['context', 'semantic', 'glossary', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-001', semantic: 'semantic/SV_PLANT_PERFORMANCE', glossary: 'glossary/T-004', cleansing: 'explorer/RAW_BRONZE/MES_LINE_EVENT_CDC', governance: 'explorer/GOVERNANCE/RAP_BU_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      let rows = Q.prodIn(d, (p) => Q.inRange(p.date, Q.PERIODS.lastWeek) && okBu(p.bu, allow));
      const notes: string[] = [];
      if (s.context) notes.push('BR-001: planned downtime excluded from the time base; BR-002: 65% tier-3 review threshold. Cited OPS-STD-014, chunk 7.');
      else notes.push('No rule BR-001: scheduled shift time used as the time base; no citation.');
      if (!s.glossary) notes.push('"OEE" not resolved: lines compared on availability against 65%.');
      if (!s.semantic) notes.push('No semantic view: line OEE taken as the unweighted mean of its shifts.');
      if (!s.cleansing) {
        rows = withDuplicates(rows);
        notes.push('Ran on RAW_BRONZE.MES_LINE_EVENT_CDC: rework counted as good units (no GOOD_UNITS column in raw MES).');
      }
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const o = optsOf(s);
      const by = groupBy(rows, (p) => p.lineId);
      const lines = [...by.entries()].map(([lineId, xs]) => ({ lineId, bu: xs[0].bu, plant: xs[0].plantName, v: oeeWith(xs, o) }));
      const below = lines.filter((x) => x.v < 65).sort((a, b) => a.v - b.v);
      return {
        value: below.length, valueText: `${below.length} of ${lines.length} lines`, caption: `below 65% ${s.glossary ? 'OEE' : 'availability'}, Mon 21 – Sun 27 Sep 2026`,
        table: { columns: ['Line', 'Plant', 'Business unit', s.glossary ? 'OEE' : 'Availability'], rows: below.map((x) => [x.lineId, x.plant, x.bu, fmtPct(x.v)]) },
        sql: s.semantic
          ? `SELECT line.line_id, ${s.glossary ? 'oee_pct' : 'availability_pct'}\n  FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_PLANT_PERFORMANCE ...)\n WHERE date.production_date BETWEEN '2026-09-21' AND '2026-09-27'\n   AND ${s.glossary ? 'oee_pct' : 'availability_pct'} < 65${s.context ? '  -- BR-001, BR-002' : ''}`
          : `SELECT line_id, AVG(${s.glossary ? 'oee_pct' : 'availability_pct'}) AS v\n  FROM ${DB}.${s.cleansing ? 'DATA_PRODUCTS.DP_PRODUCTION_OEE' : 'RAW_BRONZE.MES_LINE_EVENT_CDC'}\n WHERE shift_date BETWEEN '2026-09-21' AND '2026-09-27'\n GROUP BY 1 HAVING v < 65`,
        sources: [{ productId: 'DP-01', version: '2.1.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-001 planned downtime counted as lost time, pushing healthy lines under 65%, and OPS-STD-014 was not cited:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view each line’s OEE was an average of its shifts, so one bad shift weighed as much as a full one:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"OEE" was not resolved, so lines were judged on availability alone and performance and quality losses were missed:', g, x), severity: 'ambiguous' as const },
      cleansing: { reason: describe('Raw MES counts rework as good, hiding quality losses:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so lines outside your business units were listed:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Production & OEE is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const m = mes();
      const r = m.rows;
      const n = (x: Row, k: string) => Number(x[k]);
      const byLine = groupBy(r, (x) => String(x.LINE_CD));
      const score = (xs: Row[]) => (sum(xs.map((x) => n(x, 'PLAN_MIN') - n(x, 'PLAN_DOWN_MIN') - n(x, 'DOWN_MIN'))) / Math.max(1, sum(xs.map((x) => n(x, 'PLAN_MIN'))))) * (sum(xs.map((x) => n(x, 'TOTAL_CNT') - n(x, 'SCRAP_CNT'))) / Math.max(1, sum(xs.map((x) => n(x, 'TOTAL_CNT'))))) * 100;
      const below = [...byLine.values()].filter((xs) => score(xs) < 65).length;
      const people = roster();
      const dates = r.map((x) => String(x.SHIFT_DT)).sort();
      return {
        value: below, valueText: `${below} of ${byLine.size} lines`, caption: 'availability × yield below 65% over landed MES rows',
        sql: 'SELECT LINE_CD FROM RAW_BRONZE.MES_LINE_EVENT_CDC\n GROUP BY LINE_CD\nHAVING SUM(PLAN_MIN - PLAN_DOWN_MIN - DOWN_MIN) / SUM(PLAN_MIN)\n     * SUM(TOTAL_CNT - SCRAP_CNT) / SUM(TOTAL_CNT) < 0.65',
        tablesUsed: ['RAW_BRONZE.MES_LINE_EVENT_CDC', 'RAW_BRONZE.MES_OPERATOR_CDC'],
        risks: [
          `Wrong week: the landed sample covers ${dates[0]} to ${dates[dates.length - 1]}, not Mon 21 – Sun 27 Sep`,
          'Wrong definition: no performance term, planned downtime in the time base, rework counted as good',
          `Duplicates: ${m.dups} CDC update rows and ${m.deletes} deletes included`,
          'No loss driver: DOWN_RSN_CD codes are not decoded and no loss standard is cited',
          'Shift lead names read in clear from the roster feed; no owner or certification',
        ],
        rowsRead: {
          columns: ['LINE_CD', 'SHIFT_DT', 'DOWN_RSN_CD', 'TOTAL_CNT', 'LEAD_BADGE', 'FIRST_NM', 'LAST_NM'],
          rows: r.slice(0, 4).map((x) => { const p = people.get(String(x.LEAD_BADGE)); return [String(x.LINE_CD), String(x.SHIFT_DT), String(x.DOWN_RSN_CD), n(x, 'TOTAL_CNT'), String(x.LEAD_BADGE), p ? String(p.FIRST_NM) : null, p ? String(p.LAST_NM) : null]; }),
          exposed: [5, 6],
        },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- K-4 energy per unit (draft product)
  const k4: KnockoutScenario = {
    id: 'KO-4', scenarioId: 'S-08', agentId: 'AG-02',
    question: 'What was energy per unit and scope 2 emissions by business unit last quarter?',
    affects: ['certification', 'context', 'governance'],
    links: { certification: 'certify/DP-06', context: 'context/rules?rule=BR-016', governance: 'explorer/GOVERNANCE/RAP_BU_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const e = Q.energy(d, q3, allow);
      const rows = Q.prodIn(d, (p) => Q.inMonths(p.date, q3) && okBu(p.bu, allow));
      const byBu = groupBy(rows, (p) => p.bu);
      // BR-016 divides by good units only; without it the agent divides by every unit started (scrap and rework included).
      const units = (xs: Production[]) => sum(xs.map((x) => (s.context ? x.good : x.total)));
      const v = s.context ? e.kwhPerUnit : round(sum(rows.map((x) => x.energyKwh)) / Math.max(1, units(rows)), 2);
      const notes: string[] = [];
      if (s.context) notes.push('BR-016: energy per unit divides by good units; scope 2 is location-based.');
      else notes.push('No rule BR-016: divided by units started, so scrapped and reworked units lowered energy per unit.');
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      return {
        value: v, valueText: `${fmtNum(v, 2)} kWh`, caption: `per ${s.context ? 'good' : 'started'} unit, Q3 2026; scope 2 ${fmtInt(e.tco2e)} tCO2e`,
        table: { columns: ['Business unit', 'kWh per unit', 'Scope 2 (tCO2e)'], rows: e.rows.map((x) => [x.bu, fmtNum(sum((byBu.get(x.bu) ?? []).map((p) => p.energyKwh)) / Math.max(1, units(byBu.get(x.bu) ?? [])), 2), fmtInt(x.tco2e)]) },
        sql: `SELECT business_unit, SUM(energy_kwh) / SUM(${s.context ? 'good_units' : 'total_units'}) AS kwh_per_unit,\n       SUM(co2e_kg) / 1000 AS scope2_tco2e\n  FROM ${DB}.DATA_PRODUCTS.DP_ENERGY_EMISSIONS${s.certification ? '  -- DRAFT, not certified' : ''}\n WHERE energy_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY 1`,
        sources: [{ productId: 'DP-06', version: '0.4.0', certified: false }],
        notes: s.certification ? [...notes, 'Not certified: Energy & Emissions (DP-06) is a Draft product with no steward and a failing freshness check.'] : notes,
        hiddenWarning: s.certification ? undefined : 'Draft product used without a warning; missing steward and failing freshness check hidden.',
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used the Draft Energy & Emissions product with no "Not certified" banner, hiding its missing steward and failing freshness check.', severity: 'unverified' as const },
      context: { reason: describe('Without rule BR-016 energy was divided by every unit started, including scrap and rework:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so business units outside your scope were included:', g, x), severity: 'unsafe' as const },
      cleansing: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      semantic: { reason: 'No visible effect: Energy & Emissions has no semantic view yet.', severity: 'unverified' as const },
      glossary: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
    })[layer],
  };

  return [k1, k2, k3, k4];
}
