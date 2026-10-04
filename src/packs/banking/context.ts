import type { ContextLayer, VerifiedQuery } from '../../types';

const DB = 'RLB_AI_PLATFORM';

type VqSpec = [question: string, metrics: string, dims: string, where?: string];

const vq = (sv: string, items: VqSpec[], start: number, by: string[]): VerifiedQuery[] =>
  items.map(([question, metrics, dims, where], i) => ({
    id: `VQ-${String(start + i).padStart(3, '0')}`,
    semanticView: sv,
    question,
    sql: `SELECT *\n  FROM SEMANTIC_VIEW(\n    ${DB}.SEMANTIC.${sv}\n    METRICS ${metrics}${dims ? `\n    DIMENSIONS ${dims}` : ''}${where ? `\n    WHERE ${where}` : ''}\n  );`,
    verifiedBy: by[i % by.length],
    verifiedOn: `2026-0${7 + (i % 3)}-${String(2 + ((i * 7) % 26)).padStart(2, '0')}`,
  }));

const VQ_CUSTOMER: VqSpec[] = [
  ['What was the average deposit balance per customer by region at the end of last quarter?', 'avg_deposit_balance', 'customer.region', "date.calendar_date = '2026-09-30' AND active_customers"],
  ['How many active customers do we have, and how many are digitally active?', 'active_customers, digital_active_rate', ''],
  ['What is the digital active rate by segment?', 'digital_active_rate', 'customer.segment'],
  ['How many products does the average customer hold?', 'products_per_customer', ''],
  ['Products per customer by region', 'products_per_customer', 'customer.region'],
  ['What is our customer attrition rate over the last 12 months?', 'attrition_rate', ''],
  ['Which customers hold more than $100,000 in deposits but have no loans with us?', 'avg_deposit_balance', 'customer.customer_id', 'deposit.ledger_balance > 100000 AND loans = 0'],
  ['Active customers by branch', 'active_customers', 'branch.branch_name'],
  ['Show daily card spending over the last 30 days', 'card_purchase_volume', 'date.calendar_date', "date.calendar_date >= '2026-09-01'"],
  ['What is our card fraud loss rate in basis points this quarter?', 'card_fraud_loss_bps', '', "date.calendar_date BETWEEN '2026-07-01' AND '2026-09-30'"],
  ['Card fraud loss by merchant category this quarter', 'card_fraud_loss_bps', 'card.merchant_category', "date.calendar_date >= '2026-07-01'"],
  ['What is the card authorization approval rate by channel?', 'auth_approval_rate', 'card.channel'],
  ['Average ticket size by merchant category', 'avg_ticket', 'card.merchant_category'],
  ['Card purchase volume by region in Q3', 'card_purchase_volume', 'customer.region', "date.calendar_date BETWEEN '2026-07-01' AND '2026-09-30'"],
];
const VQ_DEPOSITS: VqSpec[] = [
  ['What are total deposits by region at September month-end?', 'total_deposits', 'branch.region', "date.month_end = '2026-09-30'"],
  ['What is deposit growth year to date?', 'deposit_growth_pct', ''],
  ['Which 5 branches had the largest deposit outflows last quarter?', 'total_deposits', 'branch.branch_name', "date.month_end IN ('2026-06-30', '2026-09-30')"],
  ['What is our cost of deposits this month?', 'cost_of_deposits', '', "date.month_end = '2026-09-30'"],
  ['Cost of deposits by product type', 'cost_of_deposits', 'deposit.product_type'],
  ['What is the loan-to-deposit ratio?', 'loan_to_deposit_ratio', '', "date.month_end = '2026-09-30'"],
  ['What is our liquidity coverage ratio?', 'liquidity_coverage_ratio', '', "date.month_end = '2026-09-30'"],
  ['Compare net interest margin this quarter with the same quarter last year', 'net_interest_margin', 'date.fiscal_quarter', "date.fiscal_quarter IN ('2025-Q3', '2026-Q3')"],
  ['Net interest margin by region for Q3 2026', 'net_interest_margin', 'branch.region', "date.fiscal_quarter = '2026-Q3'"],
  ['What is the cost-to-income ratio this quarter?', 'cost_to_income_ratio', '', "date.fiscal_quarter = '2026-Q3'"],
  ['Deposit mix by product at month-end', 'total_deposits', 'deposit.product_type', "date.month_end = '2026-09-30'"],
  ['Stressed 30-day outflows by product', 'stressed_outflows', 'deposit.product_type'],
  ['Total deposits trend by month', 'total_deposits', 'date.month_end'],
];
const VQ_LOANS: VqSpec[] = [
  ['What is our NPL ratio by loan segment, and how has it trended this year?', 'npl_ratio', 'loan.loan_segment, date.snapshot_month', "date.snapshot_month BETWEEN '2026-01' AND '2026-09'"],
  ['What is the NPL ratio at September month-end?', 'npl_ratio', '', "date.snapshot_month = '2026-09'"],
  ['Non-performing loan balance by region', 'npl_balance', 'loan.region', "date.snapshot_month = '2026-09'"],
  ['What is the 30+ days past due rate by market?', 'delinquency_30_plus_rate', 'loan.region', "date.snapshot_month = '2026-09'"],
  ['Net charge-off ratio year to date', 'net_charge_off_ratio', '', "date.snapshot_month >= '2026-01'"],
  ['Net charge-offs by loan segment', 'net_charge_off_ratio', 'loan.loan_segment', "date.snapshot_month >= '2026-01'"],
  ['Allowance coverage of non-performing loans', 'allowance_coverage_ratio', '', "date.snapshot_month = '2026-09'"],
  ['Total loans outstanding by segment', 'total_loans', 'loan.loan_segment', "date.snapshot_month = '2026-09'"],
  ['Loan yield by segment', 'loan_yield', 'loan.loan_segment', "date.snapshot_month = '2026-09'"],
  ['How much of the NPL balance is on non-accrual but under 90 days past due?', 'npl_balance', 'loan.non_accrual_flag', 'loan.days_past_due < 90'],
  ['NPL ratio by branch', 'npl_ratio', 'branch.branch_name', "date.snapshot_month = '2026-09'"],
  ['Commercial real estate NPL ratio trend', 'npl_ratio', 'date.snapshot_month', "loan.loan_segment = 'Commercial real estate'"],
  ['Delinquency trend by month this year', 'delinquency_30_plus_rate', 'date.snapshot_month', "date.snapshot_month >= '2026-01'"],
  ['Loans outstanding by borrower segment', 'total_loans', 'customer.segment', "date.snapshot_month = '2026-09'"],
];
/** Exactly 7: DP-05 certification gate 4 needs 10 verified queries (spec section 7.6). */
const VQ_AML: VqSpec[] = [
  ['How many AML alerts were raised this quarter?', 'alerts_raised', '', "date.fiscal_quarter = '2026-Q3'"],
  ['What is our AML alert-to-case rate this year?', 'alert_to_case_rate', '', "date.alert_date >= '2026-01-01'"],
  ['Alerts raised by monitoring scenario year to date', 'alerts_raised', 'alert.scenario', "date.alert_date >= '2026-01-01'"],
  ['SAR conversion rate year to date', 'sar_conversion_rate', '', "date.alert_date >= '2026-01-01'"],
  ['Average days to disposition by scenario', 'avg_days_to_disposition', 'alert.scenario'],
  ['Alert-to-case rate by region', 'alert_to_case_rate', 'alert.region'],
  ['Alert volume by quarter', 'alerts_raised', 'date.fiscal_quarter'],
];

