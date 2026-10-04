// The 15 Utilities agent scenarios (spec section 9). Every number is computed from the in-memory sample.
import type { GlossaryTerm, IndustryPack, Persona, Scenario } from '../../types';
import { avg, groupBy, round, sum } from '../../mock-snowflake/generators';
import { maskFor } from '../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import type { UtilData } from './data';
import { OPCOS } from './generators.config';
import * as Q from './queries';

const DB = 'NVE_AI_PLATFORM';
const allowedOpcos = (p: Persona) => (p.rowFilter?.column === 'OPCO' ? p.rowFilter.allowed : undefined);
const rowNote = (p: Persona) => (allowedOpcos(p) ? ` Row access policy limited results to ${allowedOpcos(p)!.join(' and ')}.` : '');
const opcoWhere = (p: Persona) => (allowedOpcos(p) ? `\n  -- RAP_OPCO_ACCESS applied by Snowflake: OPCO IN (${allowedOpcos(p)!.map((o) => `'${o}'`).join(', ')})` : '');

type PackLike = Pick<IndustryPack, 'glossary' | 'products' | 'agents' | 'semanticViews' | 'certificationScript' | 'context'>;

export function buildScenarios(d: UtilData, packRef: () => PackLike): Scenario[] {
  return [
    {
      id: 'S-01', agentId: 'AG-01', pattern: 1, productIds: ['DP-01'], kpiIds: ['K-02'],
      question: 'What was the average monthly residential bill last quarter by region?',
      paraphrases: ['average residential bill by region last quarter', 'typical home bill per region in Q3', 'residential monthly bill by territory'],
      terms: [{ text: 'monthly bill', termId: 'T-009' }, { text: 'residential', termId: 'T-012' }],
      ruleIds: ['BR-002', 'BR-003'], instruction: 'Report currency to the cent; name the period and customer group.',
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['avg_monthly_bill'], dimensions: ['customer.region'], filters: ["segment = 'Residential'", 'statement_month in Q3 2026'] },
      run: ({ persona }) => {
        const allow = allowedOpcos(persona);
        const bills = d.bills.filter((b) => b.residential && Q.PERIODS.quarter.months.includes(b.month) && (!allow || allow.includes(b.opco)));
        const by = groupBy(bills, (b) => b.region);
        const rows = OPCOS.filter((o) => by.has(o.region)).map((o) => ({ region: o.region, opco: o.name, v: round(avg(by.get(o.region)!.map((b) => b.billed)), 2), n: by.get(o.region)!.length }));
        const overall = round(avg(bills.map((b) => b.billed)), 2);
        const top = [...rows].sort((a, b) => b.v - a.v)[0];
        return {
          summary: `The average residential monthly bill in Q3 2026 (Jul–Sep) was ${fmtUsd(overall)}. ${top.region} (${top.opco}) was highest at ${fmtUsd(top.v)}.${rowNote(persona)}`,
          table: { columns: ['Region', 'Operating company', 'Avg monthly bill', 'Statements (sample)'], rows: rows.map((r) => [r.region, r.opco, fmtUsd(r.v), fmtInt(r.n)]) },
          chart: { kind: 'bar', labels: rows.map((r) => r.region), values: rows.map((r) => r.v), unit: 'USD' },
          sql: `SELECT customer.region, AVG(billing.billed_amount) AS avg_monthly_bill\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360 -- via SV_CUSTOMER_360\n WHERE customer.segment = 'Residential'\n   AND billing.statement_month BETWEEN '2026-07-01' AND '2026-09-01'${opcoWhere(persona)}\n GROUP BY customer.region\n ORDER BY avg_monthly_bill DESC;`,
          rows: rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-02': overall },
        };
      },
    },
    {
      id: 'S-02', agentId: 'AG-01', pattern: 2, productIds: ['DP-01'], kpiIds: ['K-01', 'K-04'],
      question: 'How many active customers are enrolled in paperless billing?',
      paraphrases: ['active customers on paperless', 'how many customers use e-bill', 'paperless enrolment among active accounts', 'digital adoption of active customers'],
      terms: [{ text: 'active customers', termId: 'T-002' }, { text: 'paperless billing', termId: 'T-011' }],
      ruleIds: ['BR-001'], instruction: 'State which customers count as active.',
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['active_customers', 'digital_adoption_rate'], dimensions: ['customer.digital_enrolled'], filters: ['Active Customer rule BR-001'] },
      run: ({ persona }) => {
        const allow = allowedOpcos(persona);
        const act = Q.activeCustomers(d).filter((c) => !allow || allow.includes(c.opco));
        const pl = act.filter((c) => c.paperless);
        const statusOnly = d.customers.filter((c) => c.status === 'Active' && (!allow || allow.includes(c.opco))).length;
        const pct = round((pl.length / act.length) * 100, 1);
        return {
          summary: `${fmtCompact(pl.length * d.scale)} active customers are enrolled in paperless billing — ${fmtPct(pct)} of ${fmtCompact(act.length * d.scale)} active customers. "Active" follows rule BR-001: Active status and a bill in the last 60 days, which excludes ${fmtInt((statusOnly - act.length) * d.scale)} Active-status accounts with no recent bill.${rowNote(persona)}`,
          table: { columns: ['Group', 'Customers', 'Share'], rows: [['Paperless', fmtInt(pl.length * d.scale), fmtPct(pct)], ['Paper bill', fmtInt((act.length - pl.length) * d.scale), fmtPct(100 - pct)], ['Active customers', fmtInt(act.length * d.scale), '100.0%']] },
          chart: { kind: 'bar', labels: ['Paperless', 'Paper bill'], values: [Math.round(pl.length * d.scale), Math.round((act.length - pl.length) * d.scale)], unit: 'customers' },
          sql: `SELECT customer.digital_enrolled, COUNT(DISTINCT customer.customer_id) AS active_customers\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360\n WHERE is_active  -- BR-001: status = 'Active' AND last statement > CURRENT_DATE - 60${opcoWhere(persona)}\n GROUP BY 1;`,
          rows: 2, rowFiltered: Boolean(allow), note: `Sample of ${fmtInt(act.length)} active customers scaled ×${fmtNum(d.scale, 1)} to the 1.385 M customer base.`,
          kpiValues: allow ? undefined : { 'K-01': Math.round(act.length * d.scale), 'K-04': pct },
        };
      },
    },
    {
      id: 'S-03', agentId: 'AG-01', pattern: 3, productIds: ['DP-01'], kpiIds: ['K-03', 'K-05'],
      question: 'Which customers are at high churn risk with arrears over $500?',
      paraphrases: ['list high churn risk customers with arrears above 500', 'customers likely to churn who owe more than $500', 'at-risk customers with big past due balances'],
      terms: [{ text: 'churn risk', termId: 'T-020' }, { text: 'arrears', termId: 'T-010' }],
      ruleIds: ['BR-004', 'BR-005'], instruction: 'Never reveal PII unless the role may see it.',
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['arrears_balance', 'avg_churn_risk'], dimensions: ['customer.customer_id', 'customer.customer_name', 'customer.opco'], filters: ['churn_risk_score >= 70', 'arrears_amount > 500'] },
      run: ({ persona }) => {
        const allow = allowedOpcos(persona);
        const list = Q.highChurnArrears(d).filter((x) => !allow || allow.includes(x.c.opco));
        const masked = !persona.unmasked.includes('PII');
        const shown = list.slice(0, 8);
        return {
          summary: `${list.length} customers in the sample have a churn risk score of 70+ and arrears over $500 on their latest statement (≈ ${fmtCompact(list.length * d.scale)} across the customer base), owing ${fmtUsd(sum(list.map((x) => x.arrears)), 0)} in the sample. The highest-risk ${shown.length} are listed.${masked ? ' Names are masked by MP_MASK_PII for your role.' : ''}${rowNote(persona)}`,
          table: {
            columns: ['Customer ID', 'Name', 'Opco', 'Churn risk', 'Arrears'],
            rows: shown.map((x) => [x.c.id, String(maskFor(persona, 'PII', `${x.c.first} ${x.c.last}`)), x.c.opco, x.c.churnRisk, fmtUsd(x.arrears)]),
            masked: masked ? [1] : [],
          },
          sql: `SELECT customer_id, customer_name, opco, churn_risk_score, arrears_amount\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360\n WHERE churn_risk_score >= 70   -- BR-004\n   AND arrears_amount > 500      -- BR-005 latest statement${opcoWhere(persona)}\n ORDER BY churn_risk_score DESC, arrears_amount DESC\n LIMIT 8;`,
          rows: shown.length, maskedColumns: masked ? ['CUSTOMER_NAME'] : [], rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_CUSTOMER_360',
        };
      },
    },
    {
      id: 'S-04', agentId: 'AG-01', pattern: 4, productIds: ['DP-05'], kpiIds: ['K-20'],
      question: 'What is our days sales outstanding this month?',
      paraphrases: ['what is DSO this month', 'days sales outstanding for September', 'how long are receivables outstanding', 'current DSO'],
      terms: [{ text: 'days sales outstanding', termId: 'T-018' }],
      ruleIds: ['BR-006'], instruction: 'Report days to one decimal and show the trend.',
      semantic: { view: 'SV_BILLING_AR', metrics: ['dso_days'], dimensions: ['date.statement_month'], filters: ["statement_month = '2026-09-01'"] },
      run: ({ persona }) => {
        const allow = allowedOpcos(persona);
        const bs = (m: string) => d.bills.filter((b) => b.month === m && (!allow || allow.includes(b.opco)));
        const dsoOf = (m: string) => { const x = bs(m); const billed = sum(x.map((b) => b.billed)); return round(((billed + sum(x.map((b) => b.arrears))) / billed) * 30, 1); };
        const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
        const trend = months.map((m) => ({ m, v: dsoOf(m) }));
        const cur = trend[trend.length - 1].v;
        const prev = trend[trend.length - 2].v;
        const sept = bs('2026-09');
        const ar = (sum(sept.map((b) => b.billed)) + sum(sept.map((b) => b.arrears))) * d.scale;
        return {
          summary: `Days sales outstanding for September 2026 is ${fmtNum(cur, 1)} days, ${cur > prev ? 'up' : 'down'} ${fmtNum(Math.abs(cur - prev), 1)} days from August. Month-end receivables were ${fmtCompact(ar, 'USD')} against ${fmtCompact(sum(sept.map((b) => b.billed)) * d.scale, 'USD')} billed.${rowNote(persona)}`,
          table: { columns: ['Month', 'DSO (days)'], rows: trend.map((t) => [t.m, fmtNum(t.v, 1)]) },
          chart: { kind: 'line', labels: trend.map((t) => t.m.slice(5)), values: trend.map((t) => t.v), unit: 'days' },
          sql: `SELECT date.statement_month,\n       (SUM(billed_amount) + SUM(arrears_amount)) / SUM(billed_amount) * 30 AS dso_days -- BR-006\n  FROM ${DB}.DATA_PRODUCTS.DP_BILLING_RECEIVABLES\n WHERE statement_month >= '2026-04-01'${opcoWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: trend.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-20': cur },
        };
      },
    },
    {
      id: 'S-05', agentId: 'AG-01', pattern: 5, productIds: ['DP-03'], kpiIds: ['K-12'],
      question: 'Show peak demand by rate class for last week',
      paraphrases: ['peak kw by tariff last week', 'max demand per rate class over the past week', 'last week peak load by rate'],
      terms: [{ text: 'peak demand', termId: 'T-014' }, { text: 'rate class', termId: 'T-012' }],
      ruleIds: ['BR-008'],
      semantic: { view: 'SV_CUSTOMER_360', metrics: ['peak_kw'], dimensions: ['customer.rate_class', 'usage.usage_date'], filters: ["usage_date BETWEEN '2026-09-21' AND '2026-09-27'"] },
      run: ({ persona }) => {
        const r = Q.peakDemandByRateClass(d);
        const top = r.daily.reduce((a, b) => (b.systemPeakMw > a.systemPeakMw ? b : a));
        return {
          summary: `Last week (Mon 21 – Sun 27 Sep 2026) the average daily peak per premise was ${r.rows.map((x) => `${fmtNum(x.avgPeakKw, 1)} kW for ${x.rateClass}`).join(', ')}. Estimated coincident system peak was highest on ${top.day} at ${fmtInt(top.systemPeakMw)} MW.${allowedOpcos(persona) ? ' Usage is not opco-restricted for your role.' : ''}`,
          table: { columns: ['Rate class', 'Avg daily peak (kW)', 'Max peak (kW)', 'Premises (sample)'], rows: r.rows.map((x) => [x.rateClass, fmtNum(x.avgPeakKw, 2), fmtNum(x.maxPeakKw, 1), x.premises]) },
          chart: { kind: 'line', labels: r.daily.map((x) => x.day.slice(5)), values: r.daily.map((x) => x.systemPeakMw), unit: 'MW' },
          sql: `SELECT rate_class, usage_date, AVG(peak_kw) AS avg_peak_kw, MAX(peak_kw) AS max_peak_kw\n  FROM ${DB}.DATA_PRODUCTS.DP_AMI_USAGE\n WHERE usage_date BETWEEN '2026-09-21' AND '2026-09-27'  -- BR-008 Monday–Sunday\n GROUP BY 1, 2 ORDER BY 1, 2;`,
          rows: r.rows.length * 7, kpiValues: { 'K-12': round(avg(r.rows.map((x) => x.avgPeakKw)), 2) },
        };
      },
    },
    {
      id: 'S-06', agentId: 'AG-02', pattern: 6, productIds: ['DP-02'], kpiIds: ['K-06'],
      question: 'What is SAIDI year to date excluding major event days, by operating company?',
      paraphrases: ['saidi ytd by opco', 'outage minutes per customer this year by operating company', 'year to date saidi excluding storms per opco', 'SAIDI by OPCO year to date'],
      terms: [{ text: 'SAIDI', termId: 'T-004' }, { text: 'operating company', termId: 'T-003' }, { text: 'major event days', termId: 'T-007' }],
      ruleIds: ['BR-012', 'BR-010'], instruction: 'Report minutes to one decimal; exclude Major Event Days.',
      semantic: { view: 'SV_RELIABILITY', metrics: ['saidi_minutes'], dimensions: ['circuit.opco'], filters: ['med_flag = FALSE', 'outage_date YTD 2026'] },
      doc: { docId: 'DOC-01', chunk: 14 },
      run: ({ persona }) => {
        const allow = allowedOpcos(persona);
        const r = Q.reliability(d, Q.PERIODS.ytd, true, allow);
        const worst = [...r.rows].sort((a, b) => b.saidi - a.saidi)[0];
        return {
          summary: `SAIDI year to date (1 Jan – 30 Sep 2026), excluding major event days, is ${fmtNum(r.total.saidi, 1)} minutes ${allow ? 'for your opcos' : 'system-wide'}. ${worst.opco} is highest at ${fmtNum(worst.saidi, 1)} minutes. ${r.medEventsExcluded} events on major event days were excluded under the IEEE 1366 2.5 beta method.`,
          table: { columns: ['Operating company', 'SAIDI (min)', 'Customers served', 'Customer minutes'], rows: r.rows.map((x) => [x.opco, fmtNum(x.saidi, 1), fmtInt(x.served), fmtCompact(x.cmi)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.opco.replace('Northvale ', '')), values: r.rows.map((x) => x.saidi), unit: 'min' },
          sql: `SELECT circuit.opco,\n       SUM(outage.customer_minutes) / MAX(circuit.customers_served_opco) AS saidi_minutes\n  FROM ${DB}.DATA_PRODUCTS.DP_SYSTEM_RELIABILITY\n WHERE outage_date BETWEEN '2026-01-01' AND '2026-09-30'\n   AND med_flag = FALSE  -- BR-012 IEEE 1366 2.5 beta${opcoWhere(persona)}\n GROUP BY circuit.opco\n ORDER BY saidi_minutes DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-06': r.total.saidi }, explorerTarget: 'DATA_PRODUCTS.DP_SYSTEM_RELIABILITY',
        };
      },
    },
    {
      id: 'S-07', agentId: 'AG-02', pattern: 7, productIds: ['DP-02'], kpiIds: ['K-09'],
      question: 'Top 5 circuits by customers interrupted in the last 30 days',
      paraphrases: ['worst circuits last 30 days', 'which feeders had the most customers out this month', 'top five circuits by interruptions'],
      terms: [{ text: 'customers interrupted', termId: 'T-005' }],
      ruleIds: ['BR-010'],
      semantic: { view: 'SV_RELIABILITY', metrics: ['customers_interrupted'], dimensions: ['circuit.circuit_id', 'circuit.opco'], filters: ["outage_date >= '2026-09-01'"] },
      run: ({ persona }) => {
        const allow = allowedOpcos(persona);
        const top = Q.topCircuitsByCi(d, 40).filter((x) => !allow || allow.includes(x.opco)).slice(0, 5);
        return {
          summary: `In the last 30 days (1–30 Sep 2026) ${top[0].circuitId} (${top[0].substation}, ${top[0].opco}) interrupted the most customers: ${fmtInt(top[0].ci)} across ${top[0].events} event${top[0].events > 1 ? 's' : ''}. The top five together account for ${fmtInt(sum(top.map((x) => x.ci)))} customer interruptions.${rowNote(persona)}`,
          table: { columns: ['Circuit', 'Substation', 'Opco', 'Customers interrupted', 'Events', 'Customer minutes'], rows: top.map((x) => [x.circuitId, x.substation, x.opco, fmtInt(x.ci), x.events, fmtCompact(x.cmi)]) },
          chart: { kind: 'bar', labels: top.map((x) => x.circuitId), values: top.map((x) => x.ci), unit: 'customers' },
          sql: `SELECT circuit_id, opco, SUM(customers_interrupted) AS customers_interrupted, COUNT(*) AS events\n  FROM ${DB}.DATA_PRODUCTS.DP_SYSTEM_RELIABILITY\n WHERE outage_date >= '2026-09-01'${opcoWhere(persona)}\n GROUP BY 1, 2\n ORDER BY customers_interrupted DESC\n LIMIT 5;`,
          rows: top.length, rowFiltered: Boolean(allow), explorerTarget: 'CONFORMED_GOLD.DIM_CIRCUIT',
        };
      },
    },
    {
      id: 'S-08', agentId: 'AG-02', pattern: 8, productIds: ['DP-02', 'DP-06'], kpiIds: ['K-25', 'K-24'],
      question: 'How many outages were caused by trees this quarter, and how many spans are overdue for trimming?',
      paraphrases: ['tree outages this quarter and overdue spans', 'vegetation outages and trim backlog', 'how many spans are overdue for trimming', 'tree caused outages q3'],
      terms: [{ text: 'caused by trees', termId: 'T-025' }, { text: 'overdue for trimming', termId: 'T-019' }],
      ruleIds: ['BR-013'],
      semantic: { view: 'SV_RELIABILITY', metrics: ['tree_outages'], dimensions: ['date.outage_month'], filters: ["fiscal_quarter = '2026-Q3'"] },
      doc: { docId: 'DOC-04', chunk: 4 },
      run: ({ persona }) => {
        const t = Q.treeOutagesQuarter(d);
        const v = Q.vegetation(d);
        const allow = allowedOpcos(persona);
        return {
          summary: `In Q3 2026, ${t.tree} of ${t.total} sustained outages (${fmtPct(t.pct)}) were caused by tree contact. ${fmtInt(v.overdue)} of ${fmtInt(v.spans)} inspected spans (${fmtPct(v.pctOverdue)}) are past their trim cycle, so trim-cycle compliance is ${fmtPct(v.compliance)}. The span figures come from Vegetation Risk, which is a Draft product.${allow ? rowNote(persona) : ''}`,
          table: { columns: ['Operating company', 'Spans', 'Overdue', 'Overdue %'], rows: v.byOpco.map((x) => [x.opco, x.spans, x.overdue, fmtPct((x.overdue / Math.max(1, x.spans)) * 100)]) },
          chart: { kind: 'bar', labels: t.byMonth.map((m) => m.month), values: t.byMonth.map((m) => m.tree), unit: 'tree outages' },
          sql: `SELECT COUNT_IF(cause = 'Tree contact') AS tree_outages, COUNT(*) AS outages\n  FROM ${DB}.DATA_PRODUCTS.DP_SYSTEM_RELIABILITY\n WHERE outage_date BETWEEN '2026-07-01' AND '2026-09-30';\n\nSELECT opco, COUNT(*) AS spans, COUNT_IF(is_overdue) AS overdue  -- BR-013\n  FROM ${DB}.DATA_PRODUCTS.DP_VEGETATION_RISK  -- DRAFT, not certified\n GROUP BY opco;`,
          rows: v.byOpco.length + 1, kpiValues: { 'K-25': t.tree, 'K-24': v.pctOverdue, 'K-26': v.compliance },
        };
      },
    },
    {
      id: 'S-09', agentId: 'AG-02', pattern: 9, productIds: ['DP-02'], kpiIds: ['K-07'],
      question: 'Compare SAIFI this year with last year',
      paraphrases: ['saifi this year vs last year', 'interruption frequency year over year', 'how does SAIFI compare to 2025'],
      terms: [{ text: 'SAIFI', termId: 'T-005' }],
      ruleIds: ['BR-012'], instruction: 'Compare like-for-like periods; SAIFI to three decimals.',
      semantic: { view: 'SV_RELIABILITY', metrics: ['saifi'], dimensions: ['date.fiscal_year', 'circuit.opco'], filters: ['Jan–Sep of each year', 'med_flag = FALSE'] },
      doc: { docId: 'DOC-01', chunk: 9 },
      run: ({ persona }) => {
        const allow = allowedOpcos(persona);
        const cur = Q.reliability(d, Q.PERIODS.ytd, true, allow);
        const prev = Q.reliability(d, Q.PERIODS.priorYtd, true, allow);
        const chg = ((cur.total.saifi - prev.total.saifi) / prev.total.saifi) * 100;
        return {
          summary: `SAIFI for January–September 2026 is ${fmtNum(cur.total.saifi, 3)}, compared with ${fmtNum(prev.total.saifi, 3)} for the same months of 2025 — ${chg < 0 ? 'an improvement' : 'a deterioration'} of ${fmtPct(Math.abs(chg))}. Both exclude major event days.${rowNote(persona)}`,
          table: { columns: ['Operating company', 'SAIFI 2025 YTD', 'SAIFI 2026 YTD', 'Change'], rows: cur.rows.map((x, i) => [x.opco, fmtNum(prev.rows[i].saifi, 3), fmtNum(x.saifi, 3), fmtPct(((x.saifi - prev.rows[i].saifi) / prev.rows[i].saifi) * 100)]) },
          chart: { kind: 'bar', labels: ['2025 YTD', '2026 YTD'], values: [prev.total.saifi, cur.total.saifi], unit: 'interruptions' },
          sql: `SELECT YEAR(outage_date) AS fiscal_year, circuit.opco,\n       SUM(customers_interrupted) / MAX(customers_served_opco) AS saifi\n  FROM ${DB}.DATA_PRODUCTS.DP_SYSTEM_RELIABILITY\n WHERE MONTH(outage_date) <= 9 AND YEAR(outage_date) IN (2025, 2026)\n   AND med_flag = FALSE  -- BR-012${opcoWhere(persona)}\n GROUP BY 1, 2;`,
          rows: cur.rows.length * 2, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-07': cur.total.saifi, 'K-08': cur.total.caidi },
        };
      },
    },
    {
      id: 'S-10', agentId: 'AG-03', pattern: 10, productIds: ['DP-04'], kpiIds: ['K-16'],
      question: 'What percentage of Q3 spend was under contract?',
      paraphrases: ['q3 contract compliance', 'spend under contract last quarter', 'how much of our spend was on contract in Q3'],
      terms: [{ text: 'spend under contract', termId: 'T-015' }],
      ruleIds: ['BR-014'],
      semantic: { view: 'SV_PROCUREMENT', metrics: ['spend_under_contract_pct', 'total_spend'], dimensions: [], filters: ["fiscal_quarter = '2026-Q3'"] },
      doc: { docId: 'DOC-03', chunk: 5 },
      run: () => {
        const r = Q.spendUnderContract(d);
        return {
          summary: `${fmtPct(r.pct)} of Q3 2026 spend was under contract: $${fmtNum(r.on / 1e6, 1)} M of $${fmtNum(r.total / 1e6, 1)} M. Spend under contract is the share of PO spend placed against an active outline agreement; the remaining $${fmtNum(r.off / 1e6, 1)} M is maverick spend.`,
          table: { columns: ['Measure', 'Q3 2026'], rows: [['Total spend', fmtUsd(r.total, 0)], ['On contract', fmtUsd(r.on, 0)], ['Off contract (maverick)', fmtUsd(r.off, 0)], ['Spend under contract %', fmtPct(r.pct)]] },
          chart: { kind: 'bar', labels: ['On contract', 'Off contract'], values: [round(r.on / 1e6, 2), round(r.off / 1e6, 2)], unit: '$M' },
          sql: `SELECT SUM(IFF(on_contract, spend_usd, 0)) / SUM(spend_usd) * 100 AS spend_under_contract_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_PROCUREMENT_SPEND\n WHERE po_date BETWEEN '2026-07-01' AND '2026-09-30';`,
          rows: 1, kpiValues: { 'K-16': r.pct },
        };
      },
    },
    {
      id: 'S-11', agentId: 'AG-03', pattern: 11, productIds: ['DP-04'], kpiIds: ['K-17'],
      question: 'Which suppliers have OTIF below 90%?',
      paraphrases: ['suppliers under 90 percent on time in full', 'late suppliers', 'vendors with poor delivery performance'],
      terms: [{ text: 'OTIF', termId: 'T-017' }],
      ruleIds: ['BR-015', 'BR-016'],
      semantic: { view: 'SV_PROCUREMENT', metrics: ['otif_pct'], dimensions: ['supplier.supplier_name'], filters: ['otif_pct < 90'] },
      run: () => {
        const all = Q.supplierOtif(d);
        const below = all.filter((s) => s.otifPct < 90);
        return {
          summary: `${below.length} suppliers are below 90% OTIF this fiscal year: ${below.map((s) => `${s.supplier} (${fmtPct(s.otifPct)})`).join(' and ')}. Under rule BR-016 they qualify for a performance improvement plan. Overall OTIF is ${fmtPct((sum(all.map((s) => s.otifPct * s.lines)) / sum(all.map((s) => s.lines))))}.`,
          table: { columns: ['Supplier', 'OTIF %', 'PO lines', 'Spend'], rows: all.map((s) => [s.supplier, fmtPct(s.otifPct), s.lines, fmtCompact(s.spend, 'USD')]) },
          chart: { kind: 'bar', labels: all.map((s) => s.supplier.split(' ')[0]), values: all.map((s) => s.otifPct), unit: '%' },
          sql: `SELECT supplier_name, AVG(IFF(otif_flag, 1, 0)) * 100 AS otif_pct, COUNT(*) AS po_lines\n  FROM ${DB}.DATA_PRODUCTS.DP_PROCUREMENT_SPEND\n GROUP BY supplier_name\nHAVING otif_pct < 90\n ORDER BY otif_pct;`,
          rows: below.length, kpiValues: { 'K-17': round((d.poLines.filter((l) => l.otif).length / d.poLines.length) * 100, 1) },
          explorerTarget: 'CONFORMED_GOLD.DIM_SUPPLIER',
        };
      },
    },
    {
      id: 'S-12', agentId: 'AG-03', pattern: 12, productIds: ['DP-04'], kpiIds: ['K-19'],
      question: 'Where is maverick spend highest by category?',
      paraphrases: ['maverick spend by category', 'off contract spend by category', 'which categories have the most rogue spend'],
      terms: [{ text: 'maverick spend', termId: 'T-016' }],
      ruleIds: ['BR-014'],
      semantic: { view: 'SV_PROCUREMENT', metrics: ['maverick_spend'], dimensions: ['spend.category'], filters: ['FY 2026 (Oct–Sep)'] },
      doc: { docId: 'DOC-03', chunk: 5 },
      run: () => {
        const r = Q.maverickByCategory(d);
        const total = sum(r.map((x) => x.maverick));
        return {
          summary: `Maverick spend — spend placed outside an active contract (term T-016) — totals $${fmtNum(total / 1e6, 1)} M this fiscal year. It is highest in ${r[0].category} ($${fmtNum(r[0].maverick / 1e6, 1)} M, ${fmtPct(r[0].pct)} of the category) and ${r[1].category} ($${fmtNum(r[1].maverick / 1e6, 1)} M).`,
          table: { columns: ['Category', 'Maverick spend', 'Share of category'], rows: r.map((x) => [x.category, fmtCompact(x.maverick, 'USD'), fmtPct(x.pct)]) },
          chart: { kind: 'bar', labels: r.map((x) => x.category), values: r.map((x) => round(x.maverick / 1e6, 2)), unit: '$M' },
          sql: `SELECT category, SUM(IFF(on_contract, 0, spend_usd)) AS maverick_spend  -- T-016 / BR-014\n  FROM ${DB}.DATA_PRODUCTS.DP_PROCUREMENT_SPEND\n GROUP BY category\n ORDER BY maverick_spend DESC;`,
          rows: r.length, kpiValues: { 'K-19': Math.round(total) },
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
          summary: `${gaps.length} critical data element${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'has' : 'have'} no steward: ${gaps.map((t) => `${t.term} (${t.id}, owner ${t.owner})`).join(', ')}. It feeds the Draft product Vegetation Risk. Also note ${draft.length} Draft term: ${draft.map((t) => t.term).join(', ')}.`,
          table: { columns: ['Term', 'Id', 'Domain', 'Owner', 'Steward', 'Next action'], rows: gaps.map((t) => [t.term, t.id, t.domain, t.owner, '— none —', 'Assign a grid-ops steward before DP-06 enters certification']) },
          sql: `SELECT t.term_id, t.term, t.domain, t.owner\n  FROM ${DB}.GLOSSARY.BUSINESS_TERM t\n  JOIN ${DB}.GLOSSARY.CDE_REGISTER c USING (term_id)\n WHERE t.is_cde AND c.steward IS NULL;`,
          rows: gaps.length, explorerTarget: 'GLOSSARY.CDE_REGISTER',
        };
      },
    },
    {
      id: 'S-14', agentId: 'AG-04', pattern: 14, productIds: [], kpiIds: [],
      question: 'Where is the term Active Customer used?',
      paraphrases: ['lineage of active customer', 'what uses the active customer definition', 'where does active customer appear'],
      terms: [{ text: 'Active Customer', termId: 'T-002' }],
      ruleIds: ['BR-001'],
      run: () => {
        const p = packRef();
        const t = p.glossary.find((x) => x.id === 'T-002') as GlossaryTerm;
        const metrics = t.metricRefs;
        const products = p.products.filter((pr) => pr.semanticView && metrics.some((m) => m.startsWith(pr.semanticView!)) && pr.kpiIds.includes('K-01'));
        const agents = p.agents.filter((a) => a.productIds.some((x) => products.some((pr) => pr.id === x)));
        return {
          summary: `"Active Customer" (T-002) is mapped to ${t.mappings.length} columns, defines the metric ${metrics.join(', ')}, is enforced by rule BR-001, and flows into ${products.map((x) => `${x.name} (${x.id})`).join(', ')} and the ${agents.map((a) => a.name).join(', ')} agent.`,
          table: { columns: ['Layer', 'Object', 'Usage'], rows: [
            ...t.mappings.map((m) => ['Column', `${m.fqn}.${m.column}`, m.kind]),
            ...metrics.map((m) => ['Semantic metric', m, 'defines']),
            ['Context rule', 'BR-001', 'business rule'],
            ...products.map((x) => ['Data product', `${x.id} ${x.name}`, 'KPI K-01']),
            ...agents.map((a) => ['Agent', a.objectName, 'answers with it']),
          ] },
          sql: `SELECT 'column' AS kind, object_fqn || '.' || column_name AS ref\n  FROM ${DB}.GLOSSARY.TERM_COLUMN_MAP WHERE term_id = 'T-002'\nUNION ALL\nSELECT 'rule', rule_id FROM ${DB}.CONTEXT.BUSINESS_RULES WHERE applies_to_metric ILIKE '%active_customers%'\nUNION ALL\nSELECT 'product', product_id FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY WHERE semantic_view = 'SV_CUSTOMER_360';`,
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
