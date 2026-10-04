// Semantic views for Altair Communications (spec sections 5 and 7.3).
import type { Row, SemanticView } from '../../types';
import { addDays, sum } from '../../mock-snowflake/generators';
import type { TelData } from './data';
import { AS_OF, SITES_TOTAL } from './generators.config';
import { PERIODS } from './queries';

const n = (r: Row, k: string) => Number(r[k] ?? 0);
const quarter = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const Q3 = PERIODS.quarter.months;

export function buildSemanticViews(d: TelData, vqIds: (sv: string) => string[]): SemanticView[] {
  const invoiceRows = () => d.invoices.map((v) => ({
    region: v.region, plan_name: v.planName, segment: v.segment, lob: v.lob, month: v.month, device_model: v.deviceModel ?? '(none)',
    billed: v.billed, rated: v.rated, leakage: v.leakage, roaming: v.roaming, cost: v.costOfService, subsidy: v.deviceSubsidy,
  }));
  const months = (rs: Row[]) => Math.max(1, new Set(rs.map((r) => r.month)).size);

  const subscriber360: SemanticView = {
    name: 'SV_SUBSCRIBER_360',
    description: 'Subscriber, usage and revenue metrics: active base, ARPU, service revenue, leakage, roaming and usage',
    tables: [
      { alias: 'subscriber', fqn: 'CONFORMED_GOLD.DIM_SUBSCRIBER', pk: 'SUBSCRIBER_KEY' },
      { alias: 'plan', fqn: 'CONFORMED_GOLD.DIM_PLAN', pk: 'PLAN_KEY' },
      { alias: 'billing', fqn: 'CONFORMED_GOLD.FCT_BILLING', pk: 'INVOICE_KEY' },
      { alias: 'usage', fqn: 'CONFORMED_GOLD.FCT_DAILY_USAGE', pk: 'DATE_KEY, SUBSCRIBER_KEY' },
    ],
    relationships: [
      { from: 'billing', to: 'subscriber', on: 'SUBSCRIBER_KEY' },
      { from: 'billing', to: 'plan', on: 'PLAN_KEY' },
      { from: 'usage', to: 'subscriber', on: 'SUBSCRIBER_KEY' },
    ],
    facts: [
      { name: 'billing.service_revenue', expr: 'billing.SERVICE_REVENUE', description: 'Billed service revenue per invoice' },
      { name: 'billing.rated_amount', expr: 'billing.RATED_AMOUNT', description: 'Charges computed by rating' },
      { name: 'billing.leakage_amount', expr: 'billing.LEAKAGE_AMOUNT', description: 'Rated but not billed' },
      { name: 'billing.roaming_revenue', expr: 'billing.ROAMING_REVENUE', description: 'Retail roaming revenue' },
      { name: 'usage.data_gb', expr: 'usage.DATA_GB', description: 'Daily data used (GB)' },
      { name: 'usage.voice_min', expr: 'usage.VOICE_MIN', description: 'Daily voice minutes' },
    ],
    dimensions: [
      { name: 'subscriber.region', expr: 'subscriber.REGION', synonyms: ['region', 'territory', 'area'], description: 'Region' },
      { name: 'subscriber.market', expr: 'subscriber.MARKET', synonyms: ['market', 'metro'], description: 'Market' },
      { name: 'plan.plan_name', expr: 'plan.PLAN_NAME', synonyms: ['plan', 'rate plan', 'tariff', 'price plan'], description: 'Rate plan' },
      { name: 'plan.segment', expr: 'plan.SEGMENT', synonyms: ['postpaid', 'prepaid', 'line type'], description: 'Postpaid / Prepaid / Broadband' },
      { name: 'subscriber.autopay', expr: 'subscriber.AUTOPAY', synonyms: ['autopay', 'auto pay', 'automatic payment'], description: 'Autopay enrolled' },
    ],
    timeDimensions: [
      { name: 'billing.invoice_month', expr: "DATE_TRUNC('month', billing.INVOICE_DATE)", description: 'Billing month' },
      { name: 'usage.usage_date', expr: 'usage.USAGE_DATE', description: 'Usage date' },
    ],
    metrics: [
      { name: 'active_subscribers', expr: "COUNT(DISTINCT IFF(subscriber.status = 'Active' AND billing.invoice_month = DATE_TRUNC('month', CURRENT_DATE - 30), subscriber.subscriber_key, NULL))", description: 'Subscribers with Active status and an invoice in the latest closed month', synonyms: ['active lines', 'subscriber count', 'active base'], termId: 'T-002', unit: 'subscribers' },
      { name: 'postpaid_arpu', expr: "SUM(IFF(plan.segment = 'Postpaid', billing.service_revenue, 0)) / COUNT_IF(plan.segment = 'Postpaid')", description: 'Average monthly service revenue per postpaid subscriber (excludes device revenue)', synonyms: ['arpu', 'average revenue per user', 'revenue per subscriber'], termId: 'T-009', unit: 'USD' },
      { name: 'service_revenue', expr: 'SUM(billing.service_revenue)', description: 'Billed service revenue: plan, overage and roaming, net of leakage', synonyms: ['service revenue', 'billed revenue'], termId: 'T-010', unit: 'USD' },
      { name: 'revenue_leakage_pct', expr: 'SUM(billing.leakage_amount) / SUM(billing.rated_amount) * 100', description: 'Share of rated charges that were not billed', synonyms: ['leakage', 'revenue leakage', 'unbilled usage rate'], termId: 'T-017', unit: '%' },
      { name: 'leakage_amount', expr: 'SUM(billing.leakage_amount)', description: 'Rated charges that were not billed', synonyms: ['unbilled usage', 'leakage dollars'], termId: 'T-017', unit: 'USD' },
      { name: 'roaming_revenue_share', expr: "SUM(IFF(plan.line_of_business = 'Mobile', billing.roaming_revenue, 0)) / SUM(IFF(plan.line_of_business = 'Mobile', billing.service_revenue, 0)) * 100", description: 'Retail roaming revenue as a share of mobile service revenue', synonyms: ['roaming share', 'roaming revenue'], termId: 'T-028', unit: '%' },
      { name: 'data_gb_per_sub', expr: 'SUM(usage.data_gb) / COUNT(DISTINCT usage.subscriber_key)', description: 'Monthly data used per mobile subscriber', synonyms: ['data usage', 'gb per subscriber', 'data consumption'], termId: 'T-011', unit: 'GB' },
      { name: 'voice_min_per_sub', expr: 'SUM(usage.voice_min) / COUNT(DISTINCT usage.subscriber_key)', description: 'Monthly voice minutes of use per mobile subscriber', synonyms: ['mou', 'minutes of use'], termId: 'T-026', unit: 'minutes' },
      { name: 'autopay_rate', expr: 'AVG(IFF(subscriber.autopay, 1, 0)) * 100', description: 'Share of active subscribers enrolled in autopay', synonyms: ['autopay adoption', 'auto pay rate'], termId: 'T-027', unit: '%' },
      { name: 'avg_churn_propensity', expr: 'AVG(subscriber.churn_propensity)', description: 'Average churn propensity score (0–100)', synonyms: ['churn risk', 'churn score'], termId: 'T-020', unit: 'score' },
    ],
    verifiedQueryIds: vqIds('SV_SUBSCRIBER_360'),
    productIds: ['DP-01', 'DP-03'],
    playground: {
      from: 'SEMANTIC.SV_SUBSCRIBER_360',
      rows: invoiceRows,
      dimensions: [
        { name: 'subscriber.region', column: 'region' },
        { name: 'plan.plan_name', column: 'plan_name' },
        { name: 'billing.invoice_month', column: 'month' },
      ],
      filters: [
        { label: 'Q3 2026', sql: "billing.invoice_month BETWEEN '2026-07-01' AND '2026-09-01'", test: (r) => Q3.includes(String(r.month)) },
        { label: 'September 2026', sql: "billing.invoice_month = '2026-09-01'", test: (r) => r.month === PERIODS.month },
        { label: 'Last 12 months', sql: "billing.invoice_month >= '2025-10-01'", test: () => true },
      ],
      metrics: [
        { name: 'postpaid_arpu', unit: 'USD', decimals: 2, sqlExpr: 'postpaid_arpu', agg: (rs) => { const pp = rs.filter((r) => r.segment === 'Postpaid'); return sum(pp.map((r) => n(r, 'billed'))) / Math.max(1, pp.length); } },
        { name: 'service_revenue', unit: 'USD', decimals: 0, sqlExpr: 'service_revenue', agg: (rs) => (sum(rs.map((r) => n(r, 'billed'))) * d.scale) / months(rs) },
        { name: 'revenue_leakage_pct', unit: '%', decimals: 2, sqlExpr: 'revenue_leakage_pct', agg: (rs) => (sum(rs.map((r) => n(r, 'leakage'))) / Math.max(1, sum(rs.map((r) => n(r, 'rated'))))) * 100 },
        { name: 'roaming_revenue_share', unit: '%', decimals: 2, sqlExpr: 'roaming_revenue_share', agg: (rs) => { const m = rs.filter((r) => r.lob === 'Mobile'); return (sum(m.map((r) => n(r, 'roaming'))) / Math.max(1, sum(m.map((r) => n(r, 'billed'))))) * 100; } },
      ],
    },
  };

  const network: SemanticView = {
    name: 'SV_NETWORK_PERFORMANCE',
    description: 'Network quality and availability by cell site, market, region, technology and period',
    tables: [
      { alias: 'network', fqn: 'CONFORMED_GOLD.FCT_NETWORK_DAILY', pk: 'DATE_KEY, SITE_KEY' },
      { alias: 'site', fqn: 'CONFORMED_GOLD.DIM_CELL_SITE', pk: 'SITE_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'network', to: 'site', on: 'SITE_KEY' },
      { from: 'network', to: 'date', on: 'DATE_KEY' },
    ],
    facts: [
      { name: 'network.call_attempts', expr: 'network.CALL_ATTEMPTS', description: 'Call attempts' },
      { name: 'network.dropped_calls', expr: 'network.DROPPED_CALLS', description: 'Dropped calls' },
      { name: 'network.setup_failures', expr: 'network.SETUP_FAILURES', description: 'Call setup failures' },
      { name: 'network.downtime_min', expr: 'network.DOWNTIME_MIN', description: 'Service-affecting downtime minutes' },
      { name: 'network.data_tb', expr: 'network.DATA_TB', description: 'Data carried (TB)' },
    ],
    dimensions: [
      { name: 'site.region', expr: 'site.REGION', synonyms: ['region', 'territory'], description: 'Region' },
      { name: 'site.market', expr: 'site.MARKET', synonyms: ['market', 'metro'], description: 'Market' },
      { name: 'site.site_id', expr: 'site.SITE_ID', synonyms: ['cell site', 'tower', 'site', 'cell'], description: 'Cell site' },
      { name: 'site.technology', expr: 'site.TECHNOLOGY', synonyms: ['5g', 'lte', 'radio technology'], description: '5G / LTE' },
      { name: 'site.vendor', expr: 'site.VENDOR', synonyms: ['ran vendor', 'equipment vendor'], description: 'RAN vendor' },
    ],
    timeDimensions: [
      { name: 'date.kpi_date', expr: 'date.CALENDAR_DATE', description: 'KPI date' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter (FY = calendar year)' },
    ],
    metrics: [
      { name: 'dropped_call_rate', expr: 'SUM(network.dropped_calls) / SUM(network.call_attempts) * 100', description: 'Dropped calls as a share of call attempts', synonyms: ['dcr', 'drop rate', 'call drop rate', 'dropped calls'], termId: 'T-013', unit: '%' },
      { name: 'network_availability', expr: '100 - SUM(network.downtime_min) / (COUNT(*) * 1440) * 100', description: 'Share of site-minutes in service', synonyms: ['availability', 'uptime', 'network uptime'], termId: 'T-014', unit: '%' },
      { name: 'call_setup_success_rate', expr: '100 - SUM(network.setup_failures) / SUM(network.call_attempts) * 100', description: 'Share of call attempts that set up successfully', synonyms: ['cssr', 'setup success'], termId: 'T-015', unit: '%' },
      { name: 'avg_throughput_mbps', expr: 'AVG(network.avg_throughput_mbps)', description: 'Average user downlink throughput', synonyms: ['throughput', 'download speed', 'speed'], termId: 'T-030', unit: 'Mbps' },
      { name: 'site_sla_compliance', expr: 'AVG(IFF(site_month_availability >= 99.9, 1, 0)) * 100', description: 'Share of sites meeting the 99.9% monthly availability SLA', synonyms: ['sla compliance', 'sites within sla'], termId: 'T-029', unit: '%' },
      { name: 'data_traffic_pb', expr: 'SUM(network.data_tb) * site_scale / 1000', description: 'Mobile data carried, all sites (PB)', synonyms: ['data traffic', 'traffic'], termId: 'T-011', unit: 'PB' },
    ],
    verifiedQueryIds: vqIds('SV_NETWORK_PERFORMANCE'),
    productIds: ['DP-02'],
    playground: {
      from: 'SEMANTIC.SV_NETWORK_PERFORMANCE',
      rows: () => {
        const siteOf = new Map(d.sites.map((s) => [s.key, s]));
        return d.network.map((x) => ({ region: x.region, technology: siteOf.get(x.siteKey)!.technology, fiscal_quarter: quarter(x.date), date: x.date, attempts: x.attempts, dropped: x.dropped, setup_fail: x.setupFail, downtime: x.downtimeMin, tput: x.throughput, tb: x.dataTb }));
      },
      dimensions: [
        { name: 'site.region', column: 'region' },
        { name: 'site.technology', column: 'technology' },
        { name: 'date.fiscal_quarter', column: 'fiscal_quarter' },
      ],
      filters: [
        { label: 'Q3 2026', sql: "date.fiscal_quarter = '2026-Q3'", test: (r) => r.fiscal_quarter === '2026-Q3' },
        { label: 'Q2 2026', sql: "date.fiscal_quarter = '2026-Q2'", test: (r) => r.fiscal_quarter === '2026-Q2' },
        { label: 'Last 30 days', sql: `date.kpi_date >= '${addDays(AS_OF, -29)}'`, test: (r) => String(r.date) >= addDays(AS_OF, -29) },
        { label: 'Year to date', sql: "date.kpi_date BETWEEN '2026-01-01' AND '2026-09-30'", test: () => true },
      ],
      metrics: [
        { name: 'dropped_call_rate', unit: '%', decimals: 3, sqlExpr: 'dropped_call_rate', agg: (rs) => (sum(rs.map((r) => n(r, 'dropped'))) / Math.max(1, sum(rs.map((r) => n(r, 'attempts'))))) * 100 },
        { name: 'network_availability', unit: '%', decimals: 3, sqlExpr: 'network_availability', agg: (rs) => 100 - (sum(rs.map((r) => n(r, 'downtime'))) / Math.max(1, rs.length * 1440)) * 100 },
        { name: 'call_setup_success_rate', unit: '%', decimals: 2, sqlExpr: 'call_setup_success_rate', agg: (rs) => 100 - (sum(rs.map((r) => n(r, 'setup_fail'))) / Math.max(1, sum(rs.map((r) => n(r, 'attempts'))))) * 100 },
        { name: 'avg_throughput_mbps', unit: 'Mbps', decimals: 1, sqlExpr: 'avg_throughput_mbps', agg: (rs) => sum(rs.map((r) => n(r, 'tput'))) / Math.max(1, rs.length) },
        { name: 'data_traffic_pb', unit: 'PB', decimals: 1, sqlExpr: 'data_traffic_pb', agg: (rs) => (sum(rs.map((r) => n(r, 'tb'))) * (SITES_TOTAL / d.sites.length)) / 1000 },
      ],
    },
  };

  const churn: SemanticView = {
    name: 'SV_CHURN_RETENTION',
    description: 'Subscriber base movements: churn, port-outs, gross adds, net adds and plan migrations',
    tables: [
      { alias: 'movement', fqn: 'CONFORMED_GOLD.FCT_SUBSCRIBER_MONTHLY', pk: 'MONTH_KEY, MARKET_KEY, PLAN_KEY' },
      { alias: 'plan', fqn: 'CONFORMED_GOLD.DIM_PLAN', pk: 'PLAN_KEY' },
      { alias: 'market', fqn: 'CONFORMED_GOLD.DIM_MARKET', pk: 'MARKET_KEY' },
      { alias: 'date', fqn: 'CONFORMED_GOLD.DIM_DATE', pk: 'DATE_KEY' },
    ],
    relationships: [
      { from: 'movement', to: 'plan', on: 'PLAN_KEY' },
      { from: 'movement', to: 'market', on: 'MARKET_KEY' },
      { from: 'movement', to: 'date', on: 'MONTH_KEY = DATE_KEY' },
    ],
    facts: [
      { name: 'movement.opening_base', expr: 'movement.OPENING_BASE', description: 'Subscribers at start of month' },
      { name: 'movement.voluntary_disconnects', expr: 'movement.VOLUNTARY_DISCONNECTS', description: 'Voluntary disconnects' },
      { name: 'movement.port_outs', expr: 'movement.PORT_OUTS', description: 'Port-outs' },
      { name: 'movement.involuntary_disconnects', expr: 'movement.INVOLUNTARY_DISCONNECTS', description: 'Non-pay and fraud disconnects' },
      { name: 'movement.gross_adds', expr: 'movement.GROSS_ADDS', description: 'New connections' },
      { name: 'movement.migrations_out', expr: 'movement.MIGRATIONS_OUT', description: 'Plan migrations out (not churn)' },
    ],
    dimensions: [
      { name: 'plan.plan_name', expr: 'plan.PLAN_NAME', synonyms: ['plan', 'rate plan', 'tariff', 'price plan'], description: 'Rate plan' },
      { name: 'market.region', expr: 'market.REGION', synonyms: ['region', 'territory', 'area'], description: 'Region' },
      { name: 'market.market_name', expr: 'market.MARKET_NAME', synonyms: ['market', 'metro'], description: 'Market' },
      { name: 'plan.segment', expr: 'plan.SEGMENT', synonyms: ['postpaid', 'prepaid', 'broadband', 'line type'], description: 'Postpaid / Prepaid / Broadband' },
    ],
    timeDimensions: [
      { name: 'date.month', expr: 'date.MONTH', description: 'Calendar month' },
      { name: 'date.fiscal_quarter', expr: 'date.FISCAL_QUARTER', description: 'Fiscal quarter' },
    ],
    metrics: [
      { name: 'postpaid_churn_rate', expr: "SUM(IFF(plan.segment = 'Postpaid', movement.voluntary_disconnects + movement.port_outs, 0)) / SUM(IFF(plan.segment = 'Postpaid', movement.opening_base, 0)) * 100", description: 'Monthly postpaid churn: voluntary disconnects plus port-outs over opening base; plan migrations excluded', synonyms: ['postpaid churn', 'churn', 'churn rate', 'attrition', 'disconnect rate'], termId: 'T-004', unit: '%' },
      { name: 'prepaid_churn_rate', expr: "SUM(IFF(plan.segment = 'Prepaid', movement.voluntary_disconnects + movement.port_outs, 0)) / SUM(IFF(plan.segment = 'Prepaid', movement.opening_base, 0)) * 100", description: 'Monthly prepaid churn', synonyms: ['prepaid churn'], termId: 'T-004', unit: '%' },
      { name: 'broadband_churn_rate', expr: "SUM(IFF(plan.segment = 'Broadband', movement.voluntary_disconnects + movement.port_outs, 0)) / SUM(IFF(plan.segment = 'Broadband', movement.opening_base, 0)) * 100", description: 'Monthly broadband churn', synonyms: ['fiber churn', 'home internet churn'], termId: 'T-004', unit: '%' },
      { name: 'port_out_share', expr: 'SUM(movement.port_outs) / SUM(movement.voluntary_disconnects + movement.port_outs) * 100', description: 'Share of churn that ported to another carrier', synonyms: ['port outs', 'port-out share', 'competitive losses'], termId: 'T-005', unit: '%' },
      { name: 'gross_adds', expr: 'SUM(movement.gross_adds)', description: 'New connections in the period', synonyms: ['gross additions', 'new lines', 'activations'], termId: 'T-008', unit: 'subscribers' },
      { name: 'net_adds', expr: 'SUM(movement.gross_adds) - SUM(movement.voluntary_disconnects + movement.port_outs + movement.involuntary_disconnects)', description: 'Gross adds minus all disconnects (migrations net to zero)', synonyms: ['net additions', 'net growth'], termId: 'T-007', unit: 'subscribers' },
      { name: 'plan_migrations', expr: 'SUM(movement.migrations_out)', description: 'Subscribers who changed plan (excluded from churn)', synonyms: ['plan changes', 'migrations', 'upgrades'], termId: 'T-006', unit: 'subscribers' },
    ],
    verifiedQueryIds: vqIds('SV_CHURN_RETENTION'),
    productIds: ['DP-04'],
    playground: {
      from: 'SEMANTIC.SV_CHURN_RETENTION',
      rows: () => d.base.map((r) => ({ plan_name: r.planName, region: r.region, month: r.month, segment: r.segment, opening: r.opening, churned: r.voluntary + r.portOuts, ports: r.portOuts, invol: r.involuntary, gross: r.grossAdds })),
      dimensions: [
        { name: 'plan.plan_name', column: 'plan_name' },
        { name: 'market.region', column: 'region' },
        { name: 'date.month', column: 'month' },
      ],
      filters: [
        { label: 'September 2026, postpaid', sql: "date.month = '2026-09' AND plan.segment = 'Postpaid'", test: (r) => r.month === PERIODS.month && r.segment === 'Postpaid' },
        { label: 'Q3 2026, postpaid', sql: "date.fiscal_quarter = '2026-Q3' AND plan.segment = 'Postpaid'", test: (r) => Q3.includes(String(r.month)) && r.segment === 'Postpaid' },
        { label: 'Last 12 months, postpaid', sql: "date.month >= '2025-10' AND plan.segment = 'Postpaid'", test: (r) => r.segment === 'Postpaid' },
      ],
      metrics: [
        { name: 'postpaid_churn_rate', unit: '%', decimals: 2, sqlExpr: 'postpaid_churn_rate', agg: (rs) => (sum(rs.map((r) => n(r, 'churned'))) / Math.max(1, sum(rs.map((r) => n(r, 'opening'))))) * 100 },
        { name: 'port_out_share', unit: '%', decimals: 1, sqlExpr: 'port_out_share', agg: (rs) => (sum(rs.map((r) => n(r, 'ports'))) / Math.max(1, sum(rs.map((r) => n(r, 'churned'))))) * 100 },
        { name: 'gross_adds', unit: '', decimals: 0, sqlExpr: 'gross_adds', agg: (rs) => sum(rs.map((r) => n(r, 'gross'))) },
        { name: 'net_adds', unit: '', decimals: 0, sqlExpr: 'net_adds', agg: (rs) => sum(rs.map((r) => n(r, 'gross') - n(r, 'churned') - n(r, 'invol'))) },
      ],
    },
  };

  const profitability: SemanticView = {
    name: 'SV_DEVICE_PLAN_PROFITABILITY',
    description: 'Plan and device profitability: gross margin, margin per subscriber and device subsidy',
    tables: [
      { alias: 'billing', fqn: 'CONFORMED_GOLD.FCT_BILLING', pk: 'INVOICE_KEY' },
      { alias: 'subscriber', fqn: 'CONFORMED_GOLD.DIM_SUBSCRIBER', pk: 'SUBSCRIBER_KEY' },
      { alias: 'plan', fqn: 'CONFORMED_GOLD.DIM_PLAN', pk: 'PLAN_KEY' },
    ],
    relationships: [
      { from: 'billing', to: 'subscriber', on: 'SUBSCRIBER_KEY' },
      { from: 'billing', to: 'plan', on: 'PLAN_KEY' },
    ],
    facts: [
      { name: 'billing.service_revenue', expr: 'billing.SERVICE_REVENUE' },
      { name: 'billing.cost_of_service', expr: 'billing.COST_OF_SERVICE' },
      { name: 'billing.device_subsidy', expr: 'billing.DEVICE_SUBSIDY' },
      { name: 'billing.device_revenue', expr: 'billing.DEVICE_REVENUE' },
    ],
    dimensions: [
      { name: 'plan.plan_name', expr: 'plan.PLAN_NAME', synonyms: ['plan', 'rate plan', 'tariff'] },
      { name: 'plan.segment', expr: 'plan.SEGMENT', synonyms: ['postpaid', 'prepaid'] },
      { name: 'subscriber.device_model', expr: 'subscriber.DEVICE_MODEL', synonyms: ['device', 'handset', 'phone'] },
      { name: 'subscriber.region', expr: 'subscriber.REGION', synonyms: ['region', 'territory'] },
    ],
    timeDimensions: [{ name: 'billing.invoice_month', expr: "DATE_TRUNC('month', billing.INVOICE_DATE)" }],
    metrics: [
      { name: 'plan_gross_margin_pct', expr: '(SUM(billing.service_revenue) - SUM(billing.cost_of_service) - SUM(billing.device_subsidy)) / SUM(billing.service_revenue) * 100', description: 'Gross margin as a share of service revenue, after cost of service and device subsidy', synonyms: ['gross margin', 'plan margin', 'margin %'], termId: 'T-022', unit: '%' },
      { name: 'margin_per_subscriber', expr: '(SUM(billing.service_revenue) - SUM(billing.cost_of_service) - SUM(billing.device_subsidy)) / COUNT(billing.invoice_key)', description: 'Monthly gross margin per subscriber', synonyms: ['margin per sub', 'margin per subscriber', 'unit margin'], termId: 'T-022', unit: 'USD' },
      { name: 'device_subsidy_per_sub', expr: "SUM(billing.device_subsidy) / COUNT_IF(plan.segment = 'Postpaid')", description: 'Monthly amortised device subsidy per postpaid subscriber', synonyms: ['subsidy', 'handset subsidy'], termId: 'T-023', unit: 'USD' },
    ],
    verifiedQueryIds: vqIds('SV_DEVICE_PLAN_PROFITABILITY'),
    productIds: ['DP-05'],
    playground: {
      from: 'SEMANTIC.SV_DEVICE_PLAN_PROFITABILITY',
      rows: invoiceRows,
      dimensions: [
        { name: 'plan.plan_name', column: 'plan_name' },
        { name: 'subscriber.device_model', column: 'device_model' },
        { name: 'subscriber.region', column: 'region' },
      ],
      filters: [
        { label: 'Q3 2026', sql: "billing.invoice_month BETWEEN '2026-07-01' AND '2026-09-01'", test: (r) => Q3.includes(String(r.month)) },
        { label: 'September 2026', sql: "billing.invoice_month = '2026-09-01'", test: (r) => r.month === PERIODS.month },
      ],
      metrics: [
        { name: 'plan_gross_margin_pct', unit: '%', decimals: 1, sqlExpr: 'plan_gross_margin_pct', agg: (rs) => (sum(rs.map((r) => n(r, 'billed') - n(r, 'cost') - n(r, 'subsidy'))) / Math.max(1, sum(rs.map((r) => n(r, 'billed'))))) * 100 },
        { name: 'margin_per_subscriber', unit: 'USD', decimals: 2, sqlExpr: 'margin_per_subscriber', agg: (rs) => sum(rs.map((r) => n(r, 'billed') - n(r, 'cost') - n(r, 'subsidy'))) / Math.max(1, rs.length) },
        { name: 'device_subsidy_per_sub', unit: 'USD', decimals: 2, sqlExpr: 'device_subsidy_per_sub', agg: (rs) => sum(rs.map((r) => n(r, 'subsidy'))) / Math.max(1, rs.filter((r) => r.segment === 'Postpaid').length) },
      ],
    },
  };

  return [subscriber360, network, churn, profitability];
}
