// Retail: the scripted AG-01 improvement loop (E10) and preset changes for impact analysis (E11).
import type { Persona, ScenarioContext } from '../../../types';
import type { FeedbackScript, ImpactPreset } from '../../../ext/types';
import { avg, round, sum } from '../../../mock-snowflake/generators';
import { fmtCompact, fmtUsd } from '../../../lib/format';
import type { Member, RetailData } from '../data';

const DB = 'HPR_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const TIERS = ['Elite', 'Plus', 'Member'] as const;

export function buildFeedback(d: RetailData): FeedbackScript {
  /** Members in scope for the persona; with the rule, closed accounts (frozen CLV scores) are excluded. */
  const scope = (ruleApplied: boolean, p: Persona) => {
    const allow = allowOf(p);
    return { allow, ms: d.members.filter((m) => (!allow || allow.includes(m.region)) && (!ruleApplied || m.status === 'Active')) };
  };
  const meanClv = (ms: Member[]) => round(avg(ms.map((m) => m.clv)), 2);
  /** The wrong join: DIM_CUSTOMER joined to every SCD2 version in CURATED_SILVER.LOYALTY_MEMBER (no IS_CURRENT). */
  const fanout = (p: Persona) => {
    const { ms } = scope(true, p);
    const w = (m: Member) => (m.priorTier ? 2 : 1);
    return round(sum(ms.map((m) => w(m) * m.clv)) / sum(ms.map(w)), 2);
  };
  const compute = (ruleApplied: boolean, { persona }: ScenarioContext) => {
    const { allow, ms } = scope(ruleApplied, persona);
    const v = meanClv(ms);
    const closed = d.members.filter((m) => (!allow || allow.includes(m.region)) && m.status === 'Closed').length;
    return {
      value: v,
      valueText: fmtUsd(v),
      summary: `The average predicted 3-year lifetime value is ${fmtUsd(v)} per Harbor Club account across ≈ ${fmtCompact(ms.length * d.memberScale)} accounts (draft CLV model).${ruleApplied ? ` ${fmtCompact(closed * d.memberScale)} closed accounts are excluded under rule BR-019; their scores are frozen at closure.` : ''}${allow ? ` Row access policy limited results to ${allow.join(' and ')}.` : ''}`,
      table: { columns: ['Tier', 'Accounts', 'Avg predicted CLV'], rows: TIERS.map((t) => { const xs = ms.filter((m) => m.tier === t); return [t, fmtCompact(xs.length * d.memberScale), fmtUsd(meanClv(xs))]; }) },
      sql: `SELECT tier, COUNT(*) AS accounts, AVG(predicted_clv_usd) AS avg_predicted_clv\n  FROM ${DB}.CONFORMED_GOLD.DIM_CUSTOMER\n${ruleApplied ? " WHERE member_status = 'Active'   -- BR-019: closed accounts keep a frozen score\n" : ''} GROUP BY ROLLUP (tier);`,
    };
  };
  return {
    agentId: 'AG-01',
    question: 'What is the average predicted lifetime value of a Harbor Club member?',
    paraphrases: ['average CLV per loyalty member', 'predicted customer lifetime value per member by tier'],
    comment: 'This should leave out closed accounts',
    termId: 'T-024',
    productIds: ['DP-01'],
    rule: { id: 'BR-019', domain: 'Customer', text: 'Predicted customer lifetime value is reported for open (Active-status) accounts only; closed accounts keep the score frozen at closure and are excluded from averages.', metric: 'SV_CUSTOMER_LOYALTY.avg_predicted_clv', sourceDoc: 'Harbor Club programme standard' },
    synonym: { term: 'Predicted Customer Lifetime Value', synonym: 'customer value score', scope: 'Customer' },
    relationship: { view: 'SV_CUSTOMER_LOYALTY', label: 'member → current member version', detail: 'DIM_CUSTOMER joins CURATED_SILVER.LOYALTY_MEMBER on MEMBER_ID restricted to IS_CURRENT = TRUE (one-to-one)' },
    compute,
    evalItems: [
      { id: 'AG-01-Q45', question: 'What is the average predicted lifetime value of a Harbor Club member?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes closed accounts)` },
      { id: 'AG-01-Q46', question: 'Average CLV per loyalty member', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes closed accounts)` },
      { id: 'AG-01-Q47', question: 'Predicted customer lifetime value per member by tier', category: 'missing_rule', fix: 'rule', expected: (c) => `${compute(true, c).table!.rows.length} tiers, ${compute(true, c).valueText} overall`, wrong: (c) => `${compute(false, c).table!.rows.length} tiers, ${compute(false, c).valueText} overall (closed accounts counted)` },
      { id: 'AG-01-Q48', question: 'What is the average customer value score?', category: 'ambiguous_term', fix: 'synonym', expected: (c) => compute(true, c).valueText, wrong: () => 'Asked to clarify: “customer value score” is not a known term' },
      { id: 'AG-01-Q49', question: 'Average predicted lifetime value for open accounts only', category: 'ambiguous_term', fix: 'verified_query', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (“open accounts” read as all accounts)` },
      { id: 'AG-01-Q50', question: 'What is the average predicted lifetime value per home store region?', category: 'wrong_join', fix: 'relationship', expected: (c) => compute(true, c).valueText, wrong: (c) => `${fmtUsd(fanout(c.persona))} (joined every member version, not the current one)` },
    ],
  };
}

export const impactPresets: ImpactPreset[] = [
  { id: 'IP-1', label: 'Member email type change', objectFqn: 'RAW_BRONZE.LOYALTY_MEMBER_CDC', column: 'EMAIL_ADDR', change: 'type', aliases: ['EMAIL'], note: 'The loyalty platform widens EMAIL_ADDR from VARCHAR(120) to VARCHAR(254).' },
  { id: 'IP-2', label: 'New fulfilment type SFS', objectFqn: 'RAW_BRONZE.ECOM_ORDER_CDC', column: 'FULFIL_TYPE', change: 'semantics', aliases: ['FULFILMENT_TYPE', 'CHANNEL'], note: 'The commerce platform adds FULFIL_TYPE value SFS (ship from store), which changes which store and channel a web order is attributed to.' },
  { id: 'IP-3', label: 'Rename POS discount amount', objectFqn: 'RAW_BRONZE.POS_TRANSACTION_CDC', column: 'DISC_AMT', change: 'rename', aliases: ['DISCOUNT_USD'], note: 'The store systems upgrade renames DISC_AMT to TOTAL_DISC_AMT.' },
  { id: 'IP-4', label: 'Inventory snapshots move to daily', objectFqn: 'RAW_BRONZE.WMS_INVENTORY_CDC', column: 'SNAPSHOT_TS', change: 'grain', aliases: ['WEEK_ENDING'], note: 'The WMS switches from Sunday-night weekly snapshots to daily snapshots for every store.' },
];
