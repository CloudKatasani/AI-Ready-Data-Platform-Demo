import type { Kpi } from '../../types';

const k = (id: string, name: string, definition: string, formula: string, unit: string, termId: string, metric: string, productIds: string[], agentIds: string[]): Kpi =>
  ({ id, name, definition, formula, unit, termId, metric, productIds, agentIds });

export const KPIS: Kpi[] = [
  k('K-01', 'Active loyalty members', 'Harbor Club members with Active status and a purchase in the last 12 months', 'count of members with status Active and a purchase in the last 365 days', 'members', 'T-002', 'SV_CUSTOMER_LOYALTY.active_members', ['DP-01'], ['AG-01']),
  k('K-02', 'Loyalty share of sales', 'Share of net sales identified to a Harbor Club member', 'loyalty-identified net sales ÷ net sales', '%', 'T-009', 'SV_CUSTOMER_LOYALTY.loyalty_share_pct', ['DP-01'], ['AG-01']),
  k('K-03', 'Spend per active member', 'Average 12-month net spend per active member', 'sum of 12-month spend ÷ active members', 'USD', 'T-030', 'SV_CUSTOMER_LOYALTY.avg_spend_per_member', ['DP-01'], ['AG-01']),
  k('K-04', 'Repeat purchase rate', 'Share of active members with purchases on two or more days in 12 months', 'active members with 2+ purchase days ÷ active members', '%', 'T-026', 'SV_CUSTOMER_LOYALTY.repeat_purchase_rate', ['DP-01'], ['AG-01']),
  k('K-05', 'Omnichannel member share', 'Share of active members who bought in store and online', 'omnichannel active members ÷ active members', '%', 'T-027', 'SV_CUSTOMER_LOYALTY.omnichannel_share_pct', ['DP-01'], ['AG-01']),
  k('K-06', 'Comparable store sales %', 'Net sales growth of comparable stores against the same weekday last year', '(TY comp-store net sales ÷ LY net sales of the same stores, 364 days earlier) − 1', '%', 'T-004', 'SV_STORE_SALES.comp_sales_pct', ['DP-02'], ['AG-02']),
  k('K-07', 'Net sales', 'Net sales year to date across stores and e-commerce', 'gross sales − discounts − returns', 'USD', 'T-006', 'SV_STORE_SALES.net_sales', ['DP-02'], ['AG-02']),
  k('K-08', 'Basket size', 'Average net sales per transaction', 'net sales ÷ transactions', 'USD', 'T-007', 'SV_STORE_SALES.basket_size', ['DP-02'], ['AG-02']),
  k('K-09', 'Units per transaction', 'Average units in a sales transaction', 'units ÷ transactions', 'units', 'T-008', 'SV_STORE_SALES.units_per_transaction', ['DP-02'], ['AG-02']),
  k('K-10', 'E-commerce share of sales', 'Share of net sales from web and app orders', 'e-commerce net sales ÷ net sales', '%', 'T-025', 'SV_STORE_SALES.ecommerce_share_pct', ['DP-02'], ['AG-02']),
  k('K-11', 'Discount rate', 'Promotional and markdown discounts as a share of gross sales', 'discounts ÷ gross sales', '%', 'T-028', 'SV_STORE_SALES.discount_rate_pct', ['DP-02'], ['AG-02']),
  k('K-12', 'Sell-through %', 'Share of available units sold in the quarter', 'units sold ÷ (opening on hand + receipts)', '%', 'T-010', 'SV_SUPPLY_CHAIN.sell_through_pct', ['DP-03'], ['AG-03']),
  k('K-13', 'Inventory turns', 'How many times average inventory sells through in a year', 'annualised COGS (13 weeks × 4) ÷ average inventory at cost', 'turns', 'T-011', 'SV_SUPPLY_CHAIN.inventory_turns', ['DP-03'], ['AG-03']),
  k('K-14', 'Out-of-stock rate', 'Share of ranged store-SKUs with zero on hand at the weekly snapshot', 'SKUs out of stock ÷ SKUs ranged', '%', 'T-012', 'SV_SUPPLY_CHAIN.oos_rate_pct', ['DP-03'], ['AG-03']),
  k('K-15', 'Weeks of supply', 'Weeks of stock at the recent rate of sale', 'on-hand units ÷ average weekly units sold (4 weeks)', 'weeks', 'T-013', 'SV_SUPPLY_CHAIN.weeks_of_supply', ['DP-03'], ['AG-03']),
  k('K-16', 'Inventory at cost', 'Store inventory valued at cost at the latest week end', 'sum of on-hand units × unit cost', 'USD', 'T-029', 'SV_SUPPLY_CHAIN.inventory_cost', ['DP-03'], ['AG-03']),
  k('K-17', 'Supplier OTIF %', 'Share of PO lines delivered on time and in full', 'OTIF lines ÷ received lines', '%', 'T-014', 'SV_SUPPLY_CHAIN.otif_pct', ['DP-04'], ['AG-03']),
  k('K-18', 'Fill rate', 'Share of ordered units delivered', 'units received ÷ units ordered', '%', 'T-015', 'SV_SUPPLY_CHAIN.fill_rate_pct', ['DP-04'], ['AG-03']),
  k('K-19', 'Supplier lead time', 'Average days from PO to DC receipt', 'mean of receipt date − PO date', 'days', 'T-016', 'SV_SUPPLY_CHAIN.avg_lead_time_days', ['DP-04'], ['AG-03']),
  k('K-20', 'ASN accuracy', 'Share of PO lines whose advance ship notice matched the receipt', 'matching ASN lines ÷ received lines', '%', 'T-017', 'SV_SUPPLY_CHAIN.asn_accuracy_pct', ['DP-04'], ['AG-03']),
  k('K-21', 'Purchase order spend', 'Merchandise cost received in the last 12 months', 'sum of received line cost', 'USD', 'T-031', 'SV_SUPPLY_CHAIN.po_spend', ['DP-04'], ['AG-03']),
  k('K-22', 'Promotion ROI', 'Incremental gross margin per dollar of Harbor & Pine-funded discount', 'incremental margin ÷ promotion cost', 'ratio', 'T-020', 'SV_PROMO_EFFECTIVENESS.promo_roi', ['DP-05'], ['AG-01']),
  k('K-23', 'Promotional lift', 'Promoted-item sales above the modelled baseline', '(promoted net sales − baseline) ÷ baseline', '%', 'T-019', 'SV_PROMO_EFFECTIVENESS.promo_lift_pct', ['DP-05'], ['AG-01']),
  k('K-24', 'Redemption rate', 'Share of offers issued that were redeemed', 'redemptions ÷ offers issued', '%', 'T-021', 'SV_PROMO_EFFECTIVENESS.redemption_rate_pct', ['DP-05'], ['AG-01']),
  k('K-25', 'Predicted customer lifetime value', 'Average predicted 3-year value of an active member (draft model)', 'mean predicted CLV of active members', 'USD', 'T-024', 'SV_CUSTOMER_LOYALTY.avg_predicted_clv', ['DP-01'], ['AG-01']),
  k('K-26', 'Return rate', 'Returned sales as a share of gross sales', 'returns ÷ gross sales', '%', 'T-022', 'DP_RETURNS_FRAUD.return_rate_pct', ['DP-06'], ['AG-02']),
  k('K-27', 'Suspicious return rate', 'Share of returns flagged for loss-prevention review', 'suspicious returns ÷ returns', '%', 'T-023', 'DP_RETURNS_FRAUD.suspicious_return_pct', ['DP-06'], ['AG-02']),
];
