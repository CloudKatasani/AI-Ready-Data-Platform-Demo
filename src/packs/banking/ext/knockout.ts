// Banking knockout questions (E1) and raw-data variants (E2). Every degraded and raw number is computed from the
// same synthetic data with the faulty logic applied: real CDC duplicates in the landed Bronze sample, a real join
// fan-out, a lost month-end grain, an unresolved term, a missing business rule. Nothing is typed in.
import type { Persona, Row, SfObject } from '../../../types';
import type { KnockoutResult, KnockoutScenario, LayerSwitches, RawResult } from '../../../ext/types';
import { describe } from '../../../ext/knockout';
import { avg, groupBy, round, sum } from '../../../mock-snowflake/generators';
import { maskFor } from '../../../mock-snowflake/policies';
import { fmtCompact, fmtNum, fmtPct, fmtUsd } from '../../../lib/format';
import type { BankData } from '../data';
import { LOAN_SEGMENTS, PRODUCTION, REGIONS } from '../generators.config';
import * as Q from '../queries';

const DB = 'RLB_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const inAllow = (allow: string[] | undefined, region: string) => !allow || allow.includes(region);
const rowNote = (allow: string[] | undefined) => `Row access: ${allow!.join(' and ')} markets only.`;
const QUARTER_OF: Record<string, string[]> = { '2026-09': ['2026-07', '2026-08', '2026-09'], '2026-06': ['2026-04', '2026-05', '2026-06'] };

