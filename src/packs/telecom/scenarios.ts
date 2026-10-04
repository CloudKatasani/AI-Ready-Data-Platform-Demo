// The 15 Telecom agent scenarios (spec section 9). Every number is computed from the in-memory sample.
import type { GlossaryTerm, IndustryPack, Persona, Scenario } from '../../types';
import { round, sum } from '../../mock-snowflake/generators';
import { maskFor } from '../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import type { TelData } from './data';
import { PLANS, REGIONS } from './generators.config';
import * as Q from './queries';

const DB = 'ALT_AI_PLATFORM';
const allowedRegions = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const rowNote = (p: Persona) => (allowedRegions(p) ? ` Row access policy limited results to the ${allowedRegions(p)!.join(' and ')} regions.` : '');
const regionWhere = (p: Persona, col = 'region') => (allowedRegions(p) ? `\n  -- RAP_REGION_ACCESS applied by Snowflake: ${col} IN (${allowedRegions(p)!.map((o) => `'${o}'`).join(', ')})` : '');

type PackLike = Pick<IndustryPack, 'glossary' | 'products' | 'agents' | 'semanticViews' | 'certificationScript' | 'context'>;

export function buildScenarios(d: TelData, packRef: () => PackLike): Scenario[] {
  return [
    {
      id: 'S-01', agentId: 'AG-01', pattern: 1, productIds: ['DP-01'], kpiIds: ['K-02'],
      question: 'What was postpaid ARPU last quarter by region?',
      paraphrases: ['postpaid ARPU by region last quarter', 'average revenue per user by region in Q3', 'ARPU per region for postpaid last quarter'],
      terms: [{ text: 'ARPU', termId: 'T-009' }, { text: 'region', termId: 'T-003' }],
      ruleIds: ['BR-002', 'BR-003'], instruction: 'Report ARPU to the cent; name the period and the subscriber group.',
      semantic: { view: 'SV_SUBSCRIBER_360', metrics: ['postpaid_arpu'], dimensions: ['subscriber.region'], filters: ["plan.segment = 'Postpaid'", 'invoice_month in Q3 2026'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.arpuByRegion(d, Q.PERIODS.quarter.months, allow);
        const top = [...r.rows].sort((a, b) => b.arpu - a.arpu)[0];
        return {
          summary: `Postpaid ARPU in Q3 2026 (Jul–Sep) was ${fmtUsd(r.overall)} per subscriber per month. ${top.region} was highest at ${fmtUsd(top.arpu)}. ARPU is service revenue only: device installments are excluded, roaming and overage included (BR-002).${rowNote(persona)}`,
          table: { columns: ['Region', 'Postpaid ARPU', 'Invoices (sample)', 'Service revenue (scaled)'], rows: r.rows.map((x) => [x.region, fmtUsd(x.arpu), fmtInt(x.invoices), fmtCompact(x.revenue * d.scale, 'USD')]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.region), values: r.rows.map((x) => x.arpu), unit: 'USD' },
          sql: `SELECT subscriber.region, SUM(billing.service_revenue) / COUNT(*) AS postpaid_arpu\n  FROM ${DB}.DATA_PRODUCTS.DP_SUBSCRIBER_360 -- via SV_SUBSCRIBER_360\n WHERE plan.segment = 'Postpaid'\n   AND billing.invoice_month BETWEEN '2026-07-01' AND '2026-09-01'${regionWhere(persona)}\n GROUP BY subscriber.region\n ORDER BY postpaid_arpu DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-02': r.overall },
        };
      },
    },
    {
      id: 'S-02', agentId: 'AG-01', pattern: 2, productIds: ['DP-01'], kpiIds: ['K-01', 'K-05'],
      question: 'How many active subscribers are enrolled in autopay?',
      paraphrases: ['active subscribers on autopay', 'how many active lines use automatic payment', 'autopay enrolment among active subscribers', 'autopay adoption of active subscribers'],
      terms: [{ text: 'active subscribers', termId: 'T-002' }, { text: 'autopay', termId: 'T-027' }],
      ruleIds: ['BR-001'], instruction: 'State which subscribers count as active.',
      semantic: { view: 'SV_SUBSCRIBER_360', metrics: ['active_subscribers', 'autopay_rate'], dimensions: ['subscriber.autopay'], filters: ['Active Subscriber rule BR-001'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const act = Q.activeSubscribers(d, allow);
        const ap = act.filter((s) => s.autopay);
        const statusOnly = d.subscribers.filter((s) => s.status === 'Active' && (!allow || allow.includes(s.region))).length;
        const mobile = Q.activeMobile(d, allow);
        const pct = round((ap.length / act.length) * 100, 1);
        return {
          summary: `${fmtCompact(ap.length * d.scale)} active subscribers are enrolled in autopay — ${fmtPct(pct)} of ${fmtCompact(act.length * d.scale)} active subscribers (${fmtCompact(mobile.scaled)} mobile lines and ${fmtCompact((act.length - mobile.sample) * d.scale)} broadband homes). "Active" follows rule BR-001: Active status and an invoice in September 2026, which excludes ${fmtInt((statusOnly - act.length) * d.scale)} Active-status lines with no invoice (mostly dormant prepaid).${rowNote(persona)}`,
          table: { columns: ['Group', 'Subscribers', 'Share'], rows: [['Autopay', fmtInt(ap.length * d.scale), fmtPct(pct)], ['No autopay', fmtInt((act.length - ap.length) * d.scale), fmtPct(100 - pct)], ['Active subscribers', fmtInt(act.length * d.scale), '100.0%']] },
          chart: { kind: 'bar', labels: ['Autopay', 'No autopay'], values: [Math.round(ap.length * d.scale), Math.round((act.length - ap.length) * d.scale)], unit: 'subscribers' },
          sql: `SELECT autopay, COUNT(DISTINCT subscriber_id) AS active_subscribers\n  FROM ${DB}.DATA_PRODUCTS.DP_SUBSCRIBER_360\n WHERE is_active  -- BR-001: status = 'Active' AND invoiced in the latest closed month${regionWhere(persona)}\n GROUP BY 1;`,
          rows: 2, rowFiltered: Boolean(allow), note: `Sample of ${fmtInt(act.length)} active subscribers scaled ×${fmtNum(d.scale, 0)} to the 11.9 M base.`,
          kpiValues: allow ? undefined : { 'K-01': mobile.scaled, 'K-05': pct },
        };
      },
    },
    {
      id: 'S-03', agentId: 'AG-01', pattern: 3, productIds: ['DP-01'], kpiIds: [],
      question: 'Which postpaid subscribers are out of contract with a churn propensity above 70?',
      paraphrases: ['list out of contract postpaid subscribers with high churn propensity', 'postpaid subscribers out of contract with churn propensity over 70', 'high churn propensity subscribers who are out of contract'],
      terms: [{ text: 'postpaid subscribers', termId: 'T-001' }, { text: 'churn propensity', termId: 'T-020' }],
      ruleIds: ['BR-006', 'BR-007'], instruction: 'Never reveal PII or CPNI unless the role may see it.',
      semantic: { view: 'SV_SUBSCRIBER_360', metrics: ['avg_churn_propensity'], dimensions: ['subscriber.subscriber_id', 'subscriber.subscriber_name', 'subscriber.msisdn', 'subscriber.region'], filters: ['churn_propensity >= 70', 'out_of_contract = TRUE', "segment = 'Postpaid'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const list = Q.churnRiskOutOfContract(d, allow);
        const maskName = !persona.unmasked.includes('PII');
        const maskNum = !persona.unmasked.includes('CPNI');
        const shown = list.slice(0, 8);
        const masked = [...(maskName ? ['SUBSCRIBER_NAME'] : []), ...(maskNum ? ['MSISDN'] : [])];
        return {
          summary: `${list.length} active postpaid subscribers in the sample are out of contract with a churn propensity of 70 or more (≈ ${fmtCompact(list.length * d.scale)} across the base), billing ${fmtUsd(sum(list.map((x) => x.bill)))} a month in the sample. The ${shown.length} highest-risk are listed.${masked.length ? ` ${maskName ? 'Names are masked by MP_MASK_PII' : ''}${maskName && maskNum ? ' and ' : ''}${maskNum ? `${maskName ? 'mobile numbers' : 'Mobile numbers are masked'} by MP_MASK_CPNI` : ''} for your role.` : ''} Churn propensity is a Draft term (T-020).${rowNote(persona)}`,
          table: {
            columns: ['Subscriber ID', 'Name', 'MSISDN', 'Region', 'Plan', 'Churn propensity', 'Sep bill'],
            rows: shown.map((x) => [x.s.id, String(maskFor(persona, 'PII', `${x.s.first} ${x.s.last}`)), String(maskFor(persona, 'CPNI', x.s.msisdn ?? '')), x.s.region, x.s.planName, x.s.churnPropensity, fmtUsd(x.bill)]),
            masked: [...(maskName ? [1] : []), ...(maskNum ? [2] : [])],
          },
          sql: `SELECT subscriber_id, subscriber_name, msisdn, region, plan_name, churn_propensity\n  FROM ${DB}.DATA_PRODUCTS.DP_SUBSCRIBER_360\n WHERE segment = 'Postpaid' AND is_active\n   AND out_of_contract           -- BR-006\n   AND churn_propensity >= 70    -- BR-006 high propensity${regionWhere(persona)}\n ORDER BY churn_propensity DESC\n LIMIT 8;`,
          rows: shown.length, maskedColumns: masked, rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_SUBSCRIBER_360',
        };
      },
    },
    {
      id: 'S-04', agentId: 'AG-01', pattern: 4, productIds: ['DP-05'], kpiIds: ['K-24', 'K-22'],
      question: 'What is gross margin per subscriber by plan this quarter?',
      paraphrases: ['gross margin per subscriber by plan', 'plan margin per subscriber this quarter', 'margin per subscriber for each rate plan in Q3'],
      terms: [{ text: 'gross margin', termId: 'T-022' }, { text: 'plan', termId: 'T-012' }],
      ruleIds: ['BR-013'], instruction: 'Report margins to the cent and the margin rate to one decimal.',
      semantic: { view: 'SV_DEVICE_PLAN_PROFITABILITY', metrics: ['margin_per_subscriber', 'plan_gross_margin_pct'], dimensions: ['plan.plan_name'], filters: ['invoice_month in Q3 2026'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.marginByPlan(d, Q.PERIODS.quarter.months, allow);
        const top = r.rows[0];
        const low = r.rows[r.rows.length - 1];
        return {
          summary: `In Q3 2026 gross margin was ${fmtUsd(r.perSub)} per subscriber per month, a ${fmtPct(r.pct)} margin on service revenue. ${top.plan} earns the most (${fmtUsd(top.perSub)}); ${low.plan} the least (${fmtUsd(low.perSub)}). Margin deducts cost of service and amortised device subsidy (${fmtUsd(r.subsidyPerPostpaid)} per postpaid subscriber), per BR-013.${rowNote(persona)}`,
          table: { columns: ['Plan', 'Segment', 'Margin per subscriber', 'Gross margin %', 'Device subsidy / sub'], rows: r.rows.map((x) => [x.plan, x.segment, fmtUsd(x.perSub), fmtPct(x.pct), fmtUsd(x.subsidy)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.plan), values: r.rows.map((x) => x.perSub), unit: 'USD' },
          sql: `SELECT plan_name,\n       SUM(gross_margin) / COUNT(*) AS margin_per_subscriber,\n       SUM(gross_margin) / SUM(service_revenue) * 100 AS plan_gross_margin_pct  -- BR-013\n  FROM ${DB}.DATA_PRODUCTS.DP_DEVICE_PLAN_PROFITABILITY\n WHERE invoice_month BETWEEN '2026-07' AND '2026-09'${regionWhere(persona)}\n GROUP BY plan_name\n ORDER BY margin_per_subscriber DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-22': r.pct, 'K-24': r.perSub, 'K-23': r.subsidyPerPostpaid },
        };
      },
    },
    {
      id: 'S-05', agentId: 'AG-01', pattern: 5, productIds: ['DP-03'], kpiIds: ['K-03'],
      question: 'Show daily mobile data usage for the last 30 days',
      paraphrases: ['daily data usage trend for the last 30 days', 'mobile data usage per day this month', 'data usage by day over the past 30 days'],
      terms: [{ text: 'data usage', termId: 'T-011' }],
      ruleIds: ['BR-015'],
      semantic: { view: 'SV_SUBSCRIBER_360', metrics: ['data_gb_per_sub'], dimensions: ['usage.usage_date'], filters: ["usage_date BETWEEN '2026-09-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const u = Q.dailyUsage(d, allow);
        const peak = u.daily.reduce((a, b) => (b.tb > a.tb ? b : a));
        const low = u.daily.reduce((a, b) => (b.tb < a.tb ? b : a));
        return {
          summary: `Over the last 30 days (1–30 Sep 2026) mobile subscribers used ${fmtNum(u.gbPerSub, 1)} GB each on average${allow ? ' in your regions' : ''}. Daily traffic peaked on ${peak.day} at ${fmtInt(peak.tb)} TB and was lowest on ${low.day} at ${fmtInt(low.tb)} TB; weekends run higher than weekdays.${rowNote(persona)}`,
          table: { columns: ['Date', 'Data (TB, scaled)', 'GB per subscriber'], rows: u.daily.map((x) => [x.day, fmtInt(x.tb), fmtNum(x.gbPerSub, 3)]) },
          chart: { kind: 'line', labels: u.daily.map((x) => x.day.slice(5)), values: u.daily.map((x) => x.tb), unit: 'TB' },
          sql: `SELECT usage_date, SUM(data_gb) / 1000 AS data_tb, SUM(data_gb) / COUNT(DISTINCT subscriber_key) AS gb_per_subscriber\n  FROM ${DB}.CONFORMED_GOLD.FCT_DAILY_USAGE  -- via SV_SUBSCRIBER_360, product DP_USAGE_REVENUE\n WHERE usage_date BETWEEN '2026-09-01' AND '2026-09-30'  -- BR-015 mobile lines only${regionWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: u.daily.length, rowFiltered: Boolean(allow), note: `${fmtInt(u.subs)} mobile subscribers in the sample, ${fmtInt(d.usage.length)} subscriber-days in FCT_DAILY_USAGE.`,
          kpiValues: allow ? undefined : { 'K-03': u.gbPerSub, 'K-04': u.minPerSub },
        };
      },
    },
    {
      id: 'S-06', agentId: 'AG-02', pattern: 6, productIds: ['DP-04'], kpiIds: ['K-16', 'K-20'],
      question: 'What was postpaid churn last month by plan and region?',
      paraphrases: ['postpaid churn by plan and region last month', 'churn rate by rate plan and region for September', 'last month postpaid churn per plan and region', 'September postpaid churn by plan and region'],
      terms: [{ text: 'postpaid churn', termId: 'T-004' }, { text: 'plan', termId: 'T-012' }, { text: 'region', termId: 'T-003' }],
      ruleIds: ['BR-004', 'BR-016'], instruction: 'Report churn to two decimals; count voluntary disconnects and port-outs and exclude plan migrations.',
      semantic: { view: 'SV_CHURN_RETENTION', metrics: ['postpaid_churn_rate'], dimensions: ['plan.plan_name', 'market.region'], filters: ["date.month = '2026-09'", "plan.segment = 'Postpaid'", 'plan migrations excluded (BR-004)'] },
      doc: { docId: 'DOC-01', chunk: 6 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.churnByPlanRegion(d, Q.PERIODS.month, 'Postpaid', allow);
        const regions = REGIONS.filter((x) => !allow || allow.includes(x));
        const plans = PLANS.filter((p) => p.segment === 'Postpaid').map((p) => p.name);
        const cell = (plan: string, region: string) => r.cells.find((c) => c.plan === plan && c.region === region)!;
        const hi = [...r.cells].sort((a, b) => b.rate - a.rate)[0];
        const lo = [...r.cells].sort((a, b) => a.rate - b.rate)[0];
        return {
          summary: `Postpaid churn in September 2026 was ${fmtNum(r.rate, 2)}%${allow ? ' in your regions' : ''}: ${fmtInt(r.churned)} of ${fmtCompact(r.opening)} opening subscribers left — ${fmtInt(r.voluntary)} voluntary disconnects and ${fmtInt(r.portOuts)} port-outs (${fmtPct(r.portOutShare)} port-out share). Per rule BR-004, ${fmtInt(r.migrationsExcluded)} plan migrations were excluded, and ${fmtInt(r.involuntary)} involuntary disconnects are reported separately. Highest: ${hi.plan} in the ${hi.region} (${fmtNum(hi.rate, 2)}%); lowest: ${lo.plan} in the ${lo.region} (${fmtNum(lo.rate, 2)}%).`,
          table: {
            columns: ['Plan', ...regions, 'All regions'],
            rows: [
              ...plans.map((p) => [p, ...regions.map((rg) => `${fmtNum(cell(p, rg).rate, 2)}%`), `${fmtNum(r.byPlan.find((x) => x.key === p)!.rate, 2)}%`]),
              ['All plans', ...regions.map((rg) => `${fmtNum(r.byRegion.find((x) => x.key === rg)!.rate, 2)}%`), `${fmtNum(r.rate, 2)}%`],
            ],
          },
          chart: { kind: 'bar', labels: r.byPlan.map((x) => x.key), values: r.byPlan.map((x) => x.rate), unit: '%' },
          sql: `SELECT plan.plan_name, market.region,\n       SUM(voluntary_disconnects + port_outs) / SUM(opening_base) * 100 AS postpaid_churn_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_CHURN_RETENTION\n WHERE month = '2026-09' AND segment = 'Postpaid'\n   -- BR-004: churn = voluntary disconnects + port-outs; MIGRATIONS_OUT excluded${regionWhere(persona)}\n GROUP BY ROLLUP (plan.plan_name, market.region)\n ORDER BY 1, 2;`,
          rows: r.cells.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-16': r.rate, 'K-20': r.portOutShare }, explorerTarget: 'DATA_PRODUCTS.DP_CHURN_RETENTION',
          note: `Opening base ${fmtInt(r.opening)} postpaid subscribers (production grain, month × market × plan).`,
        };
      },
    },
    {
      id: 'S-07', agentId: 'AG-02', pattern: 7, productIds: ['DP-02'], kpiIds: ['K-10'],
      question: 'Top 10 cell sites by dropped call rate in the last 30 days',
      paraphrases: ['worst cell sites by dropped call rate last 30 days', 'which cell sites had the highest dropped call rate this month', 'top ten sites by dropped call rate in the past 30 days'],
      terms: [{ text: 'cell sites', termId: 'T-016' }, { text: 'dropped call rate', termId: 'T-013' }],
      ruleIds: ['BR-010'],
      semantic: { view: 'SV_NETWORK_PERFORMANCE', metrics: ['dropped_call_rate'], dimensions: ['site.site_id', 'site.market'], filters: ["kpi_date >= '2026-09-01'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const top = Q.topSitesByDcr(d, 10, allow);
        const all = Q.netSummary(d, Q.PERIODS.last30, allow);
        return {
          summary: `In the last 30 days (1–30 Sep 2026) ${top[0].siteId} (${top[0].name}, ${top[0].market}) had the highest dropped call rate at ${fmtNum(top[0].dcr, 2)}%, against a network average of ${fmtNum(all.dcr, 2)}%. ${top.filter((x) => x.technology === 'LTE').length} of the top 10 are LTE-only sites.${rowNote(persona)}`,
          table: { columns: ['Site', 'Name', 'Market', 'Technology', 'Dropped call rate', 'Dropped calls', 'Downtime (min)'], rows: top.map((x) => [x.siteId, x.name, x.market, x.technology, `${fmtNum(x.dcr, 2)}%`, fmtInt(x.dropped), x.downtime]) },
          chart: { kind: 'bar', labels: top.map((x) => x.siteId), values: top.map((x) => x.dcr), unit: '%' },
          sql: `SELECT site_id, market, technology, SUM(dropped_calls) / SUM(call_attempts) * 100 AS dropped_call_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_NETWORK_PERFORMANCE\n WHERE kpi_date >= '2026-09-01'  -- BR-010 network counters${regionWhere(persona)}\n GROUP BY 1, 2, 3\n ORDER BY dropped_call_rate DESC\n LIMIT 10;`,
          rows: top.length, rowFiltered: Boolean(allow), explorerTarget: 'CONFORMED_GOLD.DIM_CELL_SITE',
        };
      },
    },
    {
      id: 'S-08', agentId: 'AG-02', pattern: 8, productIds: ['DP-02', 'DP-06'], kpiIds: ['K-25', 'K-26'],
      question: 'What is the first-time fix rate for network site repairs this quarter, by region?',
      paraphrases: ['first-time fix rate for network site repairs this quarter', 'network site repair first time fix by region', 'how many network site repairs were fixed first time this quarter', 'ftf rate for network site repairs by region'],
      terms: [{ text: 'first-time fix', termId: 'T-021' }, { text: 'network site repairs', termId: 'T-031' }],
      ruleIds: ['BR-014'],
      semantic: { view: 'SV_NETWORK_PERFORMANCE', metrics: ['network_availability'], dimensions: ['site.region'], filters: ["fiscal_quarter = '2026-Q3'"] },
      doc: { docId: 'DOC-02', chunk: 15 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const all = Q.fieldService(d, Q.PERIODS.quarter, allow);
        const net = d.workOrders.filter((w) => w.type === 'Network site repair' && w.opened >= Q.PERIODS.quarter.from && (!allow || allow.includes(w.region)));
        const regions = REGIONS.filter((x) => !allow || allow.includes(x));
        const rows = regions.map((rg) => {
          const xs = net.filter((w) => w.region === rg);
          return { region: rg, orders: xs.length, ftf: round((xs.filter((w) => w.ftf).length / Math.max(1, xs.length)) * 100, 1), hours: round(sum(xs.map((w) => w.hours)) / Math.max(1, xs.length), 1), avail: Q.netSummary(d, Q.PERIODS.quarter, allow, rg).availability };
        });
        const netFtf = round((net.filter((w) => w.ftf).length / Math.max(1, net.length)) * 100, 1);
        const q3 = Q.netSummary(d, Q.PERIODS.quarter, allow);
        return {
          summary: `In Q3 2026, ${fmtInt(net.length)} network site repairs had a first-time fix rate of ${fmtPct(netFtf)} (target 80%), against ${fmtPct(all.ftf)} for all ${fmtInt(all.orders)} work orders, which took ${fmtNum(all.hours, 1)} hours on average to resolve. Network availability over the same quarter was ${fmtNum(q3.availability, 3)}%. The work-order figures come from Field Service Efficiency, which is a Draft product.${rowNote(persona)}`,
          table: { columns: ['Region', 'Network site repairs', 'First-time fix', 'Avg hours to resolve', 'Availability Q3'], rows: rows.map((x) => [x.region, x.orders, fmtPct(x.ftf), fmtNum(x.hours, 1), `${fmtNum(x.avail, 3)}%`]) },
          chart: { kind: 'bar', labels: rows.map((x) => x.region), values: rows.map((x) => x.ftf), unit: '%' },
          sql: `SELECT region, COUNT(*) AS repairs, AVG(IFF(first_time_fix, 1, 0)) * 100 AS ftf_pct, AVG(hours_to_resolve) AS avg_hours  -- BR-014\n  FROM ${DB}.DATA_PRODUCTS.DP_FIELD_SERVICE_EFFICIENCY  -- DRAFT, not certified\n WHERE work_order_type = 'Network site repair' AND opened_date >= '2026-07-01'${regionWhere(persona)}\n GROUP BY region;\n\nSELECT region, 100 - SUM(downtime_min) / (COUNT(*) * 1440) * 100 AS network_availability\n  FROM ${DB}.DATA_PRODUCTS.DP_NETWORK_PERFORMANCE\n WHERE kpi_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY region;`,
          rows: rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-25': all.ftf, 'K-26': all.hours, 'K-11': q3.availability },
        };
      },
    },
    {
      id: 'S-09', agentId: 'AG-02', pattern: 9, productIds: ['DP-02'], kpiIds: ['K-10'],
      question: 'Compare dropped call rate this quarter with last quarter',
      paraphrases: ['dropped call rate this quarter vs last quarter', 'dropped call rate quarter over quarter', 'how does the dropped call rate in Q3 compare to Q2'],
      terms: [{ text: 'dropped call rate', termId: 'T-013' }],
      ruleIds: ['BR-010'], instruction: 'Compare whole calendar quarters; rates to two decimals.',
      semantic: { view: 'SV_NETWORK_PERFORMANCE', metrics: ['dropped_call_rate'], dimensions: ['date.fiscal_quarter', 'site.region'], filters: ["fiscal_quarter IN ('2026-Q2', '2026-Q3')"] },
      doc: { docId: 'DOC-02', chunk: 8 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const c = Q.dcrCompare(d, allow);
        const chg = c.q3.dcr - c.q2.dcr;
        return {
          summary: `The dropped call rate in Q3 2026 (Jul–Sep) was ${fmtNum(c.q3.dcr, 2)}%, compared with ${fmtNum(c.q2.dcr, 2)}% in Q2 (Apr–Jun) — ${chg < 0 ? 'an improvement' : 'a deterioration'} of ${fmtNum(Math.abs(chg), 2)} points. Call setup success was ${fmtNum(c.q3.cssr, 2)}% and average downlink throughput ${fmtNum(c.q3.throughput, 1)} Mbps in Q3.${rowNote(persona)}`,
          table: { columns: ['Region', 'DCR Q2 2026', 'DCR Q3 2026', 'Change (pts)', 'Availability Q3'], rows: c.rows.map((x) => [x.region, `${fmtNum(x.q2.dcr, 2)}%`, `${fmtNum(x.q3.dcr, 2)}%`, fmtNum(x.q3.dcr - x.q2.dcr, 2), `${fmtNum(x.q3.availability, 3)}%`]) },
          chart: { kind: 'bar', labels: ['Q2 2026', 'Q3 2026'], values: [c.q2.dcr, c.q3.dcr], unit: '%' },
          sql: `SELECT d.fiscal_quarter, s.region, SUM(dropped_calls) / SUM(call_attempts) * 100 AS dropped_call_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_NETWORK_PERFORMANCE n\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE d ON d.calendar_date = n.kpi_date\n WHERE d.fiscal_quarter IN ('2026-Q2', '2026-Q3')  -- BR-010 whole quarters${regionWhere(persona, 's.region')}\n GROUP BY 1, 2 ORDER BY 2, 1;`,
          rows: c.rows.length * 2, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-10': c.q3.dcr, 'K-12': c.q3.cssr, 'K-13': c.q3.throughput },
        };
      },
    },
    {
      id: 'S-10', agentId: 'AG-03', pattern: 10, productIds: ['DP-03'], kpiIds: ['K-02', 'K-06'],
      question: 'What was postpaid ARPU last month?',
      paraphrases: ['postpaid ARPU for September', 'average revenue per user last month', 'ARPU last month for postpaid subscribers'],
      terms: [{ text: 'ARPU', termId: 'T-009' }],
      ruleIds: ['BR-002'],
      semantic: { view: 'SV_SUBSCRIBER_360', metrics: ['postpaid_arpu', 'service_revenue'], dimensions: ['plan.plan_name'], filters: ["invoice_month = '2026-09-01'"] },
      doc: { docId: 'DOC-01', chunk: 4 },
      run: () => {
        const r = Q.arpuMonth(d);
        const prev = Q.arpuMonth(d, Q.PERIODS.prevMonth);
        return {
          summary: `Postpaid ARPU in September 2026 was ${fmtUsd(r.arpu)}, ${r.arpu >= prev.arpu ? 'up' : 'down'} ${fmtUsd(Math.abs(r.arpu - prev.arpu))} from August. ARPU is monthly service revenue per postpaid subscriber invoiced in the month — plan, overage and roaming, excluding device installments. Total service revenue across all segments was $${fmtNum(r.serviceRevenue / 1e6, 1)} M.`,
          table: { columns: ['Plan', 'ARPU Sep 2026'], rows: [...r.byPlan.map((x) => [x.plan, fmtUsd(x.arpu)]), ['All postpaid', fmtUsd(r.arpu)]] },
          chart: { kind: 'bar', labels: r.byPlan.map((x) => x.plan), values: r.byPlan.map((x) => x.arpu), unit: 'USD' },
          sql: `SELECT plan_name, SUM(service_revenue) / COUNT(DISTINCT subscriber_id) AS postpaid_arpu  -- BR-002\n  FROM ${DB}.DATA_PRODUCTS.DP_USAGE_REVENUE\n WHERE invoice_month = '2026-09' AND segment = 'Postpaid'\n GROUP BY ROLLUP (plan_name);`,
          rows: r.byPlan.length + 1, kpiValues: { 'K-02': r.arpu, 'K-06': r.serviceRevenue },
        };
      },
    },
    {
      id: 'S-11', agentId: 'AG-03', pattern: 11, productIds: ['DP-03'], kpiIds: ['K-07', 'K-09'],
      question: 'Which markets had revenue leakage above 0.8% last quarter?',
      paraphrases: ['markets with revenue leakage over 0.8% in Q3', 'revenue leakage above 0.8% by market last quarter', 'which markets have leakage higher than 0.8%'],
      terms: [{ text: 'revenue leakage', termId: 'T-017' }],
      ruleIds: ['BR-008'],
      semantic: { view: 'SV_SUBSCRIBER_360', metrics: ['revenue_leakage_pct', 'leakage_amount'], dimensions: ['subscriber.market'], filters: ['invoice_month in Q3 2026', 'revenue_leakage_pct > 0.8'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.leakageByMarket(d);
        const rows = r.rows.filter((x) => !allow || allow.includes(x.region));
        const above = rows.filter((x) => x.pct > 0.8);
        return {
          summary: `${above.length} market${above.length === 1 ? '' : 's'} exceeded 0.8% revenue leakage in Q3 2026: ${above.map((x) => `${x.market} (${fmtNum(x.pct, 2)}%, ${fmtCompact(x.leakage, 'USD')})`).join(', ')}. Under BR-008 ${above.length === 1 ? 'it is' : 'they are'} escalated to revenue assurance. Company-wide leakage was ${fmtNum(r.pct, 2)}% of rated charges (${fmtCompact(r.leakage, 'USD')} for the quarter).${rowNote(persona)}`,
          table: { columns: ['Market', 'Region', 'Leakage %', 'Leakage (scaled)', 'Invoices with leakage (sample)'], rows: above.map((x) => [x.market, x.region, `${fmtNum(x.pct, 2)}%`, fmtCompact(x.leakage, 'USD'), x.invoices]) },
          chart: { kind: 'bar', labels: rows.map((x) => x.market), values: rows.map((x) => x.pct), unit: '%' },
          sql: `SELECT market, SUM(leakage_amount) / SUM(rated_amount) * 100 AS revenue_leakage_pct, SUM(leakage_amount) AS leakage_amount\n  FROM ${DB}.DATA_PRODUCTS.DP_USAGE_REVENUE\n WHERE invoice_month BETWEEN '2026-07' AND '2026-09'${regionWhere(persona)}\n GROUP BY market\nHAVING revenue_leakage_pct > 0.8  -- BR-008 escalation threshold\n ORDER BY revenue_leakage_pct DESC;`,
          rows: above.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-07': r.pct, 'K-09': Q.leakageMonth(d) }, explorerTarget: 'CONFORMED_GOLD.DIM_MARKET',
        };
      },
    },
    {
      id: 'S-12', agentId: 'AG-03', pattern: 12, productIds: ['DP-03'], kpiIds: ['K-08'],
      question: 'What share of mobile service revenue came from roaming last quarter?',
      paraphrases: ['roaming revenue share last quarter', 'how much of mobile service revenue was roaming in Q3', 'roaming share of mobile service revenue this quarter'],
      terms: [{ text: 'roaming', termId: 'T-028' }, { text: 'mobile service revenue', termId: 'T-010' }],
      ruleIds: ['BR-009'],
      semantic: { view: 'SV_SUBSCRIBER_360', metrics: ['roaming_revenue_share'], dimensions: ['billing.invoice_month'], filters: ['invoice_month in Q3 2026', "plan.line_of_business = 'Mobile'"] },
      doc: { docId: 'DOC-04', chunk: 7 },
      run: () => {
        const r = Q.roamingShare(d);
        const peak = r.byMonth.reduce((a, b) => (b.pct > a.pct ? b : a));
        return {
          summary: `Roaming made up ${fmtPct(r.pct, 2)} of mobile service revenue in Q3 2026: ${fmtCompact(r.roaming, 'USD')} of ${fmtCompact(r.service, 'USD')}. Roaming revenue (T-028) counts retail outbound roaming billed to Altair subscribers; inbound wholesale settlements are excluded (BR-009). ${peak.month} was the peak month at ${fmtPct(peak.pct, 2)}.`,
          table: { columns: ['Month', 'Roaming revenue (scaled)', 'Share of mobile service revenue'], rows: r.byMonth.map((x) => [x.month, fmtCompact(x.roaming, 'USD'), fmtPct(x.pct, 2)]) },
          chart: { kind: 'bar', labels: r.byMonth.map((x) => x.month), values: r.byMonth.map((x) => x.pct), unit: '%' },
          sql: `SELECT invoice_month, SUM(roaming_revenue) / SUM(service_revenue) * 100 AS roaming_revenue_share  -- T-028 / BR-009\n  FROM ${DB}.DATA_PRODUCTS.DP_USAGE_REVENUE\n WHERE invoice_month BETWEEN '2026-07' AND '2026-09'\n   AND segment IN ('Postpaid', 'Prepaid')  -- mobile service revenue\n GROUP BY ROLLUP (invoice_month);`,
          rows: r.byMonth.length, kpiValues: { 'K-08': r.pct },
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
        return {
          summary: `${gaps.length} critical data element${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'has' : 'have'} no steward: ${gaps.map((t) => `${t.term} (${t.id}, owner ${t.owner})`).join(', ')}. It feeds the Draft product Field Service Efficiency. Also note ${draft.length} Draft term: ${draft.map((t) => t.term).join(', ')}.`,
          table: { columns: ['Term', 'Id', 'Domain', 'Owner', 'Steward', 'Next action'], rows: gaps.map((t) => [t.term, t.id, t.domain, t.owner, '— none —', 'Assign a field-operations steward before DP-06 enters certification']) },
          sql: `SELECT t.term_id, t.term, t.domain, t.owner\n  FROM ${DB}.GLOSSARY.BUSINESS_TERM t\n  JOIN ${DB}.GLOSSARY.CDE_REGISTER c USING (term_id)\n WHERE t.is_cde AND c.steward IS NULL;`,
          rows: gaps.length, explorerTarget: 'GLOSSARY.CDE_REGISTER',
        };
      },
    },
    {
      id: 'S-14', agentId: 'AG-04', pattern: 14, productIds: [], kpiIds: [],
      question: 'Where is the term Active Subscriber used?',
      paraphrases: ['lineage of active subscriber', 'what uses the active subscriber definition', 'where does active subscriber appear'],
      terms: [{ text: 'Active Subscriber', termId: 'T-002' }],
      ruleIds: ['BR-001'],
      run: () => {
        const p = packRef();
        const t = p.glossary.find((x) => x.id === 'T-002') as GlossaryTerm;
        const metrics = t.metricRefs;
        const products = p.products.filter((pr) => pr.semanticView && metrics.some((m) => m.startsWith(pr.semanticView!)) && pr.kpiIds.includes('K-01'));
        const agents = p.agents.filter((a) => a.productIds.some((x) => products.some((pr) => pr.id === x)));
        return {
          summary: `"Active Subscriber" (T-002) is mapped to ${t.mappings.length} columns, defines the metric ${metrics.join(', ')}, is enforced by rule BR-001, and flows into ${products.map((x) => `${x.name} (${x.id})`).join(', ')} and the ${agents.map((a) => a.name).join(', ')} agent.`,
          table: { columns: ['Layer', 'Object', 'Usage'], rows: [
            ...t.mappings.map((m) => ['Column', `${m.fqn}.${m.column}`, m.kind]),
            ...metrics.map((m) => ['Semantic metric', m, 'defines']),
            ['Context rule', 'BR-001', 'business rule'],
            ...products.map((x) => ['Data product', `${x.id} ${x.name}`, 'KPI K-01']),
            ...agents.map((a) => ['Agent', a.objectName, 'answers with it']),
          ] },
          sql: `SELECT 'column' AS kind, object_fqn || '.' || column_name AS ref\n  FROM ${DB}.GLOSSARY.TERM_COLUMN_MAP WHERE term_id = 'T-002'\nUNION ALL\nSELECT 'rule', rule_id FROM ${DB}.CONTEXT.BUSINESS_RULES WHERE applies_to_metric ILIKE '%active_subscribers%'\nUNION ALL\nSELECT 'product', product_id FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY WHERE semantic_view = 'SV_SUBSCRIBER_360';`,
          rows: t.mappings.length + metrics.length + products.length + agents.length + 1, explorerTarget: 'GLOSSARY.TERM_COLUMN_MAP',
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
