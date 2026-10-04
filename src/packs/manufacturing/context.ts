import type { ContextLayer, VerifiedQuery } from '../../types';

const DB = 'FPI_AI_PLATFORM';

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

const Q3 = "date.fiscal_quarter = '2026-Q3'";
const LW = "date.production_date BETWEEN '2026-09-21' AND '2026-09-27'";

const VQ_PLANT: VqSpec[] = [
  ['Which lines had OEE below 65% last week, and what drove the losses?', 'oee_pct, availability_pct, performance_pct, quality_rate_pct', 'line.line_id', `${LW} AND oee_pct < 65`],
  ['What was OEE by business unit last quarter?', 'oee_pct', 'line.business_unit', Q3],
  ['What is OEE by plant this month?', 'oee_pct', 'line.plant_name', "date.production_date >= '2026-09-01'"],
  ['Availability, performance and quality by line type', 'availability_pct, performance_pct, quality_rate_pct', 'line.line_type', Q3],
  ['How many active production lines ran last month?', 'active_lines', 'line.business_unit'],
  ['Unplanned downtime hours by loss reason last quarter', 'unplanned_downtime_hours', 'production.top_loss_reason', Q3],
  ['Daily units produced over the last 30 days', 'units_produced', 'date.production_date', "date.production_date >= '2026-09-01'"],
  ['Which shift leads had the lowest OEE last month?', 'oee_pct', 'operator.shift_lead, line.line_id', "date.production_date >= '2026-09-01'"],
  ['OEE trend by production week', 'oee_pct', 'date.production_week'],
  ['Compare first-pass yield and scrap rate this quarter with last quarter', 'first_pass_yield_pct, scrap_rate_pct', 'date.fiscal_quarter', "date.fiscal_quarter IN ('2026-Q2', '2026-Q3')"],
  ['Top 5 defect codes by cost of poor quality last quarter', 'copq_usd, ncr_count', 'inspection.defect_code', Q3],
  ['Scrap rate by plant this quarter', 'scrap_rate_pct', 'line.plant_name', Q3],
  ['Defects per million by business unit', 'defects_ppm', 'line.business_unit', Q3],
  ['How many NCRs were opened last month?', 'ncr_count', '', "date.production_date >= '2026-09-01'"],
  ['Rework rate by line type', 'rework_rate_pct', 'line.line_type', Q3],
  ['Units produced by business unit this month', 'units_produced', 'line.business_unit', "date.production_date >= '2026-09-01'"],
];
const VQ_MAINT: VqSpec[] = [
  ['What is MTBF for our assets this quarter?', 'mtbf_hours', '', Q3],
  ['Which assets have MTBF below 150 hours this quarter?', 'mtbf_hours, failures', 'asset.asset_id', `${Q3} AND mtbf_hours < 150`],
  ['What share of maintenance work was planned this quarter?', 'planned_maintenance_pct', 'line.business_unit', Q3],
  ['MTTR by asset type', 'mttr_hours', 'asset.asset_type', Q3],
  ['MTBF for critical assets', 'mtbf_hours', '', "asset.criticality = 'A'"],
  ['Failures by failure cause last quarter', 'failures', 'maint.failure_cause', Q3],
  ['MTBF trend by month', 'mtbf_hours', 'date.event_month'],
  ['Repair hours by business unit', 'repair_hours', 'line.business_unit', Q3],
  ['Planned maintenance share by criticality', 'planned_maintenance_pct', 'asset.criticality', Q3],
  ['How many failures did we have in September?', 'failures', '', "date.event_month = '2026-09-01'"],
  ['MTTR for spindle failures', 'mttr_hours', '', "maint.failure_cause = 'Spindle failure'"],
  ['Compare MTBF this quarter with last quarter', 'mtbf_hours', 'date.fiscal_quarter', "date.fiscal_quarter IN ('2026-Q2', '2026-Q3')"],
  ['Assets with the most failures this quarter', 'failures', 'asset.asset_id', Q3],
];
const VQ_SUPPLIER: VqSpec[] = [
  ['What was supplier OTIF last quarter?', 'otif_pct', '', Q3],
  ['Which suppliers had OTIF below 90% last quarter?', 'otif_pct', 'supplier.supplier_name', `${Q3} AND otif_pct < 90`],
  ['Supplier PPM by supplier', 'supplier_ppm', 'supplier.supplier_name', Q3],
  ['Average supplier lead time by category', 'lead_time_days', 'supplier.category', Q3],
  ['OTIF trend by month', 'otif_pct', 'date.receipt_month'],
  ['Incoming PPM for castings', 'supplier_ppm', '', "supplier.category = 'Castings & forgings'"],
  ['Receipts by business unit', 'receipts', 'delivery.business_unit', Q3],
  ['OTIF for preferred suppliers', 'otif_pct', '', 'supplier.preferred = TRUE'],
  ['Which supplier has the longest lead time?', 'lead_time_days', 'supplier.supplier_name', Q3],
  ['Supplier PPM trend by quarter', 'supplier_ppm', 'date.fiscal_quarter'],
  ['OTIF by receiving plant', 'otif_pct', 'delivery.plant_code', Q3],
  ['Compare supplier OTIF this quarter with last quarter', 'otif_pct', 'date.fiscal_quarter', "date.fiscal_quarter IN ('2026-Q2', '2026-Q3')"],
];
/** Exactly 7: DP-05 certification gate 4 needs 10 verified queries (spec section 7.6). */
const VQ_ORDER: VqSpec[] = [
  ['What was our on-time delivery rate last month?', 'on_time_delivery_pct', '', "date.delivery_month = '2026-09-01'"],
  ['On-time delivery trend for the last six months', 'on_time_delivery_pct', 'date.delivery_month', "date.delivery_month >= '2026-04-01'"],
  ['On-time delivery by business unit', 'on_time_delivery_pct', 'orders.business_unit', "date.delivery_month = '2026-09-01'"],
  ['What is the order fill rate this quarter?', 'fill_rate_pct', '', "date.delivery_month BETWEEN '2026-07-01' AND '2026-09-01'"],
  ['Average order lead time by product family', 'order_lead_time_days', 'orders.product_family'],
  ['How many order lines did we ship last month?', 'order_lines_shipped', '', "date.delivery_month = '2026-09-01'"],
  ['Fill rate by business unit', 'fill_rate_pct', 'orders.business_unit'],
];

