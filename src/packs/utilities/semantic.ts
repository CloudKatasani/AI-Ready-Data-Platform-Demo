// Semantic views for Northvale Energy (spec sections 5 and 7.3).
import type { Row, SemanticView } from '../../types';
import { addDays, sum } from '../../mock-snowflake/generators';
import type { UtilData } from './data';
import { AS_OF, SERVED_TOTAL } from './generators.config';
import { latestBills } from './queries';

const n = (r: Row, k: string) => Number(r[k] ?? 0);

export function buildSemanticViews(d: UtilData, vqIds: (sv: string) => string[]): SemanticView[] {
  const servedFor = (g: { dimension: string; value: string }) =>
    g.dimension === 'opco' ? d.servedByOpco[g.value] ?? SERVED_TOTAL : SERVED_TOTAL;

  const reliability: SemanticView = {
    name: 'SV_RELIABILITY',
    description: 'IEEE 1366 reliability indices by operating company, circuit, cause and period',
    tables: [
      { alias: 'outage', fqn: 'CONFORMED_GOLD.FCT_OUTAGE', pk: 'OUTAGE_KEY' },
      { alias: 'circuit', fqn: 'CONFORMED_GOLD.DIM_CIRCUIT', pk: 'CIRCUIT_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'outage', to: 'circuit', on: 'CIRCUIT_KEY' },
      { from: 'outage', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'outage.customer_minutes', expr: 'outage.CUSTOMER_MINUTES', description: 'Customer minutes interrupted per event' },
      { name: 'outage.customers_interrupted', expr: 'outage.CUSTOMERS_INTERRUPTED', description: 'Customers interrupted per event' },
      { name: 'circuit.customers_served', expr: 'circuit.CUSTOMERS_SERVED', description: 'Customers served (denominator)' },
    ],
    dimensions: [
      { name: 'circuit.opco', expr: 'circuit.OPCO', synonyms: ['operating company', 'opco', 'utility', 'company'], description: 'Operating company' },
      { name: 'circuit.circuit_id', expr: 'circuit.CIRCUIT_ID', synonyms: ['feeder', 'circuit'], description: 'Distribution circuit' },
      { name: 'circuit.substation', expr: 'circuit.SUBSTATION', synonyms: ['sub'], description: 'Substation' },
      { name: 'outage.cause', expr: 'outage.CAUSE', synonyms: ['cause code', 'reason'], description: 'Outage cause' },
      { name: 'outage.med_flag', expr: 'outage.MED_FLAG', synonyms: ['major event', 'storm day'], description: 'Major event day flag' },
    ],
    timeDimensions: [
      { name: 'date.outage_date', expr: 'date.CALENDAR_DATE', description: 'Outage date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter (FY = calendar year)' },
    ],
    metrics: [
      { name: 'saidi_minutes', expr: 'SUM(outage.customer_minutes) / MAX(circuit.customers_served_total)', description: 'System average interruption duration index (minutes per customer served)', synonyms: ['saidi', 'outage minutes per customer', 'average outage duration per customer'], termId: 'T-004', unit: 'minutes' },
      { name: 'saifi', expr: 'SUM(outage.customers_interrupted) / MAX(circuit.customers_served_total)', description: 'System average interruption frequency index (interruptions per customer served)', synonyms: ['saifi', 'interruption frequency'], termId: 'T-005', unit: 'interruptions' },
      { name: 'caidi_minutes', expr: 'SUM(outage.customer_minutes) / SUM(outage.customers_interrupted)', description: 'Customer average interruption duration index (minutes per interrupted customer)', synonyms: ['caidi', 'restoration time'], termId: 'T-006', unit: 'minutes' },
      { name: 'customers_interrupted', expr: 'SUM(outage.customers_interrupted)', description: 'Total customers interrupted', synonyms: ['customer interruptions', 'ci'], termId: 'T-005', unit: 'customers' },
      { name: 'customer_minutes_interrupted', expr: 'SUM(outage.customer_minutes)', description: 'Total customer minutes interrupted', synonyms: ['cmi', 'customer minutes'], termId: 'T-008', unit: 'minutes' },
      { name: 'tree_outages', expr: "COUNT_IF(outage.cause = 'Tree contact')", description: 'Outages caused by tree contact', synonyms: ['tree outages', 'vegetation outages'], termId: 'T-025', unit: 'events' },
    ],
    verifiedQueryIds: vqIds('SV_RELIABILITY'),
    productIds: ['DP-02'],
    playground: {
      from: 'SEMANTIC.SV_RELIABILITY',
      rows: () => d.outages.map((o) => ({ opco: o.opco, cause: o.cause, fiscal_quarter: `${o.date.slice(0, 4)}-Q${Math.floor((Number(o.date.slice(5, 7)) - 1) / 3) + 1}`, date: o.date, med: o.med, ci: o.ci, cmi: o.ci * o.duration })),
      dimensions: [
        { name: 'circuit.opco', column: 'opco' },
        { name: 'outage.cause', column: 'cause' },
        { name: 'date.fiscal_quarter', column: 'fiscal_quarter' },
      ],
      filters: [
        { label: 'Year to date, excluding major event days', sql: "date.outage_date BETWEEN '2026-01-01' AND '2026-09-30' AND outage.med_flag = FALSE", test: (r) => String(r.date) >= '2026-01-01' && !r.med },
        { label: 'Year to date, including major event days', sql: "date.outage_date BETWEEN '2026-01-01' AND '2026-09-30'", test: (r) => String(r.date) >= '2026-01-01' },
        { label: 'Last 30 days', sql: `date.outage_date >= '${addDays(AS_OF, -29)}'`, test: (r) => String(r.date) >= addDays(AS_OF, -29) },
        { label: 'Prior year to date (2025), excluding MED', sql: "date.outage_date BETWEEN '2025-01-01' AND '2025-09-30' AND outage.med_flag = FALSE", test: (r) => String(r.date) >= '2025-01-01' && String(r.date) <= '2025-09-30' && !r.med },
      ],
      metrics: [
        { name: 'saidi_minutes', unit: 'min', decimals: 1, sqlExpr: 'saidi_minutes', agg: (rs, g) => sum(rs.map((r) => n(r, 'cmi'))) / servedFor(g) },
        { name: 'saifi', unit: '', decimals: 3, sqlExpr: 'saifi', agg: (rs, g) => sum(rs.map((r) => n(r, 'ci'))) / servedFor(g) },
        { name: 'caidi_minutes', unit: 'min', decimals: 1, sqlExpr: 'caidi_minutes', agg: (rs) => sum(rs.map((r) => n(r, 'cmi'))) / Math.max(1, sum(rs.map((r) => n(r, 'ci')))) },
        { name: 'customers_interrupted', unit: '', decimals: 0, sqlExpr: 'customers_interrupted', agg: (rs) => sum(rs.map((r) => n(r, 'ci'))) },
        { name: 'tree_outages', unit: '', decimals: 0, sqlExpr: 'tree_outages', agg: (rs) => rs.filter((r) => r.cause === 'Tree contact').length },
      ],
    },
  };

  const latest = latestBills(d);
  const since = addDays(AS_OF, -60);
  const recent = new Set(d.bills.filter((b) => b.date > since).map((b) => b.customerKey));
  const q3Avg = new Map<number, { s: number; c: number }>();
  for (const b of d.bills) {
    if (!['2026-07', '2026-08', '2026-09'].includes(b.month)) continue;
    const cur = q3Avg.get(b.customerKey) ?? { s: 0, c: 0 };
    cur.s += b.billed;
    cur.c += 1;
    q3Avg.set(b.customerKey, cur);
  }
  const custRows = () => d.customers.map((c) => ({
    opco: c.opco, region: c.region, rate_class: c.rateClass, segment: c.segment, residential: c.residential,
    active: c.status === 'Active' && recent.has(c.key), paperless: c.paperless, churn: c.churnRisk,
    arrears: latest.get(c.key)?.arrears ?? 0, q3sum: q3Avg.get(c.key)?.s ?? 0, q3cnt: q3Avg.get(c.key)?.c ?? 0,
  }));

  const customer360: SemanticView = {
    name: 'SV_CUSTOMER_360',
    description: 'Customer, premise, billing and usage metrics for customer analytics',
    tables: [
      { alias: 'customer', fqn: 'CONFORMED_GOLD.DIM_CUSTOMER', pk: 'CUSTOMER_KEY' },
      { alias: 'premise', fqn: 'CONFORMED_GOLD.DIM_PREMISE', pk: 'PREMISE_KEY' },
      { alias: 'billing', fqn: 'CONFORMED_GOLD.FCT_BILLING', pk: 'STATEMENT_KEY' },
      { alias: 'usage', fqn: 'CONFORMED_GOLD.FCT_DAILY_USAGE', pk: 'DATE_KEY, PREMISE_KEY' },
    ],
    relationships: [
      { from: 'billing', to: 'customer', on: 'CUSTOMER_KEY' },
      { from: 'usage', to: 'customer', on: 'CUSTOMER_KEY' },
      { from: 'usage', to: 'premise', on: 'PREMISE_KEY' },
    ],
    facts: [
      { name: 'billing.billed_amount', expr: 'billing.BILLED_AMOUNT' },
      { name: 'billing.arrears_amount', expr: 'billing.ARREARS_AMOUNT' },
      { name: 'usage.kwh', expr: 'usage.KWH' },
      { name: 'usage.peak_kw', expr: 'usage.PEAK_KW' },
      { name: 'usage.read_success_pct', expr: 'usage.READ_SUCCESS_PCT' },
    ],
    dimensions: [
      { name: 'customer.opco', expr: 'customer.OPCO', synonyms: ['operating company', 'opco'] },
      { name: 'customer.region', expr: 'customer.REGION', synonyms: ['territory', 'area'] },
      { name: 'customer.rate_class', expr: 'customer.RATE_CLASS', synonyms: ['tariff', 'rate', 'rate code'] },
      { name: 'customer.segment', expr: 'customer.SEGMENT', synonyms: ['customer type'] },
      { name: 'customer.digital_enrolled', expr: 'customer.DIGITAL_ENROLLED', synonyms: ['paperless', 'ebill', 'e-bill'] },
      { name: 'premise.city', expr: 'premise.CITY', synonyms: ['town'] },
    ],
    timeDimensions: [
      { name: 'billing.statement_month', expr: "DATE_TRUNC('month', billing.STATEMENT_DATE)" },
      { name: 'usage.usage_date', expr: 'usage.USAGE_DATE' },
    ],
    metrics: [
      { name: 'active_customers', expr: "COUNT(DISTINCT IFF(customer.status = 'Active' AND billing.statement_date > CURRENT_DATE - 60, customer.customer_key, NULL))", description: 'Customers with Active status and a billed statement in the last 60 days', synonyms: ['active accounts', 'customer count'], termId: 'T-002', unit: 'customers' },
      { name: 'avg_monthly_bill', expr: 'AVG(billing.billed_amount)', description: 'Average billed amount per statement', synonyms: ['average bill', 'typical bill'], termId: 'T-009', unit: 'USD' },
      { name: 'arrears_balance', expr: 'SUM(billing.arrears_amount)', description: 'Past-due balance on the latest statement', synonyms: ['past due', 'overdue balance', 'debt'], termId: 'T-010', unit: 'USD' },
      { name: 'digital_adoption_rate', expr: 'AVG(IFF(customer.digital_enrolled, 1, 0)) * 100', description: 'Share of active customers on paperless billing', synonyms: ['paperless rate', 'ebill adoption'], termId: 'T-011', unit: '%' },
      { name: 'avg_churn_risk', expr: 'AVG(customer.churn_risk_score)', description: 'Average churn risk score (0–100)', synonyms: ['churn risk', 'attrition risk'], termId: 'T-020', unit: 'score' },
      { name: 'daily_kwh', expr: 'AVG(usage.kwh)', description: 'Average daily consumption per premise', synonyms: ['consumption', 'usage', 'load'], termId: 'T-026', unit: 'kWh' },
      { name: 'peak_kw', expr: 'AVG(usage.peak_kw)', description: 'Average daily peak demand per premise', synonyms: ['peak demand', 'max demand'], termId: 'T-014', unit: 'kW' },
      { name: 'read_success_rate', expr: 'AVG(usage.read_success_pct)', description: 'Share of 15-minute intervals read successfully', synonyms: ['read rate', 'ami performance'], termId: 'T-013', unit: '%' },
      { name: 'estimated_read_pct', expr: '100 - AVG(usage.read_success_pct)', description: 'Share of intervals estimated', synonyms: ['estimated reads'], termId: 'T-013', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_CUSTOMER_360'),
    productIds: ['DP-01', 'DP-03'],
    playground: {
      from: 'SEMANTIC.SV_CUSTOMER_360',
      rows: custRows,
      dimensions: [
        { name: 'customer.region', column: 'region' },
        { name: 'customer.opco', column: 'opco' },
        { name: 'customer.rate_class', column: 'rate_class' },
        { name: 'customer.segment', column: 'segment' },
      ],
      filters: [
        { label: 'Residential customers, Q3 2026', sql: "customer.segment = 'Residential' AND billing.statement_month BETWEEN '2026-07-01' AND '2026-09-01'", test: (r) => Boolean(r.residential) },
        { label: 'Active customers', sql: 'active_customers rule BR-001 applied', test: (r) => Boolean(r.active) },
        { label: 'All customers', sql: 'TRUE', test: () => true },
      ],
      metrics: [
        { name: 'avg_monthly_bill', unit: 'USD', decimals: 2, sqlExpr: 'avg_monthly_bill', agg: (rs) => sum(rs.map((r) => n(r, 'q3sum'))) / Math.max(1, sum(rs.map((r) => n(r, 'q3cnt')))) },
        { name: 'active_customers', unit: '', decimals: 0, sqlExpr: 'active_customers', agg: (rs) => Math.round(rs.filter((r) => r.active).length * d.scale) },
        { name: 'digital_adoption_rate', unit: '%', decimals: 1, sqlExpr: 'digital_adoption_rate', agg: (rs) => { const a = rs.filter((r) => r.active); return (a.filter((r) => r.paperless).length / Math.max(1, a.length)) * 100; } },
        { name: 'arrears_balance', unit: 'USD', decimals: 0, sqlExpr: 'arrears_balance', agg: (rs) => sum(rs.map((r) => n(r, 'arrears'))) * d.scale },
        { name: 'avg_churn_risk', unit: '', decimals: 1, sqlExpr: 'avg_churn_risk', agg: (rs) => sum(rs.map((r) => n(r, 'churn'))) / Math.max(1, rs.length) },
      ],
    },
  };

  const supplierName = new Map(d.suppliers.map((s) => [s.key, s]));
  const procurement: SemanticView = {
    name: 'SV_PROCUREMENT',
    description: 'Procurement spend, contract compliance and supplier delivery performance',
    tables: [
      { alias: 'spend', fqn: 'CONFORMED_GOLD.FCT_PO_SPEND', pk: 'PO_LINE_KEY' },
      { alias: 'supplier', fqn: 'CONFORMED_GOLD.DIM_SUPPLIER', pk: 'SUPPLIER_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'spend', to: 'supplier', on: 'SUPPLIER_KEY' },
      { from: 'spend', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'spend.spend_usd', expr: 'spend.SPEND_USD' },
      { name: 'spend.cycle_days', expr: 'spend.CYCLE_DAYS' },
    ],
    dimensions: [
      { name: 'supplier.supplier_name', expr: 'supplier.SUPPLIER_NAME', synonyms: ['vendor', 'supplier'] },
      { name: 'spend.category', expr: 'spend.CATEGORY', synonyms: ['spend category', 'commodity', 'material group'] },
      { name: 'spend.on_contract', expr: 'spend.ON_CONTRACT', synonyms: ['contracted', 'compliant'] },
      { name: 'supplier.preferred', expr: 'supplier.PREFERRED', synonyms: ['preferred vendor'] },
    ],
    timeDimensions: [
      { name: 'date.po_date', expr: 'date.CALENDAR_DATE' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER' },
    ],
    metrics: [
      { name: 'total_spend', expr: 'SUM(spend.spend_usd)', description: 'Total purchase order spend', synonyms: ['spend', 'purchases'], termId: 'T-023', unit: 'USD' },
      { name: 'spend_under_contract_pct', expr: 'SUM(IFF(spend.on_contract, spend.spend_usd, 0)) / SUM(spend.spend_usd) * 100', description: 'Share of spend placed against a contract', synonyms: ['contract compliance', 'on-contract spend'], termId: 'T-015', unit: '%' },
      { name: 'otif_pct', expr: 'AVG(IFF(spend.otif_flag, 1, 0)) * 100', description: 'Share of PO lines delivered on time and in full', synonyms: ['otif', 'on time in full', 'delivery performance'], termId: 'T-017', unit: '%' },
      { name: 'po_cycle_days', expr: 'AVG(spend.cycle_days)', description: 'Average days from PO creation to goods receipt', synonyms: ['cycle time', 'lead time'], termId: 'T-022', unit: 'days' },
      { name: 'maverick_spend', expr: 'SUM(IFF(spend.on_contract, 0, spend.spend_usd))', description: 'Spend placed outside a contract', synonyms: ['off-contract spend', 'rogue spend'], termId: 'T-016', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_PROCUREMENT'),
    productIds: ['DP-04'],
    playground: {
      from: 'SEMANTIC.SV_PROCUREMENT',
      rows: () => d.poLines.map((l) => ({ supplier: supplierName.get(l.supplierKey)!.name, preferred: supplierName.get(l.supplierKey)!.preferred, category: l.category, fiscal_quarter: `${l.date.slice(0, 4)}-Q${Math.floor((Number(l.date.slice(5, 7)) - 1) / 3) + 1}`, month: l.date.slice(0, 7), spend: l.spend, on: l.onContract, otif: l.otif, cycle: l.cycleDays })),
      dimensions: [
        { name: 'spend.category', column: 'category' },
        { name: 'supplier.supplier_name', column: 'supplier' },
        { name: 'date.fiscal_quarter', column: 'fiscal_quarter' },
      ],
      filters: [
        { label: 'Fiscal year to date (Oct 2025 – Sep 2026)', sql: "date.po_date BETWEEN '2025-10-01' AND '2026-09-30'", test: () => true },
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.fiscal_quarter === '2026-Q3' },
        { label: 'Preferred suppliers only', sql: 'supplier.preferred = TRUE', test: (r) => Boolean(r.preferred) },
      ],
      metrics: [
        { name: 'spend_under_contract_pct', unit: '%', decimals: 1, sqlExpr: 'spend_under_contract_pct', agg: (rs) => (sum(rs.filter((r) => r.on).map((r) => n(r, 'spend'))) / Math.max(1, sum(rs.map((r) => n(r, 'spend'))))) * 100 },
        { name: 'total_spend', unit: 'USD', decimals: 0, sqlExpr: 'total_spend', agg: (rs) => sum(rs.map((r) => n(r, 'spend'))) },
        { name: 'maverick_spend', unit: 'USD', decimals: 0, sqlExpr: 'maverick_spend', agg: (rs) => sum(rs.filter((r) => !r.on).map((r) => n(r, 'spend'))) },
        { name: 'otif_pct', unit: '%', decimals: 1, sqlExpr: 'otif_pct', agg: (rs) => (rs.filter((r) => r.otif).length / Math.max(1, rs.length)) * 100 },
        { name: 'po_cycle_days', unit: 'days', decimals: 1, sqlExpr: 'po_cycle_days', agg: (rs) => sum(rs.map((r) => n(r, 'cycle'))) / Math.max(1, rs.length) },
      ],
    },
  };

  const billingAr: SemanticView = {
    name: 'SV_BILLING_AR',
    description: 'Billing, receivables and collections',
    tables: [
      { alias: 'billing', fqn: 'CONFORMED_GOLD.FCT_BILLING', pk: 'STATEMENT_KEY' },
      { alias: 'customer', fqn: 'CONFORMED_GOLD.DIM_CUSTOMER', pk: 'CUSTOMER_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'billing', to: 'customer', on: 'CUSTOMER_KEY' },
      { from: 'billing', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'billing.billed_amount', expr: 'billing.BILLED_AMOUNT' },
      { name: 'billing.arrears_amount', expr: 'billing.ARREARS_AMOUNT' },
      { name: 'billing.days_to_pay', expr: 'billing.DAYS_TO_PAY' },
    ],
    dimensions: [
      { name: 'customer.opco', expr: 'customer.OPCO', synonyms: ['operating company', 'opco'] },
      { name: 'customer.rate_class', expr: 'customer.RATE_CLASS', synonyms: ['tariff'] },
      { name: 'billing.is_estimated', expr: 'billing.IS_ESTIMATED', synonyms: ['estimated bill'] },
    ],
    timeDimensions: [{ name: 'date.statement_month', expr: "DATE_TRUNC('month', date.CALENDAR_DATE)" }],
    metrics: [
      { name: 'dso_days', expr: '(SUM(billing.billed_amount) + SUM(billing.arrears_amount)) / SUM(billing.billed_amount) * 30', description: 'Days sales outstanding: receivables ÷ billed revenue × days in period', synonyms: ['dso', 'days sales outstanding', 'collection days'], termId: 'T-018', unit: 'days' },
      { name: 'bills_issued', expr: 'COUNT(billing.statement_key)', description: 'Billing statements issued', synonyms: ['bills', 'statements'], termId: 'T-009', unit: 'statements' },
      { name: 'estimated_bill_rate', expr: 'AVG(IFF(billing.is_estimated, 1, 0)) * 100', description: 'Share of bills based on an estimated read', synonyms: ['estimated bills'], termId: 'T-021', unit: '%' },
      { name: 'collections_rate', expr: 'SUM(IFF(billing.days_to_pay <= 60, billing.billed_amount, 0)) / SUM(billing.billed_amount) * 100', description: 'Share of billed revenue collected within 60 days', synonyms: ['collection rate', 'cash collection'], termId: 'T-024', unit: '%' },
    ],
    verifiedQueryIds: vqIds('SV_BILLING_AR'),
    productIds: ['DP-05'],
    playground: {
      from: 'SEMANTIC.SV_BILLING_AR',
      rows: () => d.bills.map((b) => ({ opco: b.opco, rate_class: b.rateClass, month: b.month, billed: b.billed, arrears: b.arrears, est: b.estimated, dtp: b.daysToPay })),
      dimensions: [
        { name: 'customer.opco', column: 'opco' },
        { name: 'customer.rate_class', column: 'rate_class' },
        { name: 'date.statement_month', column: 'month' },
      ],
      filters: [
        { label: 'September 2026', sql: "date.statement_month = '2026-09-01'", test: (r) => r.month === '2026-09' },
        { label: 'Q3 2026', sql: "date.statement_month BETWEEN '2026-07-01' AND '2026-09-01'", test: (r) => ['2026-07', '2026-08', '2026-09'].includes(String(r.month)) },
      ],
      metrics: [
        { name: 'dso_days', unit: 'days', decimals: 1, sqlExpr: 'dso_days', agg: (rs) => ((sum(rs.map((r) => n(r, 'billed'))) + sum(rs.map((r) => n(r, 'arrears')))) / Math.max(1, sum(rs.map((r) => n(r, 'billed'))))) * 30 },
        { name: 'bills_issued', unit: '', decimals: 0, sqlExpr: 'bills_issued', agg: (rs) => Math.round(rs.length * d.scale) },
        { name: 'estimated_bill_rate', unit: '%', decimals: 1, sqlExpr: 'estimated_bill_rate', agg: (rs) => (rs.filter((r) => r.est).length / Math.max(1, rs.length)) * 100 },
        { name: 'collections_rate', unit: '%', decimals: 1, sqlExpr: 'collections_rate', agg: (rs) => (sum(rs.filter((r) => n(r, 'dtp') <= 60).map((r) => n(r, 'billed'))) / Math.max(1, sum(rs.map((r) => n(r, 'billed'))))) * 100 },
      ],
    },
  };

  return [customer360, reliability, procurement, billingAr];
}
