// The 15 Sentinel Mutual agent scenarios (spec section 9). Every number is computed from the in-memory sample.
import type { GlossaryTerm, IndustryPack, Persona, Scenario } from '../../types';
import { round, sum } from '../../mock-snowflake/generators';
import { maskFor } from '../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import type { InsData } from './data';
import { lineName } from './queries';
import * as Q from './queries';

const DB = 'SMI_AI_PLATFORM';
const allowedRegions = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const rowNote = (p: Persona) => (allowedRegions(p) ? ` Row access policy limited results to the ${allowedRegions(p)!.join(' and ')} regions.` : '');
const regionWhere = (p: Persona) => (allowedRegions(p) ? `\n  -- RAP_REGION_ACCESS applied by Snowflake: REGION IN (${allowedRegions(p)!.map((r) => `'${r}'`).join(', ')})` : '');
const usdM = (v: number) => `$${fmtNum(v / 1e6, 1)} M`;
const usdB = (v: number) => `$${fmtNum(v / 1e9, 2)} B`;

type PackLike = Pick<IndustryPack, 'glossary' | 'products' | 'agents' | 'semanticViews' | 'certificationScript' | 'context' | 'kpis'>;

export function buildScenarios(d: InsData, packRef: () => PackLike): Scenario[] {
  return [
    {
      id: 'S-01', agentId: 'AG-01', pattern: 1, productIds: ['DP-02'], kpiIds: ['K-04'],
      question: 'What is the average claim severity by line of business year to date?',
      paraphrases: ['average severity by line of business this year', 'average incurred per claim by line year to date', 'claim severity per line of business ytd'],
      terms: [{ text: 'claim severity', termId: 'T-012' }, { text: 'line of business', termId: 'T-004' }],
      ruleIds: ['BR-003', 'BR-007'], instruction: 'Report severity to the dollar; name the accident period and say LAE is excluded.',
      semantic: { view: 'SV_CLAIMS_EXPERIENCE', metrics: ['avg_severity'], dimensions: ['line.line_of_business'], filters: ["loss_date BETWEEN '2026-01-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.severityByLine(d, Q.PERIODS.ytd, allow);
        const top = [...r.rows].sort((a, b) => b.severity - a.severity)[0];
        const low = [...r.rows].sort((a, b) => a.severity - b.severity)[0];
        return {
          summary: `Average claim severity for losses this year (1 Jan – 30 Sep 2026) is ${fmtUsd(r.overall, 0)} per claim, excluding LAE. ${top.name} is highest at ${fmtUsd(top.severity, 0)}; ${low.name} is lowest at ${fmtUsd(low.severity, 0)}.${rowNote(persona)}`,
          table: { columns: ['Line of business', 'Average severity', 'Claims (scaled)'], rows: r.rows.map((x) => [x.name, fmtUsd(x.severity, 0), fmtInt(x.scaledClaims)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.name), values: r.rows.map((x) => x.severity), unit: 'USD' },
          sql: `SELECT line.line_of_business, AVG(claim.incurred_loss) AS avg_severity  -- BR-003, LAE excluded\n  FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE -- via SV_CLAIMS_EXPERIENCE\n WHERE loss_date BETWEEN '2026-01-01' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY 1\n ORDER BY avg_severity DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-04': r.overall },
        };
      },
    },
    {
      id: 'S-02', agentId: 'AG-01', pattern: 2, productIds: ['DP-02'], kpiIds: ['K-07'],
      question: 'How many open claims do we have?',
      paraphrases: ['number of open claims', 'how many claims are still open', 'open claim count by line', 'open claims inventory'],
      terms: [{ text: 'open claims', termId: 'T-014' }],
      ruleIds: ['BR-002'], instruction: 'State which claims count as open.',
      semantic: { view: 'SV_CLAIMS_EXPERIENCE', metrics: ['open_claims'], dimensions: ['line.line_of_business'], filters: ['Open Claim rule BR-002'] },
      doc: { docId: 'DOC-04', chunk: 5 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.openClaims(d, allow);
        return {
          summary: `There are ${fmtCompact(r.scaledOpen)} open claims today (${fmtInt(r.open.length)} in the sample, scaled ×${fmtNum(d.claimScale, 0)}), including ${fmtInt(r.reopened * d.claimScale)} reopened. "Open" follows rule BR-002: status Open or Reopened with a case reserve above zero, which excludes ${fmtInt(r.statusOnly * d.claimScale)} status-open claims that are fully paid and only awaiting a subrogation recovery.${rowNote(persona)}`,
          table: { columns: ['Line of business', 'Open claims', 'Of which reopened'], rows: r.rows.map((x) => [x.name, fmtInt(x.open * d.claimScale), fmtInt(x.reopened * d.claimScale)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.name), values: r.rows.map((x) => Math.round(x.open * d.claimScale)), unit: 'claims' },
          sql: `SELECT line_of_business, COUNT(*) AS open_claims\n  FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE\n WHERE is_open  -- BR-002: status IN ('Open', 'Reopened') AND case_reserve > 0${regionWhere(persona)}\n GROUP BY 1 ORDER BY 2 DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), note: `Sample of ${fmtInt(r.open.length)} open claims scaled ×${fmtNum(d.claimScale, 0)} to production.`,
          kpiValues: allow ? undefined : { 'K-07': r.scaledOpen },
        };
      },
    },
    {
      id: 'S-03', agentId: 'AG-01', pattern: 3, productIds: ['DP-02'], kpiIds: ['K-10'],
      question: 'Which open injury claims have incurred losses over $50,000?',
      paraphrases: ['open injury claims with incurred over $50,000', 'list large open injury claims above 50000', 'open bodily injury claims with incurred losses above 50k'],
      terms: [{ text: 'open', termId: 'T-014' }, { text: 'incurred losses', termId: 'T-007' }],
      ruleIds: ['BR-009', 'BR-002'], instruction: 'Never reveal claimant names or injury details unless the role may see them.',
      semantic: { view: 'SV_CLAIMS_EXPERIENCE', metrics: ['incurred_losses'], dimensions: ['claim.claim_id', 'claim.claimant_name', 'claim.injury_description', 'claim.region'], filters: ['is_open', 'injury_description IS NOT NULL', 'incurred_loss > 50000'] },
      doc: { docId: 'DOC-04', chunk: 13 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const list = Q.largeInjuryClaims(d, allow);
        const shown = list.slice(0, 8);
        const piiMasked = !persona.unmasked.includes('PII');
        const phiMasked = !persona.unmasked.includes('PHI');
        const masked = [...(piiMasked ? ['CLAIMANT_NAME'] : []), ...(phiMasked ? ['INJURY_DESCRIPTION'] : [])];
        return {
          summary: `${list.length} open injury claims in the sample carry incurred losses above $50,000 (≈ ${fmtCompact(list.length * d.claimScale)} across the book), totalling ${fmtUsd(sum(list.map((x) => x.c.incurred)), 0)} in the sample. Under BR-009 each needs a quarterly large-loss review. The largest ${shown.length} are listed.${masked.length ? ` Claimant names (MP_MASK_PII) and injuries (MP_MASK_PHI) are masked for your role.` : ''}${rowNote(persona)}`,
          table: {
            columns: ['Claim', 'Claimant', 'Injury', 'Line', 'Region', 'Days open', 'Incurred'],
            rows: shown.map((x) => [x.c.claimNo, String(maskFor(persona, 'PII', `${x.c.claimantFirst} ${x.c.claimantLast}`)), String(maskFor(persona, 'PHI', x.c.injury)), lineName(x.c.line), x.c.region, x.daysOpen, fmtUsd(x.c.incurred, 0)]),
            masked: [...(piiMasked ? [1] : []), ...(phiMasked ? [2] : [])],
          },
          sql: `SELECT claim_id, claimant_name, injury_description, line_of_business, region,\n       DATEDIFF('day', report_date, CURRENT_DATE) AS days_open, incurred_loss\n  FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE\n WHERE is_open                         -- BR-002\n   AND injury_description IS NOT NULL\n   AND incurred_loss > 50000           -- BR-009 large loss${regionWhere(persona)}\n ORDER BY incurred_loss DESC\n LIMIT 8;`,
          rows: shown.length, maskedColumns: masked, rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE',
        };
      },
    },
    {
      id: 'S-04', agentId: 'AG-01', pattern: 4, productIds: ['DP-05'], kpiIds: ['K-24'],
      question: 'What is our total case reserve balance this month?',
      paraphrases: ['case reserve balance this month', 'total case reserves for September', 'how much do we hold in case reserves', 'current case reserve balance'],
      terms: [{ text: 'case reserve', termId: 'T-019' }],
      ruleIds: ['BR-010', 'BR-011'], instruction: 'Report reserves in millions and show the six-month trend.',
      semantic: { view: 'SV_LOSS_RESERVES', metrics: ['case_reserve_balance', 'ibnr_reserve'], dimensions: ['date.valuation_month'], filters: ["valuation_date = '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const trend = Q.reserveTrend(d, allow);
        const cur = trend[trend.length - 1];
        const prev = trend[trend.length - 2];
        const chg = cur.caseBal - prev.caseBal;
        return {
          summary: `Case reserves at the 30 September 2026 valuation total ${usdM(cur.caseBal)}, ${chg >= 0 ? 'up' : 'down'} ${usdM(Math.abs(chg))} from August, across ${fmtInt(cur.openClaims * d.claimScale)} open claims (average ${fmtUsd(cur.avgCase, 0)} per claim). IBNR adds ${usdM(cur.ibnr)}, for total loss reserves of ${usdM(cur.total)}.${rowNote(persona)}`,
          table: { columns: ['Valuation month', 'Case reserves', 'IBNR', 'Open claims'], rows: trend.map((t) => [t.month, usdM(t.caseBal), usdM(t.ibnr), fmtInt(t.openClaims * d.claimScale)]) },
          chart: { kind: 'line', labels: trend.map((t) => t.month), values: trend.map((t) => round(t.caseBal / 1e6, 1)), unit: '$M' },
          sql: `SELECT date.valuation_month,\n       SUM(case_reserve) AS case_reserve_balance,  -- BR-010 month-end, open claims only\n       SUM(ibnr_allocated) AS ibnr_reserve         -- BR-011\n  FROM ${DB}.DATA_PRODUCTS.DP_LOSS_RESERVES\n WHERE valuation_date >= '2026-04-30'${regionWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: trend.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-24': Math.round(cur.caseBal), 'K-25': Math.round(cur.ibnr), 'K-26': cur.avgCase },
        };
      },
    },
    {
      id: 'S-05', agentId: 'AG-01', pattern: 5, productIds: ['DP-02'], kpiIds: ['K-11'],
      question: 'Show daily claim payments for the last 30 days',
      paraphrases: ['daily claim payments last 30 days', 'claim payments per day over the past 30 days', 'loss payments by day for the last 30 days'],
      terms: [{ text: 'claim payments', termId: 'T-027' }],
      ruleIds: [],
      semantic: { view: 'SV_CLAIMS_EXPERIENCE', metrics: ['paid_losses'], dimensions: ['transaction.payment_date'], filters: ["txn_type = 'Loss payment'", "payment_date BETWEEN '2026-09-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.dailyPayments(d, allow);
        const peak = r.days.reduce((a, b) => (b.amount > a.amount ? b : a));
        return {
          summary: `Over the last 30 days (1–30 Sep 2026) Sentinel paid ${usdM(r.total)} in loss payments across ≈ ${fmtCompact(r.payments * d.claimScale)} payments, an average of ${usdM(r.total / 30)} a day. The busiest day was ${peak.day} at ${usdM(peak.amount)}.${rowNote(persona)}`,
          table: { columns: ['Date', 'Loss payments', 'Payments (sample)'], rows: r.days.map((x) => [x.day, usdM(x.amount), x.payments]) },
          chart: { kind: 'line', labels: r.days.map((x) => x.day.slice(5)), values: r.days.map((x) => round(x.amount / 1e6, 2)), unit: '$M' },
          sql: `SELECT TO_DATE(t.date_key::VARCHAR, 'YYYYMMDD') AS payment_date, SUM(t.amount_usd) AS loss_payments\n  FROM ${DB}.CONFORMED_GOLD.FCT_CLAIM_TRANSACTION t  -- via DP_CLAIMS_EXPERIENCE\n WHERE t.txn_type = 'Loss payment'\n   AND t.date_key BETWEEN 20260901 AND 20260930${regionWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: r.days.length, rowFiltered: Boolean(allow),
        };
      },
    },
    {
      id: 'S-06', agentId: 'AG-02', pattern: 6, productIds: ['DP-02', 'DP-03'], kpiIds: ['K-01', 'K-08'],
      question: 'What is the loss ratio by line of business this year, excluding catastrophe losses?',
      paraphrases: ['loss ratio by line excluding cat losses this year', 'ex-cat loss ratio by line of business year to date', 'loss ratio per line of business without catastrophe losses', 'non-cat loss ratio by line this year'],
      terms: [{ text: 'loss ratio', termId: 'T-008' }, { text: 'line of business', termId: 'T-004' }, { text: 'catastrophe losses', termId: 'T-009' }],
      ruleIds: ['BR-005', 'BR-007'], instruction: 'Use earned premium; exclude claims on the cat-code list and report cat points separately.',
      semantic: { view: 'SV_CLAIMS_EXPERIENCE', metrics: ['loss_ratio_ex_cat', 'cat_loss_ratio'], dimensions: ['line.line_of_business'], filters: ['cat_code IS NULL (cat-code list)', "loss_date BETWEEN '2026-01-01' AND '2026-09-30'"] },
      doc: { docId: 'DOC-02', chunk: 6 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.underwriting(d, Q.PERIODS.ytd, allow, 'line');
        const worst = [...r.rows].sort((a, b) => b.lrEx - a.lrEx)[0];
        const best = [...r.rows].sort((a, b) => a.lrEx - b.lrEx)[0];
        const events = Q.catExposure(d).events.length;
        return {
          summary: `The loss ratio excluding catastrophes is ${fmtPct(r.total.lrEx)} for accident year 2026 to date (Jan–Sep), on ${usdB(r.total.earned)} of earned premium. ${lineName(worst.key)} is highest at ${fmtPct(worst.lrEx)} and ${lineName(best.key)} lowest at ${fmtPct(best.lrEx)}. ${usdM(r.total.incurredCat)} of losses on ${events} events from the cat-code list (${fmtNum(r.total.catLr, 1)} points) were excluded under BR-005; including them the loss ratio is ${fmtPct(r.total.lr)}.${rowNote(persona)}`,
          table: { columns: ['Line of business', 'Earned premium', 'Incurred ex-cat', 'Loss ratio ex-cat', 'Cat losses excluded'], rows: r.rows.map((x) => [lineName(x.key), usdM(x.earned), usdM(x.incurredEx), fmtPct(x.lrEx), usdM(x.incurredCat)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => lineName(x.key)), values: r.rows.map((x) => x.lrEx), unit: '%' },
          sql: `SELECT line.line_of_business,\n       SUM(IFF(claim.cat_code IS NULL, claim.incurred_loss, 0))  -- BR-005 cat-code list excluded\n         / SUM(premium.earned_premium) * 100 AS loss_ratio_ex_cat     -- earned, never written\n  FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE claim\n  JOIN ${DB}.DATA_PRODUCTS.DP_PREMIUM_BILLING premium USING (line_of_business)\n WHERE claim.loss_date BETWEEN '2026-01-01' AND '2026-09-30'   -- BR-007 accident year to date\n   AND premium.premium_month BETWEEN '2026-01-01' AND '2026-09-01'${regionWhere(persona)}\n GROUP BY 1\n ORDER BY loss_ratio_ex_cat DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-01': r.total.lrEx, 'K-08': r.total.catLr }, explorerTarget: 'DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE',
        };
      },
    },
    {
      id: 'S-07', agentId: 'AG-02', pattern: 7, productIds: ['DP-02', 'DP-03'], kpiIds: ['K-10'],
      question: 'Which 5 states had the highest incurred losses this year?',
      paraphrases: ['top 5 states by incurred losses', 'states with the most incurred losses year to date', 'highest incurred loss states this year'],
      terms: [{ text: 'incurred losses', termId: 'T-007' }],
      ruleIds: ['BR-007'],
      semantic: { view: 'SV_CLAIMS_EXPERIENCE', metrics: ['incurred_losses', 'loss_ratio'], dimensions: ['policy.state', 'claim.region'], filters: ["loss_date BETWEEN '2026-01-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const top = Q.topStatesByIncurred(d, 5, allow);
        const total = Q.underwriting(d, Q.PERIODS.ytd, allow, 'all').total;
        const share = (sum(top.map((x) => x.incurred)) / (total.incurredEx + total.incurredCat)) * 100;
        return {
          summary: `${top[0].key} (${top[0].region}) had the highest incurred losses this year: ${usdM(top[0].incurred)} at a ${fmtPct(top[0].lr)} loss ratio. The top five states account for ${fmtPct(share)} of the ${usdB(total.incurredEx + total.incurredCat)} incurred on 2026 accident-year claims.${rowNote(persona)}`,
          table: { columns: ['State', 'Region', 'Incurred losses', 'Claims (scaled)', 'Loss ratio'], rows: top.map((x) => [x.key, x.region, usdM(x.incurred), fmtInt(x.claims), fmtPct(x.lr)]) },
          chart: { kind: 'bar', labels: top.map((x) => x.key), values: top.map((x) => round(x.incurred / 1e6, 1)), unit: '$M' },
          sql: `SELECT policy.state, claim.region, SUM(claim.incurred_loss) AS incurred_losses\n  FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE claim\n WHERE claim.loss_date BETWEEN '2026-01-01' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY 1, 2\n ORDER BY incurred_losses DESC\n LIMIT 5;`,
          rows: top.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-10': Math.round(total.incurredEx + total.incurredCat) }, explorerTarget: 'CONFORMED_GOLD.FCT_CLAIM',
        };
      },
    },
    {
      id: 'S-08', agentId: 'AG-02', pattern: 8, productIds: ['DP-02', 'DP-06'], kpiIds: ['K-27', 'K-28'],
      question: 'How much total insured value sits in hurricane and wildfire zones, and what have catastrophes cost us this year?',
      paraphrases: ['total insured value in hurricane and wildfire zones', 'cat zone concentration and catastrophe costs this year', 'how much TIV is exposed to hurricanes and wildfires', 'catastrophe exposure by zone and catastrophe costs'],
      terms: [{ text: 'total insured value', termId: 'T-021' }, { text: 'catastrophes', termId: 'T-009' }],
      ruleIds: ['BR-017'],
      semantic: { view: 'SV_CLAIMS_EXPERIENCE', metrics: ['incurred_losses'], dimensions: ['cat.peril'], filters: ['claim.is_catastrophe', "loss_date BETWEEN '2026-01-01' AND '2026-09-30'"] },
      doc: { docId: 'DOC-01', chunk: 12 },
      run: ({ persona }) => {
        const c = Q.catExposure(d);
        const top = [...c.events].sort((a, b) => b.incurred - a.incurred)[0];
        return {
          summary: `${usdB(c.inZone)} of in-force property TIV (${fmtPct(c.pct)} of ${usdB(c.total)}) sits in hurricane and wildfire zones, inside the 40% accumulation limit in BR-017. Catastrophe events on the cat-code list have cost ${usdM(c.catLosses)} incurred this year across ${c.events.length} events, led by the ${top.name} (${usdM(top.incurred)}). The exposure figures come from Catastrophe Exposure, which is a Draft product.${rowNote(persona)}`,
          table: { columns: ['Cat zone', 'Policies', 'Total insured value', 'Share of TIV'], rows: c.zones.map((z) => [z.zone, fmtInt(z.policies), usdB(z.tiv), fmtPct((z.tiv / c.total) * 100)]) },
          chart: { kind: 'bar', labels: c.events.map((e) => e.name), values: c.events.map((e) => round(e.incurred / 1e6, 1)), unit: '$M' },
          sql: `SELECT cat_zone, COUNT(*) AS policies, SUM(total_insured_value) AS tiv  -- BR-017 limit 40%\n  FROM ${DB}.DATA_PRODUCTS.DP_CATASTROPHE_EXPOSURE  -- DRAFT, not certified\n WHERE is_in_force\n GROUP BY cat_zone;\n\nSELECT cat_code, SUM(incurred_loss) AS cat_losses\n  FROM ${DB}.DATA_PRODUCTS.DP_CLAIMS_EXPERIENCE\n WHERE cat_code IS NOT NULL AND loss_date >= '2026-01-01'\n GROUP BY cat_code;`,
          rows: c.zones.length + c.events.length, kpiValues: { 'K-27': Math.round(c.inZone), 'K-28': c.pct },
        };
      },
    },
    {
      id: 'S-09', agentId: 'AG-02', pattern: 9, productIds: ['DP-02', 'DP-03'], kpiIds: ['K-02'],
      question: 'Compare the combined ratio this year with last year',
      paraphrases: ['combined ratio this year vs last year', 'combined ratio year over year', 'how does the combined ratio compare to 2025'],
      terms: [{ text: 'combined ratio', termId: 'T-010' }],
      ruleIds: ['BR-006', 'BR-007'], instruction: 'Compare like-for-like periods (Jan–Sep); ratios to one decimal.',
      semantic: { view: 'SV_CLAIMS_EXPERIENCE', metrics: ['combined_ratio', 'lae_ratio', 'expense_ratio'], dimensions: ['date.fiscal_year'], filters: ['Jan–Sep of each year'] },
      doc: { docId: 'DOC-02', chunk: 11 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const cur = Q.combinedRatio(d, Q.PERIODS.ytd, allow);
        const prev = Q.combinedRatio(d, Q.PERIODS.priorYtd, allow);
        const delta = cur.combined - prev.combined;
        const row = (label: string, a: number, b: number) => [label, fmtPct(a), fmtPct(b), `${b - a >= 0 ? '+' : ''}${fmtNum(b - a, 1)} pts`];
        return {
          summary: `The combined ratio for January–September 2026 is ${fmtPct(cur.combined)}, compared with ${fmtPct(prev.combined)} for the same months of 2025 — ${delta < 0 ? 'an improvement' : 'a deterioration'} of ${fmtNum(Math.abs(delta), 1)} points${cur.combined < 100 ? ', and back below 100% (an underwriting profit)' : ''}. Lower catastrophe losses (${fmtNum(cur.catLr, 1)} vs ${fmtNum(prev.catLr, 1)} points) and a better ex-cat loss ratio drove the change.${rowNote(persona)}`,
          table: { columns: ['Component', '2025 YTD', '2026 YTD', 'Change'], rows: [
            row('Loss ratio ex-cat', prev.lrEx, cur.lrEx), row('Catastrophe points', prev.catLr, cur.catLr), row('LAE ratio', prev.laeRatio, cur.laeRatio),
            row('Expense ratio', prev.expenseRatio, cur.expenseRatio), row('Combined ratio', prev.combined, cur.combined),
          ] },
          chart: { kind: 'bar', labels: ['2025 YTD', '2026 YTD'], values: [prev.combined, cur.combined], unit: '%' },
          sql: `SELECT YEAR(loss_date) AS fiscal_year,\n       (SUM(incurred_loss) + SUM(lae_amount) + SUM(uw_expense)) / SUM(earned_premium) * 100 AS combined_ratio  -- BR-006\n  FROM ${DB}.SEMANTIC.SV_CLAIMS_EXPERIENCE  -- DP_CLAIMS_EXPERIENCE + DP_PREMIUM_BILLING\n WHERE MONTH(loss_date) <= 9 AND YEAR(loss_date) IN (2025, 2026)${regionWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: 5, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-02': cur.combined, 'K-09': cur.laeRatio, 'K-15': cur.expenseRatio },
        };
      },
    },
    {
      id: 'S-10', agentId: 'AG-03', pattern: 10, productIds: ['DP-04'], kpiIds: ['K-21'],
      question: 'What was our quote-to-bind ratio last quarter?',
      paraphrases: ['quote to bind ratio last quarter', 'q3 quote-to-bind ratio', 'how many quotes did we bind in Q3', 'bind rate last quarter'],
      terms: [{ text: 'quote-to-bind ratio', termId: 'T-017' }],
      ruleIds: ['BR-014'],
      semantic: { view: 'SV_DISTRIBUTION', metrics: ['quote_to_bind_ratio', 'submissions_quoted', 'policies_bound'], dimensions: [], filters: ["quote_quarter = '2026-Q3'"] },
      run: () => {
        const q3 = Q.quoteToBind(d, { from: '2026-07-01', to: Q.PERIODS.asOf });
        const trend = Q.quoteToBindByQuarter(d);
        const q2 = trend[trend.length - 2];
        return {
          summary: `${fmtPct(q3.ratio)} of submissions quoted in Q3 2026 were bound: ${fmtCompact(q3.scaledBound)} bound of ${fmtCompact(q3.scaledQuoted)} quoted, ${q3.ratio >= q2.ratio ? 'up' : 'down'} from ${fmtPct(q2.ratio)} in Q2. Quote-to-bind (term T-017) is bound ÷ quoted submissions by quote date; submissions declined before a quote are excluded (BR-014).`,
          table: { columns: ['Quarter', 'Quoted', 'Bound', 'Quote-to-bind'], rows: trend.map((t) => [t.quarter, fmtInt(t.scaledQuoted), fmtInt(t.scaledBound), fmtPct(t.ratio)]) },
          chart: { kind: 'bar', labels: trend.map((t) => t.quarter), values: trend.map((t) => t.ratio), unit: '%' },
          sql: `SELECT COUNT_IF(is_bound) / COUNT_IF(quote_date IS NOT NULL) * 100 AS quote_to_bind_ratio  -- BR-014\n  FROM ${DB}.DATA_PRODUCTS.DP_DISTRIBUTION_PERFORMANCE\n WHERE quote_date BETWEEN '2026-07-01' AND '2026-09-30';`,
          rows: 1, kpiValues: { 'K-21': q3.ratio },
        };
      },
    },
    {
      id: 'S-11', agentId: 'AG-03', pattern: 11, productIds: ['DP-04'], kpiIds: ['K-23'],
      question: 'Which agencies take longer than 3 days to quote?',
      paraphrases: ['agencies with quote turnaround over 3 days', 'slow agencies taking more than three days to quote', 'which agencies average more than 3 days to quote'],
      terms: [{ text: 'agencies', termId: 'T-022' }, { text: 'days to quote', termId: 'T-028' }],
      ruleIds: ['BR-016'],
      semantic: { view: 'SV_DISTRIBUTION', metrics: ['quote_turnaround_days', 'quote_to_bind_ratio'], dimensions: ['producer.agency_name', 'producer.channel'], filters: ['quote_turnaround_days > 3', "quote_date >= '2026-01-01'"] },
      doc: { docId: 'DOC-01', chunk: 27 },
      run: () => {
        const all = Q.agencyTurnaround(d);
        const slow = all.filter((a) => a.turnaround > 3);
        const overall = Q.quoteToBind(d, Q.PERIODS.ytd);
        return {
          summary: `${slow.length} of ${all.length} agencies averaged more than 3 days from submission to quote this year, against a book average of ${fmtNum(overall.turnaround, 1)} days. Under BR-016 they are flagged for a service review; the slowest is ${slow[0].agency} at ${fmtNum(slow[0].turnaround, 1)} days.`,
          table: { columns: ['Agency', 'Channel', 'Region', 'Avg days to quote', 'Quotes (sample)', 'Quote-to-bind'], rows: slow.map((a) => [a.agency, a.channel, a.region, fmtNum(a.turnaround, 1), a.quotes, fmtPct(a.bindRatio)]) },
          chart: { kind: 'bar', labels: slow.map((a) => a.agency.split(' ').slice(0, 2).join(' ')), values: slow.map((a) => a.turnaround), unit: 'days' },
          sql: `SELECT agency_name, channel, AVG(turnaround_days) AS quote_turnaround_days, COUNT(*) AS quotes\n  FROM ${DB}.DATA_PRODUCTS.DP_DISTRIBUTION_PERFORMANCE\n WHERE quote_date >= '2026-01-01'\n GROUP BY 1, 2\nHAVING quote_turnaround_days > 3  -- BR-016\n ORDER BY quote_turnaround_days DESC;`,
          rows: slow.length, kpiValues: { 'K-23': overall.turnaround }, explorerTarget: 'CONFORMED_GOLD.DIM_PRODUCER',
        };
      },
    },
    {
      id: 'S-12', agentId: 'AG-03', pattern: 12, productIds: ['DP-04'], kpiIds: ['K-22'],
      question: 'How much new business premium have we written this year?',
      paraphrases: ['new business premium this year', 'new business premium year to date by channel', 'how much new business did we write in 2026'],
      terms: [{ text: 'new business premium', termId: 'T-018' }],
      ruleIds: ['BR-015'],
      semantic: { view: 'SV_DISTRIBUTION', metrics: ['new_business_premium'], dimensions: ['producer.channel'], filters: ["submission_type = 'New business'", "bound_date >= '2026-01-01'"] },
      run: () => {
        const r = Q.newBusinessPremium(d);
        const top = [...r.rows].sort((a, b) => b.premium - a.premium)[0];
        return {
          summary: `Sentinel has bound ${usdM(r.total)} of new business premium this year on ${fmtCompact(r.policies)} new policies. New business premium (term T-018) excludes renewals, rewrites and reinstatements under BR-015, which removed ${usdM(r.excluded)} on ${fmtCompact(r.excludedCount)} bound submissions. ${top.channel}s wrote the most: ${usdM(top.premium)}.`,
          table: { columns: ['Channel', 'New business premium', 'New policies'], rows: r.rows.map((x) => [x.channel, usdM(x.premium), fmtInt(x.policies)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.channel), values: r.rows.map((x) => round(x.premium / 1e6, 1)), unit: '$M' },
          sql: `SELECT channel, SUM(bound_premium) AS new_business_premium\n  FROM ${DB}.DATA_PRODUCTS.DP_DISTRIBUTION_PERFORMANCE\n WHERE submission_type = 'New business'  -- BR-015: no rewrites or reinstatements\n   AND bound_date BETWEEN '2026-01-01' AND '2026-09-30'\n GROUP BY channel\n ORDER BY new_business_premium DESC;`,
          rows: r.rows.length, kpiValues: { 'K-22': Math.round(r.total) },
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
        return {
          summary: `${gaps.length} critical data element${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'has' : 'have'} no steward: ${gaps.map((t) => `${t.term} (${t.id}, owner ${t.owner})`).join(', ')}. It feeds the Draft product ${feeds(gaps[0]).map((x) => x.name).join(', ')}. Also note ${draft.length} Draft term: ${draft.map((t) => t.term).join(', ')}.`,
          table: { columns: ['Term', 'Id', 'Domain', 'Owner', 'Steward', 'Next action'], rows: gaps.map((t) => [t.term, t.id, t.domain, t.owner, '— none —', 'Assign a catastrophe-risk steward before DP-06 enters certification']) },
          sql: `SELECT t.term_id, t.term, t.domain, t.owner\n  FROM ${DB}.GLOSSARY.BUSINESS_TERM t\n  JOIN ${DB}.GLOSSARY.CDE_REGISTER c USING (term_id)\n WHERE t.is_cde AND c.steward IS NULL;`,
          rows: gaps.length, explorerTarget: 'GLOSSARY.CDE_REGISTER',
        };
      },
    },
    {
      id: 'S-14', agentId: 'AG-04', pattern: 14, productIds: [], kpiIds: [],
      question: 'Where is the term Loss Ratio used?',
      paraphrases: ['lineage of loss ratio', 'what uses the loss ratio definition', 'where does loss ratio appear'],
      terms: [{ text: 'Loss Ratio', termId: 'T-008' }],
      ruleIds: ['BR-005'],
      run: () => {
        const p = packRef();
        const t = p.glossary.find((x) => x.id === 'T-008') as GlossaryTerm;
        const metrics = t.metricRefs;
        const kpis = p.kpis.filter((k) => k.termId === t.id);
        const products = p.products.filter((pr) => pr.kpiIds.some((k) => kpis.some((x) => x.id === k)));
        const agents = p.agents.filter((a) => a.productIds.some((x) => products.some((pr) => pr.id === x)));
        const rules = p.context.rules.filter((r) => metrics.includes(r.metric));
        return {
          summary: `"Loss Ratio" (T-008) is mapped to ${t.mappings.length} columns, defines the metrics ${metrics.join(' and ')}, is enforced by rule${rules.length > 1 ? 's' : ''} ${rules.map((r) => r.id).join(' and ')}, backs KPI ${kpis.map((k) => `${k.id} ${k.name}`).join(', ')}, and flows into ${products.map((x) => `${x.name} (${x.id})`).join(', ')} and the ${agents.map((a) => a.name).join(' and ')} agents.`,
          table: { columns: ['Layer', 'Object', 'Usage'], rows: [
            ...t.mappings.map((m) => ['Column', `${m.fqn}.${m.column}`, m.kind]),
            ...metrics.map((m) => ['Semantic metric', m, 'defines']),
            ...rules.map((r) => ['Context rule', r.id, 'business rule']),
            ...kpis.map((k) => ['KPI', `${k.id} ${k.name}`, 'measured by']),
            ...products.map((x) => ['Data product', `${x.id} ${x.name}`, 'publishes']),
            ...agents.map((a) => ['Agent', a.objectName, 'answers with it']),
          ] },
          sql: `SELECT 'column' AS kind, object_fqn || '.' || column_name AS ref\n  FROM ${DB}.GLOSSARY.TERM_COLUMN_MAP WHERE term_id = 'T-008'\nUNION ALL\nSELECT 'rule', rule_id FROM ${DB}.CONTEXT.BUSINESS_RULES WHERE applies_to_metric ILIKE '%loss_ratio%'\nUNION ALL\nSELECT 'product', product_id FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY WHERE semantic_view = 'SV_CLAIMS_EXPERIENCE';`,
          rows: t.mappings.length + metrics.length + rules.length + kpis.length + products.length + agents.length, explorerTarget: 'GLOSSARY.TERM_COLUMN_MAP',
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
