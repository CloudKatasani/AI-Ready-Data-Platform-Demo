// Retail knockout questions (E1) and raw-data variants (E2). Every degraded and raw number is computed from the same
// synthetic data with the faulty logic applied: real CDC duplicates from the Bronze samples, a real SCD2 fan-out, a
// calendar-date join instead of the same-weekday join, a missing business rule. Nothing is typed in.
import type { Persona, Row, SfObject } from '../../../types';
import type { KnockoutScenario, LayerSwitches, RawResult } from '../../../ext/types';
import { describe } from '../../../ext/knockout';
import { addDays, dateRange, round, sum, toDate } from '../../../mock-snowflake/generators';
import { maskFor } from '../../../mock-snowflake/policies';
import { fmtCompact, fmtNum, fmtPct, fmtUsd } from '../../../lib/format';
import { isCompInMonth, type Member, type RetailData, type ReturnTxn } from '../data';
import { AS_OF, PRODUCTION } from '../generators.config';
import * as Q from '../queries';

const DB = 'HPR_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const ok = (region: string, allow?: string[]) => !allow || allow.includes(region);
const rowNote = (allow?: string[]) => (allow ? [`Row access: ${allow.join(', ')} only.`] : []);

/** BR-017 applied to a list of returns (duplicates included when cleansing is off). */
export function flagReturns(rs: ReturnTxn[], rule: boolean): boolean[] {
  if (!rule) return rs.map((r) => !r.hasReceipt);
  const byMember = new Map<number, ReturnTxn[]>();
  for (const r of rs) if (r.memberKey) byMember.set(r.memberKey, [...(byMember.get(r.memberKey) ?? []), r]);
  return rs.map((r) => {
    if (!r.hasReceipt && r.amount > 250) return true;
    const mine = r.memberKey ? byMember.get(r.memberKey)! : [];
    return mine.filter((x) => Math.abs(toDate(x.date).getTime() - toDate(r.date).getTime()) <= 30 * 86_400_000).length > 5;
  });
}

