// Semantic views for Sentinel Mutual (spec sections 5 and 7.3).
import type { Row, SemanticView } from '../../types';
import { daysBetween, sum } from '../../mock-snowflake/generators';
import { inForceOn, type InsData } from './data';
import { AS_OF, LINE_BY_CODE } from './generators.config';
import { memo } from '../shared/catalog-kit';

const n = (r: Row, k: string) => Number(r[k] ?? 0);
const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const sumOf = (rs: Row[], k: string) => sum(rs.map((r) => n(r, k)));
const PRIOR_YTD = ['2025-Q1', '2025-Q2', '2025-Q3'];

export function buildSemanticViews(d: InsData, vqIds: (sv: string) => string[]): SemanticView[] {
  const agencyByKey = new Map(d.agencies.map((a) => [a.key, a]));

  // ---- Policyholder 360 (DP-01, DP-03)
  const ytd = memo(() => {
    const earned = new Map<number, number>();
    const written = new Map<number, number>();
    for (const p of d.premiums) {
      if (p.month < '2026-01') continue;
      earned.set(p.policyKey, (earned.get(p.policyKey) ?? 0) + p.earned);
      written.set(p.policyKey, (written.get(p.policyKey) ?? 0) + p.written);
    }
    return { earned, written };
  });
  const policyholder: SemanticView = {
    name: 'SV_POLICYHOLDER_360',
    description: 'Policies in force, retention, premium and billing metrics by region, line and channel',
    tables: [
      { alias: 'policy', fqn: 'CONFORMED_GOLD.DIM_POLICY', pk: 'POLICY_KEY' },
      { alias: 'premium', fqn: 'CONFORMED_GOLD.FCT_PREMIUM', pk: 'PREMIUM_KEY' },
      { alias: 'line', fqn: 'CONFORMED_GOLD.DIM_LINE_OF_BUSINESS', pk: 'LINE_CODE' },
      { alias: 'producer', fqn: 'CONFORMED_GOLD.DIM_PRODUCER', pk: 'AGENCY_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'premium', to: 'policy', on: 'POLICY_KEY' },
      { from: 'policy', to: 'line', on: 'LINE_CODE' },
      { from: 'policy', to: 'producer', on: 'AGENCY_KEY' },
      { from: 'premium', to: 'date', on: 'MONTH_KEY' },
    ],
    facts: [
      { name: 'premium.written_premium', expr: 'premium.WRITTEN_PREMIUM', description: 'Premium written in the month' },
      { name: 'premium.earned_premium', expr: 'premium.EARNED_PREMIUM', description: 'Premium earned in the month' },
      { name: 'premium.billed_amount', expr: 'premium.BILLED_AMOUNT', description: 'Invoiced in the month' },
      { name: 'premium.days_past_due', expr: 'premium.DAYS_PAST_DUE', description: 'Days past due at month end' },
      { name: 'policy.annual_premium', expr: 'policy.ANNUAL_PREMIUM', description: 'Current term premium' },
    ],
    dimensions: [
      { name: 'policy.region', expr: 'policy.REGION', synonyms: ['state group', 'territory', 'area'], description: 'Region (Northeast, Midwest, South, West)' },
      { name: 'policy.state', expr: 'policy.STATE', synonyms: ['risk state'], description: 'Risk state' },
      { name: 'line.line_of_business', expr: 'line.LINE_OF_BUSINESS', synonyms: ['lob', 'line', 'product line'], description: 'Line of business' },
      { name: 'line.segment', expr: 'line.SEGMENT', synonyms: ['personal or commercial', 'segment'], description: 'Personal or commercial lines' },
      { name: 'producer.channel', expr: 'producer.CHANNEL', synonyms: ['distribution channel', 'channel'], description: 'Distribution channel' },
      { name: 'policy.policy_status', expr: 'policy.POLICY_STATUS', synonyms: ['status'], description: 'In force, lapsed or cancelled' },
    ],
    timeDimensions: [
      { name: 'date.premium_month', expr: "DATE_TRUNC('month', date.CALENDAR_DATE)", description: 'Premium month' },
      { name: 'policy.inception_date', expr: 'policy.INCEPTION_DATE', description: 'Original inception date' },
    ],
    metrics: [
      { name: 'policies_in_force', expr: "COUNT(DISTINCT IFF(policy.policy_status = 'In force' AND policy.term_effective_date <= CURRENT_DATE, policy.policy_key, NULL))", description: 'Policies in force at the as-of date (BR-001)', synonyms: ['pif', 'policy count', 'in-force policies'], termId: 'T-002', unit: 'policies' },
      { name: 'policy_retention_rate', expr: 'AVG(IFF(policy.renewed_flag, 1, 0)) * 100', description: 'Policies renewed ÷ policies that reached a renewal date (BR-012)', synonyms: ['retention', 'renewal rate', 'persistency'], termId: 'T-016', unit: '%' },
      { name: 'avg_premium_per_policy', expr: "AVG(IFF(policy.policy_status = 'In force', policy.annual_premium, NULL))", description: 'Average current term premium of policies in force', synonyms: ['average premium', 'premium per policy'], termId: 'T-006', unit: 'USD' },
      { name: 'avg_tenure_years', expr: "AVG(IFF(policy.policy_status = 'In force', DATEDIFF('day', policy.inception_date, CURRENT_DATE) / 365.25, NULL))", description: 'Average years since original inception, policies in force', synonyms: ['tenure', 'customer tenure'], termId: 'T-001', unit: 'years' },
      { name: 'earned_premium', expr: 'SUM(premium.earned_premium)', description: 'Premium earned in the period', synonyms: ['ep', 'earned'], termId: 'T-005', unit: 'USD' },
      { name: 'written_premium', expr: 'SUM(premium.written_premium)', description: 'Premium written in the period', synonyms: ['gwp', 'dwp', 'written'], termId: 'T-006', unit: 'USD' },
      { name: 'premium_growth_pct', expr: 'SUM(premium.written_premium) / LAG(SUM(premium.written_premium)) OVER (ORDER BY date.fiscal_year) * 100 - 100', description: 'Written premium year to date vs the same months last year (BR-018)', synonyms: ['premium growth', 'top-line growth'], termId: 'T-006', unit: '%' },
      { name: 'billing_delinquency_rate', expr: 'AVG(IFF(premium.days_past_due > 30, 1, 0)) * 100', description: 'Invoices more than 30 days past due (BR-013)', synonyms: ['delinquency', 'past due rate'], termId: 'T-023', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_POLICYHOLDER_360'),
    productIds: ['DP-01', 'DP-03'],
    playground: {
      from: 'SEMANTIC.SV_POLICYHOLDER_360',
      rows: () => d.policies.map((p) => ({
        region: p.region, line: p.lineName, segment: p.segment, channel: agencyByKey.get(p.agencyKey)!.channel, inForce: inForceOn(p, AS_OF),
        due: Boolean(p.due['2026']), renewed: Boolean(p.renewed['2026']), premium: p.premium, tenure: daysBetween(p.inception, AS_OF) / 365.25,
        earned: (ytd().earned.get(p.key) ?? 0) * d.scale, written: (ytd().written.get(p.key) ?? 0) * d.scale,
      })),
      dimensions: [
        { name: 'policy.region', column: 'region' },
        { name: 'line.line_of_business', column: 'line' },
        { name: 'producer.channel', column: 'channel' },
      ],
      filters: [
        { label: 'All policies (premium year to date 2026)', sql: "date.premium_month BETWEEN '2026-01-01' AND '2026-09-01'", test: () => true },
        { label: 'Personal lines', sql: "line.segment = 'Personal'", test: (r) => r.segment === 'Personal' },
        { label: 'Commercial lines', sql: "line.segment = 'Commercial'", test: (r) => r.segment === 'Commercial' },
      ],
      metrics: [
        { name: 'policies_in_force', unit: '', decimals: 0, sqlExpr: 'policies_in_force', agg: (rs) => Math.round(rs.filter((r) => r.inForce).length * d.scale) },
        { name: 'policy_retention_rate', unit: '%', decimals: 1, sqlExpr: 'policy_retention_rate', agg: (rs) => { const due = rs.filter((r) => r.due); return (due.filter((r) => r.renewed).length / Math.max(1, due.length)) * 100; } },
        { name: 'avg_premium_per_policy', unit: 'USD', decimals: 0, sqlExpr: 'avg_premium_per_policy', agg: (rs) => { const f = rs.filter((r) => r.inForce); return sumOf(f, 'premium') / Math.max(1, f.length); } },
        { name: 'earned_premium', unit: 'USD', decimals: 0, sqlExpr: 'earned_premium', agg: (rs) => sumOf(rs, 'earned') },
        { name: 'avg_tenure_years', unit: 'years', decimals: 1, sqlExpr: 'avg_tenure_years', agg: (rs) => { const f = rs.filter((r) => r.inForce); return sumOf(f, 'tenure') / Math.max(1, f.length); } },
      ],
    },
  };

  // ---- Claims experience (DP-02): claims joined to earned premium at line × region × quarter grain
  const uwList = memo(() => {
    const uwRows = new Map<string, Row>();
    const cell = (line: string, region: string, quarter: string) => {
      const k = `${line}|${region}|${quarter}`;
      let r = uwRows.get(k);
      if (!r) uwRows.set(k, (r = { line: LINE_BY_CODE[line].name, region, quarter, earned: 0, expense: 0, incEx: 0, incCat: 0, lae: 0, claims: 0 }));
      return r;
    };
    for (const p of d.premiums) {
      const r = cell(p.line, p.region, quarterOf(`${p.month}-01`));
      r.earned = n(r, 'earned') + p.earned * d.scale;
      r.expense = n(r, 'expense') + p.expense * d.scale;
    }
    for (const c of d.claims) {
      const r = cell(c.line, c.region, quarterOf(c.lossDate));
      if (c.catCode) r.incCat = n(r, 'incCat') + c.incurred * d.claimScale;
      else r.incEx = n(r, 'incEx') + c.incurred * d.claimScale;
      r.lae = n(r, 'lae') + c.lae * d.claimScale;
      r.claims = n(r, 'claims') + d.claimScale;
    }
    return [...uwRows.values()];
  });
  const claims: SemanticView = {
    name: 'SV_CLAIMS_EXPERIENCE',
    description: 'Loss ratios, combined ratio, severity, frequency, cycle time and recoveries by line, region and period',
    tables: [
      { alias: 'claim', fqn: 'CONFORMED_GOLD.FCT_CLAIM', pk: 'CLAIM_KEY' },
      { alias: 'premium', fqn: 'CONFORMED_GOLD.FCT_PREMIUM', pk: 'PREMIUM_KEY' },
      { alias: 'line', fqn: 'CONFORMED_GOLD.DIM_LINE_OF_BUSINESS', pk: 'LINE_CODE' },
      { alias: 'cat', fqn: 'CONFORMED_GOLD.DIM_CAT_EVENT', pk: 'CAT_CODE' },
      { alias: 'policy', fqn: 'CONFORMED_GOLD.DIM_POLICY', pk: 'POLICY_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'claim', to: 'line', on: 'LINE_CODE' },
      { from: 'premium', to: 'line', on: 'LINE_CODE' },
      { from: 'claim', to: 'cat', on: 'CAT_CODE' },
      { from: 'claim', to: 'policy', on: 'POLICY_KEY' },
      { from: 'claim', to: 'date', on: 'LOSS_DATE_KEY' },
      { from: 'premium', to: 'date', on: 'MONTH_KEY' },
    ],
    facts: [
      { name: 'claim.incurred_loss', expr: 'claim.INCURRED_LOSS', description: 'Paid plus case reserve per claim' },
      { name: 'claim.paid_loss', expr: 'claim.PAID_LOSS', description: 'Paid to date per claim' },
      { name: 'claim.lae_amount', expr: 'claim.LAE_AMOUNT', description: 'Loss adjustment expense per claim' },
      { name: 'claim.subro_recovered', expr: 'claim.SUBRO_RECOVERED', description: 'Subrogation recovered per claim' },
      { name: 'claim.cycle_days', expr: 'claim.CYCLE_DAYS', description: 'FNOL to close days' },
      { name: 'premium.earned_premium', expr: 'premium.EARNED_PREMIUM', description: 'Earned premium (loss ratio denominator)' },
      { name: 'premium.uw_expense', expr: 'premium.UW_EXPENSE', description: 'Underwriting expense' },
    ],
    dimensions: [
      { name: 'line.line_of_business', expr: 'line.LINE_OF_BUSINESS', synonyms: ['lob', 'line', 'product line', 'business line'], description: 'Line of business' },
      { name: 'claim.region', expr: 'claim.REGION', synonyms: ['state group', 'territory'], description: 'Region' },
      { name: 'policy.state', expr: 'policy.STATE', synonyms: ['state', 'loss state'], description: 'Risk state' },
      { name: 'claim.claim_status', expr: 'claim.CLAIM_STATUS', synonyms: ['status', 'open or closed'], description: 'Claim status' },
      { name: 'claim.is_catastrophe', expr: 'claim.CAT_CODE IS NOT NULL', synonyms: ['cat', 'catastrophe', 'cat loss'], description: 'Claim carries a code on the cat-code list' },
      { name: 'cat.peril', expr: 'cat.PERIL', synonyms: ['peril', 'event type'], description: 'Catastrophe peril' },
    ],
    timeDimensions: [
      { name: 'date.loss_date', expr: 'date.CALENDAR_DATE', description: 'Date of loss (accident date)' },
      { name: 'date.loss_quarter', expr: 'date.FISCAL_QUARTER', description: 'Accident quarter' },
    ],
    metrics: [
      { name: 'loss_ratio_ex_cat', expr: 'SUM(IFF(claim.cat_code IS NULL, claim.incurred_loss, 0)) / SUM(premium.earned_premium) * 100', description: 'Incurred losses excluding catastrophe-coded claims ÷ earned premium (BR-005)', synonyms: ['ex-cat loss ratio', 'loss ratio excluding catastrophes', 'non-cat loss ratio', 'underlying loss ratio'], termId: 'T-008', unit: '%' },
      { name: 'loss_ratio', expr: 'SUM(claim.incurred_loss) / SUM(premium.earned_premium) * 100', description: 'All-in incurred losses ÷ earned premium', synonyms: ['loss ratio', 'all-in loss ratio', 'lr'], termId: 'T-008', unit: '%' },
      { name: 'cat_loss_ratio', expr: 'SUM(IFF(claim.cat_code IS NOT NULL, claim.incurred_loss, 0)) / SUM(premium.earned_premium) * 100', description: 'Catastrophe incurred losses ÷ earned premium (points)', synonyms: ['cat load', 'cat points', 'catastrophe loss ratio'], termId: 'T-009', unit: 'pts' },
      { name: 'combined_ratio', expr: '(SUM(claim.incurred_loss) + SUM(claim.lae_amount) + SUM(premium.uw_expense)) / SUM(premium.earned_premium) * 100', description: 'Loss ratio + LAE ratio + expense ratio (BR-006)', synonyms: ['combined ratio', 'cor', 'underwriting ratio'], termId: 'T-010', unit: '%' },
      { name: 'lae_ratio', expr: 'SUM(claim.lae_amount) / SUM(premium.earned_premium) * 100', description: 'Loss adjustment expense ÷ earned premium', synonyms: ['lae ratio', 'adjustment expense ratio'], termId: 'T-011', unit: '%' },
      { name: 'expense_ratio', expr: 'SUM(premium.uw_expense) / SUM(premium.earned_premium) * 100', description: 'Underwriting expense ÷ earned premium', synonyms: ['expense ratio', 'uw expense ratio'], termId: 'T-024', unit: '%' },
      { name: 'avg_severity', expr: 'AVG(claim.incurred_loss)', description: 'Average incurred loss per claim (BR-003)', synonyms: ['severity', 'average claim cost', 'average incurred'], termId: 'T-012', unit: 'USD' },
      { name: 'claim_frequency', expr: 'COUNT(claim.claim_key) / (COUNT(premium.premium_key) / 12) * 100', description: 'Claims per 100 policy-years', synonyms: ['frequency', 'claim rate'], termId: 'T-025', unit: 'per 100' },
      { name: 'avg_cycle_days', expr: "AVG(IFF(claim.claim_status = 'Closed', claim.cycle_days, NULL))", description: 'Average days from FNOL to close, claims closed in the period (BR-004)', synonyms: ['cycle time', 'days to close', 'claim duration'], termId: 'T-013', unit: 'days' },
      { name: 'open_claims', expr: "COUNT_IF(claim.claim_status IN ('Open', 'Reopened') AND claim.case_reserve > 0)", description: 'Open claims per BR-002', synonyms: ['open inventory', 'pending claims'], termId: 'T-014', unit: 'claims' },
      { name: 'subrogation_recovery_rate', expr: 'SUM(claim.subro_recovered) / SUM(IFF(claim.subro_eligible, claim.paid_loss, 0)) * 100', description: 'Recoveries ÷ paid losses on subrogation-eligible closed claims (BR-008)', synonyms: ['subro rate', 'recovery rate'], termId: 'T-015', unit: '%' },
      { name: 'incurred_losses', expr: 'SUM(claim.incurred_loss)', description: 'Paid plus case reserves on claims with a loss date in the period', synonyms: ['incurred', 'losses incurred'], termId: 'T-007', unit: 'USD' },
      { name: 'paid_losses', expr: 'SUM(claim.paid_loss)', description: 'Loss payments made', synonyms: ['paid', 'payments'], termId: 'T-027', unit: 'USD' },
      { name: 'earned_premium', expr: 'SUM(premium.earned_premium)', description: 'Earned premium in the period', synonyms: ['ep'], termId: 'T-005', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_CLAIMS_EXPERIENCE'),
    productIds: ['DP-02'],
    playground: {
      from: 'SEMANTIC.SV_CLAIMS_EXPERIENCE',
      rows: uwList,
      dimensions: [
        { name: 'line.line_of_business', column: 'line' },
        { name: 'claim.region', column: 'region' },
        { name: 'date.loss_quarter', column: 'quarter' },
      ],
      filters: [
        { label: 'This year to date (Jan–Sep 2026)', sql: "date.loss_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => String(r.quarter).startsWith('2026') },
        { label: 'Prior year to date (Jan–Sep 2025)', sql: "date.loss_date BETWEEN '2025-01-01' AND '2025-09-30'", test: (r) => PRIOR_YTD.includes(String(r.quarter)) },
        { label: 'Q3 2026', sql: "date.loss_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
      ],
      metrics: [
        { name: 'loss_ratio_ex_cat', unit: '%', decimals: 1, sqlExpr: 'loss_ratio_ex_cat', agg: (rs) => (sumOf(rs, 'incEx') / Math.max(1, sumOf(rs, 'earned'))) * 100 },
        { name: 'cat_loss_ratio', unit: 'pts', decimals: 1, sqlExpr: 'cat_loss_ratio', agg: (rs) => (sumOf(rs, 'incCat') / Math.max(1, sumOf(rs, 'earned'))) * 100 },
        { name: 'combined_ratio', unit: '%', decimals: 1, sqlExpr: 'combined_ratio', agg: (rs) => ((sumOf(rs, 'incEx') + sumOf(rs, 'incCat') + sumOf(rs, 'lae') + sumOf(rs, 'expense')) / Math.max(1, sumOf(rs, 'earned'))) * 100 },
        { name: 'avg_severity', unit: 'USD', decimals: 0, sqlExpr: 'avg_severity', agg: (rs) => (sumOf(rs, 'incEx') + sumOf(rs, 'incCat')) / Math.max(1, sumOf(rs, 'claims')) },
        { name: 'incurred_losses', unit: 'USD', decimals: 0, sqlExpr: 'incurred_losses', agg: (rs) => sumOf(rs, 'incEx') + sumOf(rs, 'incCat') },
      ],
    },
  };

  // ---- Distribution (DP-04)
  const distribution: SemanticView = {
    name: 'SV_DISTRIBUTION',
    description: 'Submission funnel, quote-to-bind, new business premium and quote turnaround by agency and channel',
    tables: [
      { alias: 'submission', fqn: 'CONFORMED_GOLD.FCT_SUBMISSION', pk: 'SUBMISSION_KEY' },
      { alias: 'producer', fqn: 'CONFORMED_GOLD.DIM_PRODUCER', pk: 'AGENCY_KEY' },
      { alias: 'line', fqn: 'CONFORMED_GOLD.DIM_LINE_OF_BUSINESS', pk: 'LINE_CODE' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'submission', to: 'producer', on: 'AGENCY_KEY' },
      { from: 'submission', to: 'line', on: 'LINE_CODE' },
      { from: 'submission', to: 'date', on: 'QUOTE_DATE_KEY' },
    ],
    facts: [
      { name: 'submission.quoted_premium', expr: 'submission.QUOTED_PREMIUM', description: 'Quoted premium' },
      { name: 'submission.bound_premium', expr: 'submission.BOUND_PREMIUM', description: 'Bound premium' },
      { name: 'submission.turnaround_days', expr: 'submission.TURNAROUND_DAYS', description: 'Submission to quote days' },
    ],
    dimensions: [
      { name: 'producer.agency_name', expr: 'producer.AGENCY_NAME', synonyms: ['agency', 'agent', 'producer', 'broker'], description: 'Agency or broker' },
      { name: 'producer.channel', expr: 'producer.CHANNEL', synonyms: ['channel', 'distribution channel'], description: 'Distribution channel' },
      { name: 'line.line_of_business', expr: 'line.LINE_OF_BUSINESS', synonyms: ['lob', 'line'], description: 'Line of business' },
      { name: 'submission.submission_type', expr: 'submission.SUBMISSION_TYPE', synonyms: ['business type', 'new or rewrite'], description: 'New business, rewrite or reinstatement' },
      { name: 'submission.region', expr: 'submission.REGION', synonyms: ['territory'], description: 'Region' },
    ],
    timeDimensions: [
      { name: 'date.quote_date', expr: 'date.CALENDAR_DATE', description: 'Quote date' },
      { name: 'date.quote_quarter', expr: 'date.FISCAL_QUARTER', description: 'Quote quarter' },
    ],
    metrics: [
      { name: 'quote_to_bind_ratio', expr: 'COUNT_IF(submission.is_bound) / COUNT_IF(submission.is_quoted) * 100', description: 'Bound ÷ quoted submissions (BR-014)', synonyms: ['bind rate', 'hit ratio', 'conversion'], termId: 'T-017', unit: '%' },
      { name: 'new_business_premium', expr: "SUM(IFF(submission.submission_type = 'New business', submission.bound_premium, 0))", description: 'Bound premium on new business, excluding rewrites and reinstatements (BR-015)', synonyms: ['nb premium', 'new business', 'new premium'], termId: 'T-018', unit: 'USD' },
      { name: 'quote_turnaround_days', expr: 'AVG(submission.turnaround_days)', description: 'Average days from submission to quote (BR-016)', synonyms: ['turnaround', 'speed to quote', 'time to quote'], termId: 'T-028', unit: 'days' },
      { name: 'submissions_quoted', expr: 'COUNT_IF(submission.is_quoted)', description: 'Submissions quoted', synonyms: ['quotes', 'quote volume'], termId: 'T-022', unit: 'quotes' },
      { name: 'policies_bound', expr: 'COUNT_IF(submission.is_bound)', description: 'Submissions bound', synonyms: ['binds', 'new policies'], termId: 'T-017', unit: 'policies' },
    ],
    verifiedQueryIds: vqIds('SV_DISTRIBUTION'),
    productIds: ['DP-04'],
    playground: {
      from: 'SEMANTIC.SV_DISTRIBUTION',
      rows: () => d.submissions.filter((s) => s.quoteDate).map((s) => {
        const a = agencyByKey.get(s.agencyKey)!;
        return { agency: a.name, channel: a.channel, line: LINE_BY_CODE[s.line].name, quarter: quarterOf(s.quoteDate!), year: s.quoteDate!.slice(0, 4), bound: Boolean(s.boundDate), nb: s.type === 'New business', premium: s.premium, turnaround: s.turnaround ?? 0 };
      }),
      dimensions: [
        { name: 'producer.agency_name', column: 'agency' },
        { name: 'producer.channel', column: 'channel' },
        { name: 'line.line_of_business', column: 'line' },
      ],
      filters: [
        { label: 'Quoted this year (2026)', sql: "date.quote_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => r.year === '2026' },
        { label: 'Quoted in Q3 2026', sql: "date.quote_quarter = '2026-Q3'", test: (r) => r.quarter === '2026-Q3' },
        { label: 'Independent agents, 2026', sql: "producer.channel = 'Independent agent' AND date.quote_date >= '2026-01-01'", test: (r) => r.channel === 'Independent agent' && r.year === '2026' },
      ],
      metrics: [
        { name: 'quote_to_bind_ratio', unit: '%', decimals: 1, sqlExpr: 'quote_to_bind_ratio', agg: (rs) => (rs.filter((r) => r.bound).length / Math.max(1, rs.length)) * 100 },
        { name: 'new_business_premium', unit: 'USD', decimals: 0, sqlExpr: 'new_business_premium', agg: (rs) => sumOf(rs.filter((r) => r.bound && r.nb), 'premium') * d.subScale },
        { name: 'quote_turnaround_days', unit: 'days', decimals: 1, sqlExpr: 'quote_turnaround_days', agg: (rs) => sumOf(rs, 'turnaround') / Math.max(1, rs.length) },
        { name: 'submissions_quoted', unit: '', decimals: 0, sqlExpr: 'submissions_quoted', agg: (rs) => Math.round(rs.length * d.subScale) },
      ],
    },
  };

  // ---- Loss reserves (DP-05, in certification)
  const reservesSv: SemanticView = {
    name: 'SV_LOSS_RESERVES',
    description: 'Month-end case reserves and IBNR by line, region and accident year',
    tables: [
      { alias: 'reserve', fqn: 'CONFORMED_GOLD.FCT_RESERVE', pk: 'RESERVE_KEY' },
      { alias: 'claim', fqn: 'CONFORMED_GOLD.FCT_CLAIM', pk: 'CLAIM_KEY' },
      { alias: 'line', fqn: 'CONFORMED_GOLD.DIM_LINE_OF_BUSINESS', pk: 'LINE_CODE' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'reserve', to: 'claim', on: 'CLAIM_KEY' },
      { from: 'reserve', to: 'line', on: 'LINE_CODE' },
      { from: 'reserve', to: 'date', on: 'VALUATION_DATE_KEY' },
    ],
    facts: [
      { name: 'reserve.case_reserve', expr: 'reserve.CASE_RESERVE', description: 'Case reserve at valuation' },
      { name: 'reserve.ibnr_allocated', expr: 'reserve.IBNR_ALLOCATED', description: 'Allocated IBNR' },
      { name: 'reserve.paid_to_date', expr: 'reserve.PAID_TO_DATE', description: 'Paid to date' },
    ],
    dimensions: [
      { name: 'line.line_of_business', expr: 'line.LINE_OF_BUSINESS', synonyms: ['lob', 'line'], description: 'Line of business' },
      { name: 'reserve.region', expr: 'reserve.REGION', synonyms: ['territory'], description: 'Region' },
      { name: 'reserve.accident_year', expr: 'reserve.ACCIDENT_YEAR', synonyms: ['ay', 'accident year'], description: 'Accident year' },
      { name: 'claim.claim_status', expr: 'claim.CLAIM_STATUS', synonyms: ['status'], description: 'Claim status' },
    ],
    timeDimensions: [
      { name: 'date.valuation_date', expr: 'date.CALENDAR_DATE', description: 'Month-end valuation date' },
      { name: 'date.valuation_month', expr: "DATE_TRUNC('month', date.CALENDAR_DATE)", description: 'Valuation month' },
    ],
    metrics: [
      { name: 'case_reserve_balance', expr: 'SUM(reserve.case_reserve)', description: 'Case reserves on open claims at month end (BR-010)', synonyms: ['case reserves', 'outstanding reserves', 'case os'], termId: 'T-019', unit: 'USD' },
      { name: 'ibnr_reserve', expr: 'SUM(reserve.ibnr_allocated)', description: 'Incurred but not reported reserve (BR-011)', synonyms: ['ibnr', 'bulk reserve'], termId: 'T-020', unit: 'USD' },
      { name: 'total_loss_reserves', expr: 'SUM(reserve.case_reserve) + SUM(reserve.ibnr_allocated)', description: 'Case plus IBNR', synonyms: ['loss reserves', 'total reserves'], termId: 'T-019', unit: 'USD' },
      { name: 'avg_case_reserve', expr: 'AVG(IFF(reserve.case_reserve > 0, reserve.case_reserve, NULL))', description: 'Average case reserve per open claim', synonyms: ['average reserve'], termId: 'T-019', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_LOSS_RESERVES'),
    productIds: ['DP-05'],
    playground: {
      from: 'SEMANTIC.SV_LOSS_RESERVES',
      rows: () => d.reserves.map((r) => ({ line: LINE_BY_CODE[r.line].name, region: r.region, ay: String(r.accidentYear), month: r.month, case: r.caseReserve * d.claimScale, ibnr: r.ibnr * d.claimScale })),
      dimensions: [
        { name: 'line.line_of_business', column: 'line' },
        { name: 'reserve.region', column: 'region' },
        { name: 'reserve.accident_year', column: 'ay' },
      ],
      filters: [
        { label: 'September 2026 valuation', sql: "date.valuation_date = '2026-09-30'", test: (r) => r.month === '2026-09' },
        { label: 'August 2026 valuation', sql: "date.valuation_date = '2026-08-31'", test: (r) => r.month === '2026-08' },
        { label: 'June 2026 valuation (Q2 close)', sql: "date.valuation_date = '2026-06-30'", test: (r) => r.month === '2026-06' },
      ],
      metrics: [
        { name: 'case_reserve_balance', unit: 'USD', decimals: 0, sqlExpr: 'case_reserve_balance', agg: (rs) => sumOf(rs, 'case') },
        { name: 'ibnr_reserve', unit: 'USD', decimals: 0, sqlExpr: 'ibnr_reserve', agg: (rs) => sumOf(rs, 'ibnr') },
        { name: 'total_loss_reserves', unit: 'USD', decimals: 0, sqlExpr: 'total_loss_reserves', agg: (rs) => sumOf(rs, 'case') + sumOf(rs, 'ibnr') },
        { name: 'avg_case_reserve', unit: 'USD', decimals: 0, sqlExpr: 'avg_case_reserve', agg: (rs) => { const f = rs.filter((r) => n(r, 'case') > 0); return sumOf(f, 'case') / Math.max(1, f.length) / d.claimScale; } },
      ],
    },
  };

  return [policyholder, claims, distribution, reservesSv];
}