export function buildKnockout(d: BankData, objects: SfObject[]): KnockoutScenario[] {
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
  const cif = () => cdcFactor('CORE_CUSTOMER_CDC', 'CIF_NO', (r) => r.CUST_STAT_CD === 'A');
  const depRows = () => cdcFactor('CORE_ACCOUNT_CDC', 'ACCT_NO', (r) => r.ACCT_CLASS === 'DEP');
  const lnRows = () => cdcFactor('CORE_ACCOUNT_CDC', 'ACCT_NO', (r) => r.ACCT_CLASS === 'LN');

  // ---------------------------------------------------------------------------------------------- KO-1 active customers
  const k1: KnockoutScenario = {
    id: 'KO-1', scenarioId: 'S-02', agentId: 'AG-01',
    question: 'How many active customers do we have, and how many are digitally active?',
    affects: ['glossary', 'cleansing', 'semantic', 'governance'],
    links: { glossary: 'glossary/T-002', cleansing: 'explorer/RAW_BRONZE/CORE_CUSTOMER_CDC', semantic: 'semantic/SV_CUSTOMER_360', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s: LayerSwitches, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const inScope = d.customers.filter((c) => inAllow(allow, c.region));
      const active = inScope.filter((c) => (s.glossary ? Q.isActive(d, c) : c.status === 'Active'));
      let count = active.length * d.scale;
      const notes: string[] = [];
      if (s.glossary) notes.push('Active Customer (T-002): Active status, an open account at month-end and activity in the last 90 days.');
      else notes.push('"Active" read as CUSTOMER_STATUS = \'Active\' only: no open-account or 90-day activity test.');
      if (!s.semantic) {
        // Naive join to month-end deposit and loan rows without DISTINCT: one row per account held.
        count = sum(active.map((c) => { const h = Q.holdingsOf(d, c.key); return h.depositAccounts + h.loanCount; })) * d.scale;
        notes.push('Joined customers to month-end account rows and counted rows, not distinct customers.');
      }
      if (!s.cleansing) {
        const f = cif();
        count *= f.factor;
        notes.push(`Counted CDC rows from RAW_BRONZE.CORE_CUSTOMER_CDC (${f.dups} update duplicates, ${f.deletes} deletes in the landed sample).`);
      }
      if (allow) notes.push(rowNote(allow));
      const v = Math.round(count);
      // The governed text matches Agent Studio (one decimal); degraded counts show two so small over-counts stay visible.
      const governed = s.glossary && s.semantic && s.cleansing;
      return {
        value: v, valueText: governed || v < 1e6 ? fmtCompact(v) : `${fmtNum(v / 1e6, 2)} M`, caption: `active customers${allow ? ` in the ${allow.join(' and ')} markets` : ''}`,
        sql: s.semantic
          ? `SELECT COUNT_IF(${s.glossary ? 'is_active)  -- BR-001' : "customer_status = 'Active')"}\n  FROM ${DB}.${s.cleansing ? 'DATA_PRODUCTS.DP_CUSTOMER_360' : 'RAW_BRONZE.CORE_CUSTOMER_CDC'}`
          : `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.DIM_CUSTOMER' : 'RAW_BRONZE.CORE_CUSTOMER_CDC'} c\n  JOIN ${DB}.CONFORMED_GOLD.FCT_DEPOSIT_BALANCE b ON b.customer_key = c.customer_key\n WHERE b.date_key = 20260930  -- no DISTINCT: one row per account`,
        sources: [{ productId: 'DP-01', version: '3.1.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('Without the glossary the agent counted every Active-status CIF, ignoring the open-account and 90-day activity tests in T-002:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Without Silver, CDC update duplicates and deleted CIF rows were counted:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined to month-end accounts and counted account rows instead of customers:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so customers outside your markets were counted and their names shown:', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Customer 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('CORE_CUSTOMER_CDC');
      // Raw agent: counts every CDC row with CUST_STAT_CD = 'A' and scales by untrimmed CIF_NO values.
      const matched = r.filter((x) => x.CUST_STAT_CD === 'A');
      const sampleCifs = new Set(r.map((x) => String(x.CIF_NO))).size;
      const v = Math.round(matched.length * (PRODUCTION.customers / Math.max(1, sampleCifs)));
      const f = cif();
      return {
        value: v, valueText: fmtCompact(v), caption: 'CDC rows guessed as "active customers"',
        sql: "SELECT COUNT(*) FROM RAW_BRONZE.CORE_CUSTOMER_CDC\n WHERE CUST_STAT_CD = 'A'  -- no dedup, no activity rule, no market",
        tablesUsed: ['RAW_BRONZE.CORE_CUSTOMER_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deleted customers counted in the landed sample`,
          'Wrong definition: status code only, no open account or 90-day activity test (BR-001)',
          'Untrimmed CIF_NO and lowercase REGION_CD values split one customer into two',
          `Unmasked PII and NPI read for ${persona.roleId}: FIRST_NM, LAST_NM, EMAIL_ADDR, TAX_ID`,
          'No lineage, owner or certification for the table used',
        ],
        rowsRead: { columns: ['CIF_NO', 'FIRST_NM', 'LAST_NM', 'EMAIL_ADDR', 'TAX_ID', 'CUST_STAT_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.CIF_NO), String(x.FIRST_NM), String(x.LAST_NM), String(x.EMAIL_ADDR), String(x.TAX_ID), String(x.CUST_STAT_CD), String(x.OP_TYPE)]), exposed: [1, 2, 3, 4] },
      } satisfies RawResult;
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-2 avg deposits per customer
  const k2: KnockoutScenario = {
    id: 'KO-2', scenarioId: 'S-01', agentId: 'AG-01',
    question: 'What was the average deposit balance per customer by region at the end of last quarter?',
    affects: ['context', 'glossary', 'semantic', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-003', glossary: 'glossary/T-007', semantic: 'semantic/SV_CUSTOMER_360', cleansing: 'explorer/RAW_BRONZE/CORE_ACCOUNT_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      // BR-003: "end of last quarter" is the 30 September month-end. Without it the agent takes the last completed quarter.
      const month = s.context ? Q.PERIODS.month : '2026-06';
      const months = s.semantic ? [month] : QUARTER_OF[month];
      const pop = d.customers.filter((c) => inAllow(allow, c.region) && (!s.context || Q.isActive(d, c)));
      const keys = new Set(pop.map((c) => c.key));
      const bal = new Map<number, number>();
      for (const m of months) for (const x of Q.depByMonth(d).get(m) ?? []) if (keys.has(x.customerKey)) bal.set(x.customerKey, (bal.get(x.customerKey) ?? 0) + x.balance);
      if (!s.glossary) for (const m of months) for (const x of Q.loanByMonth(d).get(m) ?? []) if (keys.has(x.customerKey)) bal.set(x.customerKey, (bal.get(x.customerKey) ?? 0) + x.balance);
      const factor = s.cleansing ? 1 : depRows().factor;
      if (s.context) notes.push('BR-003: 30 September 2026 month-end ledger balances. BR-001: active customers only.');
      else notes.push('No rules: "end of last quarter" read as 30 June 2026, and every customer on file averaged in, including closed and dormant.');
      if (!s.glossary) notes.push('"Deposit balance" not resolved to T-007: CUR_BAL summed across deposit and loan accounts.');
      if (!s.semantic) notes.push('No semantic view: summed the three month-ends of the quarter per customer instead of one month-end snapshot.');
      if (!s.cleansing) notes.push(`Summed RAW_BRONZE.CORE_ACCOUNT_CDC rows including ${depRows().dups} update duplicates and ${depRows().deletes} deletes in the landed sample.`);
      if (allow) notes.push(rowNote(allow));
      const per = (cs: typeof pop) => (sum(cs.map((c) => bal.get(c.key) ?? 0)) * factor) / Math.max(1, cs.length);
      const byRegion = groupBy(pop, (c) => c.region);
      const rows = REGIONS.filter((r) => byRegion.has(r.name)).map((r) => [r.name, fmtUsd(per(byRegion.get(r.name)!), 0)] as [string, string]);
      const v = round(per(pop), 2);
      return {
        value: v, valueText: fmtUsd(v, 0), caption: `average deposits per ${s.context ? 'active ' : ''}customer, ${month === '2026-09' ? '30 Sep' : '30 Jun'} 2026`,
        table: { columns: ['Region', 'Avg deposits per customer'], rows },
        sql: s.semantic
          ? `SELECT customer.region, avg_deposit_balance FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_CUSTOMER_360 ...)\n WHERE ${s.context ? "month_end = '2026-09-30' AND is_active  -- BR-003, BR-001" : "month_end = '2026-06-30'"}`
          : `SELECT region, SUM(${s.cleansing ? 'ledger_balance' : 'CUR_BAL'}) / COUNT(DISTINCT customer_key)\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_DEPOSIT_BALANCE' : 'RAW_BRONZE.CORE_ACCOUNT_CDC'}\n WHERE month_end BETWEEN ...  -- every month-end in the quarter: grain lost`,
        sources: [{ productId: 'DP-01', version: '3.1.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rules BR-003 and BR-001 the agent used the 30 June month-end and averaged closed and dormant customers in:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"Deposit balance" was not resolved, so loan principal was added to deposits:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent summed three month-end balances per customer:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in CORE_ACCOUNT_CDC inflated balances:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so markets outside yours were included:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Customer 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('CORE_ACCOUNT_CDC').filter((x) => x.ACCT_CLASS === 'DEP');
      const v = round(avg(r.map((x) => Number(x.CUR_BAL))), 2);
      const f = depRows();
      return {
        value: v, valueText: fmtUsd(v, 0), caption: 'AVG(CUR_BAL) over every landed deposit row',
        sql: "SELECT AVG(CUR_BAL) FROM RAW_BRONZE.CORE_ACCOUNT_CDC\n WHERE ACCT_CLASS = 'DEP'  -- per account, not per customer; no dedup, no market",
        tablesUsed: ['RAW_BRONZE.CORE_ACCOUNT_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes averaged in`,
          'Wrong grain: average per account row, not per customer',
          'No active-customer rule and no month-end date (BR-001, BR-003)',
          'No region: the raw table has no market column',
          'Unmasked account numbers (NPI) read; no owner, contract or certification',
        ],
        rowsRead: { columns: ['ACCT_NO', 'CIF_NO', 'PROD_CD', 'CUR_BAL', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.ACCT_NO), String(x.CIF_NO), String(x.PROD_CD), Number(x.CUR_BAL), String(x.OP_TYPE)]), exposed: [0] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-3 NPL ratio (signature)
  const k3: KnockoutScenario = {
    id: 'KO-3', scenarioId: 'S-06', agentId: 'AG-02',
    question: 'What is our NPL ratio by loan segment, and how has it trended this year?',
    affects: ['context', 'glossary', 'semantic', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-007', glossary: 'glossary/T-012', semantic: 'semantic/SV_LOAN_PORTFOLIO', cleansing: 'explorer/RAW_BRONZE/CORE_ACCOUNT_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      const xs = (Q.loanByMonth(d).get(Q.PERIODS.month) ?? []).filter((x) => inAllow(allow, x.region));
      const bad = (x: (typeof xs)[number]) => (!s.glossary ? x.dpd >= 30 : s.context ? x.npl : x.dpd >= 90);
      const ratio = (ys: typeof xs) => (sum(ys.filter(bad).map((y) => y.balance)) / Math.max(1, sum(ys.map((y) => y.balance)))) * 100;
      const bySeg = groupBy(xs, (x) => x.segment);
      const segRatios = LOAN_SEGMENTS.filter((sg) => bySeg.has(sg.name)).map((sg) => ({ segment: sg.name, ratio: ratio(bySeg.get(sg.name)!) }));
      let v = s.semantic ? ratio(xs) : avg(segRatios.map((r) => r.ratio));
      if (!s.glossary) notes.push('"Non-performing" not resolved to T-012: counted every loan 30+ days past due as an NPL.');
      else if (s.context) notes.push('BR-007: non-performing = 90+ days past due or on non-accrual. Cited the Basel III definitions guide.');
      else notes.push('No rule BR-007: non-accrual loans under 90 days past due left out of NPLs; no citation.');
      if (!s.semantic) notes.push('No semantic view: averaged the five segment ratios instead of weighting by principal.');
      if (!s.cleansing) {
        // Ratio on the landed Bronze loan rows (I + U + D) against the same rows deduplicated by ACCT_NO.
        const raw = rowsOf('CORE_ACCOUNT_CDC').filter((r) => r.ACCT_CLASS === 'LN');
        const latest = new Map<string, Row>();
        for (const r of raw) latest.set(String(r.ACCT_NO), r);
        const clean = [...latest.values()].filter((r) => r.OP_TYPE !== 'D');
        const isBad = (r: Row) => (!s.glossary ? Number(r.DPD_CNT) >= 30 : Number(r.DPD_CNT) >= 90 || (s.context && r.NONACCR_FLG === 'Y'));
        const rr = (rs: Row[]) => sum(rs.filter(isBad).map((r) => Number(r.CUR_BAL))) / Math.max(1, sum(rs.map((r) => Number(r.CUR_BAL))));
        const k = rr(clean) ? rr(raw) / rr(clean) : 1;
        v *= k;
        notes.push(`Ran on RAW_BRONZE.CORE_ACCOUNT_CDC: ${lnRows().dups} update duplicates and ${lnRows().deletes} paid-off loans still counted in the landed sample.`);
      }
      if (allow) notes.push(rowNote(allow));
      v = round(v, 2);
      return {
        value: v, valueText: fmtPct(v, 2), caption: 'NPL ratio, 30 September 2026 month-end',
        table: { columns: ['Loan segment', 'Ratio'], rows: segRatios.map((r) => [r.segment, fmtPct(r.ratio, 2)]) },
        sql: s.semantic && s.glossary
          ? `SELECT loan.loan_segment, npl_ratio FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_LOAN_PORTFOLIO ...)\n WHERE snapshot_date = '2026-09-30'${s.context ? '  -- BR-007: DPD >= 90 OR non_accrual' : '  -- DPD >= 90 only'}`
          : `SELECT AVG(seg_ratio) FROM (\n  SELECT loan_segment, SUM(IFF(days_past_due >= ${s.glossary ? 90 : 30}, principal_balance, 0)) / SUM(principal_balance) * 100 AS seg_ratio\n    FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_LOAN_BALANCE' : 'RAW_BRONZE.CORE_ACCOUNT_CDC'} GROUP BY 1)`,
        sources: [{ productId: 'DP-03', version: '1.6.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-007 non-accrual loans under 90 days past due were not counted and the Basel III guide was not cited:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"Non-performing" was not resolved, so the agent reported the 30+ days past due rate:', g, x), severity: 'ambiguous' as const },
      semantic: { reason: describe('Without the semantic view the agent averaged segment ratios, so small segments weighed as much as residential mortgages:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC duplicates and deleted (paid-off) loans in CORE_ACCOUNT_CDC distorted the ratio:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so loans in all four markets were reported:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Loan Portfolio Risk is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('CORE_ACCOUNT_CDC').filter((x) => x.ACCT_CLASS === 'LN');
      const v = round((sum(r.filter((x) => Number(x.DPD_CNT) >= 90).map((x) => Number(x.CUR_BAL))) / Math.max(1, sum(r.map((x) => Number(x.CUR_BAL))))) * 100, 2);
      const f = lnRows();
      return {
        value: v, valueText: fmtPct(v, 2), caption: 'balance with DPD_CNT ≥ 90 over all landed loan rows',
        sql: "SELECT SUM(IFF(DPD_CNT >= 90, CUR_BAL, 0)) / SUM(CUR_BAL) * 100\n  FROM RAW_BRONZE.CORE_ACCOUNT_CDC WHERE ACCT_CLASS = 'LN'  -- NONACCR_FLG ignored",
        tablesUsed: ['RAW_BRONZE.CORE_ACCOUNT_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes included`,
          'Wrong definition: non-accrual flag ignored, so it is not the NPL ratio in BR-007',
          'No segment: PROD_CD codes are not mapped to loan segments',
          'Unmasked loan numbers (NPI) read',
          'No owner, lineage or certification',
        ],
        rowsRead: { columns: ['ACCT_NO', 'CIF_NO', 'PROD_CD', 'CUR_BAL', 'DPD_CNT', 'NONACCR_FLG', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.ACCT_NO), String(x.CIF_NO), String(x.PROD_CD), Number(x.CUR_BAL), Number(x.DPD_CNT), String(x.NONACCR_FLG), String(x.OP_TYPE)]), exposed: [0] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-4 profitability (draft product)
  const k4: KnockoutScenario = {
    id: 'KO-4', scenarioId: 'S-08', agentId: 'AG-02',
    question: 'Which customer segments are most profitable after expected credit losses?',
    affects: ['certification', 'glossary', 'semantic', 'governance'],
    links: { certification: 'certify/DP-06', glossary: 'glossary/T-025', semantic: 'semantic/SV_LOAN_PORTFOLIO', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const rows = Q.profitability(d).filter((r) => inAllow(allow, r.c.region));
      const netOf = (r: (typeof rows)[number]) => (s.glossary ? r.net : r.net + r.ecl);
      const bySeg = groupBy(rows, (r) => r.c.segment);
      const segs = [...bySeg.entries()].map(([seg, rs]) => ({ seg, net: avg(rs.map(netOf)) })).sort((a, b) => b.net - a.net);
      const v = round(s.semantic ? avg(rows.map(netOf)) : avg(segs.map((x) => x.net)), 0);
      const notes: string[] = [];
      if (!s.glossary) notes.push('"Profitable" not resolved to T-025: expected credit loss not deducted.');
      if (!s.semantic) notes.push('No semantic view: averaged the four segment averages, so Commercial weighed as much as Mass retail.');
      if (allow) notes.push(rowNote(allow));
      return {
        value: v, valueText: fmtUsd(v, 0), caption: `average 12-month net contribution per open customer (${segs[0].seg} highest)`,
        table: { columns: ['Segment', 'Avg net contribution (12m)'], rows: segs.map((x) => [x.seg, fmtUsd(x.net, 0)]) },
        sql: `SELECT segment, AVG(${s.glossary ? 'net_contribution_12m' : 'net_contribution_12m + expected_credit_loss'})\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_PROFITABILITY  -- DRAFT\n GROUP BY segment`,
        sources: [{ productId: 'DP-06', version: '0.4.0', certified: false }],
        notes: s.certification ? [...notes, 'Not certified: Customer Profitability is a Draft product (quality score 89.4, no steward).'] : notes,
        hiddenWarning: s.certification ? undefined : 'Draft product used without a warning; quality score 89.4 and missing steward hidden.',
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used the Draft Customer Profitability product with no "Not certified" banner, its 89.4 quality score and missing steward hidden.', severity: 'unverified' as const },
      glossary: { reason: describe('"Profitable" was not resolved to net contribution after expected credit loss (T-025):', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without a defined metric the agent averaged segment averages instead of customers:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so customers in all four markets were included:', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      cleansing: { reason: 'No visible effect: the draft product reads Gold facts only.', severity: 'unverified' as const },
    })[layer],
  };

  // Governance also exposes PII: KO-1 shows a sample of the customers it counted, masked unless the role may see PII.
  const withExposure = (ks: KnockoutScenario): KnockoutScenario => ({
    ...ks,
    compute: (s, ctx) => {
      const r = ks.compute(s, ctx);
      if (ks.id !== 'KO-1') return r;
      const canSee = ctx.persona.unmasked.includes('PII');
      const allow = s.governance ? allowOf(ctx.persona) : undefined;
      const sample = d.customers.filter((c) => inAllow(allow, c.region) && Q.isActive(d, c)).slice(0, 3);
      const table: KnockoutResult['table'] = {
        columns: ['Customer', 'Email', 'Region'],
        rows: sample.map((c) => [String(s.governance ? maskFor(ctx.persona, 'PII', c.name) : c.name), String(s.governance ? maskFor(ctx.persona, 'PII', c.email) : c.email), c.region]),
        masked: s.governance && !canSee ? [0, 1] : [],
        exposed: !s.governance && !canSee ? [0, 1] : [],
      };
      return { ...r, table, exposed: !s.governance && !canSee ? ['CUSTOMER_NAME', 'EMAIL'] : undefined };
    },
  });

  return [k1, k2, k3, k4].map(withExposure);
}
