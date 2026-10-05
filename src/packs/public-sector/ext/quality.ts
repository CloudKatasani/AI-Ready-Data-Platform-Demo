// Public Sector: the scripted AG-01 improvement loop (E10) and preset changes for impact analysis (E11).
import type { Persona, ScenarioContext } from '../../../types';
import type { FeedbackScript, ImpactPreset } from '../../../ext/types';
import { round } from '../../../mock-snowflake/generators';
import { fmtCompact, fmtInt, fmtPct } from '../../../lib/format';
import type { PsData } from '../data';
import { DISTRICTS } from '../generators.config';
import { PERIODS } from '../queries';

const DB = 'WCS_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'DISTRICT' ? p.rowFilter.allowed : undefined);
const pct = (a: number, b: number) => round((a / Math.max(1, b)) * 100, 1);

export function buildFeedback(d: PsData): FeedbackScript {
  /** Closed 311 requests created last quarter, and those that count as on time with or without the reopen rule. */
  const onTime = (ruleApplied: boolean, p: Persona) => {
    const allow = allowOf(p);
    const closed = d.requests.filter((s) => PERIODS.quarter.months.includes(s.created.slice(0, 7)) && s.resolutionDays !== null && (!allow || allow.includes(s.district)));
    const ok = closed.filter((s) => s.onTime && (!ruleApplied || !s.reopened));
    const reopenedInSla = closed.filter((s) => s.onTime && s.reopened);
    const by = DISTRICTS.filter((x) => !allow || allow.includes(x.name)).map((x) => {
      const cs = closed.filter((s) => s.district === x.name);
      return { district: x.name, rate: pct(cs.filter((s) => s.onTime && (!ruleApplied || !s.reopened)).length, cs.length), closed: cs.length, reopened: cs.filter((s) => s.reopened).length };
    });
    return { rate: pct(ok.length, closed.length), ok, closed: closed.length, reopenedInSla: reopenedInSla.length, by, allow };
  };
  /** The wrong join: requests joined to DIM_OFFICE on DISTRICT, so each request repeats once per office in its district. */
  const officesIn = (district: string) => d.offices.filter((o) => o.district === district).length;
  const closedOnTimeByOffice = (p: Persona, fanout: boolean) => {
    const r = onTime(true, p);
    return Math.round(r.ok.reduce((t, s) => t + (fanout ? officesIn(s.district) : 1), 0) * d.srScale);
  };
  const compute = (ruleApplied: boolean, { persona }: ScenarioContext) => {
    const r = onTime(ruleApplied, persona);
    return {
      value: r.rate,
      valueText: fmtPct(r.rate),
      summary: `In Q3 2026 (Jul–Sep) ${fmtPct(r.rate)} of closed 311 requests were resolved on time — closed within the SLA for their request type${ruleApplied ? ' and not reopened' : ''} — across ≈ ${fmtCompact(r.closed * d.srScale)} closed requests.${ruleApplied ? ` Under rule BR-019, ≈ ${fmtInt(r.reopenedInSla * d.srScale)} requests that were closed within SLA but later reopened do not count as on time.` : ''}${r.allow ? ` Row access policy limited results to ${r.allow.join(' and ')}.` : ''}`,
      table: { columns: ['District', 'On-time resolution', 'Closed requests (sample)', 'Reopened (sample)'], rows: r.by.map((b) => [b.district, fmtPct(b.rate), fmtInt(b.closed), fmtInt(b.reopened)]) },
      sql: `SELECT district,\n       AVG(IFF(within_sla${ruleApplied ? ' AND NOT reopened' : ''}, 1, 0)) * 100 AS on_time_resolution_rate\n  FROM ${DB}.DATA_PRODUCTS.DP_SERVICE_REQUESTS_311\n WHERE created_date BETWEEN '2026-07-01' AND '2026-09-30'\n   AND closed_date IS NOT NULL${ruleApplied ? '  -- BR-019: reopened requests are not on time' : ''}\n GROUP BY district\n ORDER BY on_time_resolution_rate;`,
    };
  };
  return {
    agentId: 'AG-01',
    question: 'What is our 311 on-time resolution rate?',
    paraphrases: ['What share of 311 requests were closed within SLA last quarter?', '311 on-time resolution rate by district'],
    comment: 'Reopened requests should not count as on time',
    termId: 'T-018',
    productIds: ['DP-04'],
    rule: { id: 'BR-019', domain: '311', text: 'A 311 request that is reopened after closure is not on time, even if it was first closed within its SLA; on-time resolution counts requests closed within SLA and not reopened.', metric: 'SV_CONSTITUENT_360.on_time_resolution_rate', sourceDoc: '311 service level standard' },
    synonym: { term: '311 Resolution Time', synonym: 'SLA compliance', scope: '311' },
    relationship: { view: 'SV_CONSTITUENT_360', label: 'request → office', detail: 'requests relate to offices through the constituent’s home office (OFFICE_KEY), not through DISTRICT, which matches two offices per district' },
    compute,
    evalItems: [
      { id: 'AG-01-Q45', question: 'What is our 311 on-time resolution rate?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (reopened requests counted as on time)` },
      { id: 'AG-01-Q46', question: 'What share of 311 requests were closed within SLA last quarter?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (reopened requests counted as on time)` },
      { id: 'AG-01-Q47', question: '311 on-time resolution rate by district', category: 'missing_rule', fix: 'rule', expected: (c) => `${compute(true, c).table.rows.length} districts, ${compute(true, c).valueText} overall`, wrong: (c) => `${compute(false, c).table.rows.length} districts, ${compute(false, c).valueText} overall (reopened requests counted)` },
      { id: 'AG-01-Q48', question: 'What is our 311 SLA compliance rate?', category: 'ambiguous_term', fix: 'synonym', expected: (c) => compute(true, c).valueText, wrong: () => 'Asked to clarify: “SLA compliance” is not a known term' },
      { id: 'AG-01-Q49', question: '311 on-time rate last quarter, not counting reopened requests', category: 'ambiguous_term', fix: 'verified_query', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (“not counting reopened” ignored)` },
      { id: 'AG-01-Q50', question: 'How many 311 requests were closed on time last quarter by office?', category: 'wrong_join', fix: 'relationship', expected: (c) => fmtInt(closedOnTimeByOffice(c.persona, false)), wrong: (c) => `${fmtInt(closedOnTimeByOffice(c.persona, true))} (joined offices on district: each request counted once per office)` },
    ],
  };
}

export const impactPresets: ImpactPreset[] = [
  { id: 'IP-1', label: 'Payment amount precision change', objectFqn: 'RAW_BRONZE.BEN_PAYMENT_CDC', column: 'PMT_AMT', change: 'type', aliases: ['PAYMENT_AMOUNT'], note: 'The payments system widens PMT_AMT from NUMBER(10,2) to NUMBER(12,2) for lump-sum retroactive payments.' },
  { id: 'IP-2', label: 'New decision code R (referred for verification)', objectFqn: 'RAW_BRONZE.ELIG_APPLICATION_CDC', column: 'DECN_CD', change: 'semantics', aliases: ['DECISION'], note: 'Eligibility adds decision code R for applications pended for third-party verification, which today stay P (pending).' },
  { id: 'IP-3', label: 'Rename district code', objectFqn: 'RAW_BRONZE.CM_PERSON_CDC', column: 'DIST_CD', change: 'rename', aliases: ['DISTRICT'], note: 'Case management renames DIST_CD to SVC_DIST_CD in the next release.' },
  { id: 'IP-4', label: '311 duplicates merged into parent requests', objectFqn: 'RAW_BRONZE.SR311_REQUEST_CDC', column: 'SR_NO', change: 'grain', aliases: ['SR_ID'], note: 'The 311 CRM starts merging duplicate reports of the same issue into one parent request, so SR_NO moves from one row per report to one row per issue.' },
];
