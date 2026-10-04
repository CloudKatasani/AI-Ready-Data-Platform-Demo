// The 15 Manufacturing agent scenarios (spec section 9). Every number is computed from the in-memory sample.
import type { GlossaryTerm, IndustryPack, Persona, Scenario } from '../../types';
import { round, sum } from '../../mock-snowflake/generators';
import { maskFor } from '../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import type { MfgData } from './data';
import * as Q from './queries';

const DB = 'FPI_AI_PLATFORM';
const allowedBus = (p: Persona) => (p.rowFilter?.column === 'BUSINESS_UNIT' ? p.rowFilter.allowed : undefined);
const rowNote = (p: Persona) => (allowedBus(p) ? ` Row access policy limited results to ${allowedBus(p)!.join(' and ')}.` : '');
const buWhere = (p: Persona) => (allowedBus(p) ? `\n  -- RAP_BU_ACCESS applied by Snowflake: BUSINESS_UNIT IN (${allowedBus(p)!.map((o) => `'${o}'`).join(', ')})` : '');
const Q3 = Q.PERIODS.quarter.months;
const Q2 = Q.PERIODS.prevQuarter.months;

type PackLike = Pick<IndustryPack, 'glossary' | 'products' | 'agents' | 'semanticViews' | 'certificationScript' | 'context' | 'kpis'>;

