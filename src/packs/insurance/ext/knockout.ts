// Insurance knockout questions (E1) and raw-data variants (E2). Every degraded and raw number is computed from the
// same synthetic data with the faulty logic applied: real CDC duplicates in the landed claims sample, a real
// claim-to-transaction fan-out, an unweighted average of line ratios, real catastrophe claims and real month-end valuation rows.
import type { Persona, Row, SfObject } from '../../../types';
import type { KnockoutResult, KnockoutScenario, LayerSwitches, RawResult } from '../../../ext/types';
import { describe } from '../../../ext/knockout';
import { avg, groupBy, round, sum } from '../../../mock-snowflake/generators';
import { maskFor } from '../../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../../lib/format';
import type { Claim, InsData } from '../data';
import { LINES } from '../generators.config';
import * as Q from '../queries';

const DB = 'SMI_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const inReg = (allow: string[] | undefined, r: string) => !allow || allow.includes(r);
const usdM = (v: number) => `$${fmtNum(v / 1e6, 1)} M`;
const regionNote = (allow?: string[]) => (allow ? [`Row access: ${allow.join(' and ')} regions only.`] : []);

export function buildKnockout(d: InsData, objects: SfObject[]): KnockoutScenario[] {
  const rowsOf = (name: string): Row[] => {
    const o = objects.find((x) => x.name === name);
    return o?.rows ? o.rows({ productStatus: {}, productVersion: {}, fixes: {} }) : [];
  };
  /** Bronze over-count factor: CDC rows (I + U + D) per distinct key in the landed sample. */
  const cdcFactor = (table: string, key: string) => {
    const rows = rowsOf(table);
    const distinct = new Set(rows.map((r) => String(r[key]).trim())).size;
    return { factor: distinct ? rows.length / distinct : 1, dups: rows.filter((r) => r.OP_TYPE === 'U').length, deletes: rows.filter((r) => r.OP_TYPE === 'D').length, rows: rows.length, distinct };
  };
  const clm = () => cdcFactor('CLM_CLAIM_CDC', 'CLAIM_NO');
  const txnsByClaim = groupBy(d.txns, (t) => String(t.claimKey));
  const txnCount = (c: Claim) => txnsByClaim.get(String(c.key))?.length ?? 0;
  /** Claims "duplicated" by Bronze CDC: every k-th claim appears twice when the update rows are not collapsed. */
  const withCdcDups = <T,>(xs: T[]) => {
    const f = clm().factor;
    const k = f > 1 ? Math.max(1, Math.round(1 / (f - 1))) : 0;
    return k ? [...xs, ...xs.filter((_, i) => i % k === 0)] : xs;
  };

  // ---------------------------------------------------------------------------------------------- KO-1 open claims
  const k1: KnockoutScenario = {
    id: 'KO-1', scenarioId: 'S-02', agentId: 'AG-01',
    question: 'How many open claims do we have?',
    affects: ['glossary', 'cleansing', 'semantic', 'governance'],
    links: { glossary: 'glossary/T-014', cleansing: 'explorer/RAW_BRONZE/CLM_CLAIM_CDC', semantic: 'semantic/SV_CLAIMS_EXPERIENCE', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s: LayerSwitches, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const scoped = d.claims.filter((c) => inReg(allow, c.region));
      const open = scoped.filter((c) => (s.glossary ? Q.isOpenClaim(c) : c.status !== 'Closed'));
      let count = open.length * d.claimScale;
      const notes: string[] = [];
      if (s.glossary) notes.push('Open Claim (T-014): status Open or Reopened with a case reserve above zero.');
      else notes.push(`"Open" read as CLAIM_STATUS <> 'Closed': ${fmtInt(scoped.filter((c) => c.status !== 'Closed' && c.reserve <= 0).length * d.claimScale)} fully paid claims awaiting only subrogation counted.`);
      if (!s.semantic) {
        // Naive join to claim transactions without DISTINCT: one row per reserve, payment and recovery.
        count = sum(open.map(txnCount)) * d.claimScale;
        notes.push('Counted joined transaction rows, not distinct claims.');
      }
      if (!s.cleansing) {
        const f = clm();
        count *= f.factor;
        notes.push(`Counted CDC rows from RAW_BRONZE.CLM_CLAIM_CDC (${f.dups} update duplicates, ${f.deletes} deletes in the landed sample).`);
      }
      notes.push(...regionNote(allow));
      const v = Math.round(count);
      const byLine = groupBy(open, (c) => c.line);
      return {
        value: v, valueText: fmtCompact(count), caption: `open claims${allow ? ` in the ${allow.join(' and ')} regions` : ''}`,
        table: { columns: ['Line of business', 'Open claims'], rows: LINES.filter((l) => byLine.has(l.code)).map((l) => [l.name, fmtInt(byLine.get(l.code)!.length * d.claimScale)]) },
        sql: s.semantic
          ? `SELECT COUNT(*) FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE\n WHERE ${s.glossary ? 'is_open  -- T-014 / BR-002' : "claim_status <> 'Closed'"}`
          : `SELECT COUNT(*) FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_CLAIM' : 'RAW_BRONZE.CLM_CLAIM_CDC'} c\n  JOIN ${DB}.CONFORMED_GOLD.FCT_CLAIM_TRANSACTION t ON t.claim_key = c.claim_key\n WHERE c.claim_status <> 'Closed'  -- no DISTINCT: one row per transaction`,
        sources: [{ productId: 'DP-02', version: '1.6.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      glossary: { reason: describe('Without the glossary "open" was read as any status other than Closed, so fully paid claims awaiting subrogation were counted:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('Without Silver, CDC update duplicates and deleted claims were counted:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent joined claims to their transactions and counted rows instead of claims:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so claims outside your regions were counted and claimant names shown:', g, x), severity: 'unsafe' as const },
      context: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Claims Experience is certified.', severity: 'unverified' as const },
    })[layer],
    raw: ({ persona }) => {
      const r = rowsOf('CLM_CLAIM_CDC');
      const f = clm();
      // Raw agent: COUNT(*) on every CDC row with STAT_CD O or R, extrapolated from the landed sample to the book.
      const matched = r.filter((x) => x.STAT_CD === 'O' || x.STAT_CD === 'R');
      const v = Math.round(matched.length * ((d.claims.length * d.claimScale) / Math.max(1, f.distinct)));
      return {
        value: v, valueText: fmtCompact(v), caption: 'CDC rows guessed as "open claims"',
        sql: "SELECT COUNT(*) FROM RAW_BRONZE.CLM_CLAIM_CDC\n WHERE STAT_CD IN ('O', 'R')  -- no reserve check, no dedup",
        tablesUsed: ['RAW_BRONZE.CLM_CLAIM_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deleted claims counted in the landed sample`,
          'Wrong definition: no case-reserve check, so fully paid claims awaiting subrogation count as open',
          'Sample bias: the landed sample holds the most recent claims, which are more often open',
          `Unmasked PII and PHI read for ${persona.roleId}: CLMNT_FIRST_NM, CLMNT_LAST_NM, INJURY_DESC`,
          'No lineage, owner or certification for the table used',
        ],
        rowsRead: { columns: ['CLAIM_NO', 'CLMNT_FIRST_NM', 'CLMNT_LAST_NM', 'INJURY_DESC', 'STAT_CD', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.CLAIM_NO), String(x.CLMNT_FIRST_NM), String(x.CLMNT_LAST_NM), x.INJURY_DESC == null ? null : String(x.INJURY_DESC), String(x.STAT_CD), String(x.OP_TYPE)]), exposed: [1, 2, 3] },
      } satisfies RawResult;
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-2 claim severity
  const k2: KnockoutScenario = {
    id: 'KO-2', scenarioId: 'S-01', agentId: 'AG-01',
    question: 'What is the average claim severity by line of business year to date?',
    affects: ['context', 'semantic', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-003', semantic: 'semantic/SV_CLAIMS_EXPERIENCE', cleansing: 'explorer/RAW_BRONZE/CLM_CLAIM_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      let cs = d.claims.filter((c) => Q.inRange(c.lossDate, Q.PERIODS.ytd) && inReg(allow, c.region));
      const notes: string[] = [];
      const amount = (c: Claim) => (s.context ? c.incurred : c.incurred + c.lae);
      if (s.context) notes.push('BR-003: incurred (paid plus case reserve) per claim; LAE excluded.');
      else notes.push('No rule BR-003: loss adjustment expense added to every claim.');
      if (!s.cleansing) {
        cs = withCdcDups(cs);
        notes.push(`Averaged RAW_BRONZE.CLM_CLAIM_CDC rows including ${clm().dups} update duplicates in the landed sample.`);
      }
      // Semantic off: AVG over claims joined to transactions, so claims with more payments weigh more.
      const metric = (xs: Claim[]) => (s.semantic ? avg(xs.map(amount)) : sum(xs.map((c) => amount(c) * txnCount(c))) / Math.max(1, sum(xs.map(txnCount))));
      if (!s.semantic) notes.push('No semantic view: averaged claim-transaction join rows, not claims.');
      notes.push(...regionNote(allow));
      const by = groupBy(cs, (c) => c.line);
      const v = round(metric(cs), 0);
      return {
        value: v, valueText: fmtUsd(v, 0), caption: 'average incurred per claim, loss date 1 Jan – 30 Sep 2026',
        table: { columns: ['Line of business', 'Average severity'], rows: LINES.filter((l) => by.has(l.code)).map((l) => [l.name, fmtUsd(round(metric(by.get(l.code)!), 0), 0)]) },
        sql: s.semantic
          ? `SELECT line.line_of_business, AVG(claim.incurred_loss${s.context ? '' : ' + claim.lae_amount'}) FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_CLAIMS_EXPERIENCE ...)\n WHERE loss_date BETWEEN '2026-01-01' AND '2026-09-30'${s.context ? '  -- BR-003' : ''}`
          : `SELECT line_code, AVG(${s.cleansing ? 'c.incurred_loss' : 'c.RESERVE_AMT + c.PAID_AMT'}${s.context ? '' : ' + c.lae_amount'})\n  FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_CLAIM' : 'RAW_BRONZE.CLM_CLAIM_CDC'} c JOIN ${DB}.CONFORMED_GOLD.FCT_CLAIM_TRANSACTION t USING (claim_key)  -- grain lost`,
        sources: [{ productId: 'DP-02', version: '1.6.0', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-003 loss adjustment expense was added to every claim:', g, x), severity: 'wrong' as const },
      semantic: { reason: describe('Without the semantic view the agent averaged claim-transaction rows, so claims with many payments counted several times:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in CLM_CLAIM_CDC were averaged in:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so the South and West regions were included:', g, x), severity: 'unsafe' as const },
      glossary: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      certification: { reason: 'No visible effect: Claims Experience is certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const r = rowsOf('CLM_CLAIM_CDC').filter((x) => String(x.LOSS_DT) >= '2026-01-01');
      const v = round(avg(r.map((x) => Number(x.RESERVE_AMT) + Number(x.PAID_AMT))), 0);
      const f = clm();
      return {
        value: v, valueText: fmtUsd(v, 0), caption: 'AVG(RESERVE_AMT + PAID_AMT) over landed claim rows',
        sql: "SELECT LOB_CD, AVG(RESERVE_AMT + PAID_AMT) FROM RAW_BRONZE.CLM_CLAIM_CDC\n WHERE LOSS_DT >= '2026-01-01' GROUP BY LOB_CD  -- no dedup, no region",
        tablesUsed: ['RAW_BRONZE.CLM_CLAIM_CDC'],
        risks: [
          `Duplicates: ${f.dups} CDC update rows and ${f.deletes} deletes averaged in`,
          'Sample bias: the landed rows are the most recent claims, still early in their development',
          'No line-of-business conformance: LOB_CD is used as landed',
          'No region: LOSS_ST is not mapped to a region',
          'No owner, contract or certification',
        ],
        rowsRead: { columns: ['CLAIM_NO', 'LOB_CD', 'RESERVE_AMT', 'PAID_AMT', 'OP_TYPE'], rows: r.slice(0, 4).map((x) => [String(x.CLAIM_NO), String(x.LOB_CD), Number(x.RESERVE_AMT), Number(x.PAID_AMT), String(x.OP_TYPE)]), exposed: [] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-3 loss ratio ex-cat (signature)
  const k3: KnockoutScenario = {
    id: 'KO-3', scenarioId: 'S-06', agentId: 'AG-02',
    question: 'What is the loss ratio by line of business this year, excluding catastrophe losses?',
    affects: ['context', 'glossary', 'semantic', 'cleansing', 'governance'],
    links: { context: 'context/rules?rule=BR-005', glossary: 'glossary/T-008', semantic: 'semantic/SV_CLAIMS_EXPERIENCE', cleansing: 'explorer/RAW_BRONZE/CLM_CLAIM_CDC', governance: 'explorer/GOVERNANCE/RAP_REGION_ACCESS' },
    compute: (s, { persona }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const u = Q.underwriting(d, Q.PERIODS.ytd, allow, 'line');
      const notes: string[] = [];
      if (s.context) notes.push('BR-005: claims on the cat-code list excluded; earned premium. Cited the NAIC reporting guide, chunk 6.');
      else notes.push(`Catastrophe claims included: ${fmtInt(u.total.catClaims)} cat-coded claims counted; no citation.`);
      if (!s.glossary) notes.push('"Loss ratio" not resolved to T-008: divided by written premium.');
      if (!s.semantic) notes.push('No semantic view: averaged the line loss ratios with equal weight instead of total losses over total earned premium.');
      if (!s.cleansing) notes.push(`Ran on RAW_BRONZE.CLM_CLAIM_CDC: ${clm().dups} update duplicates in the landed sample.`);
      notes.push(...regionNote(allow));
      const ratio = (r: Q.UwRow) => {
        let num = s.context ? r.incurredEx : r.incurredEx + r.incurredCat;
        if (!s.cleansing) num *= clm().factor;
        const den = s.glossary ? r.earned : r.written;
        return round((num / den) * 100, 1);
      };
      // Semantic off: the six line ratios are averaged with equal weight instead of dividing total losses by total premium.
      const v = s.semantic ? ratio(u.total) : round(avg(u.rows.map((r) => ratio(r))), 1);
      return {
        value: v, valueText: fmtPct(v), caption: `loss ratio${s.context ? ' ex-cat' : ' including catastrophes'}, accident year 2026 to date`,
        table: { columns: ['Line of business', 'Loss ratio'], rows: u.rows.map((r) => [Q.lineName(r.key), fmtPct(ratio(r))]) },
        sql: s.semantic
          ? `SELECT line.line_of_business, ${s.glossary ? 'loss_ratio_ex_cat' : 'SUM(incurred_loss) / SUM(written_premium) * 100'} FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_CLAIMS_EXPERIENCE ...)\n WHERE loss_date BETWEEN '2026-01-01' AND '2026-09-30'${s.context ? ' AND cat_code IS NULL  -- BR-005' : ''}`
          : `SELECT AVG(line_loss_ratio) FROM (\n  SELECT c.line_code, SUM(c.incurred_loss) / SUM(p.${s.glossary ? 'earned_premium' : 'written_premium'}) * 100 AS line_loss_ratio\n    FROM ${DB}.${s.cleansing ? 'CONFORMED_GOLD.FCT_CLAIM' : 'RAW_BRONZE.CLM_CLAIM_CDC'} c JOIN ${DB}.CONFORMED_GOLD.FCT_PREMIUM p USING (line_code)\n   GROUP BY 1)  -- unweighted average of line ratios`,
        sources: [{ productId: 'DP-02', version: '1.6.0', certified: true }, { productId: 'DP-03', version: '3.2.1', certified: true }], notes,
      };
    },
    failure: (layer, g, x) => ({
      context: { reason: describe('Without rule BR-005 catastrophe claims stayed in and the NAIC guide was not cited:', g, x), severity: 'wrong' as const },
      glossary: { reason: describe('"Loss ratio" was not resolved to T-008, so the agent divided by written instead of earned premium:', g, x), severity: 'ambiguous' as const },
      semantic: { reason: describe('Without the semantic view the agent averaged the six line loss ratios with equal weight, so small commercial lines counted as much as Personal Auto:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in CLM_CLAIM_CDC inflated incurred losses:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Row access was bypassed, so all four regions were reported:', g, x), severity: 'unsafe' as const },
      certification: { reason: 'No visible effect: Claims Experience and Premium & Billing are certified.', severity: 'unverified' as const },
    })[layer],
    raw: () => {
      const cl = rowsOf('CLM_CLAIM_CDC').filter((x) => String(x.LOSS_DT) >= '2026-01-01');
      const pol = rowsOf('PAS_POLICY_CDC');
      const fc = clm();
      const fp = cdcFactor('PAS_POLICY_CDC', 'POLICY_NO');
      // Raw agent: incurred on landed claim rows over annual (written) premium on landed policy rows, each scaled from its sample.
      const num = sum(cl.map((x) => Number(x.RESERVE_AMT) + Number(x.PAID_AMT))) * (d.claims.length / Math.max(1, fc.distinct)) * d.claimScale;
      const den = sum(pol.map((x) => Number(x.ANNUAL_PREM))) * (d.policies.length / Math.max(1, fp.distinct)) * d.scale;
      const v = round((num / den) * 100, 1);
      return {
        value: v, valueText: fmtPct(v), caption: 'SUM(RESERVE_AMT + PAID_AMT) ÷ SUM(ANNUAL_PREM) over landed rows',
        sql: "SELECT SUM(c.RESERVE_AMT + c.PAID_AMT) / (SELECT SUM(ANNUAL_PREM) FROM RAW_BRONZE.PAS_POLICY_CDC) * 100\n  FROM RAW_BRONZE.CLM_CLAIM_CDC c\n WHERE c.LOSS_DT >= '2026-01-01'  -- cat claims included, written premium",
        tablesUsed: ['RAW_BRONZE.CLM_CLAIM_CDC', 'RAW_BRONZE.PAS_POLICY_CDC'],
        risks: [
          `Duplicates: ${fc.dups} claim and ${fp.dups} policy CDC update rows included`,
          'Wrong definition: annual written premium instead of earned premium for the same months',
          'Catastrophe claims not excluded; no cat-code list, no NAIC citation',
          'No line of business conformance: LOB_CD lower-case values split lines',
          `Unmasked PII read: PH_FIRST_NM, PH_LAST_NM, BIRTH_DT on ${fmtInt(pol.length)} policy rows`,
        ],
        rowsRead: { columns: ['POLICY_NO', 'PH_FIRST_NM', 'PH_LAST_NM', 'LOB_CD', 'ANNUAL_PREM', 'OP_TYPE'], rows: pol.slice(0, 4).map((x) => [String(x.POLICY_NO), String(x.PH_FIRST_NM), String(x.PH_LAST_NM), String(x.LOB_CD), Number(x.ANNUAL_PREM), String(x.OP_TYPE)]), exposed: [1, 2] },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------- KO-4 case reserves (product in certification)
  const k4: KnockoutScenario = {
    id: 'KO-4', scenarioId: 'S-04', agentId: 'AG-01',
    question: 'What is our total case reserve balance this month?',
    affects: ['certification', 'context', 'cleansing', 'governance'],
    links: { certification: 'certify/DP-05', context: 'context/rules?rule=BR-010', cleansing: 'explorer/RAW_BRONZE/CLM_CLAIM_CDC', governance: 'explorer/GOVERNANCE/MP_MASK_PHI' },
    compute: (s, { persona, live }) => {
      const allow = s.governance ? allowOf(persona) : undefined;
      const trend = Q.reserveTrend(d, allow);
      const cur = trend[trend.length - 1];
      let v = cur.caseBal;
      const notes: string[] = [];
      if (s.context) notes.push('BR-010: case reserves at the 30 Sep 2026 month-end valuation, open claims only.');
      else {
        v = sum(trend.map((t) => t.caseBal));
        notes.push(`No rule BR-010: summed all ${trend.length} month-end valuations (Apr–Sep) instead of the latest.`);
      }
      if (!s.cleansing) {
        v *= clm().factor;
        notes.push(`Summed RESERVE_AMT on RAW_BRONZE.CLM_CLAIM_CDC rows, including ${clm().dups} update duplicates.`);
      }
      notes.push(...regionNote(allow));
      const status = live.productStatus['DP-05'] ?? 'In certification';
      const certified = status === 'Certified';
      const phiMasked = s.governance && !persona.unmasked.includes('PHI');
      const phiExposed = !s.governance && !persona.unmasked.includes('PHI');
      const top = d.reserves.filter((r) => r.month === Q.PERIODS.month && inReg(allow, r.region)).sort((a, b) => b.caseReserve - a.caseReserve).slice(0, 3);
      const claimNo = new Map(d.claims.map((c) => [c.key, c.claimNo]));
      return {
        value: Math.round(v), valueText: usdM(v), caption: `case reserves${s.context ? ' at the 30 Sep 2026 valuation' : ', six valuations summed'}${allow ? ` in the ${allow.join(' and ')} regions` : ''}`,
        table: {
          columns: ['Claim', 'Claimant DOB', 'Region', 'Case reserve'],
          rows: top.map((r) => [claimNo.get(r.claimKey) ?? '', String(s.governance ? maskFor(persona, 'PHI', r.claimantDob) : r.claimantDob), r.region, fmtUsd(r.caseReserve * d.claimScale, 0)]),
          masked: phiMasked ? [1] : [], exposed: phiExposed ? [1] : [],
        },
        sql: `SELECT SUM(${s.cleansing ? 'case_reserve' : 'RESERVE_AMT'}) FROM ${DB}.${s.cleansing ? 'DATA_PRODUCTS.DP_LOSS_RESERVES' : 'RAW_BRONZE.CLM_CLAIM_CDC'}\n${s.context ? " WHERE valuation_date = '2026-09-30'  -- BR-010" : ' -- every valuation month summed'}`,
        sources: [{ productId: 'DP-05', version: live.productVersion['DP-05'] ?? '1.0.0-rc', certified }],
        notes: s.certification && !certified ? [...notes, `Not certified: Loss Reserves is ${status} (quality score 94.0).`] : notes,
        exposed: phiExposed ? ['CLAIMANT_DOB'] : undefined,
        hiddenWarning: s.certification || certified ? undefined : `${status} product used without a warning; quality score 94.0 hidden.`,
      };
    },
    failure: (layer, g, x) => ({
      certification: { reason: 'Without certification checks the answer used Loss Reserves, still in certification, with no "Not certified" banner and its 94.0 quality score hidden.', severity: 'unverified' as const },
      context: { reason: describe('Without rule BR-010 the agent summed six month-end valuations instead of reporting the latest one:', g, x), severity: 'wrong' as const },
      cleansing: { reason: describe('CDC update duplicates in CLM_CLAIM_CDC were summed:', g, x), severity: 'wrong' as const },
      governance: { reason: describe('Masking and row access were bypassed: claimant dates of birth (PHI, the open Gate 6 finding) were shown and all regions summed:', g, x), severity: 'unsafe' as const },
      semantic: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
      glossary: { reason: 'No visible effect on this question.', severity: 'unverified' as const },
    })[layer],
  };

  // Governance also exposes claimant names on the open-claims list; keep the analyst story visible in KO-1's table.
  const withExposure = (ks: KnockoutScenario): KnockoutScenario => ({
    ...ks,
    compute: (s, ctx) => {
      const r = ks.compute(s, ctx);
      if (ks.id !== 'KO-1') return r;
      const allow = s.governance ? allowOf(ctx.persona) : undefined;
      const hidden = !ctx.persona.unmasked.includes('PII');
      const sample = d.claims.filter((c) => Q.isOpenClaim(c) && inReg(allow, c.region)).sort((a, b) => b.incurred - a.incurred).slice(0, 3);
      const table: KnockoutResult['table'] = {
        columns: ['Claim', 'Claimant', 'Region', 'Incurred'],
        rows: sample.map((c) => [c.claimNo, String(s.governance ? maskFor(ctx.persona, 'PII', `${c.claimantFirst} ${c.claimantLast}`) : `${c.claimantFirst} ${c.claimantLast}`), c.region, fmtUsd(c.incurred, 0)]),
        masked: s.governance && hidden ? [1] : [],
        exposed: !s.governance && hidden ? [1] : [],
      };
      return { ...r, table, exposed: !s.governance && hidden ? ['CLAIMANT_NAME'] : undefined };
    },
  });

  return [k1, k2, k3, k4].map(withExposure);
}