export function buildKnockout(d: RetailData, objects: SfObject[]): KnockoutScenario[] {
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
  const loyalty = () => cdcFactor('LOYALTY_MEMBER_CDC', 'MBR_ID', (r) => r.STAT_CD === 'A');
  const pos = () => cdcFactor('POS_TRANSACTION_CDC', 'TXN_ID');
  const ecom = () => cdcFactor('ECOM_ORDER_CDC', 'ORDER_NO');
  const posReturns = () => cdcFactor('POS_TRANSACTION_CDC', 'TXN_ID', (r) => r.TXN_TYPE === 'RETURN');

  // ---------------------------------------------------------------------------------------------- KO-1 omnichannel members
  const k1: KnockoutScenario = {
    id: 'KO-1', scenarioId: 'S-02', agentId: 'AG-01',
    question: 'How many active loyalty members are omnichannel shoppers?',
    affects: ['glossary', 'semantic', 'cleansing', 'governance'],
    links: { glossary: 'glossary/T-027', semantic: 'semantic/SV_CUSTOMER_LOYALTY', cleansing: 'explorer/RAW_BRONZE/LOYALTY_MEMBER_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s: LayerSwitches, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const since = addDays(AS_OF, -365);
      const notes: string[] = [];
      // Glossary on: Active Member (T-002) and Omnichannel Member (T-027). Off: status Active, any online purchase.
      const picked: Member[] = d.members.filter((m) => ok(m.region, allow) && m.status === 'Active' && (s.glossary ? m.lastPurchase > since && m.storeBuyer && m.onlineBuyer : m.onlineBuyer));
      if (s.glossary) notes.push('Active Member (T-002): Active status and a purchase in the last 12 months. Omnichannel (T-027): bought in store and online.');
      else notes.push('"Omnichannel" not resolved: counted every Active-status member with an online purchase.');
      let n = picked.length;
      if (!s.semantic) {
        // Join to CURATED_SILVER.LOYALTY_MEMBER without IS_CURRENT: one row per SCD2 version.
        n = sum(picked.map((m) => (m.priorTier ? 2 : 1)));
        notes.push(`No semantic view: joined every SCD2 member version, so ${picked.filter((m) => m.priorTier).length} members with a tier change in the sample were counted twice.`);
      }
      let count = n * d.memberScale;
      if (!s.cleansing) {
        const f = loyalty();
        count *= f.factor;
        notes.push(`Counted CDC rows from RAW_BRONZE.LOYALTY_MEMBER_CDC (${f.dups} update duplicates, ${f.deletes} deletes in the landed sample).`);
      }
      notes.push(...rowNote(allow));
      const v = Math.round(count);
      const masked = s.governance && !persona.unmasked.includes('PII');
      const exposed = !s.governance && !persona.unmasked.includes('PII');
      const pii = (x: string) => (s.governance ? String(maskFor(persona, 'PII', x)) : x);
      return {
        value: v, valueText: fmtCompact(v), caption: `active members buying in store and online${allow ? ` in ${allow.join(' and ')}` : ''}`,
        table: { columns: ['Member ID', 'Member', 'Email', 'Region'], rows: picked.slice(0, 3).map((m) => [pii(m.id), pii(`${m.first} ${m.last}`), pii(m.email), m.region]), masked: masked ? [0, 1, 2] : [], exposed: exposed ? [0, 1, 2] : [] },
        sql: s.semantic
          ? `SELECT COUNT(*) FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_LOYALTY_360\n WHERE ${s.glossary ? 'is_active AND is_omnichannel  -- BR-001, T-027' : "member_status = 'Active' AND online_buyer"}`
          : `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.DIM_CUSTOMER' : 'RAW_BRONZE.LOYALTY_MEMBER_CDC'} c\n  JOIN ${DB}.CURATED_SILVER.LOYALTY_MEMBER v ON v.member_id = c.member_id  -- no IS_CURRENT filter\n WHERE ${s.glossary ? 'c.is_omnichannel' : 'c.online_buyer'}`,
        sources: [{ productId: 'DP-01', version: '2.2.0', certified: true }], notes,
        exposed: exposed ? ['MEMBER_ID', 'MEMBER_NAME', 'EMAIL'] : undefined,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('Without the glossary "omnichannel" was read as any online buyer, so online-only members were counted:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined every SCD2 member version, counting members with a tier change twice:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Without Silver, CDC update duplicates and deleted members were counted:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed and member IDs, names and emails were shown in clear:', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Customer & Loyalty 360 is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const lm = rowsOf('LOYALTY_MEMBER_CDC');
      const online = new Set(rowsOf('ECOM_ORDER_CDC').map((r) => String(r.MBR_ID)));
      // Raw agent: exact match on MBR_ID (untrimmed values miss), every CDC row with STAT_CD = 'A' that has a web order.
      const matched = lm.filter((r) => r.STAT_CD === 'A' && online.has(String(r.MBR_ID)));
      const sampleMembers = new Set(lm.map((r) => String(r.MBR_ID).trim())).size;
      const v = Math.round(matched.length * (PRODUCTION.members / Math.max(1, sampleMembers)));
      const f = loyalty();
      const untrimmed = lm.filter((r) => String(r.MBR_ID) !== String(r.MBR_ID).trim()).length;
      return {
        value: v, valueText: fmtCompact(v), caption: 'loyalty rows with a web order, guessed as "omnichannel members"',
        sql: "SELECT COUNT(*) FROM RAW_BRONZE.LOYALTY_MEMBER_CDC m\n  JOIN RAW_BRONZE.ECOM_ORDER_CDC o ON o.MBR_ID = m.MBR_ID\n WHERE m.STAT_CD = 'A'  -- no store purchase check, no 12-month window",
        tablesUsed: ['RAW_BRONZE.LOYALTY_MEMBER_CDC', 'RAW_BRONZE.ECOM_ORDER_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deleted members counted in the landed sample`,
          'Wrong definition: no store purchase and no 12-month activity window',
          `${untrimmed} untrimmed MBR_ID values in the sample silently fail the join`,
          `Unmasked PII read for ${persona.roleId}: FST_NM, LST_NM, EMAIL_ADDR, PHONE_NO`,
          'No lineage, owner or certification for the tables used',
        ],
        rowsRead: { columns: ['MBR_ID', 'FST_NM', 'EMAIL_ADDR', 'PHONE_NO', 'STAT_CD', 'OP_TYPE'], rows: lm.slice(0, 4).map((r) => [String(r.MBR_ID), String(r.FST_NM), String(r.EMAIL_ADDR), String(r.PHONE_NO), String(r.STAT_CD), String(r.OP_TYPE)]), exposed: [0, 1, 2, 3] },
      } satisfies RawResult;
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-2 comp sales by promotion (signature)
  const q = Q.PERIODS.quarter;
  const q3Promos = d.promos.filter((p) => p.year === 2026 && p.from >= q.from && p.from <= q.to);
  const k2: KnockoutScenario = {
    id: 'KO-2', scenarioId: 'S-06', agentId: 'AG-02',
    question: 'Which promotions lifted comparable sales above 5% last quarter?',
    affects: ['context', 'semantic', 'glossary', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-006', semantic: 'semantic/SV_STORE_SALES', glossary: 'glossary/T-004', cleansing: 'explorer/RAW_BRONZE/POS_TRANSACTION_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      const offset = s.semantic ? 364 : 365;
      const pf = pos().factor;
      const ef = ecom().factor;
      let rows: { name: string; pct: number }[];
      if (!s.glossary) {
        // "Comparable sales" not resolved: the agent used promotional lift over the modelled baseline (DP-05).
        rows = Q.promoEffectiveness(d, q.months, allow).rows.map((r) => ({ name: r.name, pct: r.liftPct }));
        notes.push('"Comparable sales" (T-004) not resolved: used promoted-item lift over baseline instead of comp store sales.');
      } else {
        rows = q3Promos.flatMap((p) => {
          const regions = p.regions.filter((r) => ok(r, allow));
          if (!regions.length) return [];
          let ty = 0;
          let ly = 0;
          for (const st of d.stores.filter((x) => regions.includes(x.region))) {
            const cells = d.byStoreDay.cells[st.key - 1];
            for (const day of dateRange(p.from, p.to)) {
              if (s.context && !isCompInMonth(st, day.slice(0, 7))) continue;
              const di = d.byStoreDay.idx.get(day);
              if (di === undefined || di < offset) continue;
              const a = cells[di];
              const b = cells[di - offset];
              if (s.context && (!a || !b)) continue;
              for (const x of a ?? []) ty += x.net * (s.cleansing ? 1 : x.channel === 'Store' ? pf : ef);
              for (const x of b ?? []) ly += x.net;
            }
          }
          return [{ name: p.name, pct: round(ly ? ((ty - ly) / ly) * 100 : 0, 1) }];
        });
        if (s.context) notes.push('BR-006: comparable stores only (open 13+ months, remodels excluded); BR-009: above 5%. Cited the comp sales guide, chunk 9.');
        else notes.push('No rule BR-006: new and remodelled stores were compared with last year; no citation.');
        if (!s.semantic) notes.push('No semantic view: last year joined on the calendar date (365 days back), so weekdays do not line up.');
        if (!s.cleansing) notes.push(`Ran on RAW_BRONZE.POS_TRANSACTION_CDC and ECOM_ORDER_CDC: this year's rows include CDC duplicates (×${fmtNum(pf, 3)} store, ×${fmtNum(ef, 3)} online); last year came from the history load.`);
      }
      notes.push(...rowNote(allow));
      const lifted = rows.filter((x) => x.pct > 5);
      return {
        value: lifted.length, valueText: `${lifted.length} of ${rows.length}`, caption: `Q3 2026 promotions with ${s.glossary ? 'comp sales' : 'lift'} above 5%`,
        table: { columns: ['Promotion', s.glossary ? 'Comp sales %' : 'Lift over baseline %'], rows: [...rows].sort((a, b) => b.pct - a.pct).map((x) => [x.name, fmtPct(x.pct)]) },
        sql: s.glossary && s.semantic
          ? `SELECT promo.promo_name, comp_sales_pct FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_STORE_SALES ...)\n WHERE sales_date BETWEEN '2026-07-01' AND '2026-09-30'${s.context ? ' AND is_comp_store  -- BR-006' : ''}\nHAVING comp_sales_pct > 5`
          : s.glossary
            ? `SELECT promo_id, SUM(ty.net_sales_usd) / SUM(ly.net_sales_usd) * 100 - 100\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_SALES' : 'RAW_BRONZE.POS_TRANSACTION_CDC'} ty\n  JOIN ... ly ON ly.sales_date = DATEADD(year, -1, ty.sales_date)  -- calendar date, not same weekday${s.context ? '\n WHERE ty.is_comp_store' : ''}`
            : `SELECT promo_name, (SUM(net_sales_usd) - SUM(baseline_sales_usd)) / SUM(baseline_sales_usd) * 100 AS lift_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_PROMOTION_EFFECTIVENESS\n GROUP BY 1 HAVING lift_pct > 5`,
        sources: [{ productId: 'DP-02', version: '3.1.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-006 new and remodelled stores were compared with last year and the comp sales guide was not cited:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view last year was joined on the calendar date, so a Saturday was compared with a Friday:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"Comparable sales" was not resolved, so the agent ranked promotions by lift over baseline:', g, x), severity: 'ambiguous' as const },
      cleansing: { reason: describe("CDC update duplicates in this year's POS and web order rows inflated comp sales:", g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so promotions that ran only in other regions were included:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Sales Performance is certified.', severity: 'unverified' as const },
    })[layer],
  };

  // ---------------------------------------------------------------------------------------------- KO-3 promotion ROI (product in certification)
  const q3Keys = new Set(q3Promos.map((p) => p.key));
  /** DIM_PROMOTION rows sharing each 2026 promotion's name (the fan-out when joined on PROMO_NAME). */
  const twins = new Map(q3Promos.map((p) => [p.key, d.promos.filter((x) => x.name === p.name).length]));
  const k3: KnockoutScenario = {
    id: 'KO-3', scenarioId: 'S-04', agentId: 'AG-01',
    question: 'What was the ROI of each promotion last quarter?',
    affects: ['certification', 'context', 'glossary', 'semantic', 'governance'],
    links: { certification: 'certify/DP-05', context: 'context/rules?rule=BR-010', glossary: 'glossary/T-020', semantic: 'semantic/SV_PROMO_EFFECTIVENESS', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const lines = d.promoSales.filter((x) => q3Keys.has(x.promoKey) && ok(x.region, allow));
      const w = (x: (typeof lines)[number]) => (s.semantic ? 1 : twins.get(x.promoKey) ?? 1);
      const num = (x: (typeof lines)[number]) => (s.glossary ? x.incrementalMargin : x.net - x.baseline);
      const den = (x: (typeof lines)[number]) => (s.context ? x.promoCost : x.discount);
      const roiOf = (xs: typeof lines) => round(sum(xs.map((x) => w(x) * num(x))) / sum(xs.map((x) => w(x) * den(x))), 2);
      const v = roiOf(lines);
      const notes: string[] = [];
      if (s.context) notes.push('BR-010: promotion cost is the discount Harbor & Pine funds after vendor funding. Cited the promotion guide, chunk 15.');
      else notes.push('No rule BR-010: divided by the full discount, ignoring vendor funding.');
      if (!s.glossary) notes.push('"ROI" (T-020) not resolved: used incremental sales, not incremental margin.');
      if (!s.semantic) notes.push(`No semantic view: joined DIM_PROMOTION on PROMO_NAME, so ${[...twins.values()].filter((n) => n > 1).length} promotions that also ran in 2025 were counted twice.`);
      notes.push(...rowNote(allow));
      const byPromo = q3Promos.map((p) => ({ name: p.name, xs: lines.filter((x) => x.promoKey === p.key) })).filter((p) => p.xs.length);
      return {
        value: v, valueText: fmtUsd(v), caption: 'incremental margin per $1 of promotion cost, Q3 2026',
        table: { columns: ['Promotion', 'ROI'], rows: byPromo.map((p) => [p.name, fmtNum(roiOf(p.xs), 2)]) },
        sql: s.semantic
          ? `SELECT promo.promo_name, promo_roi FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_PROMO_EFFECTIVENESS ...)\n WHERE fiscal_quarter = '2026-Q3'`
          : `SELECT p.promo_name, SUM(${s.glossary ? 'f.incremental_margin_usd' : 'f.net_sales_usd - f.baseline_sales_usd'}) / SUM(${s.context ? 'f.promo_cost_usd' : 'f.discount_usd'})\n  FROM ${DB}.CONFORMED_GOLD.FCT_PROMO_SALES f\n  JOIN ${DB}.CONFORMED_GOLD.DIM_PROMOTION p ON p.promo_name = (SELECT promo_name FROM ... WHERE promo_key = f.promo_key)  -- fan-out`,
        sources: [{ productId: 'DP-05', version: '1.0.0-rc', certified: false }],
        notes: s.certification ? [...notes, 'Not certified: Promotion Effectiveness is In certification (v1.0.0-rc); treat as provisional.'] : notes,
        hiddenWarning: s.certification ? undefined : 'Promotion Effectiveness (In certification, v1.0.0-rc) used without a "Not certified" warning.',
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used Promotion Effectiveness, still In certification with a failing PCI masking gate, and showed no "Not certified" warning.', severity: 'unverified' as const },
      context: { reason: describe('Without rule BR-010 vendor-funded discount was counted as Harbor & Pine cost:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"ROI" was not resolved, so incremental sales were used instead of incremental margin:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view promotions were joined by name and repeat events were counted twice:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so redemptions outside your regions were included:', g, x), severity: 'unsafe' as const },
      cleansing: { reason: 'No visible effect: duplicates inflate margin and cost equally.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('POS_TRANSACTION_CDC');
      const sales = r.filter((x) => x.TXN_TYPE === 'SALE');
      const coded = sales.filter((x) => x.PROMO_CD).length;
      // No promotion codes in the landed days, so the raw agent treats every discounted sale as promoted.
      const promo = sales.filter((x) => Number(x.DISC_AMT) > 0);
      const disc = sum(promo.map((x) => Number(x.DISC_AMT)));
      const v = round(sum(promo.map((x) => Number(x.GROSS_AMT) - Number(x.DISC_AMT))) / Math.max(1, disc), 2);
      const f = pos();
      return {
        value: v, valueText: fmtUsd(v), caption: 'net sales per $1 of discount on discounted POS rows',
        sql: "SELECT SUM(GROSS_AMT - DISC_AMT) / SUM(DISC_AMT) FROM RAW_BRONZE.POS_TRANSACTION_CDC\n WHERE DISC_AMT > 0 AND TXN_TYPE = 'SALE'  -- no baseline, no margin, no vendor funding",
        tablesUsed: ['RAW_BRONZE.POS_TRANSACTION_CDC'],
        risks: [
          `Wrong population: only ${coded} of ${sales.length} landed sale rows carry a promotion code, so every markdown was counted as a promotion`,
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes included`,
          'Wrong definition: sales per discount dollar is not incremental margin over promotion cost; no baseline',
          `Unmasked PCI and PII read for ${persona.roleId}: CARD_LAST4, MBR_ID`,
          'Only the last two business days have landed; no owner, lineage or certification',
        ],
        rowsRead: { columns: ['TXN_ID', 'MBR_ID', 'GROSS_AMT', 'DISC_AMT', 'CARD_LAST4', 'PROMO_CD', 'OP_TYPE'], rows: promo.slice(0, 4).map((x) => [String(x.TXN_ID), x.MBR_ID === null ? null : String(x.MBR_ID), Number(x.GROSS_AMT), Number(x.DISC_AMT), x.CARD_LAST4 === null ? null : String(x.CARD_LAST4), String(x.PROMO_CD), String(x.OP_TYPE)]), exposed: [1, 4] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-4 suspicious returns (draft product)
  const k4: KnockoutScenario = {
    id: 'KO-4', scenarioId: 'S-08', agentId: 'AG-02',
    question: 'What is the return rate by region this quarter, and how many returns were flagged as suspicious?',
    affects: ['certification', 'context', 'cleansing', 'governance'],
    links: { certification: 'certify/DP-06', context: 'context/rules?rule=BR-017', cleansing: 'explorer/RAW_BRONZE/POS_TRANSACTION_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const notes: string[] = [];
      let all = d.returns;
      if (!s.cleansing) {
        // Return lines duplicated at the rate of CDC duplicates seen in the landed POS sample.
        const f = pos();
        const rate = f.factor - 1;
        all = d.returns.flatMap((r, i) => (Math.floor((i + 1) * rate) > Math.floor(i * rate) ? [r, r] : [r]));
        notes.push(`Ran on CDC rows: ${all.length - d.returns.length} duplicated return lines (rate ${fmtPct(rate * 100)} from POS_TRANSACTION_CDC), which also tip members over the five-returns rule.`);
      }
      const flags = s.cleansing && s.context ? d.returns.map((r) => r.suspicious) : flagReturns(all, s.context);
      const scoped = all.map((r, i) => ({ r, f: flags[i] })).filter((x) => ok(x.r.region, allow));
      const susp = scoped.filter((x) => x.f).length;
      const v = round((susp / Math.max(1, scoped.length)) * 100, 1);
      if (s.context) notes.push('BR-017: no receipt and over $250, or more than five returns by a member in 30 days. Cited the returns policy, chunk 6.');
      else notes.push('No rule BR-017: every return without a receipt was flagged.');
      notes.push(...rowNote(allow));
      const byRegion = Q.returnsByRegion(d, allow).rows.map((x) => x.region);
      return {
        value: v, valueText: fmtPct(v), caption: `of ${fmtNum(scoped.length, 0)} sampled Q3 returns flagged as suspicious`,
        table: { columns: ['Region', 'Returns (sample)', 'Suspicious'], rows: byRegion.map((rg) => [rg, scoped.filter((x) => x.r.region === rg).length, scoped.filter((x) => x.r.region === rg && x.f).length]) },
        sql: `SELECT region, COUNT(*) AS returns, COUNT_IF(${s.context ? 'is_suspicious  -- BR-017' : 'NOT has_receipt'}) AS suspicious\n  FROM ${DB}.${s.cleansing ? 'DATA_PRODUCTS.DP_RETURNS_FRAUD' : 'RAW_BRONZE.POS_TRANSACTION_CDC'}\n WHERE return_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY region;`,
        sources: [{ productId: 'DP-06', version: '0.4.0', certified: false }],
        notes: s.certification ? [...notes, 'Not certified: Returns & Fraud is a Draft product with no steward; flags are for review only.'] : notes,
        hiddenWarning: s.certification ? undefined : 'Draft product Returns & Fraud used without a warning; its missing steward and DQ issues hidden.',
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used the Draft Returns & Fraud product with no "Not certified" banner; its missing steward and failing freshness check were hidden.', severity: 'unverified' as const },
      context: { reason: describe('Without rule BR-017 every return without a receipt was flagged as suspicious:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC duplicates were counted as extra returns, pushing members over the five-returns rule:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so returns from all four regions were included:', g, x), severity: 'unsafe' as const },
      semantic: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      glossary: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('POS_TRANSACTION_CDC');
      const rets = r.filter((x) => x.TXN_TYPE === 'RETURN');
      // No receipt status in the POS header: the raw agent reads "no loyalty ID scanned" as "no receipt".
      const anon = rets.filter((x) => x.MBR_ID === null);
      const v = round((anon.length / Math.max(1, rets.length)) * 100, 1);
      const f = posReturns();
      return {
        value: v, valueText: fmtPct(v), caption: 'POS return rows with no member ID, guessed as "suspicious"',
        sql: "SELECT COUNT_IF(MBR_ID IS NULL) / COUNT(*) FROM RAW_BRONZE.POS_TRANSACTION_CDC\n WHERE TXN_TYPE = 'RETURN'  -- no receipt status, no amount threshold, no member history",
        tablesUsed: ['RAW_BRONZE.POS_TRANSACTION_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes among ${f.rows} return rows`,
          'Wrong definition: a missing member ID is not a missing receipt; no $250 threshold and no five-returns-in-30-days check (BR-017)',
          'Web returns missing: only store POS rows are read',
          `Unmasked PII and PCI read for ${persona.roleId}: MBR_ID, CARD_LAST4`,
          'Draft product logic bypassed; no steward, owner or certification',
        ],
        rowsRead: { columns: ['TXN_ID', 'STORE_NO', 'MBR_ID', 'GROSS_AMT', 'CARD_LAST4', 'OP_TYPE'], rows: rets.slice(0, 4).map((x) => [String(x.TXN_ID), String(x.STORE_NO), x.MBR_ID === null ? null : String(x.MBR_ID), Number(x.GROSS_AMT), x.CARD_LAST4 === null ? null : String(x.CARD_LAST4), String(x.OP_TYPE)]), exposed: [2, 4] },
      };
    },
  };

  return [k1, k2, k3, k4];
}

