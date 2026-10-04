// The 15 Ridgeline Bank agent scenarios (spec section 9). Every number is computed from the in-memory sample.
import type { GlossaryTerm, IndustryPack, Persona, Scenario } from '../../types';
import { round, sum } from '../../mock-snowflake/generators';
import { maskFor } from '../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import type { BankData } from './data';
import * as Q from './queries';

const DB = 'RLB_AI_PLATFORM';
const allowedRegions = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const rowNote = (p: Persona) => (allowedRegions(p) ? ` Row access policy limited results to the ${allowedRegions(p)!.join(' and ')} markets.` : '');
const regionWhere = (p: Persona) => (allowedRegions(p) ? `\n  -- RAP_REGION_ACCESS applied by Snowflake: REGION IN (${allowedRegions(p)!.map((o) => `'${o}'`).join(', ')})` : '');
const bn = (v: number) => `$${fmtNum(v / 1e9, 1)} B`;
const mn = (v: number) => `$${fmtNum(v / 1e6, 1)} M`;
const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });

type PackLike = Pick<IndustryPack, 'glossary' | 'products' | 'agents' | 'semanticViews' | 'certificationScript' | 'context'>;

export function buildScenarios(d: BankData, packRef: () => PackLike): Scenario[] {
  return [
    {
      id: 'S-01', agentId: 'AG-01', pattern: 1, productIds: ['DP-01'], kpiIds: ['K-04'],
      question: 'What was the average deposit balance per customer by region at the end of last quarter?',
      paraphrases: ['average deposit balance per customer by region', 'avg deposits per customer in each region at quarter end', 'deposit balance per customer by market last quarter'],
      terms: [{ text: 'deposit balance', termId: 'T-007' }, { text: 'region', termId: 'T-003' }],
      ruleIds: ['BR-003', 'BR-001'], instruction: 'Report averages to the dollar; name the month-end and say only active customers are counted.',
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['avg_deposit_balance'], dimensions: ['customer.region'], filters: ["month-end = '2026-09-30'", 'active customers (BR-001)'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.depositBalanceByRegion(d, allow);
        const top = [...r.rows].sort((a, b) => b.avgPerCustomer - a.avgPerCustomer)[0];
        return {
          summary: `At the 30 September 2026 month-end, active customers held an average of ${fmtUsd(r.overall, 0)} in deposits${allow ? ' across your markets' : ''}. ${top.region} was highest at ${fmtUsd(top.avgPerCustomer, 0)} per customer. Balances are month-end ledger balances (rule BR-003) and only active customers count (BR-001).${rowNote(persona)}`,
          table: { columns: ['Region', 'Active customers (sample)', 'Avg deposits per customer'], rows: r.rows.map((x) => [x.region, fmtInt(x.customers), fmtUsd(x.avgPerCustomer, 0)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.region), values: r.rows.map((x) => round(x.avgPerCustomer, 0)), unit: 'USD' },
          sql: `SELECT region, SUM(total_deposits) / COUNT(*) AS avg_deposit_balance\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360 -- via SV_CUSTOMER_360\n WHERE is_active  -- BR-001; balances at the 2026-09-30 month-end (BR-003)${regionWhere(persona)}\n GROUP BY region\n ORDER BY avg_deposit_balance DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-04': r.overall },
        };
      },
    },
    {
      id: 'S-02', agentId: 'AG-01', pattern: 2, productIds: ['DP-01'], kpiIds: ['K-01', 'K-02'],
      question: 'How many active customers do we have, and how many are digitally active?',
      paraphrases: ['how many active customers are digitally active', 'active customers using mobile or online banking', 'digital adoption among active customers', 'count of active customers and digital active rate'],
      terms: [{ text: 'active customers', termId: 'T-002' }, { text: 'digitally active', termId: 'T-005' }],
      ruleIds: ['BR-001', 'BR-002'], instruction: 'State which customers count as active and as digitally active.',
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['active_customers', 'digital_active_rate'], dimensions: [], filters: ['Active Customer rule BR-001', 'digital session in last 30 days (BR-002)'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.digitalAdoption(d, allow);
        const excluded = r.statusOnly - r.active;
        return {
          summary: `Ridgeline has ${fmtCompact(r.activeScaled)} active customers${allow ? ' in your markets' : ''}, and ${fmtCompact(r.digitalScaled)} of them (${fmtPct(r.pct)}) used mobile or online banking in the last 30 days. "Active" follows rule BR-001 — Active status, an open account and activity in the last 90 days — which excludes ${fmtCompact(excluded * d.scale)} Active-status customers with no recent activity or no open account.${rowNote(persona)}`,
          table: { columns: ['Group', 'Customers', 'Share of active'], rows: [['Digitally active (30 days)', fmtInt(r.digitalScaled), fmtPct(r.pct)], ['Branch / phone only', fmtInt(r.activeScaled - r.digitalScaled), fmtPct(100 - r.pct)], ['Active customers', fmtInt(r.activeScaled), '100.0%']] },
          chart: { kind: 'bar', labels: ['Digitally active', 'Branch / phone only'], values: [r.digitalScaled, r.activeScaled - r.digitalScaled], unit: 'customers' },
          sql: `SELECT COUNT_IF(is_active) AS active_customers,\n       COUNT_IF(is_active AND is_digital_active) AS digital_active,\n       digital_active / active_customers * 100 AS digital_active_rate  -- BR-002\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360  -- is_active per BR-001${regionWhere(persona)};`,
          rows: 1, rowFiltered: Boolean(allow), note: `Sample of ${fmtInt(r.active)} active customers scaled ×${fmtNum(d.scale, 0)} to the 3.2 M customer base.`,
          kpiValues: allow ? undefined : { 'K-01': r.activeScaled, 'K-02': r.pct, 'K-03': Q.productsPerCustomer(d), 'K-05': Q.attrition(d).pct },
        };
      },
    },
    {
      id: 'S-03', agentId: 'AG-01', pattern: 3, productIds: ['DP-01'], kpiIds: ['K-03'],
      question: 'Which customers hold more than $100,000 in deposits but have no loans with us?',
      paraphrases: ['customers with over 100,000 in deposits and no loans', 'deposit-only customers above $100k', 'list high-deposit customers without a loan'],
      terms: [{ text: 'deposits', termId: 'T-007' }, { text: 'customers', termId: 'T-001' }],
      ruleIds: ['BR-004'], instruction: 'Never reveal names unless the role may see unmasked PII; remind the user of fair-lending review for lending offers.',
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['avg_deposit_balance'], dimensions: ['customer.customer_id', 'customer.customer_name', 'customer.region'], filters: ['total_deposits > 100000', 'total_loans = 0', 'is_active'] },
      doc: { docId: 'DOC-03', chunk: 8 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const list = Q.depositOnlyHighBalance(d, 100_000, allow);
        const masked = !persona.unmasked.includes('PII');
        const shown = list.slice(0, 10);
        return {
          summary: `${list.length} active customers in the sample hold more than $100,000 in deposits and no loan (≈ ${fmtCompact(list.length * d.scale)} across the bank), with ${fmtUsd(sum(list.map((x) => x.h.deposits)), 0)} in deposits between them. The largest ${shown.length} are listed. Lending offers to this list need fair-lending review first (BR-004).${masked ? ' Names are masked by MP_MASK_PII for your role.' : ''}${rowNote(persona)}`,
          table: {
            columns: ['Customer ID', 'Name', 'Region', 'Segment', 'Home branch', 'Deposits'],
            rows: shown.map((x) => [x.c.id, String(maskFor(persona, 'PII', x.c.name)), x.c.region, x.c.segment, x.c.branchName, fmtUsd(x.h.deposits, 0)]),
            masked: masked ? [1] : [],
          },
          sql: `SELECT customer_id, customer_name, region, segment, home_branch, total_deposits\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360\n WHERE is_active\n   AND total_deposits > 100000\n   AND total_loans = 0   -- BR-004 deposit-only${regionWhere(persona)}\n ORDER BY total_deposits DESC\n LIMIT 10;`,
          rows: shown.length, maskedColumns: masked ? ['CUSTOMER_NAME'] : [], rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_CUSTOMER_360',
        };
      },
    },
    {
      id: 'S-04', agentId: 'AG-01', pattern: 4, productIds: ['DP-05'], kpiIds: ['K-23'],
      question: 'How many AML alerts were raised on our customers’ accounts this quarter, and how many were escalated to cases?',
      paraphrases: ['AML alerts on our customers this quarter', 'how many alerts were escalated to cases this quarter', 'aml alert volume and cases for my customers', 'alerts raised and escalated this quarter'],
      terms: [{ text: 'AML alerts', termId: 'T-021' }, { text: 'escalated to cases', termId: 'T-022' }],
      ruleIds: ['BR-014', 'BR-017'], instruction: 'Give counts and dispositions only; never disclose SAR decisions on a named customer.',
      semantic: { view: 'SV_AML_ALERTS', metrics: ['alerts_raised', 'alert_to_case_rate'], dimensions: ['date.alert_month'], filters: ["fiscal_quarter = '2026-Q3'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const q = Q.amlSummary(d, Q.PERIODS.q3, allow);
        const months = Q.amlByMonth(d, Q.PERIODS.quarter.months, allow);
        return {
          summary: `In Q3 2026 (Jul–Sep) transaction monitoring raised ${fmtInt(q.alertsScaled)} AML alerts on${allow ? ' your markets’' : ''} customer accounts (${q.alerts} in the sample). ${q.dispositioned} of the sample alerts have been dispositioned and ${q.cases} were escalated to cases — an alert-to-case rate of ${fmtPct(q.alertToCase)}; ${q.open} are still open and excluded from the rate (BR-014).${rowNote(persona)}`,
          table: { columns: ['Month', 'Alerts (scaled)', 'Dispositioned', 'Escalated to case', 'Alert-to-case rate'], rows: months.map((m) => [m.month, fmtInt(m.alertsScaled), m.dispositioned, m.cases, fmtPct(m.alertToCase)]) },
          chart: { kind: 'bar', labels: months.map((m) => monthName(m.month)), values: months.map((m) => m.alertsScaled), unit: 'alerts' },
          sql: `SELECT DATE_TRUNC('month', alert_date) AS alert_month,\n       COUNT(*) AS alerts_raised,\n       COUNT_IF(is_escalated) AS cases,\n       COUNT_IF(is_escalated) / NULLIF(COUNT_IF(disposition <> 'Open'), 0) * 100 AS alert_to_case_rate  -- BR-014\n  FROM ${DB}.DATA_PRODUCTS.DP_AML_ALERTS\n WHERE alert_date BETWEEN '2026-07-01' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: months.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-23': q.alertsScaled },
        };
      },
    },
    {
      id: 'S-05', agentId: 'AG-01', pattern: 5, productIds: ['DP-04'], kpiIds: ['K-19'],
      question: 'Show daily card spending over the last 30 days',
      paraphrases: ['daily card spend for the past 30 days', 'card purchase volume by day last 30 days', 'trend of card spending this month'],
      terms: [{ text: 'card spending', termId: 'T-031' }],
      ruleIds: ['BR-013'],
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['card_purchase_volume', 'avg_ticket'], dimensions: ['date.calendar_date'], filters: ["calendar_date BETWEEN '2026-09-01' AND '2026-09-30'", 'is_approved'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const days = Q.cardDaily(d, Q.PERIODS.last30, allow);
        const m = Q.cardMetrics(d, Q.PERIODS.last30, allow);
        const peak = days.reduce((a, b) => (b.spend > a.spend ? b : a));
        const total = sum(days.map((x) => x.spend));
        return {
          summary: `Over the last 30 days (1–30 Sep 2026) approved card spending totalled ${mn(total)}${allow ? ' for your markets' : ''}, an average of ${mn(total / days.length)} a day. The peak was ${peak.day} at ${mn(peak.spend)}; weekends run higher. The average ticket was ${fmtUsd(m.avgTicket)}.${rowNote(persona)}`,
          table: { columns: ['Date', 'Approved spend', 'Transactions (sample)'], rows: days.slice(-10).map((x) => [x.day, mn(x.spend), fmtInt(x.txns)]) },
          chart: { kind: 'line', labels: days.map((x) => x.day.slice(5)), values: days.map((x) => round(x.spend / 1e6, 2)), unit: '$M' },
          sql: `SELECT transaction_date, SUM(amount_usd) AS card_purchase_volume, COUNT(*) AS transactions\n  FROM ${DB}.DATA_PRODUCTS.DP_CARD_TRANSACTIONS\n WHERE transaction_date BETWEEN '2026-09-01' AND '2026-09-30'\n   AND is_approved${regionWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: days.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-22': m.avgTicket },
        };
      },
    },
    {
      id: 'S-06', agentId: 'AG-02', pattern: 6, productIds: ['DP-03'], kpiIds: ['K-14'],
      question: 'What is our NPL ratio by loan segment, and how has it trended this year?',
      paraphrases: ['npl ratio by loan segment this year', 'non-performing loan ratio by segment and trend', 'how has the NPL ratio trended in 2026', 'NPL ratio trend by loan type'],
      terms: [{ text: 'NPL ratio', termId: 'T-013' }, { text: 'loan segment', termId: 'T-030' }, { text: 'non-performing', termId: 'T-012' }],
      ruleIds: ['BR-007', 'BR-008'], instruction: 'Report ratios to two decimals; define non-performing as 90+ days past due or on non-accrual.',
      semantic: { view: 'SV_LOAN_PORTFOLIO', metrics: ['npl_ratio'], dimensions: ['loan.loan_segment', 'date.snapshot_month'], filters: ["snapshot_month BETWEEN '2026-01' AND '2026-09'", 'non-performing = DPD ≥ 90 OR non_accrual'] },
      doc: { docId: 'DOC-01', chunk: 7 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const sep = Q.loanPortfolio(d, '2026-09', allow);
        const jan = Q.loanPortfolio(d, '2026-01', allow);
        const segSep = Q.nplBySegment(d, '2026-09', allow);
        const segJan = Q.nplBySegment(d, '2026-01', allow);
        const trend = Q.nplTrend(d, allow);
        const worst = [...segSep].sort((a, b) => b.nplRatio - a.nplRatio)[0];
        return {
          summary: `The NPL ratio was ${fmtPct(sep.nplRatio, 2)} at the 30 September 2026 month-end${allow ? ' for your markets' : ''}, up from ${fmtPct(jan.nplRatio, 2)} in January: ${bn(sep.npl)} of ${bn(sep.total)} in loans is non-performing. ${worst.segment} is highest at ${fmtPct(worst.nplRatio, 2)}. Non-performing means 90+ days past due or on non-accrual (rule BR-007); counting 90+ days past due alone would show only ${fmtPct(sep.dpd90Ratio, 2)}.${rowNote(persona)}`,
          table: { columns: ['Loan segment', 'NPL ratio Jan 2026', 'NPL ratio Sep 2026', 'Change (pp)', 'NPL balance', 'Loans outstanding'], rows: segSep.map((s, i) => [s.segment, fmtPct(segJan[i].nplRatio, 2), fmtPct(s.nplRatio, 2), fmtNum(s.nplRatio - segJan[i].nplRatio, 2), bn(s.npl), bn(s.total)]) },
          chart: { kind: 'line', labels: trend.map((t) => monthName(t.month)), values: trend.map((t) => t.nplRatio), unit: '%' },
          sql: `SELECT loan_segment, DATE_TRUNC('month', snapshot_date) AS snapshot_month,\n       SUM(IFF(days_past_due >= 90 OR non_accrual_flag, principal_balance, 0))  -- BR-007\n         / SUM(principal_balance) * 100 AS npl_ratio                             -- BR-008\n  FROM ${DB}.DATA_PRODUCTS.DP_LOAN_PORTFOLIO\n WHERE snapshot_date BETWEEN '2026-01-31' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY 1, 2\n ORDER BY 1, 2;`,
          rows: segSep.length * trend.length, rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_LOAN_PORTFOLIO',
          kpiValues: allow ? undefined : { 'K-14': sep.nplRatio, 'K-13': Math.round(sep.total), 'K-15': sep.dpd30Ratio, 'K-17': sep.coverage, 'K-18': sep.yield, 'K-16': Q.ncoRatio(d).pct },
        };
      },
    },
    {
      id: 'S-07', agentId: 'AG-02', pattern: 7, productIds: ['DP-02'], kpiIds: ['K-06'],
      question: 'Which 5 branches had the largest deposit outflows last quarter?',
      paraphrases: ['top 5 branches by deposit outflows', 'branches losing the most deposits in Q3', 'largest branch deposit declines last quarter'],
      terms: [{ text: 'deposit', termId: 'T-007' }],
      ruleIds: ['BR-006'],
      semantic: { view: 'SV_DEPOSITS_LIQUIDITY', metrics: ['total_deposits'], dimensions: ['branch.branch_name', 'branch.region'], filters: ["month_end IN ('2026-06-30', '2026-09-30')"] },
      doc: { docId: 'DOC-04', chunk: 13 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const all = Q.branchDepositChange(d, '2026-06', '2026-09', allow);
        const top = all.filter((x) => x.change < 0).slice(0, 5);
        const g = Q.depositGrowth(d, allow);
        const over3 = top.filter((x) => x.pct <= -3).length;
        return {
          summary: `Between the 30 June and 30 September 2026 month-ends, ${top[0].branch} (${top[0].region}) lost the most deposits: ${mn(-top[0].change)} (${fmtPct(top[0].pct)}). The five largest outflows total ${mn(-sum(top.map((x) => x.change)))}; ${over3} of them exceed the 3% escalation threshold in the ALM policy. Bank-wide deposits still grew ${fmtPct(g.ytdPct, 2)} year to date to ${bn(g.sep)}.${rowNote(persona)}`,
          table: { columns: ['Branch', 'Region', 'Deposits 30 Jun', 'Deposits 30 Sep', 'Change', 'Change %'], rows: top.map((x) => [x.branch, x.region, mn(x.start), mn(x.end), mn(x.change), fmtPct(x.pct)]) },
          chart: { kind: 'bar', labels: top.map((x) => x.branch), values: top.map((x) => round(x.change / 1e6, 1)), unit: '$M' },
          sql: `SELECT branch_name, region,\n       SUM(IFF(month_end = '2026-06-30', balance_usd, 0)) AS deposits_jun,\n       SUM(IFF(month_end = '2026-09-30', balance_usd, 0)) AS deposits_sep,\n       deposits_sep - deposits_jun AS change  -- BR-006\n  FROM ${DB}.DATA_PRODUCTS.DP_DEPOSITS_LIQUIDITY${regionWhere(persona)}\n GROUP BY 1, 2\n ORDER BY change ASC\n LIMIT 5;`,
          rows: top.length, rowFiltered: Boolean(allow), explorerTarget: 'CONFORMED_GOLD.DIM_BRANCH',
          kpiValues: allow ? undefined : { 'K-06': Math.round(g.sep), 'K-07': g.ytdPct },
        };
      },
    },
    {
      id: 'S-08', agentId: 'AG-02', pattern: 8, productIds: ['DP-03', 'DP-06'], kpiIds: ['K-27', 'K-28'],
      question: 'Which customer segments are most profitable after expected credit losses?',
      paraphrases: ['most profitable customer segments', 'customer profitability by segment', 'net contribution per customer by segment', 'which segments are unprofitable'],
      terms: [{ text: 'profitable', termId: 'T-025' }, { text: 'expected credit losses', termId: 'T-016' }, { text: 'customer segments', termId: 'T-004' }],
      ruleIds: ['BR-016'], instruction: 'Flag that Customer Profitability is a Draft product; never segment by a prohibited basis.',
      semantic: { view: 'SV_LOAN_PORTFOLIO', metrics: ['allowance_coverage_ratio'], dimensions: ['customer.segment'], filters: ['trailing 12 months (Oct 2025 – Sep 2026)'] },
      doc: { docId: 'DOC-03', chunk: 14 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.profitabilityBySegment(d, allow);
        const ranked = [...r.segs].sort((a, b) => b.avgNet - a.avgNet);
        return {
          summary: `After funds transfer pricing, cost to serve and expected credit losses, ${ranked[0].segment} customers contribute the most — ${fmtUsd(ranked[0].avgNet, 0)} each over the last 12 months — and ${ranked[ranked.length - 1].segment} the least at ${fmtUsd(ranked[ranked.length - 1].avgNet, 0)}. Across all open customers the average is ${fmtUsd(r.avgNet, 0)}, and ${fmtPct(r.unprofitablePct)} are unprofitable. These figures come from Customer Profitability, a Draft product whose cost-to-serve allocation is still under review.${rowNote(persona)}`,
          table: { columns: ['Segment', 'Customers (sample)', 'Avg net contribution (12m)', 'Unprofitable', 'Expected credit loss (scaled)'], rows: ranked.map((s) => [s.segment, fmtInt(s.customers), fmtUsd(s.avgNet, 0), fmtPct(s.unprofitablePct), fmtCompact(s.ecl, 'USD')]) },
          chart: { kind: 'bar', labels: ranked.map((s) => s.segment), values: ranked.map((s) => s.avgNet), unit: 'USD' },
          sql: `SELECT segment, AVG(net_contribution_12m) AS avg_net_contribution,\n       AVG(IFF(is_unprofitable, 1, 0)) * 100 AS unprofitable_pct,\n       SUM(expected_credit_loss) AS expected_credit_loss  -- ECL from DP_LOAN_PORTFOLIO allowance\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_PROFITABILITY  -- DRAFT, not certified; BR-016${regionWhere(persona)}\n GROUP BY segment\n ORDER BY avg_net_contribution DESC;`,
          rows: ranked.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-27': r.avgNet, 'K-28': r.unprofitablePct },
        };
      },
    },
    {
      id: 'S-09', agentId: 'AG-02', pattern: 9, productIds: ['DP-02'], kpiIds: ['K-11'],
      question: 'Compare net interest margin this quarter with the same quarter last year',
      paraphrases: ['nim this quarter vs same quarter last year', 'net interest margin Q3 2026 versus Q3 2025', 'how has our net interest margin changed year over year'],
      terms: [{ text: 'net interest margin', termId: 'T-011' }],
      ruleIds: ['BR-010'], instruction: 'Compare like-for-like quarters; ratios to two decimals.',
      semantic: { view: 'SV_DEPOSITS_LIQUIDITY', metrics: ['net_interest_margin', 'cost_of_deposits'], dimensions: ['date.fiscal_quarter', 'branch.region'], filters: ["fiscal_quarter IN ('2025-Q3', '2026-Q3')"] },
      doc: { docId: 'DOC-04', chunk: 5 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.nimComparison(d, allow);
        const chg = (r.cur.nim - r.prev.nim) * 100;
        return {
          summary: `Net interest margin was ${fmtPct(r.cur.nim, 2)} in Q3 2026, compared with ${fmtPct(r.prev.nim, 2)} in Q3 2025 — ${chg >= 0 ? 'up' : 'down'} ${fmtInt(Math.abs(chg))} basis points. Lower deposit costs drove most of it: cost of deposits fell from ${fmtPct(r.costPrev, 2)} to ${fmtPct(r.costCur, 2)}. Net interest income was ${bn(r.cur.nii)} for the quarter, and the cost-to-income ratio was ${fmtPct(r.cur.efficiency)}.${rowNote(persona)}`,
          table: { columns: ['Region', 'NIM Q3 2025', 'NIM Q3 2026', 'Change (bps)', 'Cost-to-income Q3 2026'], rows: r.rows.map((x) => [x.region, fmtPct(x.prev.nim, 2), fmtPct(x.cur.nim, 2), fmtInt((x.cur.nim - x.prev.nim) * 100), fmtPct(x.cur.efficiency)]) },
          chart: { kind: 'bar', labels: ['Q3 2025', 'Q3 2026'], values: [r.prev.nim, r.cur.nim], unit: '%' },
          sql: `SELECT d.fiscal_quarter, g.region,\n       (SUM(IFF(g.gl_account IN ('4100','4200','4300'), g.amount_usd, 0))\n        - SUM(IFF(g.gl_account IN ('5100','5200'), g.amount_usd, 0))) * 4\n       / (SUM(IFF(g.gl_account IN ('1000','1100','1200'), g.amount_usd, 0)) / 3) * 100 AS net_interest_margin  -- BR-010\n  FROM ${DB}.CONFORMED_GOLD.FCT_GL_MONTHLY g\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE d USING (date_key)\n WHERE d.fiscal_quarter IN ('2025-Q3', '2026-Q3')${regionWhere(persona)}\n GROUP BY 1, 2 ORDER BY 2, 1;`,
          rows: r.rows.length * 2, rowFiltered: Boolean(allow),
          kpiValues: allow ? undefined : { 'K-11': r.cur.nim, 'K-12': r.cur.efficiency, 'K-08': r.cur.ldr, 'K-09': Q.costOfDeposits(d), 'K-10': Q.lcr(d) },
        };
      },
    },
    {
      id: 'S-10', agentId: 'AG-03', pattern: 10, productIds: ['DP-04'], kpiIds: ['K-20'],
      question: 'What is our card fraud loss rate in basis points this quarter?',
      paraphrases: ['card fraud loss bps this quarter', 'fraud losses in basis points for Q3', 'how much did we lose to card fraud this quarter'],
      terms: [{ text: 'card fraud loss', termId: 'T-019' }],
      ruleIds: ['BR-013'],
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['card_fraud_loss_bps', 'card_purchase_volume'], dimensions: [], filters: ["calendar_date BETWEEN '2026-07-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const m = Q.cardMetrics(d, Q.PERIODS.q3, allow);
        return {
          summary: `Card fraud losses were ${fmtNum(m.fraudBps, 1)} basis points of approved purchase volume in Q3 2026: ${mn(m.fraudLossScaled)} lost on ${bn(m.volumeScaled)} of approved spend. Card fraud loss is confirmed fraud net of chargeback recoveries over approved volume × 10,000 (BR-013); declined fraud attempts carry no loss. The authorisation approval rate was ${fmtPct(m.approvalRate)}.${rowNote(persona)}`,
          table: { columns: ['Measure', 'Q3 2026'], rows: [['Approved purchase volume', bn(m.volumeScaled)], ['Fraud losses (net)', mn(m.fraudLossScaled)], ['Card fraud loss', `${fmtNum(m.fraudBps, 1)} bps`], ['Approval rate', fmtPct(m.approvalRate)], ['Confirmed fraud transactions (sample)', fmtInt(m.fraudCount)]] },
          chart: { kind: 'bar', labels: ['Approved volume ($M)', 'Fraud loss ($M)'], values: [round(m.volumeScaled / 1e6, 1), round(m.fraudLossScaled / 1e6, 2)], unit: '$M' },
          sql: `SELECT SUM(fraud_loss_usd) / SUM(IFF(is_approved, amount_usd, 0)) * 10000 AS card_fraud_loss_bps  -- BR-013\n  FROM ${DB}.DATA_PRODUCTS.DP_CARD_TRANSACTIONS\n WHERE transaction_date BETWEEN '2026-07-01' AND '2026-09-30'${regionWhere(persona)};`,
          rows: 1, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-20': m.fraudBps, 'K-19': Math.round(m.volumeScaled), 'K-21': m.approvalRate },
        };
      },
    },
    {
      id: 'S-11', agentId: 'AG-03', pattern: 11, productIds: ['DP-04'], kpiIds: ['K-21'],
      question: 'Which merchant categories have fraud losses above 10 basis points this quarter?',
      paraphrases: ['merchant categories with fraud above 10 bps', 'which merchant categories exceed 10 basis points of fraud', 'high fraud merchant categories this quarter'],
      terms: [{ text: 'fraud losses', termId: 'T-019' }],
      ruleIds: ['BR-013'],
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['card_fraud_loss_bps'], dimensions: ['card.merchant_category'], filters: ['card_fraud_loss_bps > 10', "calendar_date >= '2026-07-01'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const all = Q.fraudByCategory(d, Q.PERIODS.q3, allow);
        const above = all.filter((x) => x.bps > 10);
        return {
          summary: `${above.length} merchant categories ran above 10 basis points of fraud loss in Q3 2026: ${above.map((x) => `${x.category} (${fmtNum(x.bps, 1)} bps)`).join(', ')}. Together they account for ${fmtPct((sum(above.map((x) => x.loss)) / Math.max(1, sum(all.map((x) => x.loss)))) * 100, 0)} of fraud losses on ${fmtPct((sum(above.map((x) => x.volume)) / sum(all.map((x) => x.volume))) * 100, 0)} of volume.${rowNote(persona)}`,
          table: { columns: ['Merchant category', 'Fraud loss (bps)', 'Fraud losses', 'Approved volume', 'Fraud transactions (sample)'], rows: above.map((x) => [x.category, fmtNum(x.bps, 1), fmtCompact(x.loss, 'USD'), fmtCompact(x.volume, 'USD'), x.frauds]) },
          chart: { kind: 'bar', labels: all.map((x) => x.category), values: all.map((x) => x.bps), unit: 'bps' },
          sql: `SELECT merchant_category,\n       SUM(fraud_loss_usd) / SUM(IFF(is_approved, amount_usd, 0)) * 10000 AS fraud_loss_bps\n  FROM ${DB}.DATA_PRODUCTS.DP_CARD_TRANSACTIONS\n WHERE transaction_date BETWEEN '2026-07-01' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY merchant_category\nHAVING fraud_loss_bps > 10\n ORDER BY fraud_loss_bps DESC;`,
          rows: above.length, rowFiltered: Boolean(allow), explorerTarget: 'CONFORMED_GOLD.FCT_CARD_TRANSACTION',
        };
      },
    },
    {
      id: 'S-12', agentId: 'AG-03', pattern: 12, productIds: ['DP-05'], kpiIds: ['K-24'],
      question: 'What is our AML alert-to-case rate this year?',
      paraphrases: ['alert to case rate year to date', 'what share of AML alerts became cases this year', 'escalation rate for aml alerts in 2026'],
      terms: [{ text: 'alert-to-case rate', termId: 'T-022' }, { text: 'AML', termId: 'T-021' }],
      ruleIds: ['BR-014', 'BR-015'], instruction: 'Say that open alerts are excluded; rates to one decimal.',
      semantic: { view: 'SV_AML_ALERTS', metrics: ['alert_to_case_rate', 'sar_conversion_rate'], dimensions: ['alert.scenario'], filters: ["alert_date BETWEEN '2026-01-01' AND '2026-09-30'"] },
      doc: { docId: 'DOC-02', chunk: 6 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const y = Q.amlSummary(d, Q.PERIODS.ytd, allow);
        const by = Q.amlByScenario(d, Q.PERIODS.ytd, allow);
        return {
          summary: `Year to date (1 Jan – 30 Sep 2026) the AML alert-to-case rate is ${fmtPct(y.alertToCase)}: ${y.cases} of ${y.dispositioned} dispositioned alerts in the sample were escalated to a case. Under the glossary definition (T-022) the ${y.open} alerts still open are excluded from the denominator. ${fmtPct(y.sarConversion)} of closed cases led to a SAR, and alerts took ${fmtNum(y.avgDays, 1)} days on average to disposition.${rowNote(persona)}`,
          table: { columns: ['Scenario', 'Alerts (sample)', 'Dispositioned', 'Cases', 'Alert-to-case rate'], rows: by.map((s) => [s.scenario, s.alerts, s.dispositioned, s.cases, fmtPct(s.rate)]) },
          chart: { kind: 'bar', labels: by.map((s) => s.scenario), values: by.map((s) => s.rate), unit: '%' },
          sql: `SELECT scenario,\n       COUNT_IF(is_escalated) / NULLIF(COUNT_IF(disposition <> 'Open'), 0) * 100 AS alert_to_case_rate  -- T-022, BR-014\n  FROM ${DB}.DATA_PRODUCTS.DP_AML_ALERTS\n WHERE alert_date BETWEEN '2026-01-01' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY scenario\n ORDER BY alert_to_case_rate DESC;`,
          rows: by.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-24': y.alertToCase, 'K-25': y.sarConversion, 'K-26': y.avgDays },
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
        const feeds = (t: GlossaryTerm) => p.products.filter((pr) => t.mappings.some((m) => m.fqn === `DATA_PRODUCTS.${pr.outputPort}`));
        return {
          summary: `${gaps.length} critical data element${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'has' : 'have'} no steward: ${gaps.map((t) => `${t.term} (${t.id}, owner ${t.owner})`).join(', ')}. It feeds the Draft product ${gaps.flatMap(feeds).map((x) => `${x.name} (${x.id})`).join(', ')}. Also note ${draft.length} Draft term: ${draft.map((t) => t.term).join(', ')}.`,
          table: { columns: ['Term', 'Id', 'Domain', 'Owner', 'Steward', 'Next action'], rows: gaps.map((t) => [t.term, t.id, t.domain, t.owner, '— none —', 'Assign a Finance steward before DP-06 enters certification']) },
          sql: `SELECT t.term_id, t.term, t.domain, t.owner\n  FROM ${DB}.GLOSSARY.BUSINESS_TERM t\n  JOIN ${DB}.GLOSSARY.CDE_REGISTER c USING (term_id)\n WHERE t.is_cde AND c.steward IS NULL;`,
          rows: gaps.length, explorerTarget: 'GLOSSARY.CDE_REGISTER',
        };
      },
    },
    {
      id: 'S-14', agentId: 'AG-04', pattern: 14, productIds: [], kpiIds: [],
      question: 'Where is the term Non-Performing Loan used?',
      paraphrases: ['lineage of non-performing loan', 'what uses the non-performing loan definition', 'where does the NPL term appear'],
      terms: [{ text: 'Non-Performing Loan', termId: 'T-012' }],
      ruleIds: ['BR-007'],
      run: () => {
        const p = packRef();
        const t = p.glossary.find((x) => x.id === 'T-012') as GlossaryTerm;
        const ratio = p.glossary.find((x) => x.id === 'T-013') as GlossaryTerm;
        const metrics = [...t.metricRefs, ...ratio.metricRefs];
        const products = p.products.filter((pr) => pr.semanticView && metrics.some((m) => m.startsWith(`${pr.semanticView}.`)));
        const agents = p.agents.filter((a) => a.productIds.some((x) => products.some((pr) => pr.id === x)));
        const rules = p.context.rules.filter((r) => /non-performing/i.test(r.text));
        return {
          summary: `"Non-Performing Loan" (T-012) is mapped to ${t.mappings.length} columns, feeds the metrics ${metrics.join(' and ')}, is enforced by rule${rules.length > 1 ? 's' : ''} ${rules.map((r) => r.id).join(' and ')}, and flows into ${products.map((x) => `${x.name} (${x.id})`).join(', ')} and the ${agents.map((a) => a.name).join(', ')} agent.`,
          table: { columns: ['Layer', 'Object', 'Usage'], rows: [
            ...t.mappings.map((m) => ['Column', `${m.fqn}.${m.column}`, m.kind]),
            ...metrics.map((m) => ['Semantic metric', m, 'defines']),
            ...rules.map((r) => ['Context rule', r.id, 'business rule']),
            ...products.map((x) => ['Data product', `${x.id} ${x.name}`, 'KPI K-14']),
            ...agents.map((a) => ['Agent', a.objectName, 'answers with it']),
          ] },
          sql: `SELECT 'column' AS kind, object_fqn || '.' || column_name AS ref\n  FROM ${DB}.GLOSSARY.TERM_COLUMN_MAP WHERE term_id IN ('T-012', 'T-013')\nUNION ALL\nSELECT 'rule', rule_id FROM ${DB}.CONTEXT.BUSINESS_RULES WHERE rule_text ILIKE '%non-performing%'\nUNION ALL\nSELECT 'product', product_id FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY WHERE semantic_view = 'SV_LOAN_PORTFOLIO';`,
          rows: t.mappings.length + metrics.length + rules.length + products.length + agents.length, explorerTarget: 'GLOSSARY.TERM_COLUMN_MAP',
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
