import type { Kpi } from '../../types';

const k = (id: string, name: string, definition: string, formula: string, unit: string, termId: string, metric: string, productIds: string[], agentIds: string[]): Kpi =>
  ({ id, name, definition, formula, unit, termId, metric, productIds, agentIds });

export const KPIS: Kpi[] = [
  k('K-01', 'OEE', 'Share of planned production time that produced good units at ideal speed', 'availability × performance × quality; planned downtime excluded', '%', 'T-004', 'SV_PLANT_PERFORMANCE.oee_pct', ['DP-01'], ['AG-01', 'AG-02']),
  k('K-02', 'Availability', 'Run time as a share of planned production time', 'run time ÷ planned production time', '%', 'T-005', 'SV_PLANT_PERFORMANCE.availability_pct', ['DP-01'], ['AG-01', 'AG-02']),
  k('K-03', 'Performance', 'Actual speed against the nameplate ideal cycle time', 'ideal cycle time × total units ÷ run time', '%', 'T-006', 'SV_PLANT_PERFORMANCE.performance_pct', ['DP-01'], ['AG-01', 'AG-02']),
  k('K-04', 'Quality rate', 'Units good first time as a share of units started', 'good units ÷ total units', '%', 'T-007', 'SV_PLANT_PERFORMANCE.quality_rate_pct', ['DP-01'], ['AG-01', 'AG-02']),
  k('K-05', 'Units produced', 'Good units completed in the month', 'sum of good units', 'units', 'T-010', 'SV_PLANT_PERFORMANCE.units_produced', ['DP-01'], ['AG-01']),
  k('K-06', 'Unplanned downtime hours', 'Hours of stoppage inside planned production time in the quarter', 'sum of unplanned downtime minutes ÷ 60', 'hours', 'T-009', 'SV_PLANT_PERFORMANCE.unplanned_downtime_hours', ['DP-01'], ['AG-01', 'AG-02']),
  k('K-07', 'Active production lines', 'Lines with Active status and production in the last 30 days', 'count of lines with status Active and a shift in the last 30 days', 'lines', 'T-002', 'SV_PLANT_PERFORMANCE.active_lines', ['DP-01'], ['AG-01']),
  k('K-08', 'First-pass yield', 'Inspection lots accepted at first inspection', 'lots accepted first time ÷ lots inspected', '%', 'T-011', 'SV_PLANT_PERFORMANCE.first_pass_yield_pct', ['DP-02'], ['AG-02']),
  k('K-09', 'Scrap rate', 'Scrapped units as a share of units started', 'scrap units ÷ total units', '%', 'T-012', 'SV_PLANT_PERFORMANCE.scrap_rate_pct', ['DP-02'], ['AG-02']),
  k('K-10', 'Defects per million', 'Defects found per million units inspected', 'defects ÷ units inspected × 1,000,000', 'ppm', 'T-014', 'SV_PLANT_PERFORMANCE.defects_ppm', ['DP-02'], ['AG-02']),
  k('K-11', 'Nonconformances', 'NCRs opened in the quarter', 'count of lots with an NCR', 'NCRs', 'T-016', 'SV_PLANT_PERFORMANCE.ncr_count', ['DP-02'], ['AG-02']),
  k('K-12', 'Cost of poor quality', 'Scrap, rework and investigation cost of nonconforming lots in the quarter', 'sum of COPQ on NCR lots', 'USD', 'T-015', 'SV_PLANT_PERFORMANCE.copq_usd', ['DP-02'], ['AG-02']),
  k('K-13', 'Rework rate', 'Reworked units as a share of units started', 'rework units ÷ total units', '%', 'T-013', 'SV_PLANT_PERFORMANCE.rework_rate_pct', ['DP-02'], ['AG-02']),
  k('K-14', 'MTBF', 'Mean operating hours between unplanned failures', 'asset operating hours ÷ failures', 'hours', 'T-017', 'SV_ASSET_MAINTENANCE.mtbf_hours', ['DP-03'], ['AG-03']),
  k('K-15', 'MTTR', 'Mean hours to repair a failed asset', 'repair hours ÷ failures', 'hours', 'T-018', 'SV_ASSET_MAINTENANCE.mttr_hours', ['DP-03'], ['AG-03']),
  k('K-16', 'Planned maintenance %', 'Share of maintenance work orders that were planned', 'preventive work orders ÷ all work orders', '%', 'T-019', 'SV_ASSET_MAINTENANCE.planned_maintenance_pct', ['DP-03'], ['AG-03']),
  k('K-17', 'Unplanned failures', 'Corrective work orders in the quarter', 'count of corrective work orders', 'failures', 'T-017', 'SV_ASSET_MAINTENANCE.failures', ['DP-03'], ['AG-03']),
  k('K-18', 'Supplier OTIF', 'Share of receipts delivered on time and in full', 'OTIF receipts ÷ receipts', '%', 'T-021', 'SV_SUPPLIER_PERFORMANCE.otif_pct', ['DP-04'], ['AG-03']),
  k('K-19', 'Supplier PPM', 'Parts rejected at incoming inspection per million received', 'rejected ÷ received × 1,000,000', 'ppm', 'T-022', 'SV_SUPPLIER_PERFORMANCE.supplier_ppm', ['DP-04'], ['AG-03']),
  k('K-20', 'Supplier lead time', 'Average days from purchase order to receipt', 'mean of receipt date − PO date', 'days', 'T-023', 'SV_SUPPLIER_PERFORMANCE.lead_time_days', ['DP-04'], ['AG-03']),
  k('K-21', 'On-time delivery', 'Customer order lines delivered on or before the promised date', 'on-time lines ÷ delivered lines', '%', 'T-024', 'SV_ORDER_DELIVERY.on_time_delivery_pct', ['DP-05'], ['AG-01']),
  k('K-22', 'Order lead time', 'Average days from customer order to delivery', 'mean of delivery date − order date', 'days', 'T-026', 'SV_ORDER_DELIVERY.order_lead_time_days', ['DP-05'], ['AG-01']),
  k('K-23', 'Order fill rate', 'Delivered order lines shipped complete', 'in-full lines ÷ delivered lines', '%', 'T-025', 'SV_ORDER_DELIVERY.fill_rate_pct', ['DP-05'], ['AG-01']),
  k('K-24', 'Order lines shipped', 'Customer order lines delivered in the month', 'count of delivered order lines', 'lines', 'T-030', 'SV_ORDER_DELIVERY.order_lines_shipped', ['DP-05'], ['AG-01']),
  k('K-25', 'Energy per unit', 'Metered kWh per good unit', 'energy kWh ÷ good units', 'kWh', 'T-027', 'DP_ENERGY_EMISSIONS.kwh_per_unit', ['DP-06'], ['AG-02']),
  k('K-26', 'Scope 2 emissions', 'Location-based emissions from purchased electricity in the quarter', 'sum of kWh × grid factor ÷ 1,000', 'tCO2e', 'T-028', 'DP_ENERGY_EMISSIONS.scope2_tco2e', ['DP-06'], ['AG-02']),
];