const verifiedQueries: VerifiedQuery[] = [
  ...vq('SV_CUSTOMER_360', VQ_CUSTOMER, 1, ['N. Pereira', 'P. Agbaje']),
  ...vq('SV_DEPOSITS_LIQUIDITY', VQ_DEPOSITS, 15, ['S. Kowalewski', 'A. Delacroix']),
  ...vq('SV_LOAN_PORTFOLIO', VQ_LOANS, 28, ['G. Ellery', 'R. Thibodeaux']),
  ...vq('SV_AML_ALERTS', VQ_AML, 42, ['J. Rahman']),
];

export const CONTEXT: ContextLayer = {
  searchService: 'CS_BANKING_DOCS',
  instructions: [
    { id: 'AI-01', agentId: 'AG-01', type: 'persona', version: '1.4', text: 'You are Ridgeline Bank’s Relationship Manager Assistant. You help relationship managers and retail analysts understand customers, deposits, digital engagement, card spend and AML alerts on their customers’ accounts.' },
    { id: 'AI-02', agentId: 'AG-01', type: 'response', version: '1.4', text: 'Report balances in dollars (thousands for averages, millions or billions for totals) and say which period and which customers (active, segment, market) a number covers.' },
    { id: 'AI-03', agentId: 'AG-01', type: 'guardrail', version: '1.4', text: 'Never reveal names, contact details, tax IDs, account or card numbers unless the user’s role may see unmasked PII, NPI or PCI. Never answer from a product the user cannot access. Do not tip off customers about AML alerts.' },
    { id: 'AI-04', agentId: 'AG-01', type: 'orchestration', version: '1.4', text: 'Use Cortex Analyst on SV_CUSTOMER_360 for customer, deposit and card metrics and on SV_AML_ALERTS for alerts. Use CS_BANKING_DOCS for policy definitions.' },
    { id: 'AI-05', agentId: 'AG-02', type: 'persona', version: '2.1', text: 'You are the Risk & Liquidity Analyst for Ridgeline Bank. You answer questions about deposits, liquidity, net interest margin, credit quality and customer profitability for Treasury, ALCO and the Chief Credit Office.' },
    { id: 'AI-06', agentId: 'AG-02', type: 'response', version: '2.1', text: 'Report ratios as percentages to two decimals and balances in billions to one decimal. Always state the month-end or quarter the figure is as of.' },
    { id: 'AI-07', agentId: 'AG-02', type: 'guardrail', version: '2.1', text: 'Flag any answer that uses a product that is not certified. Apply the regulatory definitions in the Basel III and stress-test guide; never redefine non-performing or LCR on the fly.' },
    { id: 'AI-08', agentId: 'AG-02', type: 'orchestration', version: '2.1', text: 'Use Cortex Analyst on SV_LOAN_PORTFOLIO for credit quality and SV_DEPOSITS_LIQUIDITY for funding, margin and liquidity. Cite the Basel III and stress-test definitions from CS_BANKING_DOCS whenever non-performing or LCR is used.' },
    { id: 'AI-09', agentId: 'AG-03', type: 'persona', version: '1.2', text: 'You are the Financial Crimes Copilot. You help AML investigators and fraud managers track card fraud losses, alert volumes, escalation to cases and SAR outcomes.' },
    { id: 'AI-10', agentId: 'AG-03', type: 'response', version: '1.2', text: 'Show fraud losses in basis points to one decimal and rates as percentages to one decimal. Name the period and whether open alerts were excluded.' },
    { id: 'AI-11', agentId: 'AG-03', type: 'guardrail', version: '1.2', text: 'Never disclose whether a SAR was filed on a named customer outside the investigations team, and never show full card numbers.' },
    { id: 'AI-12', agentId: 'AG-03', type: 'orchestration', version: '1.2', text: 'Use Cortex Analyst on SV_AML_ALERTS for alerts and cases and on SV_CUSTOMER_360 for card fraud. Use the BSA/AML program policy in CS_BANKING_DOCS for escalation and SAR definitions.' },
    { id: 'AI-13', agentId: 'AG-04', type: 'persona', version: '0.9', text: 'You are the Data Steward Assistant. You help stewards find governance gaps in the glossary, CDE register and product registry.' },
    { id: 'AI-14', agentId: 'AG-04', type: 'response', version: '0.9', text: 'Answer with a table of items and a recommended next action for each.' },
    { id: 'AI-15', agentId: 'AG-04', type: 'guardrail', version: '0.9', text: 'Read metadata only; never query customer-level data.' },
    { id: 'AI-16', agentId: 'AG-04', type: 'orchestration', version: '0.9', text: 'Use the SQL tool over GLOSSARY, GOVERNANCE and DATA_PRODUCTS.DP_REGISTRY. Read certification state live.' },
  ],
  rules: [
    { id: 'BR-001', domain: 'Customer', text: 'An Active Customer has Active status, at least one open deposit or loan account at month-end, and a customer-initiated transaction or digital login in the last 90 days.', metric: 'SV_CUSTOMER_360.active_customers', sourceDoc: 'Customer data standard v4' },
    { id: 'BR-002', domain: 'Customer', text: 'A customer is digitally active when they signed in to the mobile app or online banking at least once in the last 30 days; the denominator is active customers.', metric: 'SV_CUSTOMER_360.digital_active_rate', sourceDoc: 'Customer data standard v4' },
    { id: 'BR-003', domain: 'Customer', text: 'Deposit balances are month-end ledger balances; "end of last quarter" means the 30 September 2026 month-end.', metric: 'SV_CUSTOMER_360.avg_deposit_balance', sourceDoc: 'Customer data standard v4' },
    { id: 'BR-004', domain: 'Customer', text: 'Deposit-only customers hold no open loan or line of credit at month-end; they are the cross-sell list for lending offers, subject to fair-lending review.', metric: 'SV_CUSTOMER_360.avg_deposit_balance', sourceDoc: 'Fair lending and responsible banking standard' },
    { id: 'BR-005', domain: 'Treasury', text: 'Deposit growth compares month-end total deposits with 31 December of the prior year; brokered deposits are excluded.', metric: 'SV_DEPOSITS_LIQUIDITY.deposit_growth_pct', sourceDoc: 'Asset-liability and liquidity policy' },
    { id: 'BR-006', domain: 'Treasury', text: 'A deposit outflow is a decline in month-end balances between two month-ends for the same branch; quarter comparisons use the last month-end of each quarter.', metric: 'SV_DEPOSITS_LIQUIDITY.total_deposits', sourceDoc: 'Asset-liability and liquidity policy' },
    { id: 'BR-007', domain: 'Credit risk', text: 'Non-performing = 90+ days past due or on non-accrual. A loan counts as non-performing from the earlier of the two, and stays so until brought current with six consecutive payments.', metric: 'SV_LOAN_PORTFOLIO.npl_ratio', sourceDoc: 'Basel III and stress-test definitions' },
    { id: 'BR-008', domain: 'Credit risk', text: 'The NPL ratio uses month-end principal of non-performing loans over total loans outstanding, before the allowance; unfunded commitments are excluded.', metric: 'SV_LOAN_PORTFOLIO.npl_ratio', sourceDoc: 'Basel III and stress-test definitions' },
    { id: 'BR-009', domain: 'Credit risk', text: 'The net charge-off ratio annualises year-to-date net charge-offs over average month-end loans.', metric: 'SV_LOAN_PORTFOLIO.net_charge_off_ratio', sourceDoc: 'Basel III and stress-test definitions' },
    { id: 'BR-010', domain: 'Finance', text: 'Net interest margin is annualised net interest income over average earning assets; quarterly NIM uses the three month-ends of the quarter and compares like quarters year over year.', metric: 'SV_DEPOSITS_LIQUIDITY.net_interest_margin', sourceDoc: 'Asset-liability and liquidity policy' },
    { id: 'BR-011', domain: 'Treasury', text: 'Loan-to-deposit ratio is gross loans over total deposits at month-end; the board limit is 95%.', metric: 'SV_DEPOSITS_LIQUIDITY.loan_to_deposit_ratio', sourceDoc: 'Asset-liability and liquidity policy' },
    { id: 'BR-012', domain: 'Finance', text: 'The cost-to-income (efficiency) ratio is non-interest expense over net interest income plus non-interest income; one-off restructuring charges are excluded.', metric: 'SV_DEPOSITS_LIQUIDITY.cost_to_income_ratio', sourceDoc: 'Asset-liability and liquidity policy' },
    { id: 'BR-013', domain: 'Cards', text: 'Card fraud loss in basis points is confirmed fraud losses net of chargeback recoveries over approved purchase volume, times 10,000. Declined fraud attempts carry no loss.', metric: 'SV_CUSTOMER_360.card_fraud_loss_bps', sourceDoc: 'Card fraud and disputes standard' },
    { id: 'BR-014', domain: 'Financial crimes', text: 'An alert is escalated to a case when the investigator finds activity that warrants investigation. Alert-to-case rate counts only dispositioned alerts; open alerts are excluded from the denominator.', metric: 'SV_AML_ALERTS.alert_to_case_rate', sourceDoc: 'BSA/AML program policy' },
    { id: 'BR-015', domain: 'Financial crimes', text: 'A SAR must be filed within 30 calendar days of initial detection; SAR conversion is SARs filed over closed cases (cases under investigation are excluded).', metric: 'SV_AML_ALERTS.sar_conversion_rate', sourceDoc: 'BSA/AML program policy' },
    { id: 'BR-016', domain: 'Finance', text: 'Customer profitability is revenue after funds transfer pricing minus cost to serve and expected credit loss. It must never use or proxy prohibited bases (race, sex, age, marital status, national origin).', metric: 'DP_CUSTOMER_PROFITABILITY.avg_net_contribution', sourceDoc: 'Fair lending and responsible banking standard' },
    { id: 'BR-017', domain: 'Financial crimes', text: 'AML alert information is confidential: relationship managers may see alert counts and dispositions for their customers, never SAR decisions on a named customer.', metric: 'SV_AML_ALERTS.alerts_raised', sourceDoc: 'BSA/AML program policy' },
  ],
  verifiedQueries,
  synonyms: [
    { term: 'Non-Performing Loan', synonym: 'npl', scope: 'Credit risk' },
    { term: 'Non-Performing Loan', synonym: 'bad loans', scope: 'Credit risk' },
    { term: 'Non-Performing Loan', synonym: 'problem loans', scope: 'Credit risk' },
    { term: 'Loan Segment', synonym: 'loan book', scope: 'Credit risk' },
    { term: 'Loan Segment', synonym: 'portfolio', scope: 'Credit risk' },
    { term: 'Days Past Due', synonym: 'delinquent', scope: 'Credit risk' },
    { term: 'Net Charge-Off', synonym: 'write-offs', scope: 'Credit risk' },
    { term: 'Market Region', synonym: 'market', scope: 'Enterprise' },
    { term: 'Market Region', synonym: 'footprint', scope: 'Enterprise' },
    { term: 'Customer', synonym: 'client', scope: 'Customer' },
    { term: 'Customer', synonym: 'relationship', scope: 'Customer' },
    { term: 'Digital Active Customer', synonym: 'mobile users', scope: 'Customer' },
    { term: 'Deposit Balance', synonym: 'funding', scope: 'Treasury' },
    { term: 'Deposit Balance', synonym: 'outflows', scope: 'Treasury' },
    { term: 'Net Interest Margin', synonym: 'nim', scope: 'Finance' },
    { term: 'Loan-to-Deposit Ratio', synonym: 'ldr', scope: 'Treasury' },
    { term: 'Liquidity Coverage Ratio', synonym: 'lcr', scope: 'Treasury' },
    { term: 'Cost-to-Income Ratio', synonym: 'efficiency ratio', scope: 'Finance' },
    { term: 'Card Fraud Loss', synonym: 'fraud bps', scope: 'Cards' },
    { term: 'Card Fraud Loss', synonym: 'basis points', scope: 'Cards' },
    { term: 'AML Alert', synonym: 'tm alert', scope: 'Financial crimes' },
    { term: 'Alert-to-Case Rate', synonym: 'escalation rate', scope: 'Financial crimes' },
    { term: 'Suspicious Activity Report', synonym: 'sar', scope: 'Financial crimes' },
    { term: 'Customer Net Contribution', synonym: 'profitable', scope: 'Finance' },
  ],
  documents: [
    {
      id: 'DOC-01', title: 'Basel III capital and stress-test definitions — Ridgeline application guide', source: '@RLB_AI_PLATFORM.CONTEXT.DOCS/basel3_stress_test_definitions_2026.pdf', chunkCount: 64, updatedAt: '2026-02-09 09:00:00',
      chunks: [
        { n: 4, text: 'Common Equity Tier 1 capital is measured against risk-weighted assets. Residential mortgages carry a 50% risk weight; commercial real estate, commercial and industrial and consumer loans carry 100%. Ridgeline targets a CET1 ratio above 10.5%.' },
        { n: 7, text: 'A non-performing loan is any loan 90 days or more past due or on non-accrual status, whichever comes first. The NPL ratio is non-performing loan principal divided by total loans outstanding at month-end, before the allowance. A non-accrual loan returns to performing only after six consecutive scheduled payments.' },
        { n: 12, text: 'The liquidity coverage ratio divides high-quality liquid assets by total net cash outflows over a 30-day stress period. Outflow rates: stable retail deposits 3–5%, operational commercial deposits 25%, non-operational commercial and sweep balances 40%.' },
        { n: 19, text: 'The annual stress test projects net charge-offs, pre-provision net revenue and capital over nine quarters under the baseline and severely adverse scenarios; commercial real estate loss rates are stressed most heavily.' },
      ],
    },
    {
      id: 'DOC-02', title: 'BSA/AML program policy', source: '@RLB_AI_PLATFORM.CONTEXT.DOCS/bsa_aml_program_policy_v7.pdf', chunkCount: 52, updatedAt: '2026-04-15 10:00:00',
      chunks: [
        { n: 6, text: 'Transaction-monitoring alerts must be dispositioned within 30 days. An investigator closes the alert with no action or escalates it to a case when activity warrants further investigation. The alert-to-case rate excludes alerts still open.' },
        { n: 11, text: 'A suspicious activity report must be filed within 30 calendar days of initial detection of facts that may constitute a basis for filing, extendable to 60 days when no suspect is identified.' },
        { n: 15, text: 'Alert and SAR information is confidential. Staff outside the BSA/AML office may see alert counts for their customers but must never disclose the existence of a SAR or tip off a customer.' },
      ],
    },
    {
      id: 'DOC-03', title: 'Fair lending and responsible banking standard', source: '@RLB_AI_PLATFORM.CONTEXT.DOCS/fair_lending_standard_2026.pdf', chunkCount: 33, updatedAt: '2026-01-20 08:30:00',
      chunks: [
        { n: 3, text: 'Credit decisions, pricing, marketing lists and customer segmentation must not use or proxy a prohibited basis under ECOA and the Fair Housing Act: race, colour, religion, national origin, sex, marital status, age, or receipt of public assistance.' },
        { n: 8, text: 'Cross-sell campaigns for lending products are reviewed by Fair Lending before launch. Lists built from deposit balances must be checked for disparate impact across census tracts.' },
        { n: 14, text: 'Customer profitability models may inform relationship strategy but may not set loan pricing or credit decisions without a model risk and fair-lending review.' },
      ],
    },
    {
      id: 'DOC-04', title: 'Asset-liability and liquidity management policy', source: '@RLB_AI_PLATFORM.CONTEXT.DOCS/alm_liquidity_policy_2026.pdf', chunkCount: 41, updatedAt: '2026-03-02 14:00:00',
      chunks: [
        { n: 5, text: 'Net interest margin is annualised net interest income divided by average earning assets. ALCO reviews NIM quarterly against the same quarter of the prior year and against deposit beta assumptions.' },
        { n: 9, text: 'The loan-to-deposit ratio must stay below the board limit of 95%; the liquidity coverage ratio must stay above the internal floor of 110%, above the 100% regulatory minimum.' },
        { n: 13, text: 'Branch deposit outflows above 3% in a quarter are escalated to the market president with a retention and pricing plan.' },
      ],
    },
  ],
};
