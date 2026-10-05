// Telecom: the scripted AG-01 improvement loop (E10) and preset changes for impact analysis (E11).
import type { Persona, ScenarioContext } from '../../../types';
import type { FeedbackScript, ImpactPreset } from '../../../ext/types';
import { fmtInt } from '../../../lib/format';
import type { TelData } from '../data';
import { PLANS, REGIONS } from '../generators.config';
import * as Q from '../queries';

const DB = 'ALT_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);

export function buildFeedback(d: TelData): FeedbackScript {
  /** Out-of-contract postpaid lines at population scale; with the rule, only active subscribers (BR-001) count. */
  const outOfContract = (ruleApplied: boolean, p: Persona) => {
    const allow = allowOf(p);
    const active = new Set(Q.activeSubscribers(d, allow).map((s) => s.key));
    const subs = d.subscribers.filter((s) => s.segment === 'Postpaid' && s.outOfContract && (!allow || allow.includes(s.region)) && (!ruleApplied || active.has(s.key)));
    const by = REGIONS.filter((r) => !allow || allow.includes(r)).map((r) => {
      const xs = subs.filter((s) => s.region === r);
      return { region: r, n: xs.length, disc: xs.filter((s) => !active.has(s.key)).length };
    });
    return { subs, total: subs.length * d.scale, by, allow };
  };
  /** The wrong join: subscriber joined to every Q3 invoice instead of the latest one. */
  const fanout = (p: Persona) => {
    const keys = new Set(outOfContract(true, p).subs.map((s) => s.key));
    return d.invoices.filter((v) => Q.PERIODS.quarter.months.includes(v.month) && keys.has(v.subKey)).length * d.scale;
  };
  const compute = (ruleApplied: boolean, { persona }: ScenarioContext) => {
    const r = outOfContract(ruleApplied, persona);
    const dropped = outOfContract(false, persona).subs.length - outOfContract(true, persona).subs.length;
    return {
      value: Math.round(r.total),
      valueText: fmtInt(r.total),
      summary: `${fmtInt(r.total)} postpaid subscribers are out of contract.${ruleApplied ? ` Only active subscribers count under rule BR-018; ${fmtInt(dropped * d.scale)} disconnected or unbilled lines that still carry OUT_OF_CONTRACT = TRUE are excluded.` : ''}${r.allow ? ` Row access policy limited results to the ${r.allow.join(' and ')} regions.` : ''}`,
      table: { columns: ['Region', 'Out-of-contract postpaid subscribers', ...(ruleApplied ? [] : ['Of which not active'])], rows: r.by.map((b) => [b.region, fmtInt(b.n * d.scale), ...(ruleApplied ? [] : [fmtInt(b.disc * d.scale)])]) },
      sql: `SELECT region, COUNT(DISTINCT subscriber_id) AS out_of_contract_subscribers\n  FROM ${DB}.DATA_PRODUCTS.DP_SUBSCRIBER_360\n WHERE segment = 'Postpaid' AND out_of_contract\n${ruleApplied ? '   AND is_active   -- BR-018: active subscribers only (BR-001)\n' : ''} GROUP BY region\n ORDER BY region;`,
    };
  };
  const planCount = (ruleApplied: boolean, c: ScenarioContext) => new Set(outOfContract(ruleApplied, c.persona).subs.map((s) => s.planCode)).size;
  return {
    agentId: 'AG-01',
    question: 'How many postpaid subscribers are out of contract?',
    paraphrases: ['How many out-of-contract postpaid lines do we have?', 'out of contract postpaid subscribers by region'],
    comment: 'This includes disconnected lines: only active subscribers can be out of contract',
    termId: 'T-002',
    productIds: ['DP-01'],
    rule: { id: 'BR-018', domain: 'Subscriber', text: 'Out-of-contract counts include only active subscribers (BR-001); disconnected and unbilled lines keep OUT_OF_CONTRACT = TRUE in DIM_SUBSCRIBER but have no contract to renew.', metric: 'SV_SUBSCRIBER_360.active_subscribers', sourceDoc: 'Retention targeting guidelines v3' },
    synonym: { term: 'Out of contract', synonym: 'off-contract', scope: 'Subscriber' },
    relationship: { view: 'SV_SUBSCRIBER_360', label: 'subscriber → latest invoice', detail: 'billing joins subscriber on SUBSCRIBER_KEY restricted to the latest INVOICE_KEY per subscriber (one-to-one)' },
    compute,
    evalItems: [
      { id: 'AG-01-Q45', question: 'How many postpaid subscribers are out of contract?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes disconnected lines)` },
      { id: 'AG-01-Q46', question: 'How many out-of-contract postpaid lines do we have?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes disconnected lines)` },
      { id: 'AG-01-Q47', question: 'Out of contract postpaid subscribers by region', category: 'missing_rule', fix: 'rule', expected: (c) => `${compute(true, c).table!.rows.length} regions, ${compute(true, c).valueText} total`, wrong: (c) => `${compute(false, c).table!.rows.length} regions, ${compute(false, c).valueText} total (disconnected lines counted)` },
      { id: 'AG-01-Q48', question: 'How many postpaid subscribers are off-contract?', category: 'ambiguous_term', fix: 'synonym', expected: (c) => compute(true, c).valueText, wrong: () => 'Asked to clarify: “off-contract” is not a known term' },
      { id: 'AG-01-Q49', question: 'Out-of-contract postpaid subscribers by region, active lines only', category: 'ambiguous_term', fix: 'verified_query', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (“active lines” read as all lines)` },
      { id: 'AG-01-Q50', question: 'How many out-of-contract postpaid subscribers are there per plan?', category: 'wrong_join', fix: 'relationship', expected: (c) => `${planCount(true, c)} plans, ${compute(true, c).valueText} total`, wrong: (c) => `${fmtInt(fanout(c.persona))} (joined every Q3 invoice, not the latest)` },
    ],
  };
}

export const impactPresets: ImpactPreset[] = [
  { id: 'IP-1', label: 'MSISDN widened for international numbers', objectFqn: 'RAW_BRONZE.CRM_SUBSCRIBER_CDC', column: 'MSISDN', change: 'type', aliases: ['MSISDN'], note: 'CRM widens MSISDN from VARCHAR(16) to VARCHAR(20) to hold international E.164 numbers with extensions.' },
  { id: 'IP-2', label: 'New subscriber status SU (suspended)', objectFqn: 'RAW_BRONZE.CRM_SUBSCRIBER_CDC', column: 'STATUS_CD', change: 'semantics', aliases: ['STATUS'], note: `CRM adds status value SU for suspended lines (lost or stolen device), which today stay AC; ${PLANS.filter((p) => p.segment === 'Postpaid').length} postpaid plans are affected.` },
  { id: 'IP-3', label: 'Rename billed amount', objectFqn: 'RAW_BRONZE.BSS_INVOICE_CDC', column: 'BILLED_AMT', change: 'rename', aliases: ['BILLED_AMOUNT', 'SERVICE_REVENUE'], note: 'BSS renames BILLED_AMT to BILLED_SVC_AMT in the next release.' },
  { id: 'IP-4', label: 'Data CDRs aggregated to 5-minute sessions', objectFqn: 'RAW_BRONZE.CDR_MEDIATION_CDC', column: 'EVENT_TS', change: 'grain', aliases: ['EVENT_TS'], note: 'Mediation switches data records from one row per event to one row per 5-minute session.' },
];
