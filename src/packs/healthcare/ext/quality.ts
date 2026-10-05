// Healthcare: the scripted AG-01 improvement loop (E10) and preset changes for impact analysis (E11).
import type { Persona, ScenarioContext } from '../../../types';
import type { FeedbackScript, ImpactPreset } from '../../../ext/types';
import { groupBy, sum } from '../../../mock-snowflake/generators';
import { fmtCompact, fmtUsd } from '../../../lib/format';
import type { Claim, HcData } from '../data';
import { AS_OF, MARKETS } from '../generators.config';
import { daysBetween } from '../queries';

const DB = 'CVH_AI_PLATFORM';
const allowOf = (p: Persona) => (p.rowFilter?.column === 'MARKET' ? p.rowFilter.allowed : undefined);
/** Self-pay balances older than this many days from service are placed with the bad-debt agency. */
const PLACEMENT_DAYS = 120;

export function buildFeedback(d: HcData): FeedbackScript {
  const isOpen = (c: Claim) => c.submitDate <= AS_OF && c.resolvedDate > AS_OF;
  const placed = (c: Claim) => d.payers[c.payerKey - 1].payerClass === 'Self-pay' && daysBetween(c.serviceDate, AS_OF) > PLACEMENT_DAYS;
  /** Open A/R at the as-of date by market, at system scale. */
  const openAr = (ruleApplied: boolean, p: Persona, weight: (c: Claim) => number = () => 1) => {
    const allow = allowOf(p);
    const cs = d.claims.filter((c) => isOpen(c) && (!allow || allow.includes(c.market)) && (!ruleApplied || !placed(c)));
    const by = [...groupBy(cs, (c) => c.market).entries()]
      .map(([market, xs]) => ({ market, total: sum(xs.map((c) => c.expected * weight(c))) * d.scale.claims, n: xs.length }))
      .sort((a, b) => MARKETS.findIndex((m) => m.name === a.market) - MARKETS.findIndex((m) => m.name === b.market));
    return { total: sum(by.map((b) => b.total)), claims: cs.length * d.scale.claims, by, allow };
  };
  /** The wrong join: claims joined to every SCD2 version of the patient (no IS_CURRENT filter). */
  const versions = (c: Claim) => (d.patients[c.patientKey - 1].priorPayerKey ? 2 : 1);
  const compute = (ruleApplied: boolean, { persona }: ScenarioContext) => {
    const r = openAr(ruleApplied, persona);
    return {
      value: r.total,
      valueText: fmtUsd(r.total, 0),
      summary: `Open A/R is ${fmtUsd(r.total, 0)} across ≈ ${fmtCompact(r.claims)} open claims at 30 Sep 2026.${ruleApplied ? ` Self-pay balances more than ${PLACEMENT_DAYS} days past service are excluded under rule BR-019; they sit with the bad-debt agency.` : ''}${r.allow ? ` Row access policy limited results to the ${r.allow.join(' and ')} markets.` : ''}`,
      table: { columns: ['Market', 'Open A/R', 'Open claims'], rows: r.by.map((b) => [b.market, fmtUsd(b.total, 0), fmtCompact(b.n * d.scale.claims)]) },
      sql: `SELECT market, SUM(open_ar_usd) AS open_ar_balance\n  FROM ${DB}.DATA_PRODUCTS.DP_REVENUE_CYCLE\n WHERE open_ar_usd > 0\n${ruleApplied ? `   AND NOT (payer_class = 'Self-pay' AND days_outstanding > ${PLACEMENT_DAYS})  -- BR-019: bad-debt placements\n` : ''} GROUP BY market\n ORDER BY market;`,
    };
  };
  return {
    agentId: 'AG-01',
    question: 'What is our total open A/R balance?',
    paraphrases: ['How much is outstanding in accounts receivable?', 'open A/R balance by market'],
    comment: 'This should exclude self-pay balances already placed with the collection agency',
    termId: 'T-018',
    productIds: ['DP-03'],
    rule: { id: 'BR-019', domain: 'Revenue cycle', text: `Open A/R excludes self-pay balances more than ${PLACEMENT_DAYS} days past the service date; they are placed with the bad-debt agency and reported as bad debt.`, metric: 'SV_PATIENT_REVENUE.open_ar_balance', sourceDoc: 'Revenue cycle KPI handbook' },
    synonym: { term: 'Open A/R', synonym: 'outstanding receivables', scope: 'Revenue cycle' },
    relationship: { view: 'SV_PATIENT_REVENUE', label: 'claim → current patient version', detail: 'FCT_CLAIM joins PATIENT on MRN restricted to IS_CURRENT = TRUE (many-to-one), not every SCD2 version' },
    compute,
    evalItems: [
      { id: 'AG-01-Q45', question: 'What is our total open A/R balance?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes bad-debt placements)` },
      { id: 'AG-01-Q46', question: 'How much is outstanding in accounts receivable?', category: 'missing_rule', fix: 'rule', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (includes bad-debt placements)` },
      { id: 'AG-01-Q47', question: 'Open A/R balance by market', category: 'missing_rule', fix: 'rule', expected: (c) => `${compute(true, c).table!.rows.length} markets, ${compute(true, c).valueText} total`, wrong: (c) => `${compute(false, c).table!.rows.length} markets, ${compute(false, c).valueText} total (bad-debt placements counted)` },
      { id: 'AG-01-Q48', question: 'What is our total outstanding receivables?', category: 'ambiguous_term', fix: 'synonym', expected: (c) => compute(true, c).valueText, wrong: () => 'Asked to clarify: “outstanding receivables” is not a known term' },
      { id: 'AG-01-Q49', question: 'Open A/R by market excluding bad-debt placements', category: 'ambiguous_term', fix: 'verified_query', expected: (c) => compute(true, c).valueText, wrong: (c) => `${compute(false, c).valueText} (“bad-debt placements” not applied)` },
      { id: 'AG-01-Q50', question: 'What is the open A/R balance per payer class?', category: 'wrong_join', fix: 'relationship', expected: (c) => compute(true, c).valueText, wrong: (c) => `${fmtUsd(openAr(true, c.persona, versions).total, 0)} (claims joined to every patient version, not the current one)` },
    ],
  };
}

export const impactPresets: ImpactPreset[] = [
  { id: 'IP-1', label: 'MRN length change', objectFqn: 'RAW_BRONZE.EHR_PATIENT_CDC', column: 'MRN', change: 'type', aliases: ['PATIENT_MRN'], note: 'The EHR widens MRN from VARCHAR(12) to VARCHAR(16) after the Valley market merges its legacy MRN range.' },
  { id: 'IP-2', label: 'New discharge status code 50 (hospice, home)', objectFqn: 'RAW_BRONZE.EHR_ENCOUNTER_CDC', column: 'DISCH_DISP_CD', change: 'semantics', aliases: ['DISCHARGE_DISPOSITION'], note: 'ADT starts sending UB-04 status 50 (discharged to hospice, home), which used to arrive as 01 (home).' },
  { id: 'IP-3', label: 'Rename paid amount', objectFqn: 'RAW_BRONZE.CLM_837_835_CDC', column: 'PAID_AMT', change: 'rename', aliases: ['PAID_USD'], note: 'The clearinghouse renames PAID_AMT to CLM_PAYMENT_AMT in the next 835 feed release.' },
  { id: 'IP-4', label: 'Supply capture moves to scan level', objectFqn: 'RAW_BRONZE.SUPPLY_USAGE_CDC', column: 'USAGE_ID', change: 'grain', aliases: ['USAGE_ID', 'USAGE_KEY'], note: 'Point-of-use capture switches from one line per item per case to one line per barcode scan.' },
];
