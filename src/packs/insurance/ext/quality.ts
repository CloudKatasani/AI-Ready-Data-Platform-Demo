// Insurance: the scripted AG-01 improvement loop (E10) and preset changes for impact analysis (E11).
import type { Persona, ScenarioContext } from '../../../types';
import type { FeedbackScript, ImpactPreset } from '../../../ext/types';
import { groupBy, sum } from '../../../mock-snowflake/generators';
import { fmtNum } from '../../../lib/format';
import type { InsData } from '../data';
import { LINES } from '../generators.config';
import { inRange, PERIODS } from '../queries';

const DB = 'SMI_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const usdM = (v: number) => `$${fmtNum(v / 1e6, 1)} M`;

export function buildFeedback(d: InsData): FeedbackScript {
  const ytd = (p: Persona) => {
    const allow = allowOf(p);
    return { allow, txns: d.txns.filter((t) => inRange(t.date, PERIODS.ytd) && (!allow || allow.includes(t.region))) };
  };
  /** Paid losses this year by line of business, gross or net of subrogation recoveries (recoveries are negative), scaled. */
  const paid = (ruleApplied: boolean, p: Persona) => {
    const { allow, txns } = ytd(p);
    const rows = txns.filter((t) => t.type === 'Loss payment' || (ruleApplied && t.type === 'Subrogation recovery'));
    const by = groupBy(rows, (t) => t.line);
    const lines = LINES.filter((l) => by.has(l.code)).map((l) => {
      const xs = by.get(l.code)!;
      return { name: l.name, paid: sum(xs.filter((t) => t.type === 'Loss payment').map((t) => t.amount)) * d.claimScale, recovered: -sum(xs.filter((t) => t.type === 'Subrogation recovery').map((t) => t.amount)) * d.claimScale };
    });
    const recovered = sum(lines.map((l) => l.recovered));
    return { total: sum(lines.map((l) => l.paid)) - recovered, recovered, lines, allow };
  };
  /** The wrong join: loss payments joined to FCT_RESERVE, which repeats each open claim once per month-end valuation. */
  const reserveRows = groupBy(d.reserves, (r) => String(r.claimKey));
  const fanout = (p: Persona) => {
    const { txns } = ytd(p);
    const net = txns.filter((t) => t.type === 'Loss payment' || t.type === 'Subrogation recovery');
    return sum(net.map((t) => t.amount * Math.max(1, reserveRows.get(String(t.claimKey))?.length ?? 0))) * d.claimScale;
  };
  const compute = (ruleApplied: boolean, { persona }: ScenarioContext) => {
    const r = paid(ruleApplied, persona);
    return {
      value: r.total,
      valueText: usdM(r.total),
      summary: `Paid losses for 1 Jan – 30 Sep 2026 are ${usdM(r.total)}${ruleApplied ? `, net of ${usdM(r.recovered)} of subrogation recoveries under rule BR-019` : ', gross of subrogation recoveries'}.${r.allow ? ` Row access policy limited results to the ${r.allow.join(' and ')} regions.` : ''}`,
      table: { columns: ['Line of business', 'Loss payments', 'Recoveries', 'Paid losses'], rows: r.lines.map((l) => [l.name, usdM(l.paid), ruleApplied ? usdM(l.recovered) : '—', usdM(l.paid - l.recovered)]) },
      sql: `SELECT line_of_business, SUM(amount_usd) AS paid_losses\n  FROM ${DB}.CONFORMED_GOLD.FCT_CLAIM_TRANSACTION  -- via DP_CLAIMS_EXPERIENCE\n WHERE txn_type IN ('Loss payment'${ruleApplied ? ", 'Subrogation recovery'" : ''})${ruleApplied ? '  -- BR-019: net of recoveries' : ''}\n   AND date_key BETWEEN 20260101 AND 20260930\n GROUP BY line_of_business\n ORDER BY paid_losses DESC;`,
    };
  };
  return {
    agentId: 'AG-01',
    question: 'What are our paid losses this year?',
    paraphrases: ['How much have we paid in claims this year?', 'paid losses year to date by line of business'],
    comment: 'Paid losses should be net of subrogation recoveries',
    termId: 'T-027',
    productIds: ['DP-02'],
    rule: { id: 'BR-019', domain: 'Claims', text: 'Paid losses are reported net of subrogation recoveries received in the same period; gross loss payments are shown only when asked for explicitly.', metric: 'SV_CLAIMS_EXPERIENCE.paid_losses', sourceDoc: 'NAIC statutory reporting — Sentinel Mutual application guide' },
    synonym: { term: 'Paid Loss', synonym: 'claim disbursements', scope: 'Claims' },
    relationship: { view: 'SV_CLAIMS_EXPERIENCE', label: 'claim transaction → claim (many-to-one)', detail: 'transactions join FCT_CLAIM on CLAIM_KEY, never FCT_RESERVE, whose month-end valuation rows repeat each open claim' },
    compute,
    evalItems: [
      { id: 'AG-01-Q45', question: 'What are our paid losses this year?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (gross of subrogation recoveries)` },
      { id: 'AG-01-Q46', question: 'How much have we paid in claims this year?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (gross of subrogation recoveries)` },
      { id: 'AG-01-Q47', question: 'Paid losses year to date by line of business', category: 'missing_rule', fix: 'rule', expected: (c) => `${compute(true, c).table!.rows.length} lines, ${compute(true, c).valueText} total`, wrong: (c) => `${compute(false, c).table!.rows.length} lines, ${compute(false, c).valueText} total (recoveries not netted)` },
      { id: 'AG-01-Q48', question: 'What are our claim disbursements this year?', category: 'ambiguous_term', fix: 'synonym', expected: (c) => compute(true, c).valueText, wrong: () => 'Asked to clarify: “claim disbursements” is not a known term' },
      { id: 'AG-01-Q49', question: 'Paid losses this year after recoveries, by line of business', category: 'ambiguous_term', fix: 'verified_query', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (“after recoveries” ignored)` },
      { id: 'AG-01-Q50', question: 'What are paid losses this year per accident year?', category: 'wrong_join', fix: 'relationship', expected: (c) => compute(true, c).valueText, wrong: (c) => `${usdM(fanout(c.persona))} (joined to every reserve valuation row)` },
    ],
  };
}

export const impactPresets: ImpactPreset[] = [
  { id: 'IP-1', label: 'Annual premium precision change', objectFqn: 'RAW_BRONZE.PAS_POLICY_CDC', column: 'ANNUAL_PREM', change: 'type', aliases: ['ANNUAL_PREMIUM'], note: 'Policy administration widens ANNUAL_PREM from NUMBER(12,2) to NUMBER(14,4) for large commercial accounts.' },
  { id: 'IP-2', label: 'New claim status S (closed pending subrogation)', objectFqn: 'RAW_BRONZE.CLM_CLAIM_CDC', column: 'STAT_CD', change: 'semantics', aliases: ['CLAIM_STATUS', 'IS_OPEN'], note: 'The claims system adds status S for claims closed to the insured but still pursuing subrogation, splitting them out of O.' },
  { id: 'IP-3', label: 'Rename case reserve amount', objectFqn: 'RAW_BRONZE.CLM_CLAIM_CDC', column: 'RESERVE_AMT', change: 'rename', aliases: ['CASE_RESERVE'], note: 'The claims system renames RESERVE_AMT to CASE_RSV_AMT in the next release.' },
  { id: 'IP-4', label: 'Invoices move to instalment grain', objectFqn: 'RAW_BRONZE.BIL_INVOICE_CDC', column: 'BILL_DT', change: 'grain', aliases: ['INVOICE_MONTH', 'PREMIUM_MONTH'], note: 'Billing switches from one invoice per policy-month to one row per instalment, so monthly-pay policies can have two rows in a month.' },
];
