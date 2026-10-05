// Manufacturing: the scripted AG-01 improvement loop (E10) and preset changes for impact analysis (E11).
import type { Persona, ScenarioContext } from '../../../types';
import type { FeedbackScript, ImpactPreset } from '../../../ext/types';
import { groupBy, sum } from '../../../mock-snowflake/generators';
import { fmtInt } from '../../../lib/format';
import type { MfgData } from '../data';
import { BUSINESS_UNITS } from '../generators.config';
import { activeLines, inMonths, PERIODS } from '../queries';

const DB = 'FPI_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'BUSINESS_UNIT' ? p.rowFilter.allowed : undefined);

export function buildFeedback(d: MfgData): FeedbackScript {
  const q3 = PERIODS.quarter.months;
  const running = new Set(activeLines(d).active.map((l) => l.key));
  /** Q3 good units by business unit; with the rule, only lines still active (BR-003) at quarter end. */
  const output = (ruleApplied: boolean, p: Persona) => {
    const allow = allowOf(p);
    const rows = d.production.filter((x) => inMonths(x.date, q3) && (!allow || allow.includes(x.bu)) && (!ruleApplied || running.has(x.lineKey)));
    const g = groupBy(rows, (x) => x.bu);
    const by = BUSINESS_UNITS.filter((b) => g.has(b.name)).map((b) => ({ bu: b.name, units: sum(g.get(b.name)!.map((x) => x.good)), lines: new Set(g.get(b.name)!.map((x) => x.lineKey)).size }));
    const excluded = [...new Set(d.production.filter((x) => inMonths(x.date, q3) && (!allow || allow.includes(x.bu)) && !running.has(x.lineKey)).map((x) => x.lineId))];
    return { total: sum(by.map((b) => b.units)), by, allow, excluded };
  };
  /** The wrong join: production joined to DIM_OPERATOR on LINE_ID, so each shift repeats once per operator on the line. */
  const fanout = (p: Persona) => {
    const allow = allowOf(p);
    const crew = new Map<number, number>();
    for (const o of d.operators) crew.set(o.lineKey, (crew.get(o.lineKey) ?? 0) + 1);
    return sum(d.production.filter((x) => inMonths(x.date, q3) && (!allow || allow.includes(x.bu)) && running.has(x.lineKey)).map((x) => x.good * (crew.get(x.lineKey) ?? 1)));
  };
  const compute = (ruleApplied: boolean, { persona }: ScenarioContext) => {
    const r = output(ruleApplied, persona);
    return {
      value: r.total,
      valueText: `${fmtInt(r.total)} units`,
      summary: `Q3 2026 output was ${fmtInt(r.total)} good units across ${sum(r.by.map((b) => b.lines))} lines.${ruleApplied ? ` Lines idled or decommissioned during the quarter (${r.excluded.join(', ')}) are excluded under rule BR-017; their output is in the capacity-change log.` : ''}${r.allow ? ` Row access policy limited results to ${r.allow.join(' and ')}.` : ''}`,
      table: { columns: ['Business unit', 'Good units', 'Lines'], rows: r.by.map((b) => [b.bu, fmtInt(b.units), b.lines]) },
      sql: `SELECT business_unit, SUM(good_units) AS units_produced\n  FROM ${DB}.DATA_PRODUCTS.DP_PRODUCTION_OEE\n WHERE production_date BETWEEN '2026-07-01' AND '2026-09-30'\n${ruleApplied ? '   AND line_id IN (SELECT line_id FROM active_lines)   -- BR-017: exclude idled and decommissioned lines\n' : ''} GROUP BY business_unit;`,
    };
  };
  return {
    agentId: 'AG-01',
    question: 'How many good units did we produce last quarter?',
    paraphrases: ['What was our total good output in Q3?', 'good units produced by business unit last quarter'],
    comment: 'This should leave out lines we shut down during the quarter',
    termId: 'T-010',
    productIds: ['DP-01'],
    rule: { id: 'BR-017', domain: 'Operations', text: 'Quarterly output and capacity comparisons count only lines still active at quarter end (BR-003); output from lines idled or decommissioned during the quarter is reported in the capacity-change log.', metric: 'SV_PLANT_PERFORMANCE.units_produced', sourceDoc: 'Manufacturing master data standard' },
    synonym: { term: 'Units Produced', synonym: 'good pieces', scope: 'Operations' },
    relationship: { view: 'SV_PLANT_PERFORMANCE', label: 'production → shift lead', detail: 'FCT_LINE_PRODUCTION joins DIM_OPERATOR on SHIFT_LEAD_KEY = OPERATOR_KEY (many-to-one), not on LINE_ID' },
    compute,
    evalItems: [
      { id: 'AG-01-Q45', question: 'How many good units did we produce last quarter?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes idled lines)` },
      { id: 'AG-01-Q46', question: 'What was our total good output in Q3?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes idled lines)` },
      { id: 'AG-01-Q47', question: 'Good units produced by business unit last quarter', category: 'missing_rule', fix: 'rule', expected: (c) => `${compute(true, c).table!.rows.length} business units, ${compute(true, c).valueText} total`, wrong: (c) => `${compute(false, c).table!.rows.length} business units, ${compute(false, c).valueText} total (idled lines counted)` },
      { id: 'AG-01-Q48', question: 'How many good pieces did we make last quarter?', category: 'ambiguous_term', fix: 'synonym', expected: (c) => compute(true, c).valueText, wrong: () => 'Asked to clarify: “good pieces” is not a known term' },
      { id: 'AG-01-Q49', question: 'Good units last quarter from running lines only', category: 'ambiguous_term', fix: 'verified_query', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (“running lines” read as all lines)` },
      { id: 'AG-01-Q50', question: 'What were good units per shift lead last quarter?', category: 'wrong_join', fix: 'relationship', expected: (c) => compute(true, c).valueText, wrong: (c) => `${fmtInt(fanout(c.persona))} units (joined operators on line, not shift lead)` },
    ],
  };
}

export const impactPresets: ImpactPreset[] = [
  { id: 'IP-1', label: 'Customer contact email type change', objectFqn: 'RAW_BRONZE.ERP_SALES_ORDER_CDC', column: 'CONTACT_EMAIL', change: 'type', aliases: ['CUSTOMER_CONTACT'], note: 'ERP widens CONTACT_EMAIL from VARCHAR(120) to VARCHAR(254).' },
  { id: 'IP-2', label: 'New downtime reason code TLCHG', objectFqn: 'RAW_BRONZE.MES_LINE_EVENT_CDC', column: 'DOWN_RSN_CD', change: 'semantics', aliases: ['LOSS_REASON', 'TOP_LOSS_REASON'], note: 'MES adds reason TLCHG (tool change), splitting tool changes out of CHGOV changeover overruns.' },
  { id: 'IP-3', label: 'Rename usage decision', objectFqn: 'RAW_BRONZE.QMS_INSPECTION_CDC', column: 'USAGE_DECISION', change: 'rename', aliases: ['DISPOSITION', 'PASSED_FIRST_FLAG'], note: 'The QMS upgrade renames USAGE_DECISION to UD_CODE.' },
  { id: 'IP-4', label: 'Receipts move to ASN line grain', objectFqn: 'RAW_BRONZE.SUPPLIER_ASN_CDC', column: 'RECEIPT_DT', change: 'grain', aliases: ['RECEIVED_DATE'], note: 'The supplier portal sends one row per ASN line instead of one per ASN, with a receipt date per line.' },
];
