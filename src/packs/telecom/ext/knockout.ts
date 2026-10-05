// Telecom knockout questions (E1) and raw-data variants (E2). Every degraded and raw number is computed from the
// same synthetic data with the faulty logic applied: real CDC duplicates in the landed Bronze sample, a real
// invoice fan-out, plan migrations and involuntary disconnects that the rules exclude. Nothing is typed in.
import type { Persona, Row, SfObject } from '../../../types';
import type { KnockoutResult, KnockoutScenario, LayerSwitches, RawResult } from '../../../ext/types';
import { describe } from '../../../ext/knockout';
import { avg, groupBy, round, sum } from '../../../mock-snowflake/generators';
import { maskFor } from '../../../mock-snowflake/policies';
import { fmtCompact, fmtNum, fmtUsd } from '../../../lib/format';
import type { Invoice, TelData } from '../data';
import { PLANS, REGIONS, SUBSCRIBER_TOTAL } from '../generators.config';
import * as Q from '../queries';

const DB = 'ALT_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const ok = (region: string, allow?: string[]) => !allow || allow.includes(region);

export function buildKnockout(d: TelData, objects: SfObject[]): KnockoutScenario[] {
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
  const crmActive = () => cdcFactor('CRM_SUBSCRIBER_CDC', 'SUB_ID', (r) => r.STATUS_CD === 'AC');
  const crm = () => cdcFactor('CRM_SUBSCRIBER_CDC', 'SUB_ID');
  const bss = () => cdcFactor('BSS_INVOICE_CDC', 'INVOICE_NO');
  const q3 = Q.PERIODS.quarter.months;
  /** Append the share of rows that the landed CDC sample over-counts (the Bronze update and delete rows). */
  const withDuplicates = (xs: Invoice[]) => [...xs, ...xs.slice(0, Math.round(xs.length * (bss().factor - 1)))];

  // ---------------------------------------------------------------------------------------------- KO-1 active autopay
  const k1: KnockoutScenario = {
    id: 'KO-1', scenarioId: 'S-02', agentId: 'AG-01',
    question: 'How many active subscribers are enrolled in autopay?',
    affects: ['glossary', 'semantic', 'cleansing', 'governance'],
    links: { glossary: 'glossary/T-002', semantic: 'semantic/SV_SUBSCRIBER_360', cleansing: 'explorer/RAW_BRONZE/CRM_SUBSCRIBER_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s: LayerSwitches, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const active = s.glossary ? Q.activeSubscribers(d, allow) : d.subscribers.filter((x) => x.status === 'Active' && ok(x.region, allow));
      const autopay = active.filter((x) => x.autopay);
      let count = autopay.length * d.scale;
      const notes: string[] = [];
      if (s.glossary) notes.push('Active Subscriber (T-002 / BR-001): Active status and an invoice in September 2026.');
      else notes.push(`"Active" read as STATUS = 'Active' only: ${autopay.length - Q.activeSubscribers(d, allow).filter((x) => x.autopay).length} dormant autopay lines in the sample counted.`);
      if (!s.semantic) {
        // Naive join to FCT_BILLING over the quarter without DISTINCT: one row per invoice.
        const keys = new Set(autopay.map((x) => x.key));
        count = d.invoices.filter((v) => q3.includes(v.month) && keys.has(v.subKey)).length * d.scale;
        notes.push('Counted joined Q3 invoice rows, not distinct subscribers.');
      }
      if (!s.cleansing) {
        const f = crmActive();
        count *= f.factor;
        notes.push(`Counted CDC rows from RAW_BRONZE.CRM_SUBSCRIBER_CDC (${f.dups} update duplicates, ${f.deletes} deletes in the landed sample).`);
      }
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      return {
        value: Math.round(count), valueText: fmtCompact(count), caption: `active subscribers enrolled in autopay${allow ? ` in the ${allow.join(' and ')}` : ''}`,
        sql: s.semantic
          ? `SELECT COUNT(DISTINCT subscriber_id) FROM ${DB}.DATA_PRODUCTS.DP_SUBSCRIBER_360\n WHERE ${s.glossary ? 'is_active  -- BR-001' : "status = 'Active'"} AND autopay`
          : `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.DIM_SUBSCRIBER' : 'RAW_BRONZE.CRM_SUBSCRIBER_CDC'} s\n  JOIN ${DB}.CONFORMED_GOLD.FCT_BILLING b ON b.subscriber_key = s.subscriber_key\n WHERE s.autopay AND b.date_key >= 20260701  -- no DISTINCT: one row per invoice`,
        sources: [{ productId: 'DP-01', version: '2.4.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('Without the glossary the agent counted every Active-status line, including dormant lines with no September invoice (T-002):', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined to invoices and counted invoice rows instead of subscribers:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Without Silver, CRM CDC update duplicates and deleted rows were counted:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access and masking were bypassed: subscribers outside your regions were counted and names and emails shown in clear:', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Subscriber 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('CRM_SUBSCRIBER_CDC');
      // Raw agent: no autopay column in the CRM feed, so every CDC row with STATUS_CD = 'AC' is counted and scaled.
      const matched = r.filter((x) => x.STATUS_CD === 'AC');
      const sample = new Set(r.map((x) => String(x.SUB_ID).trim())).size;
      const v = Math.round(matched.length * (SUBSCRIBER_TOTAL / Math.max(1, sample)));
      const f = crm();
      const untrimmed = r.filter((x) => String(x.SUB_ID) !== String(x.SUB_ID).trim()).length;
      return {
        value: v, valueText: fmtCompact(v), caption: 'CDC rows with STATUS_CD = \'AC\', scaled — autopay not found',
        sql: "SELECT COUNT(*) FROM RAW_BRONZE.CRM_SUBSCRIBER_CDC\n WHERE STATUS_CD = 'AC'  -- no autopay column, no invoice check, no dedup",
        tablesUsed: ['RAW_BRONZE.CRM_SUBSCRIBER_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes counted in the landed sample`,
          'Wrong definition: no invoice check, so dormant lines count as active (BR-001)',
          'Autopay is not in the CRM feed: the raw agent answered a different question',
          `${untrimmed} SUB_ID values carry trailing spaces and would fail any join`,
          `Unmasked PII and CPNI read for ${persona.roleId}: FIRST_NM, LAST_NM, EMAIL_ADDR, MSISDN`,
          'No lineage, owner or certification for the table used',
        ],
        rowsRead: { columns: ['SUB_ID', 'FIRST_NM', 'EMAIL_ADDR', 'MSISDN', 'STATUS_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.SUB_ID), String(x.FIRST_NM), String(x.EMAIL_ADDR), x.MSISDN == null ? null : String(x.MSISDN), String(x.STATUS_CD), String(x.OP_TYPE)]), exposed: [1, 2, 3] },
      } satisfies RawResult;
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-2 postpaid ARPU
  const k2: KnockoutScenario = {
    id: 'KO-2', scenarioId: 'S-01', agentId: 'AG-01',
    question: 'What was postpaid ARPU last quarter by region?',
    affects: ['semantic', 'glossary', 'context', 'cleansing', 'governance'],
    links: { semantic: 'semantic/SV_SUBSCRIBER_360', glossary: 'glossary/T-009', context: 'context/rules?rule=BR-002', cleansing: 'explorer/RAW_BRONZE/BSS_INVOICE_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      let inv = d.invoices.filter((v) => q3.includes(v.month) && ok(v.region, allow) && (!s.glossary || v.segment === 'Postpaid'));
      const amount = (v: Invoice) => (s.context ? v.billed : v.billed + v.deviceRevenue);
      const notes: string[] = [];
      if (!s.glossary) notes.push('"ARPU" not resolved to T-009: prepaid and broadband invoices averaged in.');
      if (!s.context) notes.push('No rule BR-002: device installments counted as revenue.');
      if (!s.cleansing) {
        inv = withDuplicates(inv);
        notes.push(`Ran on RAW_BRONZE.BSS_INVOICE_CDC including ${bss().dups} update duplicates and ${bss().deletes} deletes in the landed sample.`);
      }
      // Semantic off: SUM(amount) / COUNT(DISTINCT subscriber) over the quarter — the monthly grain is lost.
      const metric = (xs: Invoice[]) => (s.semantic ? avg(xs.map(amount)) : sum(xs.map(amount)) / Math.max(1, new Set(xs.map((v) => v.subKey)).size));
      if (!s.semantic) notes.push('No semantic view: summed a quarter of invoices per subscriber instead of a monthly average.');
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const by = groupBy(inv, (v) => v.region);
      const rows = REGIONS.filter((r) => by.has(r)).map((r) => [r, fmtUsd(round(metric(by.get(r)!), 2))] as [string, string]);
      const v = round(metric(inv), 2);
      return {
        value: v, valueText: fmtUsd(v), caption: `${s.glossary ? 'postpaid ' : ''}ARPU per month, Q3 2026`,
        table: { columns: ['Region', 'ARPU'], rows },
        sql: s.semantic
          ? `SELECT subscriber.region, postpaid_arpu FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_SUBSCRIBER_360 ...)\n WHERE ${s.glossary ? "plan.segment = 'Postpaid' AND " : ''}invoice_month IN Q3 2026`
          : `SELECT region, SUM(${s.context ? 'service_revenue' : 'service_revenue + device_revenue'}) / COUNT(DISTINCT subscriber_key)\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_BILLING' : 'RAW_BRONZE.BSS_INVOICE_CDC'} ...  -- grain lost`,
        sources: [{ productId: 'DP-01', version: '2.4.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      semantic: { reason: describe('Without the semantic view the agent summed three months of invoices per subscriber:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"ARPU" was not resolved to postpaid service revenue, so prepaid and broadband invoices were averaged in:', g, x), severity: 'wrong' as const },
      context: { reason: describe('Without rule BR-002 device installments were counted as service revenue:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in BSS_INVOICE_CDC were averaged in:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so regions outside your grant were included:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Subscriber 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('BSS_INVOICE_CDC');
      const v = round(avg(r.map((x) => Number(x.BILLED_AMT) + Number(x.DEVICE_AMT))), 2);
      const f = bss();
      return {
        value: v, valueText: fmtUsd(v), caption: 'AVG(BILLED_AMT + DEVICE_AMT) over every landed invoice row',
        sql: "SELECT AVG(BILLED_AMT + DEVICE_AMT) FROM RAW_BRONZE.BSS_INVOICE_CDC\n WHERE BILL_DT >= '2026-07-01'  -- no segment, no region, no dedup",
        tablesUsed: ['RAW_BRONZE.BSS_INVOICE_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes averaged in`,
          'Wrong definition: device installments counted as ARPU (BR-002)',
          'No plan segment in the feed: prepaid and broadband invoices included',
          'No region: MKT_CD is not mapped to a region',
          'Only the latest landed batch (September) is in Bronze, not the quarter',
          'No owner, contract or certification',
        ],
        rowsRead: { columns: ['INVOICE_NO', 'ACCT_NO', 'BILLED_AMT', 'DEVICE_AMT', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.INVOICE_NO), String(x.ACCT_NO), Number(x.BILLED_AMT), Number(x.DEVICE_AMT), String(x.OP_TYPE)]), exposed: [] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-3 postpaid churn (signature)
  const k3: KnockoutScenario = {
    id: 'KO-3', scenarioId: 'S-06', agentId: 'AG-02',
    question: 'What was postpaid churn last month by plan and region?',
    affects: ['context', 'glossary', 'semantic', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-004', glossary: 'glossary/T-004', semantic: 'semantic/SV_CHURN_RETENTION', cleansing: 'explorer/RAW_BRONZE/CRM_SUBSCRIBER_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const rows = d.base.filter((r) => r.month === Q.PERIODS.month && r.segment === 'Postpaid' && ok(r.region, allow));
      const churned = (r: (typeof rows)[number]) => r.voluntary + r.portOuts + (s.glossary ? 0 : r.involuntary) + (s.context ? 0 : r.migOut);
      const notes: string[] = [];
      if (s.context) notes.push('BR-004: voluntary disconnects and port-outs; plan migrations excluded. Cited the subscriber KPI standard.');
      else notes.push(`No rule BR-004: ${sum(rows.map((r) => r.migOut)).toLocaleString('en-US')} plan migrations counted as churn; no citation.`);
      if (!s.glossary) notes.push(`"Churn" not resolved to T-004: ${sum(rows.map((r) => r.involuntary)).toLocaleString('en-US')} involuntary (non-pay) disconnects counted.`);
      // Semantic off: unweighted mean of market × plan rates instead of Σ churned ÷ Σ opening base.
      const rate = (xs: typeof rows) => (s.semantic ? (sum(xs.map(churned)) / Math.max(1, sum(xs.map((r) => r.opening)))) * 100 : avg(xs.map((r) => (churned(r) / Math.max(1, r.opening)) * 100)));
      if (!s.semantic) notes.push('No semantic view: averaged market-by-plan rates instead of weighting by opening base.');
      const k = s.cleansing ? 1 : crm().factor;
      if (!s.cleansing) notes.push(`Disconnects read from RAW_BRONZE.CRM_SUBSCRIBER_CDC: ${crm().dups} update duplicates and ${crm().deletes} deletes in the landed sample.`);
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const regions = REGIONS.filter((r) => ok(r, allow));
      const plans = PLANS.filter((p) => p.segment === 'Postpaid');
      const v = round(rate(rows) * k, 2);
      return {
        value: v, valueText: `${fmtNum(v, 2)}%`, caption: 'postpaid churn, September 2026',
        table: { columns: ['Plan', ...regions], rows: plans.map((p) => [p.name, ...regions.map((rg) => `${fmtNum(rate(rows.filter((r) => r.planCode === p.code && r.region === rg)) * k, 2)}%`)]) },
        sql: s.semantic && s.glossary
          ? `SELECT plan.plan_name, market.region, postpaid_churn_rate FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_CHURN_RETENTION ...)\n WHERE date.month = '2026-09'${s.context ? '  -- BR-004: migrations excluded' : ''}`
          : `SELECT plan_name, region, AVG((voluntary_disconnects + port_outs${s.glossary ? '' : ' + involuntary_disconnects'}${s.context ? '' : ' + migrations_out'}) / opening_base) * 100\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_SUBSCRIBER_MONTHLY' : 'RAW_BRONZE.CRM_SUBSCRIBER_CDC'} ...`,
        sources: [{ productId: 'DP-04', version: '2.0.1', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-004 plan migrations were counted as churn and the KPI standard was not cited:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"Churn" was not resolved to T-004, so involuntary non-pay disconnects were counted:', g, x), severity: 'ambiguous' as const },
      semantic: { reason: describe('Without the semantic view the agent averaged market-by-plan rates, so small markets weighed as much as large ones:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in CRM_SUBSCRIBER_CDC inflated disconnects:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so all four regions were reported:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Churn & Retention is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('CRM_SUBSCRIBER_CDC');
      const v = round((r.filter((x) => x.STATUS_CD === 'DX').length / Math.max(1, r.length)) * 100, 2);
      const f = crm();
      return {
        value: v, valueText: `${fmtNum(v, 2)}%`, caption: "rows with STATUS_CD = 'DX' ÷ all landed CRM rows",
        sql: "SELECT COUNT_IF(STATUS_CD = 'DX') / COUNT(*) * 100 FROM RAW_BRONZE.CRM_SUBSCRIBER_CDC\n -- no month, no opening base, no reason code, no plan migrations",
        tablesUsed: ['RAW_BRONZE.CRM_SUBSCRIBER_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes included`,
          'Wrong definition: lifetime disconnected share, not monthly churn over opening base',
          'No disconnect reason: involuntary disconnects and port-outs cannot be told apart',
          `PLAN_CD arrives in mixed case (${r.filter((x) => String(x.PLAN_CD) !== String(x.PLAN_CD).toUpperCase()).length} lowercase rows), so a plan breakdown would split`,
          'No owner, lineage or certification',
        ],
        rowsRead: { columns: ['SUB_ID', 'MKT_CD', 'PLAN_CD', 'STATUS_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.SUB_ID), String(x.MKT_CD), String(x.PLAN_CD), String(x.STATUS_CD), String(x.OP_TYPE)]), exposed: [] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-4 margin (product in certification)
  const k4: KnockoutScenario = {
    id: 'KO-4', scenarioId: 'S-04', agentId: 'AG-01',
    question: 'What is gross margin per subscriber by plan this quarter?',
    affects: ['certification', 'context', 'semantic', 'cleansing', 'governance'],
    links: { certification: 'certify/DP-05', context: 'context/rules?rule=BR-013', semantic: 'semantic/SV_DEVICE_PLAN_PROFITABILITY', cleansing: 'explorer/RAW_BRONZE/BSS_INVOICE_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      let inv = d.invoices.filter((v) => q3.includes(v.month) && ok(v.region, allow));
      const margin = (v: Invoice) => (s.context ? v.billed - v.costOfService - v.deviceSubsidy : v.billed + v.deviceRevenue - v.costOfService);
      const notes: string[] = [];
      if (s.context) notes.push('BR-013: cost of service and amortised device subsidy deducted; installments are not margin.');
      else notes.push('No rule BR-013: device installments counted as margin and device subsidy not deducted.');
      if (!s.cleansing) {
        inv = withDuplicates(inv);
        notes.push(`Ran on RAW_BRONZE.BSS_INVOICE_CDC including ${bss().dups} update duplicates in the landed sample.`);
      }
      const perSub = (xs: Invoice[]) => sum(xs.map(margin)) / Math.max(1, s.semantic ? xs.length : new Set(xs.map((v) => v.subKey)).size);
      if (!s.semantic) notes.push('No semantic view: divided a quarter of margin by distinct subscribers instead of invoices.');
      if (allow) notes.push(`Row access: ${allow.join(', ')} only.`);
      const rows = PLANS.map((p) => [p.name, fmtUsd(round(perSub(inv.filter((v) => v.planCode === p.code)), 2))] as [string, string]);
      const v = round(perSub(inv), 2);
      return {
        value: v, valueText: fmtUsd(v), caption: 'gross margin per subscriber per month, Q3 2026',
        table: { columns: ['Plan', 'Margin per subscriber'], rows },
        sql: `SELECT plan_name, ${s.semantic ? 'margin_per_subscriber' : 'SUM(margin) / COUNT(DISTINCT subscriber_id)'}\n  FROM ${DB}.${s.cleansing ? 'DATA_PRODUCTS.DP_DEVICE_PLAN_PROFITABILITY' : 'RAW_BRONZE.BSS_INVOICE_CDC'}\n WHERE invoice_month BETWEEN '2026-07' AND '2026-09'${s.context ? '  -- BR-013' : ''}`,
        sources: [{ productId: 'DP-05', version: '1.0.0-rc', certified: false }],
        notes: s.certification ? [...notes, 'Not certified: Device & Plan Profitability is In certification (quality score 94.0, gate 6 masking open).'] : notes,
        hiddenWarning: s.certification ? undefined : 'In-certification product used without a warning; quality score 94.0 and the open masking gate hidden.',
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used Device & Plan Profitability, which is still In certification, with no "Not certified" banner and its open gate 6 (MSISDN unmasked) hidden.', severity: 'unverified' as const },
      context: { reason: describe('Without rule BR-013 device installments were counted as margin and subsidy was not deducted:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent divided three months of margin by distinct subscribers:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in BSS_INVOICE_CDC were summed:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so regions outside your grant were included:', g, x), severity: 'unsafe' as const },
      glossary: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
    })[layer],
  };

  // Governance also exposes PII on the list-style question; keep the analyst story visible in KO-1's table.
  const withExposure = (ks: KnockoutScenario): KnockoutScenario => ({
    ...ks,
    compute: (s, ctx) => {
      const r = ks.compute(s, ctx);
      if (ks.id !== 'KO-1') return r;
      const clear = !ctx.persona.unmasked.includes('PII');
      const allow = s.governance ? allowOf(ctx.persona) : undefined;
      const sample = Q.activeSubscribers(d, allow).filter((x) => x.autopay).slice(0, 3);
      const table: KnockoutResult['table'] = {
        columns: ['Subscriber', 'Email', 'Region'],
        rows: sample.map((x) => [String(s.governance ? maskFor(ctx.persona, 'PII', `${x.first} ${x.last}`) : `${x.first} ${x.last}`), String(s.governance ? maskFor(ctx.persona, 'PII', x.email) : x.email), x.region]),
        masked: s.governance && clear ? [0, 1] : [],
        exposed: !s.governance && clear ? [0, 1] : [],
      };
      return { ...r, table, exposed: !s.governance && clear ? ['SUBSCRIBER_NAME', 'EMAIL'] : undefined };
    },
  });

  return [k1, k2, k3, k4].map(withExposure);
}
