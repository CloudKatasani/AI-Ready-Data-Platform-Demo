// Utilities knockout questions (E1) and raw-data variants (E2). Every degraded and raw number is computed from the
// same synthetic data with the faulty logic applied: real CDC duplicates, a real wrong-grain aggregation, real
// major event days. Nothing is typed in.
import type { Persona, Row, SfObject } from '../../../types';
import type { KnockoutResult, KnockoutScenario, LayerSwitches, RawResult } from '../../../ext/types';
import { describe } from '../../../ext/knockout';
import { addDays, avg, groupBy, round, sum } from '../../../mock-snowflake/generators';
import { maskFor } from '../../../mock-snowflake/policies';
import { fmtCompact, fmtNum, fmtPct, fmtUsd } from '../../../lib/format';
import type { UtilData } from '../data';
import { AS_OF, OPCOS, SERVED_TOTAL } from '../generators.config';
import * as Q from '../queries';

const DB = 'NVE_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'OPCO' ? p.rowFilter.allowed : undefined);

export function buildKnockout(d: UtilData, objects: SfObject[]): KnockoutScenario[] {
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
  const cis = () => cdcFactor('CIS_CUSTOMER_CDC', 'CUST_NO', (r) => r.STAT_CD === 'A');
  const bills = () => cdcFactor('BILL_HDR_CDC', 'BILL_ID');
  const oms = () => cdcFactor('OMS_EVENT_CDC', 'EVT_ID');
  const veg = () => cdcFactor('VEG_INSPECTION_CDC', 'SPAN_ID');
  const recentBills = (since: string) => d.bills.filter((b) => b.date > since);
  const since60 = addDays(AS_OF, -60);

  // ---------------------------------------------------------------------------------------------- K-1 active customers
  const k1: KnockoutScenario = {
    id: 'KO-1', scenarioId: 'S-02', agentId: 'AG-01',
    question: 'How many active customers are enrolled in paperless billing?',
    affects: ['glossary', 'cleansing', 'semantic', 'governance'],
    links: { glossary: 'glossary/T-002', cleansing: 'explorer/RAW_BRONZE/CIS_CUSTOMER_CDC', semantic: 'semantic/SV_CUSTOMER_360', governance: 'explorer/GOVERNANCE/RAP_OPCO_ACCESS' },
    compute: (s: LayerSwitches, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const inScope = d.customers.filter((c) => !allow || allow.includes(c.opco));
      const recent = new Set(recentBills(since60).map((b) => b.customerKey));
      const active = inScope.filter((c) => c.status === 'Active' && (!s.glossary || recent.has(c.key)));
      const paperless = active.filter((c) => c.paperless);
      let count = paperless.length * d.scale;
      const notes: string[] = [];
      if (s.glossary) notes.push('Active Customer (T-002): Active status and a bill in the last 60 days.');
      else notes.push('"Active" read as CUSTOMER_STATUS = \'Active\' only.');
      if (!s.semantic) {
        // Naive join to billing statements without DISTINCT: one row per statement in the window.
        const keys = new Set(paperless.map((c) => c.key));
        count = recentBills(since60).filter((b) => keys.has(b.customerKey)).length * d.scale;
        notes.push('Counted joined statement rows, not distinct customers.');
      }
      if (!s.cleansing) {
        count *= cis().factor;
        notes.push(`Counted CDC rows from RAW_BRONZE.CIS_CUSTOMER_CDC (${cis().dups} update duplicates, ${cis().deletes} deletes in the landed sample).`);
      }
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const v = Math.round(count);
      return {
        value: v, valueText: fmtCompact(count), caption: `active customers on paperless billing${allow ? ` in ${allow.join(' and ')}` : ''}`,
        sql: s.semantic
          ? `SELECT COUNT(DISTINCT customer_id) FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360\n WHERE ${s.glossary ? 'is_active  -- BR-001' : "customer_status = 'Active'"} AND digital_enrolled`
          : `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.DIM_CUSTOMER' : 'RAW_BRONZE.CIS_CUSTOMER_CDC'} c\n  JOIN ${DB}.CONFORMED_GOLD.FCT_BILLING b ON b.customer_key = c.customer_key\n WHERE b.date_key > 20260801  -- no DISTINCT: one row per statement`,
        sources: [{ productId: 'DP-01', version: '2.3.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('Without the glossary the agent counted every Active-status account, ignoring the 60-day billing rule in T-002:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Without Silver, CDC update duplicates and deleted rows were counted:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined to statements and counted rows instead of customers:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so customers outside your operating companies were counted:', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Customer 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const cisRows = rowsOf('CIS_CUSTOMER_CDC');
      const billRows = rowsOf('BILL_HDR_CDC');
      const paperlessNos = new Set(billRows.filter((r) => r.PAPERLESS_IND === 'Y').map((r) => String(r.CUST_NO)));
      // Raw agent: exact string match on CUST_NO (untrimmed values miss), counts every CDC row with STAT_CD = 'A'.
      const matched = cisRows.filter((r) => r.STAT_CD === 'A' && paperlessNos.has(String(r.CUST_NO)));
      const sampleCustomers = new Set(cisRows.map((r) => String(r.CUST_NO).trim())).size;
      const v = Math.round(matched.length * (SERVED_TOTAL / Math.max(1, sampleCustomers)));
      const f = cis();
      return {
        value: v, valueText: fmtCompact(v), caption: 'rows guessed as "active paperless customers"',
        sql: `SELECT COUNT(*) FROM RAW_BRONZE.CIS_CUSTOMER_CDC c\n  JOIN RAW_BRONZE.BILL_HDR_CDC b ON b.CUST_NO = c.CUST_NO\n WHERE c.STAT_CD = 'A' AND b.PAPERLESS_IND = 'Y'`,
        tablesUsed: ['RAW_BRONZE.CIS_CUSTOMER_CDC', 'RAW_BRONZE.BILL_HDR_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deleted customers counted in the landed sample`,
          'Wrong definition: no 60-day billing rule for "active"',
          'Untrimmed CUST_NO values silently fail the join',
          `Unmasked PII read for ${persona.roleId}: NM_FIRST, NM_LAST, EMAIL_ADDR`,
          'No lineage, owner or certification for the tables used',
        ],
        rowsRead: { columns: ['CUST_NO', 'NM_FIRST', 'EMAIL_ADDR', 'STAT_CD', 'OP_TYPE'], rows: cisRows.slice(0, 4).map((r) => [String(r.CUST_NO), String(r.NM_FIRST), String(r.EMAIL_ADDR), String(r.STAT_CD), String(r.OP_TYPE)]), exposed: [1, 2] },
      } satisfies RawResult;
    },
  };

  // ---------------------------------------------------------------------------------------------- K-2 average bill
  const q3 = Q.PERIODS.quarter.months;
  const k2: KnockoutScenario = {
    id: 'KO-2', scenarioId: 'S-01', agentId: 'AG-01',
    question: 'What was the average monthly residential bill last quarter by region?',
    affects: ['semantic', 'glossary', 'cleansing', 'governance'],
    links: { semantic: 'semantic/SV_CUSTOMER_360', glossary: 'glossary/T-009', cleansing: 'explorer/RAW_BRONZE/BILL_HDR_CDC', governance: 'explorer/GOVERNANCE/RAP_OPCO_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      let bs = d.bills.filter((b) => q3.includes(b.month) && (!allow || allow.includes(b.opco)) && (!s.glossary || b.residential));
      const amount = (b: (typeof bs)[number]) => (s.cleansing ? b.billed : b.billed + b.arrears);
      const notes: string[] = [];
      if (!s.glossary) notes.push('"Residential" not resolved to rate classes RS-1 and RS-TOU: all customers averaged.');
      if (!s.cleansing) {
        const f = bills();
        const extra = Math.round(bs.length * (f.factor - 1));
        bs = [...bs, ...bs.slice(0, extra)];
        notes.push('Used RAW_BRONZE.BILL_HDR_CDC.AMT_DUE (billed plus arrears) including CDC duplicates.');
      }
      const byRegion = groupBy(bs, (b) => b.region);
      // Semantic off: SUM(amount) / COUNT(DISTINCT customer) over the quarter — the grain (one statement) is lost.
      const metric = (xs: typeof bs) => (s.semantic ? avg(xs.map(amount)) : sum(xs.map(amount)) / Math.max(1, new Set(xs.map((b) => b.customerKey)).size));
      if (!s.semantic) notes.push('No semantic view: summed a quarter of statements per customer instead of averaging statements.');
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const rows = OPCOS.filter((o) => byRegion.has(o.region)).map((o) => [o.region, fmtUsd(round(metric(byRegion.get(o.region)!), 2))] as [string, string]);
      const v = round(metric(bs), 2);
      return {
        value: v, valueText: fmtUsd(v), caption: `average monthly ${s.glossary ? 'residential ' : ''}bill, Q3 2026`,
        table: { columns: ['Region', 'Avg monthly bill'], rows },
        sql: s.semantic
          ? `SELECT customer.region, AVG(billing.billed_amount) FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_CUSTOMER_360 ...)\n WHERE ${s.glossary ? "customer.segment = 'Residential' AND " : ''}statement_month IN Q3 2026`
          : `SELECT region, SUM(${s.cleansing ? 'billed_amount' : 'AMT_DUE'}) / COUNT(DISTINCT customer_key)\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_BILLING' : 'RAW_BRONZE.BILL_HDR_CDC'} ...  -- grain lost`,
        sources: [{ productId: 'DP-01', version: '2.3.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      semantic: { reason: describe('Without the semantic view the agent summed three months of statements per customer:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"Residential" was not resolved, so large commercial bills were averaged in:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Raw AMT_DUE includes past-due balances and CDC duplicates:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so regions outside your operating companies were included:', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Customer 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('BILL_HDR_CDC');
      const v = round(avg(r.map((x) => Number(x.AMT_DUE))), 2);
      const f = bills();
      return {
        value: v, valueText: fmtUsd(v), caption: 'AVG(AMT_DUE) over every landed bill row',
        sql: 'SELECT AVG(AMT_DUE) FROM RAW_BRONZE.BILL_HDR_CDC\n WHERE BILL_DT >= \'2026-07-01\'  -- no rate class, no region, no dedup',
        tablesUsed: ['RAW_BRONZE.BILL_HDR_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes averaged in`,
          'Wrong definition: AMT_DUE includes past-due balances',
          'No rate class mapping: commercial bills included',
          'No region: the raw table has no operating company',
          'No owner, contract or certification',
        ],
        rowsRead: { columns: ['BILL_ID', 'CUST_NO', 'AMT_DUE', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.BILL_ID), String(x.CUST_NO), Number(x.AMT_DUE), String(x.OP_TYPE)]), exposed: [] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- K-3 SAIDI (signature)
  const k3: KnockoutScenario = {
    id: 'KO-3', scenarioId: 'S-06', agentId: 'AG-02',
    question: 'What is SAIDI year to date excluding major event days, by operating company?',
    affects: ['context', 'semantic', 'glossary', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-012', semantic: 'semantic/SV_RELIABILITY', glossary: 'glossary/T-004', cleansing: 'explorer/RAW_BRONZE/OMS_EVENT_CDC', governance: 'explorer/GOVERNANCE/RAP_OPCO_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      const r = Q.reliability(d, Q.PERIODS.ytd, s.context, allow);
      let value = r.total.saidi;
      let rows = r.rows.map((x) => [x.opco, fmtNum(x.saidi, 1)] as [string, string]);
      let caption = 'SAIDI minutes, 1 Jan – 30 Sep 2026';
      if (s.context) notes.push('BR-012: major event days excluded (IEEE 1366 2.5 beta). Cited IEEE 1366 guide, chunk 14.');
      else notes.push(`Major event days included: ${d.outages.filter((o) => o.med && o.date >= '2026-01-01').length} storm events counted; no citation.`);
      if (!s.glossary) {
        // "SAIDI" not resolved: the agent reports average event duration (minutes) instead.
        const evs = d.outages.filter((o) => o.date >= '2026-01-01' && (!s.context ? true : !o.med) && (!allow || allow.includes(o.opco)));
        value = round(avg(evs.map((o) => o.duration)), 1);
        rows = OPCOS.filter((o) => !allow || allow.includes(o.name)).map((o) => [o.name, fmtNum(avg(evs.filter((e) => e.opco === o.name).map((e) => e.duration)), 1)]);
        caption = 'average outage duration — "SAIDI" was not resolved';
        notes.push('Term not resolved: reported average event duration, not minutes per customer served.');
      } else if (!s.semantic) {
        // Naive join to DIM_CIRCUIT per event: the denominator sums circuit customers once per event.
        const evs = d.outages.filter((o) => o.date >= '2026-01-01' && (!s.context ? true : !o.med) && (!allow || allow.includes(o.opco)));
        const servedByCircuit = new Map(d.circuits.map((c) => [c.key, c.served]));
        const den = sum(evs.map((o) => servedByCircuit.get(o.circuitKey) ?? 0));
        value = round(sum(evs.map((o) => o.ci * o.duration)) / Math.max(1, den), 2);
        rows = OPCOS.filter((o) => !allow || allow.includes(o.name)).map((o) => {
          const xs = evs.filter((e) => e.opco === o.name);
          return [o.name, fmtNum(sum(xs.map((e) => e.ci * e.duration)) / Math.max(1, sum(xs.map((e) => servedByCircuit.get(e.circuitKey) ?? 0))), 2)];
        });
        notes.push('No semantic view: divided by circuit customers summed once per outage (join fan-out).');
      }
      if (!s.cleansing) {
        value = round(value * oms().factor, 1);
        notes.push(`Ran on RAW_BRONZE.OMS_EVENT_CDC: ${oms().dups} update duplicates in the landed sample.`);
      }
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      return {
        value, valueText: `${fmtNum(value, value < 10 ? 2 : 1)} min`, caption,
        table: { columns: ['Operating company', 'Value'], rows },
        sql: s.semantic && s.glossary
          ? `SELECT circuit.opco, saidi_minutes FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_RELIABILITY ...)\n WHERE outage_date >= '2026-01-01'${s.context ? ' AND med_flag = FALSE  -- BR-012' : ''}`
          : `SELECT opco, ${s.glossary ? 'SUM(customer_minutes) / SUM(c.customers_served)' : 'AVG(duration_min)'}\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_OUTAGE' : 'RAW_BRONZE.OMS_EVENT_CDC'} o JOIN ${DB}.CONFORMED_GOLD.DIM_CIRCUIT c USING (circuit_key)`,
        sources: [{ productId: 'DP-02', version: '1.4.1', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-012 storm days were counted and the IEEE 1366 guide was not cited:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined each outage to its circuit and summed customers served per event:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"SAIDI" was not resolved, so the agent reported average outage duration:', g, x), severity: 'ambiguous' as const },
      cleansing: { reason: describe('CDC update duplicates in OMS_EVENT_CDC inflated customer minutes:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so all four operating companies were reported:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: System Reliability is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('OMS_EVENT_CDC');
      const mins = r.map((x) => (new Date(String(x.END_TS).replace(' ', 'T') + 'Z').getTime() - new Date(String(x.START_TS).replace(' ', 'T') + 'Z').getTime()) / 60000);
      const v = round(avg(mins), 1);
      const f = oms();
      return {
        value: v, valueText: `${fmtNum(v, 1)} min`, caption: 'AVG(END_TS − START_TS) over landed outage rows',
        sql: 'SELECT AVG(DATEDIFF(minute, START_TS, END_TS)) FROM RAW_BRONZE.OMS_EVENT_CDC\n -- no customers served, no major event day flag, no opco',
        tablesUsed: ['RAW_BRONZE.OMS_EVENT_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes included`,
          'Wrong definition: average duration is not SAIDI (minutes per customer served)',
          'Major event days not excluded; no IEEE 1366 citation',
          'No operating company: CKT_ID is not mapped to an opco',
          'No owner, lineage or certification',
        ],
        rowsRead: { columns: ['EVT_ID', 'CKT_ID', 'START_TS', 'END_TS', 'CAUSE_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.EVT_ID), String(x.CKT_ID), String(x.START_TS), String(x.END_TS), String(x.CAUSE_CD), String(x.OP_TYPE)]), exposed: [] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- K-4 vegetation (draft product)
  const k4: KnockoutScenario = {
    id: 'KO-4', scenarioId: 'S-08', agentId: 'AG-02',
    question: 'How many spans are overdue for trimming?',
    affects: ['certification', 'context', 'cleansing'],
    links: { certification: 'certify/DP-06', context: 'context/rules?rule=BR-013', cleansing: 'explorer/RAW_BRONZE/VEG_INSPECTION_CDC' },
    compute: (s) => {
      const cycleOf = (sp: (typeof d.spans)[number]) => (s.context ? sp.cycleYears : 4);
      const overdue = d.spans.filter((sp) => {
        const age = (new Date(`${AS_OF}T00:00:00Z`).getTime() - new Date(`${sp.lastTrim}T00:00:00Z`).getTime()) / 86_400_000;
        return age > cycleOf(sp) * 365;
      });
      let v = overdue.length;
      const notes: string[] = [];
      if (s.context) notes.push('BR-013: 4-year cycle, 5 years in rural Appalachia.');
      else notes.push('No rule: a flat 4-year cycle applied to every span.');
      if (!s.cleansing) {
        v = Math.round(v * veg().factor);
        notes.push(`Counted RAW_BRONZE.VEG_INSPECTION_CDC rows, including ${veg().dups} update duplicates.`);
      }
      return {
        value: v, valueText: fmtCompact(v), caption: `of ${d.spans.length} spans overdue for trim (${fmtPct((v / d.spans.length) * 100)})`,
        sql: `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'DATA_PRODUCTS.DP_VEGETATION_RISK' : 'RAW_BRONZE.VEG_INSPECTION_CDC'}\n WHERE ${s.context ? 'is_overdue  -- BR-013 cycle by region' : "DATEADD(year, 4, last_trim_date) < CURRENT_DATE"}`,
        sources: [{ productId: 'DP-06', version: '0.3.0', certified: false }],
        notes: s.certification ? [...notes, 'Not certified: Vegetation Risk is a Draft product (quality score 88.0).'] : notes,
        hiddenWarning: s.certification ? undefined : 'Draft product used without a warning; quality score 88.0 hidden.',
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used the Draft Vegetation Risk product with no "Not certified" banner and its 88.0 quality score hidden.', severity: 'unverified' as const },
      context: { reason: describe('Without rule BR-013 rural spans were judged on a 4-year cycle:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in VEG_INSPECTION_CDC were counted:', g, x), severity: 'wrong' as const },
      semantic: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      glossary: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      governance: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
    })[layer],
  };

  // Governance also exposes PII on the list-style question; keep the analyst story visible in K-1's table.
  const withExposure = (ks: KnockoutScenario): KnockoutScenario => ({
    ...ks,
    compute: (s, ctx) => {
      const r = ks.compute(s, ctx);
      if (ks.id !== 'KO-1') return r;
      const masked = s.governance && !ctx.persona.unmasked.includes('PII');
      const allow = s.governance ? allowOf(ctx.persona) : undefined;
      const sample = d.customers.filter((c) => c.paperless && c.status === 'Active' && (!allow || allow.includes(c.opco))).slice(0, 3);
      const table: KnockoutResult['table'] = {
        columns: ['Customer', 'Email', 'Opco'],
        rows: sample.map((c) => [String(maskFor(ctx.persona, 'PII', `${c.first} ${c.last}`)), String(s.governance ? maskFor(ctx.persona, 'PII', c.email) : c.email), c.opco]),
        masked: masked ? [0, 1] : [],
        exposed: !s.governance && !ctx.persona.unmasked.includes('PII') ? [0, 1] : [],
      };
      return { ...r, table, exposed: !s.governance && !ctx.persona.unmasked.includes('PII') ? ['CUSTOMER_NAME', 'EMAIL'] : undefined };
    },
  });

  return [k1, k2, k3, k4].map(withExposure);
}
