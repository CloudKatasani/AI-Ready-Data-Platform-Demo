// Utilities: the scripted AG-01 improvement loop (E10) and preset changes for impact analysis (E11).
import type { Persona, ScenarioContext } from '../../../types';
import type { FeedbackScript, ImpactPreset } from '../../../ext/types';
import { groupBy, sum } from '../../../mock-snowflake/generators';
import { fmtCompact, fmtUsd } from '../../../lib/format';
import type { UtilData } from '../data';
import { latestBills } from '../queries';

const DB = 'NVE_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'OPCO' ? p.rowFilter.allowed : undefined);

export function buildFeedback(d: UtilData): FeedbackScript {
  const latest = latestBills(d);
  /** Arrears on the latest statement per customer, by operating company, at population scale. */
  const arrears = (ruleApplied: boolean, p: Persona) => {
    const allow = allowOf(p);
    const custs = d.customers.filter((c) => (!allow || allow.includes(c.opco)) && (!ruleApplied || c.status === 'Active'));
    const rows = custs.map((c) => ({ opco: c.opco, a: latest.get(c.key)?.arrears ?? 0 })).filter((x) => x.a > 0);
    const by = [...groupBy(rows, (r) => r.opco).entries()].map(([opco, rs]) => ({ opco, total: sum(rs.map((r) => r.a)) * d.scale, n: rs.length })).sort((a, b) => b.total - a.total);
    return { total: sum(by.map((b) => b.total)), customers: rows.length * d.scale, by, allow };
  };
  /** The wrong join: billing joined to customer on every statement instead of the latest one. */
  const fanout = (p: Persona) => {
    const allow = allowOf(p);
    return sum(d.bills.filter((b) => !allow || allow.includes(b.opco)).map((b) => b.arrears)) * d.scale;
  };
  const compute = (ruleApplied: boolean, { persona }: ScenarioContext) => {
    const r = arrears(ruleApplied, persona);
    return {
      value: r.total,
      valueText: fmtUsd(r.total, 0),
      summary: `Total arrears balance is ${fmtUsd(r.total, 0)} across ≈ ${fmtCompact(r.customers)} customers in arrears on their latest statement.${ruleApplied ? ' Closed (inactive) accounts are excluded under rule BR-021; their balances sit with collections.' : ''}${r.allow ? ` Row access policy limited results to ${r.allow.join(' and ')}.` : ''}`,
      table: { columns: ['Operating company', 'Arrears balance', 'Customers in arrears'], rows: r.by.map((b) => [b.opco, fmtUsd(b.total, 0), fmtCompact(b.n * d.scale)]) },
      sql: `SELECT opco, SUM(arrears_amount) AS arrears_balance\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360\n${ruleApplied ? " WHERE customer_status = 'Active'   -- BR-021: exclude closed accounts\n" : ''} GROUP BY opco\n ORDER BY arrears_balance DESC;`,
    };
  };
  return {
    agentId: 'AG-01',
    question: 'What is our total arrears balance?',
    paraphrases: ['How much do customers owe in arrears?', 'total past due balance by operating company'],
    comment: 'This should exclude closed accounts',
    termId: 'T-010',
    productIds: ['DP-01'],
    rule: { id: 'BR-021', domain: 'Customer / Finance', text: 'Arrears balance excludes closed (inactive) accounts; their balances transfer to collections and are reported there.', metric: 'SV_CUSTOMER_360.arrears_balance', sourceDoc: 'Credit and collections policy v2' },
    synonym: { term: 'Arrears Balance', synonym: 'delinquent balance', scope: 'Customer / Finance' },
    relationship: { view: 'SV_CUSTOMER_360', label: 'customer → latest billing statement', detail: 'billing joins customer on CUSTOMER_KEY restricted to the latest STATEMENT_KEY per customer (one-to-one)' },
    compute,
    evalItems: [
      { id: 'AG-01-Q45', question: 'What is our total arrears balance?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes closed accounts)` },
      { id: 'AG-01-Q46', question: 'How much do customers owe in arrears?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes closed accounts)` },
      { id: 'AG-01-Q47', question: 'Total past due balance by operating company', category: 'missing_rule', fix: 'rule', expected: (c) => `${compute(true, c).table!.rows.length} opcos, ${compute(true, c).valueText} total`, wrong: (c) => `${compute(false, c).table!.rows.length} opcos, ${compute(false, c).valueText} total (closed accounts counted)` },
      { id: 'AG-01-Q48', question: 'What is our total delinquent balance?', category: 'ambiguous_term', fix: 'synonym', expected: (c) => compute(true, c).valueText, wrong: () => 'Asked to clarify: “delinquent balance” is not a known term' },
      { id: 'AG-01-Q49', question: 'Arrears balance by operating company for active accounts only', category: 'ambiguous_term', fix: 'verified_query', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (“active accounts” read as all accounts)` },
      { id: 'AG-01-Q50', question: 'What is the arrears balance per customer segment?', category: 'wrong_join', fix: 'relationship', expected: (c) => compute(true, c).valueText, wrong: (c) => `${fmtUsd(fanout(c.persona), 0)} (joined every statement, not the latest)` },
    ],
  };
}

export const impactPresets: ImpactPreset[] = [
  { id: 'IP-1', label: 'Email address type change', objectFqn: 'RAW_BRONZE.CIS_CUSTOMER_CDC', column: 'EMAIL_ADDR', change: 'type', aliases: ['EMAIL', 'ACCOUNT_EMAIL'], note: 'CIS widens EMAIL_ADDR from VARCHAR(80) to VARCHAR(254).' },
  { id: 'IP-2', label: 'New outage cause code VEG-STORM', objectFqn: 'RAW_BRONZE.OMS_EVENT_CDC', column: 'CAUSE_CD', change: 'semantics', aliases: ['CAUSE'], note: 'OMS adds cause value VEG-STORM, splitting storm-driven tree contacts out of TREE.' },
  { id: 'IP-3', label: 'Rename amount due', objectFqn: 'RAW_BRONZE.BILL_HDR_CDC', column: 'AMT_DUE', change: 'rename', aliases: ['AMOUNT_DUE_USD', 'BILLED_AMOUNT', 'ARREARS_AMOUNT'], note: 'Billing renames AMT_DUE to AMT_DUE_TOTAL in the next release.' },
  { id: 'IP-4', label: 'Interval reads move to hourly', objectFqn: 'RAW_BRONZE.AMI_READ_CDC', column: 'READ_TS', change: 'grain', aliases: ['INTERVAL_START'], note: 'The AMI head-end switches from 15-minute to hourly intervals for residential meters.' },
];
