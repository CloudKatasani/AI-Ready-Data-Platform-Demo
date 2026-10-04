import type { ContextLayer, VerifiedQuery } from '../../types';

const DB = 'NVE_AI_PLATFORM';

type VqSpec = [question: string, metrics: string, dims: string, where?: string];

const vq = (sv: string, items: VqSpec[], start: number, by: string[]): VerifiedQuery[] =>
  items.map(([question, metrics, dims, where], i) => ({
    id: `VQ-${String(start + i).padStart(3, '0')}`,
    semanticView: sv,
    question,
    sql: `SELECT *\n  FROM SEMANTIC_VIEW(\n    ${DB}.SEMANTIC.${sv}\n    METRICS ${metrics}${dims ? `\n    DIMENSIONS ${dims}` : ''}${where ? `\n    WHERE ${where}` : ''}\n  );`,
    verifiedBy: by[i % by.length],
    verifiedOn: `2026-0${7 + (i % 3)}-${String(3 + ((i * 5) % 25)).padStart(2, '0')}`,
  }));

const VQ_CUSTOMER: VqSpec[] = [
  ['What was the average monthly residential bill last quarter by region?', 'avg_monthly_bill', 'customer.region', "customer.segment = 'Residential' AND billing.statement_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['How many active customers do we have?', 'active_customers', ''],
  ['How many active customers are enrolled in paperless billing?', 'active_customers', 'customer.digital_enrolled'],
  ['What is the digital adoption rate by operating company?', 'digital_adoption_rate', 'customer.opco'],
  ['What is the total arrears balance by opco?', 'arrears_balance', 'customer.opco'],
  ['Which customers are at high churn risk with arrears over $500?', 'arrears_balance, avg_churn_risk', 'customer.customer_id', 'customer.churn_risk_score >= 70 AND billing.arrears_amount > 500'],
  ['Average churn risk score by segment', 'avg_churn_risk', 'customer.segment'],
  ['Show peak demand by rate class for last week', 'peak_kw', 'customer.rate_class, usage.usage_date', "usage.usage_date BETWEEN '2026-09-21' AND '2026-09-27'"],
  ['What is the AMI read success rate this month?', 'read_success_rate', '', "usage.usage_date >= '2026-09-01'"],
  ['Daily consumption trend for September', 'daily_kwh', 'usage.usage_date', "usage.usage_date >= '2026-09-01'"],
  ['Share of estimated reads by city', 'estimated_read_pct', 'premise.city'],
  ['Average bill by rate class for the last 12 months', 'avg_monthly_bill', 'customer.rate_class'],
  ['Number of customers per rate class', 'active_customers', 'customer.rate_class'],
  ['Average daily kWh for residential time-of-use customers', 'daily_kwh', '', "customer.rate_class = 'RS-TOU'"],
];
const VQ_RELIABILITY: VqSpec[] = [
  ['What is SAIDI by OPCO year to date?', 'saidi_minutes', 'circuit.opco', "date.outage_date BETWEEN '2026-01-01' AND '2026-09-30' AND outage.med_flag = FALSE"],
  ['What is SAIFI year to date excluding major event days?', 'saifi', '', "date.outage_date >= '2026-01-01' AND outage.med_flag = FALSE"],
  ['What is CAIDI by operating company this year?', 'caidi_minutes', 'circuit.opco', "date.outage_date >= '2026-01-01' AND outage.med_flag = FALSE"],
  ['Top 5 circuits by customers interrupted in the last 30 days', 'customers_interrupted', 'circuit.circuit_id', "date.outage_date >= '2026-09-01'"],
  ['Compare SAIFI this year with last year', 'saifi', 'date.fiscal_year', "MONTH(date.outage_date) <= 9 AND outage.med_flag = FALSE"],
  ['Outages by cause year to date', 'customers_interrupted', 'outage.cause', "date.outage_date >= '2026-01-01'"],
  ['How many outages were caused by trees this quarter?', 'tree_outages', '', "date.fiscal_quarter = '2026-Q3'"],
  ['SAIDI including major event days', 'saidi_minutes', '', "date.outage_date >= '2026-01-01'"],
  ['Customer minutes interrupted by month', 'customer_minutes_interrupted', 'date.outage_month'],
  ['Which substations had the most customer minutes interrupted?', 'customer_minutes_interrupted', 'circuit.substation'],
  ['SAIDI by quarter for 2026', 'saidi_minutes', 'date.fiscal_quarter', "date.outage_date >= '2026-01-01' AND outage.med_flag = FALSE"],
  ['How many customers were interrupted on major event days?', 'customers_interrupted', 'date.outage_date', 'outage.med_flag = TRUE'],
  ['Average restoration time for equipment failures', 'caidi_minutes', '', "outage.cause = 'Equipment failure'"],
  ['SAIFI by operating company last quarter', 'saifi', 'circuit.opco', "date.fiscal_quarter = '2026-Q3' AND outage.med_flag = FALSE"],
];
const VQ_PROCUREMENT: VqSpec[] = [
  ['What percentage of Q3 spend was under contract?', 'spend_under_contract_pct', '', "date.fiscal_quarter = '2026-Q3'"],
  ['Which suppliers have OTIF below 90%?', 'otif_pct', 'supplier.supplier_name', 'otif_pct < 90'],
  ['Where is maverick spend highest by category?', 'maverick_spend', 'spend.category'],
  ['Total spend by supplier this fiscal year', 'total_spend', 'supplier.supplier_name'],
  ['Average PO cycle time by category', 'po_cycle_days', 'spend.category'],
  ['Spend under contract by quarter', 'spend_under_contract_pct', 'date.fiscal_quarter'],
  ['OTIF trend by month', 'otif_pct', 'date.po_month'],
  ['Spend with diversity-certified suppliers', 'total_spend', 'supplier.diversity_certified'],
  ['Maverick spend by supplier', 'maverick_spend', 'supplier.supplier_name'],
  ['Top categories by total spend', 'total_spend', 'spend.category'],
  ['PO cycle time for transformers', 'po_cycle_days', '', "spend.category = 'Transformers'"],
  ['Spend under contract for preferred suppliers', 'spend_under_contract_pct', '', 'supplier.preferred = TRUE'],
  ['Fleet spend off contract this year', 'maverick_spend', '', "spend.category = 'Fleet'"],
];
/** Exactly 7: DP-05 certification gate 4 needs 10 verified queries (spec section 7.6). */
const VQ_BILLING: VqSpec[] = [
  ['What is our days sales outstanding this month?', 'dso_days', '', "date.statement_month = '2026-09-01'"],
  ['How many bills were issued last month?', 'bills_issued', '', "date.statement_month = '2026-09-01'"],
  ['What is the estimated bill rate by opco?', 'estimated_bill_rate', 'customer.opco'],
  ['DSO trend for the last six months', 'dso_days', 'date.statement_month', "date.statement_month >= '2026-04-01'"],
  ['Collections rate last quarter', 'collections_rate', '', "date.statement_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['Estimated bill rate trend by month', 'estimated_bill_rate', 'date.statement_month'],
  ['Bills issued by rate class', 'bills_issued', 'customer.rate_class'],
];

const verifiedQueries: VerifiedQuery[] = [
  ...vq('SV_CUSTOMER_360', VQ_CUSTOMER, 1, ['A. Patel', 'M. Reyes']),
  ...vq('SV_RELIABILITY', VQ_RELIABILITY, 15, ['H. Sullivan', 'T. Baptiste']),
  ...vq('SV_PROCUREMENT', VQ_PROCUREMENT, 29, ['L. Kowalski', 'S. Moreau']),
  ...vq('SV_BILLING_AR', VQ_BILLING, 42, ['A. Patel']),
];

export const CONTEXT: ContextLayer = {
  searchService: 'CS_UTILITY_DOCS',
  instructions: [
    { id: 'AI-01', agentId: 'AG-01', type: 'persona', version: '1.3', text: 'You are Northvale’s Customer Insights agent. You help customer and billing analysts understand customers, bills, arrears, digital adoption and usage.' },
    { id: 'AI-02', agentId: 'AG-01', type: 'response', version: '1.3', text: 'Report currency to the cent for averages and to the nearest thousand for balances. Say which period and which customers (active, residential) a number covers.' },
    { id: 'AI-03', agentId: 'AG-01', type: 'guardrail', version: '1.3', text: 'Never reveal customer names, emails or addresses unless the user’s role is allowed to see unmasked PII. Never answer from a product the user cannot access.' },
    { id: 'AI-04', agentId: 'AG-01', type: 'orchestration', version: '1.3', text: 'Use Cortex Analyst on SV_CUSTOMER_360 for customer and usage metrics and on SV_BILLING_AR for receivables. Use CS_UTILITY_DOCS for tariff questions.' },
    { id: 'AI-05', agentId: 'AG-02', type: 'persona', version: '2.0', text: 'You are the Reliability Analyst for Northvale’s distribution grid. You answer questions about outages, reliability indices and vegetation.' },
    { id: 'AI-06', agentId: 'AG-02', type: 'response', version: '2.0', text: 'Always report reliability indices excluding Major Event Days unless the user asks otherwise. Report minutes to one decimal and SAIFI to three decimals.' },
    { id: 'AI-07', agentId: 'AG-02', type: 'guardrail', version: '2.0', text: 'Flag any answer that uses a product that is not certified. Do not speculate about causes not recorded in OMS.' },
    { id: 'AI-08', agentId: 'AG-02', type: 'orchestration', version: '2.0', text: 'Use Cortex Analyst on SV_RELIABILITY. Cite the IEEE 1366 guide from CS_UTILITY_DOCS whenever major event days are excluded.' },
    { id: 'AI-09', agentId: 'AG-03', type: 'persona', version: '1.1', text: 'You are the Procurement Copilot. You help supply chain managers track spend, contract compliance and supplier delivery.' },
    { id: 'AI-10', agentId: 'AG-03', type: 'response', version: '1.1', text: 'Show spend in millions of dollars to one decimal and percentages to one decimal. Name the period.' },
    { id: 'AI-11', agentId: 'AG-03', type: 'guardrail', version: '1.1', text: 'Do not disclose contract prices or rates; report spend only.' },
    { id: 'AI-12', agentId: 'AG-03', type: 'orchestration', version: '1.1', text: 'Use Cortex Analyst on SV_PROCUREMENT. Use the procurement policy in CS_UTILITY_DOCS for definitions of maverick spend.' },
    { id: 'AI-13', agentId: 'AG-04', type: 'persona', version: '0.9', text: 'You are the Data Steward Assistant. You help stewards find governance gaps in the glossary, CDE register and product registry.' },
    { id: 'AI-14', agentId: 'AG-04', type: 'response', version: '0.9', text: 'Answer with a table of items and a recommended next action for each.' },
    { id: 'AI-15', agentId: 'AG-04', type: 'guardrail', version: '0.9', text: 'Read metadata only; never query customer-level data.' },
    { id: 'AI-16', agentId: 'AG-04', type: 'orchestration', version: '0.9', text: 'Use the SQL tool over GLOSSARY, GOVERNANCE and DATA_PRODUCTS.DP_REGISTRY. Read certification state live.' },
  ],
  rules: [
    { id: 'BR-001', domain: 'Customer', text: 'An Active Customer has an account status of Active and at least one billed statement in the last 60 days.', metric: 'SV_CUSTOMER_360.active_customers', sourceDoc: 'Customer data standard v3' },
    { id: 'BR-002', domain: 'Customer', text: 'Residential means rate classes RS-1 and RS-TOU. Commercial means GS-1 and GS-2.', metric: 'SV_CUSTOMER_360.avg_monthly_bill', sourceDoc: 'Northvale tariff book 2026' },
    { id: 'BR-003', domain: 'Customer', text: 'Average monthly bill excludes past-due balances and one-off fees.', metric: 'SV_CUSTOMER_360.avg_monthly_bill', sourceDoc: 'Northvale tariff book 2026' },
    { id: 'BR-004', domain: 'Customer', text: 'High churn risk means a churn risk score of 70 or above.', metric: 'SV_CUSTOMER_360.avg_churn_risk', sourceDoc: 'Customer data standard v3' },
    { id: 'BR-005', domain: 'Customer', text: 'Arrears thresholds are evaluated on the latest statement per customer.', metric: 'SV_CUSTOMER_360.arrears_balance', sourceDoc: 'Credit & collections policy' },
    { id: 'BR-006', domain: 'Finance', text: 'DSO uses month-end receivables (current billed plus arrears) over billed revenue for the month, times 30.', metric: 'SV_BILLING_AR.dso_days', sourceDoc: 'Credit & collections policy' },
    { id: 'BR-007', domain: 'Finance', text: 'Collections rate counts payments received within 60 days of the statement date.', metric: 'SV_BILLING_AR.collections_rate', sourceDoc: 'Credit & collections policy' },
    { id: 'BR-008', domain: 'Metering', text: 'Peak demand is the highest 15-minute kW in the day; weeks run Monday to Sunday.', metric: 'SV_CUSTOMER_360.peak_kw', sourceDoc: 'Metering services standard' },
    { id: 'BR-009', domain: 'Metering', text: 'Intervals flagged E (estimated) or M (missing) do not count as successful reads.', metric: 'SV_CUSTOMER_360.read_success_rate', sourceDoc: 'Metering services standard' },
    { id: 'BR-010', domain: 'Grid ops', text: 'Only sustained interruptions (5 minutes or longer) count toward SAIDI, SAIFI and CAIDI.', metric: 'SV_RELIABILITY.saidi_minutes', sourceDoc: 'IEEE 1366 reliability guide' },
    { id: 'BR-011', domain: 'Grid ops', text: 'Customers served is the count of customers at the end of the reporting period, by operating company.', metric: 'SV_RELIABILITY.saidi_minutes', sourceDoc: 'IEEE 1366 reliability guide' },
    { id: 'BR-012', domain: 'Grid ops', text: 'Exclude Major Event Days (IEEE 1366 2.5 beta method) from reliability indices unless the user explicitly asks to include them.', metric: 'SV_RELIABILITY.saidi_minutes', sourceDoc: 'IEEE 1366 reliability guide' },
    { id: 'BR-013', domain: 'Grid ops', text: 'A span is overdue when its last trim is older than its trim cycle; distribution trim cycles are 4 years (5 in rural Appalachia).', metric: 'DP_VEGETATION_RISK.spans_overdue_pct', sourceDoc: 'Vegetation management standard' },
    { id: 'BR-014', domain: 'Supply chain', text: 'Maverick spend is any spend not placed against an active outline agreement, including emergency purchases.', metric: 'SV_PROCUREMENT.maverick_spend', sourceDoc: 'Procurement policy' },
    { id: 'BR-015', domain: 'Supply chain', text: 'OTIF is measured at PO line level: received on or before the promised date and in full quantity.', metric: 'SV_PROCUREMENT.otif_pct', sourceDoc: 'Procurement policy' },
    { id: 'BR-016', domain: 'Supply chain', text: 'Suppliers below 90% OTIF for a quarter enter a performance improvement plan.', metric: 'SV_PROCUREMENT.otif_pct', sourceDoc: 'Procurement policy' },
  ],
  verifiedQueries,
  synonyms: [
    { term: 'Outage', synonym: 'interruptions', scope: 'Grid ops' },
    { term: 'Outage', synonym: 'power cut', scope: 'Grid ops' },
    { term: 'Outage', synonym: 'blackout', scope: 'Grid ops' },
    { term: 'Operating Company', synonym: 'opco', scope: 'Enterprise' },
    { term: 'Operating Company', synonym: 'utility', scope: 'Enterprise' },
    { term: 'Major Event Day', synonym: 'MED', scope: 'Grid ops' },
    { term: 'Major Event Day', synonym: 'storm day', scope: 'Grid ops' },
    { term: 'Customer', synonym: 'account holder', scope: 'Customer' },
    { term: 'Customer', synonym: 'ratepayer', scope: 'Customer' },
    { term: 'Monthly Bill', synonym: 'statement', scope: 'Customer' },
    { term: 'Arrears Balance', synonym: 'past due', scope: 'Customer' },
    { term: 'Arrears Balance', synonym: 'overdue', scope: 'Customer' },
    { term: 'Digital Adoption', synonym: 'paperless', scope: 'Customer' },
    { term: 'Digital Adoption', synonym: 'e-bill', scope: 'Customer' },
    { term: 'Days Sales Outstanding', synonym: 'DSO', scope: 'Finance' },
    { term: 'Supplier OTIF', synonym: 'on time in full', scope: 'Supply chain' },
    { term: 'Supplier OTIF', synonym: 'vendor delivery', scope: 'Supply chain' },
    { term: 'Maverick Spend', synonym: 'off-contract spend', scope: 'Supply chain' },
    { term: 'Maverick Spend', synonym: 'rogue spend', scope: 'Supply chain' },
    { term: 'Supplier', synonym: 'vendor', scope: 'Supply chain' },
    { term: 'Tree-Caused Outage', synonym: 'vegetation outage', scope: 'Grid ops' },
    { term: 'Circuit', synonym: 'feeder', scope: 'Grid ops' },
  ],
  documents: [
    {
      id: 'DOC-01', title: 'IEEE 1366 reliability indices — Northvale application guide', source: '@NVE_AI_PLATFORM.CONTEXT.DOCS/ieee1366_guide_2025.pdf', chunkCount: 42, updatedAt: '2026-01-12 09:00:00',
      chunks: [
        { n: 3, text: 'SAIDI is the sum of all customer interruption durations divided by the total number of customers served. Only sustained interruptions of five minutes or longer are included.' },
        { n: 9, text: 'SAIFI is the total number of customers interrupted divided by the total number of customers served. CAIDI equals SAIDI divided by SAIFI and represents average restoration time.' },
        { n: 14, text: 'Major Event Days are identified using the 2.5 beta method: compute the natural log of daily SAIDI for the trailing five years, take its mean (α) and standard deviation (β), and flag any day whose SAIDI exceeds exp(α + 2.5β). Reliability indices are reported excluding major event days so that performance is comparable year to year.' },
        { n: 21, text: 'Northvale reports reliability by operating company to each state commission. Customers served is measured at period end.' },
      ],
    },
    {
      id: 'DOC-02', title: 'Northvale tariff book 2026', source: '@NVE_AI_PLATFORM.CONTEXT.DOCS/tariff_book_2026.pdf', chunkCount: 118, updatedAt: '2026-01-02 08:00:00',
      chunks: [
        { n: 7, text: 'Rate RS-1 Residential Service applies to single-family and multi-family dwellings. Rate RS-TOU offers on-peak and off-peak energy prices with on-peak hours 2 pm to 7 pm on weekdays.' },
        { n: 22, text: 'Bills rendered on estimated reads are trued up on the next actual read. Late payment charges apply to balances unpaid 21 days after the statement date.' },
        { n: 31, text: 'GS-1 applies to non-residential customers with demand below 50 kW; GS-2 to customers at or above 50 kW, billed with a demand charge per kW of monthly peak.' },
      ],
    },
    {
      id: 'DOC-03', title: 'Procurement policy and supplier performance standard', source: '@NVE_AI_PLATFORM.CONTEXT.DOCS/procurement_policy_v4.pdf', chunkCount: 36, updatedAt: '2026-03-18 10:30:00',
      chunks: [
        { n: 5, text: 'All purchases above $5,000 must be placed against an active outline agreement where one exists for the category. Purchases outside an agreement are classed as maverick spend and reported monthly.' },
        { n: 12, text: 'On time in full (OTIF) is measured per PO line. A supplier below 90% OTIF in a quarter enters a performance improvement plan with quarterly review.' },
      ],
    },
    {
      id: 'DOC-04', title: 'Vegetation management standard', source: '@NVE_AI_PLATFORM.CONTEXT.DOCS/vegetation_standard_2024.pdf', chunkCount: 27, updatedAt: '2025-11-04 14:00:00',
      chunks: [
        { n: 4, text: 'Distribution circuits are trimmed on a four-year cycle; rural Appalachia circuits on a five-year cycle. A span is overdue when its last trim exceeds the cycle.' },
        { n: 9, text: 'Minimum clearance after trimming is 10 feet from primary conductors. Spans with clearance below 6 feet are prioritised for hot-spot trimming.' },
      ],
    },
  ],
};
