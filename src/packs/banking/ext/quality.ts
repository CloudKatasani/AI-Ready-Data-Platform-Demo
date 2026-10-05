// Banking: the scripted AG-01 improvement loop (E10) and preset changes for impact analysis (E11).
import type { Persona, ScenarioContext } from '../../../types';
import type { FeedbackScript, ImpactPreset } from '../../../ext/types';
import { sum } from '../../../mock-snowflake/generators';
import { fmtCompact, fmtNum } from '../../../lib/format';
import type { BankData } from '../data';
import { REGIONS } from '../generators.config';
import * as Q from '../queries';

const DB = 'RLB_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const bn = (v: number) => `$${fmtNum(v / 1e9, 2)} B`;

export function buildFeedback(d: BankData): FeedbackScript {
  const status = new Map(d.customers.map((c) => [c.key, c.status]));
  /** Month-end deposits of the persona's customers by market, at population scale; the rule drops dormant relationships. */
  const deposits = (ruleApplied: boolean, p: Persona, months: string[] = [Q.PERIODS.month]) => {
    const allow = allowOf(p);
    const xs = months.flatMap((m) => Q.depByMonth(d).get(m) ?? []).filter((x) => (!allow || allow.includes(x.region)) && (!ruleApplied || status.get(x.customerKey) !== 'Dormant'));
    const by = REGIONS.filter((r) => !allow || allow.includes(r.name)).map((r) => {
      const ys = xs.filter((x) => x.region === r.name);
      return { region: r.name, total: sum(ys.map((x) => x.balance)) * d.scale, customers: new Set(ys.map((x) => x.customerKey)).size };
    });
    const dormant = Q.depByMonth(d).get(Q.PERIODS.month)!.filter((x) => (!allow || allow.includes(x.region)) && status.get(x.customerKey) === 'Dormant');
    return { total: sum(by.map((b) => b.total)), customers: new Set(xs.map((x) => x.customerKey)).size * d.scale, by, allow, dormant: sum(dormant.map((x) => x.balance)) * d.scale };
  };
  /** The wrong join: deposits joined to customer on every month-end snapshot instead of the latest one. */
  const fanout = (p: Persona) => deposits(true, p, [...Q.depByMonth(d).keys()]).total;
  const compute = (ruleApplied: boolean, { persona }: ScenarioContext) => {
    const r = deposits(ruleApplied, persona);
    return {
      value: r.total,
      valueText: bn(r.total),
      summary: `Customers held ${bn(r.total)} in deposits at the 30 September 2026 month-end across ≈ ${fmtCompact(r.customers)} relationships.${ruleApplied ? ` Dormant accounts (${bn(r.dormant)}) are excluded under rule BR-018 and reported under unclaimed-property monitoring.` : ''}${r.allow ? ` Row access policy limited results to the ${r.allow.join(' and ')} markets.` : ''}`,
      table: { columns: ['Market', 'Deposits', 'Customers'], rows: r.by.map((b) => [b.region, bn(b.total), fmtCompact(b.customers * d.scale)]) },
      sql: `SELECT region, SUM(total_deposits) AS relationship_deposits\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_360\n${ruleApplied ? " WHERE customer_status <> 'Dormant'   -- BR-018: exclude dormant accounts\n" : ''} GROUP BY region\n ORDER BY relationship_deposits DESC;`,
    };
  };
  return {
    agentId: 'AG-01',
    question: 'What are total deposits held by our customers?',
    paraphrases: ['How much do our customers hold in deposits?', 'total customer deposits by market'],
    comment: 'This should exclude dormant accounts',
    termId: 'T-007',
    productIds: ['DP-01'],
    rule: { id: 'BR-018', domain: 'Customer / Treasury', text: 'Relationship deposit totals exclude dormant accounts (no customer-initiated activity for 12 months or more); dormant balances are reported under unclaimed-property (escheatment) monitoring.', metric: 'SV_CUSTOMER_360.avg_deposit_balance', sourceDoc: 'Customer data standard v4' },
    synonym: { term: 'Deposit Balance', synonym: 'relationship balances', scope: 'Treasury' },
    relationship: { view: 'SV_CUSTOMER_360', label: 'customer → latest month-end deposit balance', detail: 'deposit joins customer on CUSTOMER_KEY restricted to the latest month-end DATE_KEY (one balance per account)' },
    compute,
    evalItems: [
      { id: 'AG-01-Q45', question: 'What are total deposits held by our customers?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes dormant accounts)` },
      { id: 'AG-01-Q46', question: 'How much do our customers hold in deposits?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes dormant accounts)` },
      { id: 'AG-01-Q47', question: 'Total customer deposits by market', category: 'missing_rule', fix: 'rule', expected: (c) => `${compute(true, c).table!.rows.length} markets, ${compute(true, c).valueText} total`, wrong: (c) => `${compute(false, c).table!.rows.length} markets, ${compute(false, c).valueText} total (dormant accounts counted)` },
      { id: 'AG-01-Q48', question: 'What are our total relationship balances?', category: 'ambiguous_term', fix: 'synonym', expected: (c) => compute(true, c).valueText, wrong: () => 'Asked to clarify: “relationship balances” is not a known term' },
      { id: 'AG-01-Q49', question: 'Total deposits by market for active relationships only', category: 'ambiguous_term', fix: 'verified_query', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (“active relationships” read as all relationships)` },
      { id: 'AG-01-Q50', question: 'What are total customer deposits per customer segment?', category: 'wrong_join', fix: 'relationship', expected: (c) => compute(true, c).valueText, wrong: (c) => `${bn(fanout(c.persona))} (joined every month-end, not the latest)` },
    ],
  };
}

export const impactPresets: ImpactPreset[] = [
  { id: 'IP-1', label: 'Card amount type change', objectFqn: 'RAW_BRONZE.CARD_AUTH_CDC', column: 'AUTH_AMT', change: 'type', aliases: ['AMOUNT_USD'], note: 'The card processor widens AUTH_AMT from NUMBER(12,2) to NUMBER(15,3) for multi-currency authorisations.' },
  { id: 'IP-2', label: 'New AML disposition code ESCX', objectFqn: 'RAW_BRONZE.AML_ALERT_CDC', column: 'DISP_CD', change: 'semantics', aliases: ['DISPOSITION', 'IS_ESCALATED'], note: 'Case management adds DISP_CD value ESCX (escalated, then closed without a case), splitting it out of ESC.' },
  { id: 'IP-3', label: 'Rename days past due', objectFqn: 'RAW_BRONZE.CORE_ACCOUNT_CDC', column: 'DPD_CNT', change: 'rename', aliases: ['DAYS_PAST_DUE', 'IS_NON_PERFORMING'], note: 'The core renames DPD_CNT to DAYS_DELINQ_CNT in the next release.' },
  { id: 'IP-4', label: 'GL balances move to daily', objectFqn: 'RAW_BRONZE.GL_BALANCE_CDC', column: 'PERIOD', change: 'grain', aliases: ['DATE_KEY'], note: 'The general ledger feed switches from monthly period balances to daily balances.' },
];