export function buildScenarios(d: MfgData, packRef: () => PackLike): Scenario[] {
  return [
    {
      id: 'S-01', agentId: 'AG-01', pattern: 1, productIds: ['DP-01'], kpiIds: ['K-01', 'K-02', 'K-03', 'K-04'],
      question: 'What was OEE by business unit last quarter?',
      paraphrases: ['OEE by business unit last quarter', 'overall equipment effectiveness per business unit in Q3', 'business unit OEE for Q3 2026', 'how did OEE compare across business units last quarter'],
      terms: [{ text: 'OEE', termId: 'T-004' }, { text: 'business unit', termId: 'T-003' }],
      ruleIds: ['BR-001'], instruction: 'Report OEE and its components to one decimal; name the quarter.',
      semantic: { view: 'SV_PLANT_PERFORMANCE', metrics: ['oee_pct', 'availability_pct', 'performance_pct', 'quality_rate_pct'], dimensions: ['line.business_unit'], filters: ["fiscal_quarter = '2026-Q3'"] },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const r = Q.oeeByBu(d, Q3, allow);
        const top = [...r.rows].sort((a, b) => b.oee - a.oee)[0];
        const low = [...r.rows].sort((a, b) => a.oee - b.oee)[0];
        return {
          summary: `OEE in Q3 2026 (Jul–Sep) was ${fmtPct(r.total.oee)} ${allow ? 'across your business units' : 'company-wide'} — availability ${fmtPct(r.total.availability)} × performance ${fmtPct(r.total.performance)} × quality ${fmtPct(r.total.quality)}, with planned downtime excluded. ${top.bu} was highest at ${fmtPct(top.oee)}; ${low.bu} lowest at ${fmtPct(low.oee)}.${rowNote(persona)}`,
          table: { columns: ['Business unit', 'OEE', 'Availability', 'Performance', 'Quality', 'Lines'], rows: r.rows.map((x) => [x.bu, fmtPct(x.oee), fmtPct(x.availability), fmtPct(x.performance), fmtPct(x.quality), x.lines]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.bu), values: r.rows.map((x) => x.oee), unit: '%' },
          sql: `SELECT line.business_unit,\n       oee_pct, availability_pct, performance_pct, quality_rate_pct\n  FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_PLANT_PERFORMANCE\n       METRICS oee_pct, availability_pct, performance_pct, quality_rate_pct\n       DIMENSIONS line.business_unit\n       WHERE date.fiscal_quarter = '2026-Q3')  -- BR-001 planned downtime excluded${buWhere(persona)}\n ORDER BY oee_pct DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow),
          kpiValues: allow ? undefined : { 'K-01': r.total.oee, 'K-02': r.total.availability, 'K-03': r.total.performance, 'K-04': r.total.quality, 'K-06': Math.round(r.total.unplanned / 60) },
        };
      },
    },
    {
      id: 'S-02', agentId: 'AG-01', pattern: 2, productIds: ['DP-01'], kpiIds: ['K-07'],
      question: 'How many active production lines ran last month?',
      paraphrases: ['active production lines last month', 'how many production lines are active', 'number of active lines in September', 'count of active production lines'],
      terms: [{ text: 'active production lines', termId: 'T-002' }],
      ruleIds: ['BR-003'], instruction: 'State which lines count as active.',
      semantic: { view: 'SV_PLANT_PERFORMANCE', metrics: ['active_lines'], dimensions: ['line.business_unit'], filters: ['Active Production Line rule BR-003'] },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const r = Q.activeLines(d, allow);
        const idle = r.statusActive - r.active.length;
        const bus = [...new Set(d.lines.filter((l) => !allow || allow.includes(l.bu)).map((l) => l.bu))];
        return {
          summary: `${r.active.length} production lines were active in September 2026. "Active" follows rule BR-003: status Active and scheduled production in the last 30 days, which excludes ${idle} Active-status line${idle === 1 ? '' : 's'} with no shifts since August and ${r.decommissioned} decommissioned line${r.decommissioned === 1 ? '' : 's'} (${r.all} lines in the master).${rowNote(persona)}`,
          table: {
            columns: ['Business unit', 'Lines in master', 'Status Active', 'Active (BR-003)'],
            rows: bus.map((b) => { const ls = d.lines.filter((l) => l.bu === b); return [b, ls.length, ls.filter((l) => l.status === 'Active').length, r.active.filter((l) => l.bu === b).length]; }),
          },
          chart: { kind: 'bar', labels: bus, values: bus.map((b) => r.active.filter((l) => l.bu === b).length), unit: 'lines' },
          sql: `SELECT line.business_unit, COUNT(DISTINCT line.line_id) AS active_lines\n  FROM ${DB}.DATA_PRODUCTS.DP_PRODUCTION_OEE p\n  JOIN ${DB}.CONFORMED_GOLD.DIM_LINE line USING (line_id)\n WHERE line.line_status = 'Active'\n   AND p.production_date > DATEADD(day, -30, '2026-09-30')  -- BR-003${buWhere(persona)}\n GROUP BY 1;`,
          rows: bus.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-07': r.active.length },
        };
      },
    },
    {
      id: 'S-03', agentId: 'AG-01', pattern: 3, productIds: ['DP-01'], kpiIds: ['K-01'],
      question: 'Which shift leads had the lowest OEE last month?',
      paraphrases: ['shift leads with the lowest OEE in September', 'lowest OEE by shift lead last month', 'which shift leads ran the lowest OEE', 'shift lead OEE ranking last month'],
      terms: [{ text: 'shift leads', termId: 'T-001' }, { text: 'OEE', termId: 'T-004' }],
      ruleIds: ['BR-001', 'BR-002'], instruction: 'Never reveal PII unless the role may see it.',
      semantic: { view: 'SV_PLANT_PERFORMANCE', metrics: ['oee_pct'], dimensions: ['operator.shift_lead', 'line.line_id'], filters: ["production_date BETWEEN '2026-09-01' AND '2026-09-30'", 'at least 8 shifts led'] },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const list = Q.shiftLeadOee(d, Q.PERIODS.month, allow);
        const masked = !persona.unmasked.includes('PII');
        const shown = list.slice(0, 8);
        return {
          summary: `${list.length} shift leads led 8 or more shifts in September 2026. The ${shown.length} with the lowest OEE are listed; the lowest ran ${fmtPct(shown[0].oee)} over ${shown[0].shifts} shifts on ${shown[0].lines}, with ${shown[0].below65} shifts below the 65% review threshold (BR-002). Low OEE usually follows the line, not the person — compare with the line's own trend.${masked ? ' Names are masked by MP_MASK_PII for your role.' : ''}${rowNote(persona)}`,
          table: {
            columns: ['Badge', 'Shift lead', 'Business unit', 'Line', 'Shifts', 'OEE', 'Shifts < 65%'],
            rows: shown.map((x) => [x.op.id, String(maskFor(persona, 'PII', `${x.op.first} ${x.op.last}`)), x.op.bu, x.lines, x.shifts, fmtPct(x.oee), x.below65]),
            masked: masked ? [1] : [],
          },
          sql: `SELECT shift_lead_id, shift_lead_name, business_unit, line_id, COUNT(*) AS shifts,\n       SUM(oee_pct * planned_production_min) / SUM(planned_production_min) AS oee_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_PRODUCTION_OEE\n WHERE production_date BETWEEN '2026-09-01' AND '2026-09-30'${buWhere(persona)}\n GROUP BY 1, 2, 3, 4\nHAVING COUNT(*) >= 8\n ORDER BY oee_pct\n LIMIT 8;`,
          rows: shown.length, maskedColumns: masked ? ['SHIFT_LEAD_NAME'] : [], rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_PRODUCTION_OEE',
        };
      },
    },
    {
      id: 'S-04', agentId: 'AG-01', pattern: 4, productIds: ['DP-05'], kpiIds: ['K-21'],
      question: 'What was our on-time delivery rate last month?',
      paraphrases: ['on-time delivery rate last month', 'customer on-time delivery for September', 'what is our OTD this month', 'how many customer orders were delivered on time last month'],
      terms: [{ text: 'on-time delivery', termId: 'T-024' }],
      ruleIds: ['BR-014'], instruction: 'Report percentages to one decimal and show the trend.',
      semantic: { view: 'SV_ORDER_DELIVERY', metrics: ['on_time_delivery_pct'], dimensions: ['date.delivery_month'], filters: ["delivery_month = '2026-09-01'"] },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const trend = Q.deliveryTrend(d, allow);
        const cur = trend[trend.length - 1];
        const prev = trend[trend.length - 2];
        return {
          summary: `On-time delivery in September 2026 was ${fmtPct(cur.otd)}: ${fmtInt(cur.lines - cur.late)} of ${fmtInt(cur.lines)} order lines in the sample (≈ ${fmtCompact(cur.scaled)} order lines company-wide) arrived on or before the first promised date, ${cur.otd >= prev.otd ? 'up' : 'down'} ${fmtNum(Math.abs(cur.otd - prev.otd), 1)} points from August. Fill rate was ${fmtPct(cur.fill)} and order lead time ${fmtNum(cur.lead, 1)} days.${rowNote(persona)}`,
          table: { columns: ['Month', 'On-time delivery', 'Fill rate', 'Lead time (days)', 'Order lines (sample)'], rows: trend.map((t) => [t.month, fmtPct(t.otd), fmtPct(t.fill), fmtNum(t.lead, 1), fmtInt(t.lines)]) },
          chart: { kind: 'line', labels: trend.map((t) => t.month.slice(5)), values: trend.map((t) => t.otd), unit: '%' },
          sql: `SELECT DATE_TRUNC('month', delivered_date) AS delivery_month,\n       AVG(IFF(on_time_flag, 1, 0)) * 100 AS on_time_delivery_pct  -- BR-014 first promise date\n  FROM ${DB}.DATA_PRODUCTS.DP_ORDER_TO_DELIVERY\n WHERE delivered_date >= '2026-04-01'${buWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: trend.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-21': cur.otd, 'K-22': cur.lead, 'K-23': cur.fill, 'K-24': cur.scaled },
        };
      },
    },
    {
      id: 'S-05', agentId: 'AG-01', pattern: 5, productIds: ['DP-01'], kpiIds: ['K-05'],
      question: 'Show daily units produced over the last 30 days',
      paraphrases: ['daily units produced last 30 days', 'units produced per day this month', 'daily production output trend', 'daily throughput over the last 30 days'],
      terms: [{ text: 'units produced', termId: 'T-010' }],
      ruleIds: ['BR-007'],
      semantic: { view: 'SV_PLANT_PERFORMANCE', metrics: ['units_produced', 'oee_pct'], dimensions: ['date.production_date'], filters: ["production_date BETWEEN '2026-09-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const days = Q.dailyUnits(d, Q.PERIODS.last30, allow);
        const total = sum(days.map((x) => x.units));
        const weekdays = days.filter((x) => { const w = new Date(`${x.day}T00:00:00Z`).getUTCDay(); return w > 0 && w < 6; });
        const peak = days.reduce((a, b) => (b.units > a.units ? b : a));
        return {
          summary: `Over the last 30 days (1–30 Sep 2026) the lines produced ${fmtCompact(total)} good units — about ${fmtCompact(sum(weekdays.map((x) => x.units)) / Math.max(1, weekdays.length))} per weekday; most lines do not run on Sundays. The peak was ${peak.day} with ${fmtCompact(peak.units)} units.${rowNote(persona)}`,
          table: { columns: ['Date', 'Good units', 'OEE'], rows: days.map((x) => [x.day, fmtInt(x.units), fmtPct(x.oee)]) },
          chart: { kind: 'line', labels: days.map((x) => x.day.slice(5)), values: days.map((x) => x.units), unit: 'units' },
          sql: `SELECT production_date, SUM(good_units) AS units_produced\n  FROM ${DB}.DATA_PRODUCTS.DP_PRODUCTION_OEE\n WHERE production_date BETWEEN '2026-09-01' AND '2026-09-30'${buWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: days.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-05': total },
        };
      },
    },
    {
      id: 'S-06', agentId: 'AG-02', pattern: 6, productIds: ['DP-01'], kpiIds: ['K-01'],
      question: 'Which lines had OEE below 65% last week, and what drove the losses?',
      paraphrases: ['lines with OEE below 65% last week', 'which lines had OEE under 65 percent last week', 'what drove the OEE losses on lines below 65% last week', 'OEE below 65% by line last week and loss drivers'],
      terms: [{ text: 'OEE', termId: 'T-004' }, { text: 'losses', termId: 'T-009' }],
      ruleIds: ['BR-001', 'BR-002'], instruction: 'State OEE as availability × performance × quality with planned downtime excluded; name the dominant loss per line.',
      semantic: { view: 'SV_PLANT_PERFORMANCE', metrics: ['oee_pct', 'availability_pct', 'performance_pct', 'quality_rate_pct'], dimensions: ['line.line_id'], filters: ["production_date BETWEEN '2026-09-21' AND '2026-09-27'", 'oee_pct < 65'] },
      doc: { docId: 'DOC-01', chunk: 7 },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const r = Q.linesBelowOee(d, Q.PERIODS.lastWeek, 65, allow);
        const b = r.below;
        const worst = b[0];
        const drivers = b.map((x) => `${x.lineId} ${fmtPct(x.agg.oee)} (${x.driver.toLowerCase()} loss${x.driver === 'Availability' ? `, ${fmtNum(x.topReasonHours, 1)} h of ${x.topReason.toLowerCase()}` : x.driver === 'Performance' ? `, performance ${fmtPct(x.agg.performance)}` : `, quality ${fmtPct(x.agg.quality)}`})`);
        return {
          summary: b.length
            ? `${b.length} of ${r.lines} lines ran below 65% OEE last week (Mon 21 – Sun 27 Sep 2026), against ${fmtPct(r.total.oee)} ${allow ? 'for your business units' : 'company-wide'}. OEE = availability × performance × quality, with planned downtime excluded from the time base. ${worst.lineId} (${worst.plant}, ${worst.type}) was lowest at ${fmtPct(worst.agg.oee)}, driven by ${worst.driver.toLowerCase()} loss. By line: ${drivers.join('; ')}.${rowNote(persona)}`
            : `No line ran below 65% OEE last week (Mon 21 – Sun 27 Sep 2026); OEE was ${fmtPct(r.total.oee)}.${rowNote(persona)}`,
          table: { columns: ['Line', 'Plant', 'Business unit', 'OEE', 'Availability', 'Performance', 'Quality', 'Main loss', 'Top unplanned reason (h)'], rows: b.map((x) => [x.lineId, x.plant, x.bu, fmtPct(x.agg.oee), fmtPct(x.agg.availability), fmtPct(x.agg.performance), fmtPct(x.agg.quality), x.driver, `${x.topReason} (${fmtNum(x.topReasonHours, 1)})`]) },
          chart: { kind: 'bar', labels: b.map((x) => x.lineId), values: b.map((x) => x.agg.oee), unit: '%' },
          sql: `SELECT line.line_id, line.plant_name,\n       availability_pct, performance_pct, quality_rate_pct,\n       oee_pct  -- BR-001: availability × performance × quality; planned downtime excluded\n  FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_PLANT_PERFORMANCE\n       METRICS oee_pct, availability_pct, performance_pct, quality_rate_pct\n       DIMENSIONS line.line_id, line.plant_name\n       WHERE date.production_date BETWEEN '2026-09-21' AND '2026-09-27')${buWhere(persona)}\n WHERE oee_pct < 65  -- BR-002 tier-3 review threshold\n ORDER BY oee_pct;`,
          rows: b.length, rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_PRODUCTION_OEE',
        };
      },
    },
    {
      id: 'S-07', agentId: 'AG-02', pattern: 7, productIds: ['DP-02'], kpiIds: ['K-12'],
      question: 'Top 5 defect codes by cost of poor quality last quarter',
      paraphrases: ['top defect codes by COPQ in Q3', 'which defect codes cost us the most last quarter', 'highest cost of poor quality by defect code', 'top five defects by quality cost'],
      terms: [{ text: 'cost of poor quality', termId: 'T-015' }, { text: 'defect codes', termId: 'T-016' }],
      ruleIds: ['BR-009'],
      semantic: { view: 'SV_PLANT_PERFORMANCE', metrics: ['copq_usd', 'ncr_count'], dimensions: ['inspection.defect_code'], filters: ["fiscal_quarter = '2026-Q3'"] },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const all = Q.copqByDefect(d, Q3, allow);
        const top = all.slice(0, 5);
        const total = sum(all.map((x) => x.copq));
        return {
          summary: `Cost of poor quality in Q3 2026 was ${fmtCompact(total, 'USD')} across ${fmtInt(sum(all.map((x) => x.ncrs)))} NCRs. ${top[0].code} cost the most (${fmtCompact(top[0].copq, 'USD')}, ${top[0].ncrs} NCRs), followed by ${top[1].code} (${fmtCompact(top[1].copq, 'USD')}). The top five account for ${fmtPct((sum(top.map((x) => x.copq)) / total) * 100)} of COPQ.${rowNote(persona)}`,
          table: { columns: ['Defect code', 'COPQ', 'NCRs', 'Scrapped lots'], rows: top.map((x) => [x.code, fmtUsd(x.copq, 0), x.ncrs, x.scrapLots]) },
          chart: { kind: 'bar', labels: top.map((x) => x.code), values: top.map((x) => round(x.copq / 1000, 1)), unit: '$K' },
          sql: `SELECT defect_code, SUM(copq_usd) AS copq_usd, COUNT(ncr_number) AS ncrs  -- BR-009\n  FROM ${DB}.DATA_PRODUCTS.DP_QUALITY_DEFECTS\n WHERE inspection_date BETWEEN '2026-07-01' AND '2026-09-30'\n   AND ncr_number IS NOT NULL${buWhere(persona)}\n GROUP BY 1\n ORDER BY copq_usd DESC\n LIMIT 5;`,
          rows: top.length, rowFiltered: Boolean(allow), explorerTarget: 'CONFORMED_GOLD.FCT_QUALITY_INSPECTION',
          kpiValues: allow ? undefined : { 'K-12': round(total, 0), 'K-11': sum(all.map((x) => x.ncrs)) },
        };
      },
    },
    {
      id: 'S-08', agentId: 'AG-02', pattern: 8, productIds: ['DP-01', 'DP-06'], kpiIds: ['K-25', 'K-26'],
      question: 'What was energy per unit and scope 2 emissions by business unit last quarter?',
      paraphrases: ['energy per unit by business unit last quarter', 'scope 2 emissions last quarter', 'kwh per unit and carbon emissions by business unit', 'energy intensity and emissions in Q3'],
      terms: [{ text: 'energy per unit', termId: 'T-027' }, { text: 'scope 2 emissions', termId: 'T-028' }],
      ruleIds: ['BR-016'],
      semantic: { view: 'SV_PLANT_PERFORMANCE', metrics: ['units_produced'], dimensions: ['line.business_unit'], filters: ["fiscal_quarter = '2026-Q3'"] },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const e = Q.energy(d, Q3, allow);
        const hi = [...e.rows].sort((a, b) => b.kwhPerUnit - a.kwhPerUnit)[0];
        return {
          summary: `In Q3 2026 the lines used ${fmtCompact(e.kwh)} kWh for ${fmtCompact(e.good)} good units — ${fmtNum(e.kwhPerUnit, 2)} kWh per unit — and location-based scope 2 emissions were ${fmtInt(e.tco2e)} tCO2e. ${hi.bu} is the most energy-intensive at ${fmtNum(hi.kwhPerUnit, 2)} kWh per unit${hi.bu === 'Aerospace Components' ? ' (heavy machining and heat treat, low unit volumes)' : ''}. Energy and emissions come from Energy & Emissions, which is a Draft product.${rowNote(persona)}`,
          table: { columns: ['Business unit', 'Energy (MWh)', 'Good units', 'kWh per unit', 'Scope 2 (tCO2e)'], rows: e.rows.map((x) => [x.bu, fmtNum(x.kwh / 1000, 0), fmtCompact(x.good), fmtNum(x.kwhPerUnit, 2), fmtInt(x.tco2e)]) },
          chart: { kind: 'bar', labels: e.rows.map((x) => x.bu), values: e.rows.map((x) => x.tco2e), unit: 'tCO2e' },
          sql: `SELECT business_unit, SUM(energy_kwh) AS energy_kwh, SUM(good_units) AS good_units,\n       SUM(energy_kwh) / SUM(good_units) AS kwh_per_unit,\n       SUM(co2e_kg) / 1000 AS scope2_tco2e  -- BR-016 location-based\n  FROM ${DB}.DATA_PRODUCTS.DP_ENERGY_EMISSIONS  -- DRAFT, not certified\n WHERE energy_date BETWEEN '2026-07-01' AND '2026-09-30'${buWhere(persona)}\n GROUP BY business_unit;`,
          rows: e.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-25': e.kwhPerUnit, 'K-26': e.tco2e },
        };
      },
    },
    {
      id: 'S-09', agentId: 'AG-02', pattern: 9, productIds: ['DP-02'], kpiIds: ['K-08', 'K-09'],
      question: 'Compare first-pass yield and scrap rate this quarter with last quarter',
      paraphrases: ['first-pass yield and scrap rate this quarter vs last quarter', 'scrap rate Q3 versus Q2', 'how did first pass yield change quarter over quarter', 'FPY and scrap compared with last quarter'],
      terms: [{ text: 'first-pass yield', termId: 'T-011' }, { text: 'scrap rate', termId: 'T-012' }],
      ruleIds: ['BR-008', 'BR-006'], instruction: 'Compare like-for-like quarters; rates to one decimal.',
      semantic: { view: 'SV_PLANT_PERFORMANCE', metrics: ['first_pass_yield_pct', 'scrap_rate_pct'], dimensions: ['date.fiscal_quarter', 'line.business_unit'], filters: ["fiscal_quarter IN ('2026-Q2', '2026-Q3')"] },
      doc: { docId: 'DOC-02', chunk: 11 },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const cur = Q.quality(d, Q3, allow);
        const prev = Q.quality(d, Q2, allow);
        const bus = Q.qualityByBu(d, Q3).filter((x) => !allow || allow.includes(x.bu));
        const busPrev = Q.qualityByBu(d, Q2);
        return {
          summary: `First-pass yield was ${fmtPct(cur.fpy)} in Q3 2026 against ${fmtPct(prev.fpy)} in Q2 (${cur.fpy >= prev.fpy ? '+' : '−'}${fmtNum(Math.abs(cur.fpy - prev.fpy), 1)} points). Scrap rate was ${fmtPct(cur.scrapRate, 2)} against ${fmtPct(prev.scrapRate, 2)}, and NCRs ${cur.ncrs < prev.ncrs ? 'fell' : 'rose'} from ${prev.ncrs} to ${cur.ncrs}. Concessions count as first-pass failures (BR-008).${rowNote(persona)}`,
          table: { columns: ['Business unit', 'FPY Q2', 'FPY Q3', 'Scrap Q2', 'Scrap Q3'], rows: bus.map((x) => { const p = busPrev.find((y) => y.bu === x.bu)!; return [x.bu, fmtPct(p.fpy), fmtPct(x.fpy), fmtPct(p.scrapRate, 2), fmtPct(x.scrapRate, 2)]; }) },
          chart: { kind: 'bar', labels: ['FPY Q2', 'FPY Q3'], values: [prev.fpy, cur.fpy], unit: '%' },
          sql: `SELECT date.fiscal_quarter, line.business_unit,\n       first_pass_yield_pct,  -- BR-008\n       scrap_rate_pct\n  FROM SEMANTIC_VIEW(${DB}.SEMANTIC.SV_PLANT_PERFORMANCE\n       METRICS first_pass_yield_pct, scrap_rate_pct\n       DIMENSIONS date.fiscal_quarter, line.business_unit\n       WHERE date.fiscal_quarter IN ('2026-Q2', '2026-Q3'))${buWhere(persona)};`,
          rows: bus.length * 2, rowFiltered: Boolean(allow),
          kpiValues: allow ? undefined : { 'K-08': cur.fpy, 'K-09': cur.scrapRate, 'K-10': cur.ppm, 'K-13': cur.reworkRate },
        };
      },
    },
    {
      id: 'S-10', agentId: 'AG-03', pattern: 10, productIds: ['DP-04'], kpiIds: ['K-18'],
      question: 'What was supplier OTIF last quarter?',
      paraphrases: ['supplier on time in full in Q3', 'supplier OTIF for last quarter', 'how did suppliers perform on OTIF last quarter'],
      terms: [{ text: 'supplier OTIF', termId: 'T-021' }],
      ruleIds: ['BR-012'],
      semantic: { view: 'SV_SUPPLIER_PERFORMANCE', metrics: ['otif_pct', 'supplier_ppm', 'lead_time_days'], dimensions: [], filters: ["fiscal_quarter = '2026-Q3'"] },
      doc: { docId: 'DOC-04', chunk: 6 },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const r = Q.supplierPerf(d, Q3, allow);
        return {
          summary: `Supplier OTIF in Q3 2026 was ${fmtPct(r.otif)} across ${fmtInt(r.receipts)} receipts: ${fmtPct(r.onTime)} arrived on or before the promised date, and the rest of the gap was short shipments. Supplier OTIF is the share of receipts delivered on time and in full against the PO promise date. Incoming PPM was ${fmtInt(r.ppm)} and average lead time ${fmtNum(r.lead, 1)} days.${rowNote(persona)}`,
          table: { columns: ['Measure', 'Q3 2026'], rows: [['Receipts', fmtInt(r.receipts)], ['On time', fmtPct(r.onTime)], ['OTIF', fmtPct(r.otif)], ['Supplier PPM', fmtInt(r.ppm)], ['Lead time (days)', fmtNum(r.lead, 1)]] },
          chart: { kind: 'bar', labels: ['On time', 'OTIF'], values: [r.onTime, r.otif], unit: '%' },
          sql: `SELECT AVG(IFF(otif_flag, 1, 0)) * 100 AS otif_pct,  -- BR-012 per receipt\n       SUM(qty_rejected) / SUM(qty_received) * 1e6 AS supplier_ppm\n  FROM ${DB}.DATA_PRODUCTS.DP_SUPPLIER_PERFORMANCE\n WHERE received_date BETWEEN '2026-07-01' AND '2026-09-30'${buWhere(persona)};`,
          rows: 1, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-18': r.otif, 'K-19': r.ppm, 'K-20': r.lead },
        };
      },
    },
    {
      id: 'S-11', agentId: 'AG-03', pattern: 11, productIds: ['DP-03'], kpiIds: ['K-14'],
      question: 'Which assets have MTBF below 150 hours this quarter?',
      paraphrases: ['assets with MTBF under 150 hours', 'which assets have low MTBF this quarter', 'assets below 150 hours mean time between failures'],
      terms: [{ text: 'MTBF', termId: 'T-017' }],
      ruleIds: ['BR-010', 'BR-011'],
      semantic: { view: 'SV_ASSET_MAINTENANCE', metrics: ['mtbf_hours', 'failures', 'mttr_hours'], dimensions: ['asset.asset_id', 'asset.criticality'], filters: ["fiscal_quarter = '2026-Q3'", 'mtbf_hours < 150'] },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const all = Q.assetMtbf(d, Q3).filter((x) => !allow || allow.includes(x.a.bu));
        const below = all.filter((x) => x.failures > 0 && x.mtbf < 150).sort((a, b) => a.mtbf - b.mtbf);
        const overall = Q.maintenance(d, Q3, (a) => !allow || allow.includes(a.bu));
        const crit = below.filter((x) => x.a.criticality === 'A').length;
        const shown = below.slice(0, 10);
        return {
          summary: `${below.length} assets ran below 150 hours MTBF in Q3 2026 (fleet MTBF ${fmtNum(overall.mtbf, 1)} hours, MTTR ${fmtNum(overall.mttr, 2)} hours). ${crit} of them are criticality A and enter a reliability review under BR-011. The lowest is ${shown[0].a.id} (${shown[0].a.type}) at ${fmtNum(shown[0].mtbf, 1)} hours over ${shown[0].failures} failures.${rowNote(persona)}`,
          table: { columns: ['Asset', 'Type', 'Criticality', 'Business unit', 'Operating hours', 'Failures', 'MTBF (h)', 'MTTR (h)'], rows: shown.map((x) => [x.a.id, x.a.type, x.a.criticality, x.a.bu, fmtInt(x.opHours), x.failures, fmtNum(x.mtbf, 1), fmtNum(x.mttr, 2)]) },
          chart: { kind: 'bar', labels: shown.map((x) => x.a.id), values: shown.map((x) => x.mtbf), unit: 'hours' },
          sql: `SELECT asset_id, asset_type, criticality,\n       SUM(operating_hours) / COUNT_IF(wo_type = 'Corrective') AS mtbf_hours  -- BR-010\n  FROM ${DB}.DATA_PRODUCTS.DP_ASSET_MAINTENANCE\n WHERE event_date BETWEEN '2026-07-01' AND '2026-09-30'${buWhere(persona)}\n GROUP BY 1, 2, 3\nHAVING mtbf_hours < 150  -- BR-011 reliability review\n ORDER BY mtbf_hours;`,
          rows: shown.length, rowFiltered: Boolean(allow), explorerTarget: 'CONFORMED_GOLD.DIM_ASSET',
          kpiValues: allow ? undefined : { 'K-14': overall.mtbf, 'K-15': overall.mttr, 'K-17': overall.failures },
        };
      },
    },
    {
      id: 'S-12', agentId: 'AG-03', pattern: 12, productIds: ['DP-03'], kpiIds: ['K-16'],
      question: 'What share of maintenance work was planned this quarter?',
      paraphrases: ['planned maintenance share this quarter', 'how much maintenance work was preventive in Q3', 'planned maintenance percentage by business unit'],
      terms: [{ text: 'planned', termId: 'T-019' }],
      ruleIds: ['BR-011'],
      semantic: { view: 'SV_ASSET_MAINTENANCE', metrics: ['planned_maintenance_pct'], dimensions: ['line.business_unit'], filters: ["fiscal_quarter = '2026-Q3'"] },
      doc: { docId: 'DOC-03', chunk: 9 },
      run: ({ persona }) => {
        const allow = allowedBus(persona);
        const all = Q.maintenance(d, Q3, (a) => !allow || allow.includes(a.bu));
        const bus = [...new Set(d.assets.map((a) => a.bu))].filter((b) => !allow || allow.includes(b));
        const rows = bus.map((b) => ({ bu: b, ...Q.maintenance(d, Q3, (a) => a.bu === b) }));
        return {
          summary: `${fmtPct(all.plannedPct)} of maintenance work orders in Q3 2026 were planned: ${fmtInt(all.pm)} preventive or condition-based work orders against ${fmtInt(all.failures)} corrective ones. Planned Maintenance (T-019) means work raised from a schedule or an IoT condition trigger, not from a failure; the standard asks for at least 80% (BR-011).${rowNote(persona)}`,
          table: { columns: ['Business unit', 'Planned work orders', 'Corrective work orders', 'Planned %'], rows: rows.map((x) => [x.bu, fmtInt(x.pm), fmtInt(x.failures), fmtPct(x.plannedPct)]) },
          chart: { kind: 'bar', labels: rows.map((x) => x.bu), values: rows.map((x) => x.plannedPct), unit: '%' },
          sql: `SELECT business_unit,\n       COUNT_IF(wo_type = 'Preventive') / COUNT(*) * 100 AS planned_maintenance_pct  -- T-019\n  FROM ${DB}.DATA_PRODUCTS.DP_ASSET_MAINTENANCE\n WHERE event_date BETWEEN '2026-07-01' AND '2026-09-30'${buWhere(persona)}\n GROUP BY business_unit;`,
          rows: rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-16': all.plannedPct },
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
        const feeds = (t: GlossaryTerm) => p.products.filter((pr) => t.metricRefs.some((m) => m.startsWith(pr.outputPort) || (pr.semanticView && m.startsWith(pr.semanticView))) || pr.kpiIds.some((k) => p.kpis.find((x) => x.id === k)?.termId === t.id));
        return {
          summary: `${gaps.length} critical data element${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'has' : 'have'} no steward: ${gaps.map((t) => `${t.term} (${t.id}, owner ${t.owner})`).join(', ')}. It feeds the Draft product ${gaps.flatMap(feeds).map((x) => `${x.name} (${x.id})`).join(', ') || 'Energy & Emissions'}. Also note ${draft.length} Draft term: ${draft.map((t) => t.term).join(', ')}.`,
          table: { columns: ['Term', 'Id', 'Domain', 'Owner', 'Steward', 'Next action'], rows: gaps.map((t) => [t.term, t.id, t.domain, t.owner, '— none —', 'Assign a sustainability steward before DP-06 enters certification']) },
          sql: `SELECT t.term_id, t.term, t.domain, t.owner\n  FROM ${DB}.GLOSSARY.BUSINESS_TERM t\n  JOIN ${DB}.GLOSSARY.CDE_REGISTER c USING (term_id)\n WHERE t.is_cde AND c.steward IS NULL;`,
          rows: gaps.length, explorerTarget: 'GLOSSARY.CDE_REGISTER',
        };
      },
    },
    {
      id: 'S-14', agentId: 'AG-04', pattern: 14, productIds: [], kpiIds: [],
      question: 'Where is the term First-Pass Yield used?',
      paraphrases: ['lineage of first-pass yield', 'what uses the first pass yield definition', 'where does first-pass yield appear'],
      terms: [{ text: 'First-Pass Yield', termId: 'T-011' }],
      ruleIds: ['BR-008'],
      run: () => {
        const p = packRef();
        const t = p.glossary.find((x) => x.id === 'T-011') as GlossaryTerm;
        const metrics = t.metricRefs;
        const kpiIds = p.kpis.filter((k) => k.termId === t.id).map((k) => k.id);
        const products = p.products.filter((pr) => pr.kpiIds.some((k) => kpiIds.includes(k)));
        const agents = p.agents.filter((a) => a.productIds.some((x) => products.some((pr) => pr.id === x)));
        const rules = p.context.rules.filter((r) => metrics.includes(r.metric));
        return {
          summary: `"First-Pass Yield" (T-011) is mapped to ${t.mappings.length} columns, defines the metric ${metrics.join(', ')}, is enforced by rule ${rules.map((r) => r.id).join(', ')}, and flows into ${products.map((x) => `${x.name} (${x.id})`).join(', ')} and the ${agents.map((a) => a.name).join(', ')} agent${agents.length > 1 ? 's' : ''}.`,
          table: { columns: ['Layer', 'Object', 'Usage'], rows: [
            ...t.mappings.map((m) => ['Column', `${m.fqn}.${m.column}`, m.kind]),
            ...metrics.map((m) => ['Semantic metric', m, 'defines']),
            ...rules.map((r) => ['Context rule', r.id, 'business rule']),
            ...products.map((x) => ['Data product', `${x.id} ${x.name}`, `KPI ${kpiIds.join(', ')}`]),
            ...agents.map((a) => ['Agent', a.objectName, 'answers with it']),
          ] },
          sql: `SELECT 'column' AS kind, object_fqn || '.' || column_name AS ref\n  FROM ${DB}.GLOSSARY.TERM_COLUMN_MAP WHERE term_id = 'T-011'\nUNION ALL\nSELECT 'rule', rule_id FROM ${DB}.CONTEXT.BUSINESS_RULES WHERE applies_to_metric ILIKE '%first_pass_yield%'\nUNION ALL\nSELECT 'product', product_id FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY WHERE semantic_view = 'SV_PLANT_PERFORMANCE';`,
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