const verifiedQueries: VerifiedQuery[] = [
  ...vq('SV_PLANT_PERFORMANCE', VQ_PLANT, 1, ['M. Lindgren', 'P. Nakamura']),
  ...vq('SV_ASSET_MAINTENANCE', VQ_MAINT, 17, ['K. Mensah', 'B. Osei']),
  ...vq('SV_SUPPLIER_PERFORMANCE', VQ_SUPPLIER, 30, ['J. Okonkwo', 'T. Brandt']),
  ...vq('SV_ORDER_DELIVERY', VQ_ORDER, 42, ['J. Okonkwo']),
];

export const CONTEXT: ContextLayer = {
  searchService: 'CS_MFG_DOCS',
  instructions: [
    { id: 'AI-01', agentId: 'AG-01', type: 'persona', version: '1.4', text: 'You are Forgepoint’s Plant Performance Analyst. You help plant and business-unit analysts understand OEE, output, downtime, crews and customer order delivery.' },
    { id: 'AI-02', agentId: 'AG-01', type: 'response', version: '1.4', text: 'Report OEE and its components as percentages to one decimal and say which period (production week Monday–Sunday, month or quarter) and which lines a number covers.' },
    { id: 'AI-03', agentId: 'AG-01', type: 'guardrail', version: '1.4', text: 'Never reveal operator or customer contact names unless the user’s role may see unmasked PII; never reveal costs or recipes tagged TRADE_SECRET. Never answer from a product the user cannot access.' },
    { id: 'AI-04', agentId: 'AG-01', type: 'orchestration', version: '1.4', text: 'Use Cortex Analyst on SV_PLANT_PERFORMANCE for OEE and output and on SV_ORDER_DELIVERY for customer delivery. Use CS_MFG_DOCS for OEE definitions.' },
    { id: 'AI-05', agentId: 'AG-02', type: 'persona', version: '2.1', text: 'You are the Quality Copilot. You help production and quality managers find where OEE is lost — availability, performance and quality losses — and track first-pass yield, scrap, cost of poor quality and energy per unit.' },
    { id: 'AI-06', agentId: 'AG-02', type: 'response', version: '2.1', text: 'Always state OEE as availability × performance × quality with planned downtime excluded, and name the dominant loss for each line. Report yields and rates to one decimal.' },
    { id: 'AI-07', agentId: 'AG-02', type: 'guardrail', version: '2.1', text: 'Flag any answer that uses a product that is not certified. Do not attribute losses to people; report lines, reasons and defect codes.' },
    { id: 'AI-08', agentId: 'AG-02', type: 'orchestration', version: '2.1', text: 'Use Cortex Analyst on SV_PLANT_PERFORMANCE. Cite the OEE standard from CS_MFG_DOCS whenever planned downtime is excluded, and the ISO 9001 procedures for nonconformance questions.' },
    { id: 'AI-09', agentId: 'AG-03', type: 'persona', version: '1.2', text: 'You are the Maintenance Planner. You help maintenance and supply chain managers plan work from asset reliability (MTBF, MTTR, planned maintenance) and from spare-part and material supplier performance.' },
    { id: 'AI-10', agentId: 'AG-03', type: 'response', version: '1.2', text: 'Show hours to one decimal, percentages to one decimal and PPM as whole numbers. Name the period and say whether only critical assets are included.' },
    { id: 'AI-11', agentId: 'AG-03', type: 'guardrail', version: '1.2', text: 'Do not disclose supplier prices or standard costs; report delivery and quality performance only.' },
    { id: 'AI-12', agentId: 'AG-03', type: 'orchestration', version: '1.2', text: 'Use Cortex Analyst on SV_ASSET_MAINTENANCE and SV_SUPPLIER_PERFORMANCE. Use the maintenance standard and supplier quality manual in CS_MFG_DOCS for definitions.' },
    { id: 'AI-13', agentId: 'AG-04', type: 'persona', version: '0.9', text: 'You are the Data Steward Assistant. You help stewards find governance gaps in the glossary, CDE register and product registry.' },
    { id: 'AI-14', agentId: 'AG-04', type: 'response', version: '0.9', text: 'Answer with a table of items and a recommended next action for each.' },
    { id: 'AI-15', agentId: 'AG-04', type: 'guardrail', version: '0.9', text: 'Read metadata only; never query operator-level or customer-level data.' },
    { id: 'AI-16', agentId: 'AG-04', type: 'orchestration', version: '0.9', text: 'Use the SQL tool over GLOSSARY, GOVERNANCE and DATA_PRODUCTS.DP_REGISTRY. Read certification state live.' },
  ],
  rules: [
    { id: 'BR-001', domain: 'Operations', text: 'OEE = availability × performance × quality; planned downtime excluded. Planned production time (shift time minus planned downtime) is the time base for every OEE number.', metric: 'SV_PLANT_PERFORMANCE.oee_pct', sourceDoc: 'OEE definitions and loss standard OPS-STD-014' },
    { id: 'BR-002', domain: 'Operations', text: 'A line below 65% OEE for a production week is reviewed at the weekly tier-3 meeting; 85% is the world-class reference, not the target.', metric: 'SV_PLANT_PERFORMANCE.oee_pct', sourceDoc: 'OEE definitions and loss standard OPS-STD-014' },
    { id: 'BR-003', domain: 'Operations', text: 'An Active Production Line has status Active and scheduled production time in the last 30 days.', metric: 'SV_PLANT_PERFORMANCE.active_lines', sourceDoc: 'Manufacturing master data standard' },
    { id: 'BR-004', domain: 'Operations', text: 'Changeovers up to the standard changeover time are planned downtime; any overrun counts as unplanned downtime.', metric: 'SV_PLANT_PERFORMANCE.availability_pct', sourceDoc: 'OEE definitions and loss standard OPS-STD-014' },
    { id: 'BR-005', domain: 'Operations', text: 'Performance uses the nameplate ideal cycle time held in DIM_LINE, never the average actual cycle time.', metric: 'SV_PLANT_PERFORMANCE.performance_pct', sourceDoc: 'OEE definitions and loss standard OPS-STD-014' },
    { id: 'BR-006', domain: 'Operations', text: 'Quality rate counts only units good first time; reworked units are a quality loss even when they ship.', metric: 'SV_PLANT_PERFORMANCE.quality_rate_pct', sourceDoc: 'OEE definitions and loss standard OPS-STD-014' },
    { id: 'BR-007', domain: 'Operations', text: 'Production weeks run Monday to Sunday; "last week" is the most recent complete production week.', metric: 'SV_PLANT_PERFORMANCE.units_produced', sourceDoc: 'Manufacturing master data standard' },
    { id: 'BR-008', domain: 'Quality', text: 'First-pass yield counts lots accepted at first inspection; lots released by concession (use as is) are first-pass failures.', metric: 'SV_PLANT_PERFORMANCE.first_pass_yield_pct', sourceDoc: 'ISO 9001 quality procedures QP-8.7' },
    { id: 'BR-009', domain: 'Quality', text: 'Cost of poor quality includes scrapped material and labour, rework labour at standard rate and investigation effort per NCR; warranty cost is reported separately.', metric: 'SV_PLANT_PERFORMANCE.copq_usd', sourceDoc: 'ISO 9001 quality procedures QP-8.7' },
    { id: 'BR-010', domain: 'Maintenance', text: 'MTBF counts only corrective work orders as failures; asset operating hours are the run hours of the asset’s line.', metric: 'SV_ASSET_MAINTENANCE.mtbf_hours', sourceDoc: 'Maintenance standard MS-201' },
    { id: 'BR-011', domain: 'Maintenance', text: 'Planned maintenance should be at least 80% of work orders; an asset with MTBF below 150 hours in a quarter enters a reliability review.', metric: 'SV_ASSET_MAINTENANCE.planned_maintenance_pct', sourceDoc: 'Maintenance standard MS-201' },
    { id: 'BR-012', domain: 'Supply chain', text: 'Supplier OTIF is measured per receipt; a supplier below 90% OTIF for a quarter receives a supplier corrective action request (SCAR).', metric: 'SV_SUPPLIER_PERFORMANCE.otif_pct', sourceDoc: 'Supplier quality manual SQM-3' },
    { id: 'BR-013', domain: 'Supply chain', text: 'Supplier PPM counts parts rejected at incoming inspection only; parts that fail later in production are charged back separately.', metric: 'SV_SUPPLIER_PERFORMANCE.supplier_ppm', sourceDoc: 'Supplier quality manual SQM-3' },
    { id: 'BR-014', domain: 'Order fulfilment', text: 'On-time delivery is measured at proof of delivery against the first confirmed promise date; re-promised dates do not reset the clock.', metric: 'SV_ORDER_DELIVERY.on_time_delivery_pct', sourceDoc: 'Customer delivery policy' },
    { id: 'BR-015', domain: 'Order fulfilment', text: 'Fill rate is measured per order line: a line is in full only when the whole quantity shipped.', metric: 'SV_ORDER_DELIVERY.fill_rate_pct', sourceDoc: 'Customer delivery policy' },
    { id: 'BR-016', domain: 'Sustainability', text: 'Scope 2 emissions use location-based grid factors per plant country, refreshed annually; energy per unit divides by good units only.', metric: 'DP_ENERGY_EMISSIONS.scope2_tco2e', sourceDoc: 'Energy & emissions reporting procedure' },
  ],
  verifiedQueries,
  synonyms: [
    { term: 'OEE', synonym: 'overall equipment effectiveness', scope: 'Operations' },
    { term: 'OEE', synonym: 'line efficiency', scope: 'Operations' },
    { term: 'Unplanned Downtime', synonym: 'stoppages', scope: 'Operations' },
    { term: 'Unplanned Downtime', synonym: 'lost time', scope: 'Operations' },
    { term: 'Business Unit', synonym: 'division', scope: 'Enterprise' },
    { term: 'Business Unit', synonym: 'bu', scope: 'Enterprise' },
    { term: 'Plant', synonym: 'site', scope: 'Enterprise' },
    { term: 'Plant', synonym: 'factory', scope: 'Enterprise' },
    { term: 'Units Produced', synonym: 'output', scope: 'Operations' },
    { term: 'Units Produced', synonym: 'throughput', scope: 'Operations' },
    { term: 'First-Pass Yield', synonym: 'right first time', scope: 'Quality' },
    { term: 'First-Pass Yield', synonym: 'FPY', scope: 'Quality' },
    { term: 'Nonconformance', synonym: 'NCR', scope: 'Quality' },
    { term: 'Cost of Poor Quality', synonym: 'COPQ', scope: 'Quality' },
    { term: 'MTBF', synonym: 'mean time between failures', scope: 'Maintenance' },
    { term: 'MTTR', synonym: 'mean time to repair', scope: 'Maintenance' },
    { term: 'Planned Maintenance', synonym: 'PM', scope: 'Maintenance' },
    { term: 'Planned Maintenance', synonym: 'preventive maintenance', scope: 'Maintenance' },
    { term: 'Supplier OTIF', synonym: 'on time in full', scope: 'Supply chain' },
    { term: 'Supplier', synonym: 'vendor', scope: 'Supply chain' },
    { term: 'On-Time Delivery', synonym: 'OTD', scope: 'Order fulfilment' },
    { term: 'Minor Stop', synonym: 'micro-stop', scope: 'Operations' },
  ],
  documents: [
    {
      id: 'DOC-01', title: 'OEE definitions and loss standard (OPS-STD-014)', source: '@FPI_AI_PLATFORM.CONTEXT.DOCS/ops_std_014_oee.pdf', chunkCount: 38, updatedAt: '2026-02-09 09:00:00',
      chunks: [
        { n: 3, text: 'Overall equipment effectiveness measures how much of the planned production time a line produces good units at its ideal cycle time. It is reported per line, plant and business unit every production week (Monday to Sunday).' },
        { n: 7, text: 'OEE = availability × performance × quality. Planned downtime — breaks, planned maintenance and planned changeovers up to the standard time — is excluded from the time base before availability is measured, so planned downtime is never an OEE loss. Changeover overruns, breakdowns, material shortages and quality holds are unplanned downtime and reduce availability.' },
        { n: 12, text: 'Performance compares actual output with the nameplate ideal cycle time. Minor stops and reduced speed show up as performance loss. Quality counts only units good first time; scrap and rework are quality losses.' },
        { n: 19, text: 'Lines below 65% OEE for a week are reviewed at the tier-3 meeting with the dominant loss (availability, performance or quality) and the top unplanned loss reason. 85% is the world-class reference.' },
      ],
    },
    {
      id: 'DOC-02', title: 'ISO 9001 quality management procedures — QP-8.7 Control of nonconforming output', source: '@FPI_AI_PLATFORM.CONTEXT.DOCS/qp_8_7_nonconforming_output.pdf', chunkCount: 54, updatedAt: '2026-03-30 08:00:00',
      chunks: [
        { n: 5, text: 'Every inspection lot that fails first inspection is raised on a nonconformance report (NCR) and dispositioned as rework, scrap or use as is (concession) by the material review board.' },
        { n: 11, text: 'First-pass yield is the share of lots accepted at first inspection. Concessions count as first-pass failures. Cost of poor quality is recorded on the NCR: scrap, rework labour at standard rate and investigation effort.' },
        { n: 18, text: 'Recurring defect codes with more than ten NCRs in a quarter require an 8D corrective action with containment within 24 hours.' },
      ],
    },
    {
      id: 'DOC-03', title: 'Maintenance standard MS-201 — reliability and planned maintenance', source: '@FPI_AI_PLATFORM.CONTEXT.DOCS/ms_201_maintenance_standard.pdf', chunkCount: 41, updatedAt: '2025-12-15 14:00:00',
      chunks: [
        { n: 4, text: 'MTBF is the operating hours of an asset divided by its number of failures in the period. Only corrective work orders count as failures. MTTR is total repair hours divided by failures.' },
        { n: 9, text: 'At least 80% of maintenance work orders should be planned: calendar preventive maintenance or condition-based work triggered by IoT vibration and temperature alarms.' },
        { n: 15, text: 'Assets ranked criticality A have no redundancy; an A asset with MTBF below 150 hours in a quarter enters a reliability review and a spare-parts check with the Maintenance Planner.' },
      ],
    },
    {
      id: 'DOC-04', title: 'Supplier quality manual SQM-3', source: '@FPI_AI_PLATFORM.CONTEXT.DOCS/supplier_quality_manual_sqm3.pdf', chunkCount: 29, updatedAt: '2026-04-21 10:30:00',
      chunks: [
        { n: 6, text: 'On time in full (OTIF) is measured per receipt against the promised date on the purchase order. A supplier below 90% OTIF for a quarter receives a supplier corrective action request (SCAR).' },
        { n: 10, text: 'Supplier PPM is the number of parts rejected at incoming inspection per million parts received. Targets: 500 PPM for machined parts, 250 PPM for electronic components.' },
      ],
    },
  ],
};
