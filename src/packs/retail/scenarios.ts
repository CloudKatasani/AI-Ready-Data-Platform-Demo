// The 15 Harbor & Pine agent scenarios (spec section 9). Every number is computed from the in-memory sample.
import type { GlossaryTerm, IndustryPack, Persona, Scenario } from '../../types';
import { round, sum } from '../../mock-snowflake/generators';
import { maskFor } from '../../mock-snowflake/policies';
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtUsd } from '../../lib/format';
import type { RetailData } from './data';
import * as Q from './queries';

const DB = 'HPR_AI_PLATFORM';
const allowedRegions = (p: Persona) => (p.rowFilter?.column === 'REGION' ? p.rowFilter.allowed : undefined);
const rowNote = (p: Persona) => (allowedRegions(p) ? ` Row access policy limited results to the ${allowedRegions(p)!.join(' and ')} regions.` : '');
const regionWhere = (p: Persona, col = 'region') => (allowedRegions(p) ? `\n  -- RAP_REGION_ACCESS applied by Snowflake: ${col} IN (${allowedRegions(p)!.map((o) => `'${o}'`).join(', ')})` : '');
const short = (d: string) => d.slice(5).replace('-', '/');

type PackLike = Pick<IndustryPack, 'glossary' | 'products' | 'agents' | 'semanticViews' | 'certificationScript' | 'context'>;

export function buildScenarios(d: RetailData, packRef: () => PackLike): Scenario[] {
  return [
    {
      id: 'S-01', agentId: 'AG-01', pattern: 1, productIds: ['DP-01'], kpiIds: ['K-02'],
      question: 'What was the loyalty share of sales by region last quarter?',
      paraphrases: ['loyalty share of sales by region in Q3', 'member share of sales per region last quarter', 'loyalty penetration by region last quarter'],
      terms: [{ text: 'loyalty share of sales', termId: 'T-009' }, { text: 'region', termId: 'T-003' }],
      ruleIds: ['BR-002'], instruction: 'Percentages to one decimal; name the period and regions.',
      semantic: { view: 'SV_CUSTOMER_LOYALTY', metrics: ['loyalty_share_pct'], dimensions: ['store.region'], filters: ["sales_date BETWEEN '2026-07-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.loyaltyShareByRegion(d, Q.PERIODS.quarter, allow);
        const top = [...r.rows].sort((a, b) => b.pct - a.pct)[0];
        return {
          summary: `In Q3 2026 (Jul–Sep), ${fmtPct(r.pct)} of net sales were identified to a Harbor Club member${allow ? ' in your regions' : ''}: ${fmtCompact(sum(r.rows.map((x) => x.loyalty)), 'USD')} of ${fmtCompact(r.net, 'USD')}. ${top.region} had the highest loyalty share at ${fmtPct(top.pct)}.${rowNote(persona)}`,
          table: { columns: ['Region', 'Loyalty share', 'Loyalty sales', 'Net sales'], rows: r.rows.map((x) => [x.region, fmtPct(x.pct), fmtCompact(x.loyalty, 'USD'), fmtCompact(x.net, 'USD')]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.region), values: r.rows.map((x) => x.pct), unit: '%' },
          sql: `SELECT store.region,\n       SUM(sales.loyalty_sales) / SUM(sales.net_sales) * 100 AS loyalty_share_pct  -- BR-002\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE -- via SV_CUSTOMER_LOYALTY\n WHERE sales_date BETWEEN '2026-07-01' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY store.region\n ORDER BY loyalty_share_pct DESC;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-02': r.pct },
        };
      },
    },
    {
      id: 'S-02', agentId: 'AG-01', pattern: 2, productIds: ['DP-01'], kpiIds: ['K-01', 'K-05'],
      question: 'How many active loyalty members are omnichannel shoppers?',
      paraphrases: ['active members who shop in store and online', 'how many active loyalty members are omnichannel', 'omnichannel share of active members', 'count of active members buying across channels'],
      terms: [{ text: 'active loyalty members', termId: 'T-002' }, { text: 'omnichannel', termId: 'T-027' }],
      ruleIds: ['BR-001'], instruction: 'State which members count as active.',
      semantic: { view: 'SV_CUSTOMER_LOYALTY', metrics: ['active_members', 'omnichannel_share_pct'], dimensions: ['member.tier'], filters: ['Active Member rule BR-001'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const m = Q.memberSummary(d, allow);
        return {
          summary: `${fmtCompact(m.omni)} active Harbor Club members are omnichannel shoppers — ${fmtPct(m.omniPct)} of ${fmtCompact(m.active)} active members. "Active" follows rule BR-001: Active status and a purchase in the last 12 months, which excludes ${fmtCompact(m.lapsed)} open accounts with no recent purchase. Elite members are the most omnichannel (${fmtPct(m.byTier[0].omniPct)}).${rowNote(persona)}`,
          table: { columns: ['Tier', 'Active members', 'Omnichannel share'], rows: [...m.byTier.map((t) => [t.tier, fmtInt(t.active), fmtPct(t.omniPct)]), ['All tiers', fmtInt(m.active), fmtPct(m.omniPct)]] },
          chart: { kind: 'bar', labels: ['Omnichannel', 'Single channel'], values: [m.omni, m.active - m.omni], unit: 'members' },
          sql: `SELECT tier, COUNT(*) AS active_members,\n       AVG(IFF(is_omnichannel, 1, 0)) * 100 AS omnichannel_share_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_LOYALTY_360\n WHERE is_active  -- BR-001: status = 'Active' AND last purchase > CURRENT_DATE - 365${regionWhere(persona)}\n GROUP BY ROLLUP (tier);`,
          rows: m.byTier.length + 1, rowFiltered: Boolean(allow), note: `Sample of ${fmtInt(m.sampleActive)} active members scaled ×${fmtNum(d.memberScale, 0)} to the 5.2 M member base.`,
          kpiValues: allow ? undefined : { 'K-01': m.active, 'K-05': m.omniPct, 'K-04': m.repeatPct, 'K-03': m.avgSpend, 'K-25': m.avgClv },
        };
      },
    },
    {
      id: 'S-03', agentId: 'AG-01', pattern: 3, productIds: ['DP-01'], kpiIds: ['K-03'],
      question: 'Which Elite members have not purchased in the last 90 days?',
      paraphrases: ['lapsing Elite members with no purchase in 90 days', 'list Elite members who have not bought in the last 90 days', 'Elite loyalty members inactive for 90 days'],
      terms: [{ text: 'Elite members', termId: 'T-001' }, { text: 'purchased', termId: 'T-030' }],
      ruleIds: ['BR-004', 'BR-001'], instruction: 'Never reveal PII unless the role may see it.',
      semantic: { view: 'SV_CUSTOMER_LOYALTY', metrics: ['avg_spend_per_member'], dimensions: ['member.member_id', 'member.member_name', 'member.home_region'], filters: ["tier = 'Elite'", 'last_purchase_date < CURRENT_DATE - 90', 'active member'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const list = Q.lapsingElite(d, allow);
        const masked = !persona.unmasked.includes('PII');
        const shown = list.slice(0, 8);
        return {
          summary: `${list.length} active Elite members in the sample have not purchased in the last 90 days (≈ ${fmtCompact(list.length * d.memberScale)} across the programme). Together they spent ${fmtUsd(sum(list.map((m) => m.spend12m)), 0)} in the last 12 months; the ${shown.length} highest spenders are listed.${masked ? ' Names and emails are masked by MP_MASK_PII for your role.' : ''}${rowNote(persona)}`,
          table: {
            columns: ['Member ID', 'Name', 'Email', 'Region', 'Last purchase', '12-month spend'],
            rows: shown.map((m) => [String(maskFor(persona, 'PII', m.id)), String(maskFor(persona, 'PII', `${m.first} ${m.last}`)), String(maskFor(persona, 'PII', m.email)), m.region, m.lastPurchase, fmtUsd(m.spend12m)]),
            masked: masked ? [0, 1, 2] : [],
          },
          sql: `SELECT member_id, member_name, email, region, last_purchase_date, spend_12m_usd\n  FROM ${DB}.DATA_PRODUCTS.DP_CUSTOMER_LOYALTY_360\n WHERE tier = 'Elite' AND is_active          -- BR-001\n   AND last_purchase_date < CURRENT_DATE - 90  -- BR-004${regionWhere(persona)}\n ORDER BY spend_12m_usd DESC\n LIMIT 8;`,
          rows: shown.length, maskedColumns: masked ? ['MEMBER_ID', 'MEMBER_NAME', 'EMAIL'] : [], rowFiltered: Boolean(allow), explorerTarget: 'DATA_PRODUCTS.DP_CUSTOMER_LOYALTY_360',
        };
      },
    },
    {
      id: 'S-04', agentId: 'AG-01', pattern: 4, productIds: ['DP-05'], kpiIds: ['K-22'],
      question: 'What was the ROI of each promotion last quarter?',
      paraphrases: ['promotion ROI last quarter', 'return on each promotion in Q3', 'which promotions paid back last quarter', 'promo ROI by promotion'],
      terms: [{ text: 'ROI', termId: 'T-020' }, { text: 'promotion', termId: 'T-018' }],
      ruleIds: ['BR-010'], instruction: 'ROI to two decimals; show lift and redemption alongside.',
      semantic: { view: 'SV_PROMO_EFFECTIVENESS', metrics: ['promo_roi', 'promo_lift_pct', 'redemption_rate_pct'], dimensions: ['promo.promo_name'], filters: ["fiscal_quarter = '2026-Q3'"] },
      doc: { docId: 'DOC-01', chunk: 15 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.promoEffectiveness(d, Q.PERIODS.quarter.months, allow);
        const rows = [...r.rows].sort((a, b) => b.roi - a.roi);
        const under = rows.filter((x) => x.roi < 1);
        return {
          summary: `Across Q3 2026 promotions, every $1 of Harbor & Pine-funded discount returned $${fmtNum(r.roi, 2)} of incremental margin (lift over baseline ${fmtPct(r.liftPct)}). ${rows[0].name} paid back best at ${fmtNum(rows[0].roi, 2)}×; ${under.length ? `${under.map((x) => x.name).join(', ')} returned less than $1 per $1 of discount.` : 'every promotion paid back.'}${rowNote(persona)}`,
          table: { columns: ['Promotion', 'ROI', 'Lift over baseline', 'Redemption rate', 'Promotion cost'], rows: rows.map((x) => [x.name, fmtNum(x.roi, 2), fmtPct(x.liftPct), fmtPct(x.redemptionPct), fmtCompact(x.cost, 'USD')]) },
          chart: { kind: 'bar', labels: rows.map((x) => x.name), values: rows.map((x) => x.roi), unit: '×' },
          sql: `SELECT promo_name,\n       SUM(incremental_margin_usd) / SUM(promo_cost_usd) AS promo_roi  -- BR-010\n  FROM ${DB}.DATA_PRODUCTS.DP_PROMOTION_EFFECTIVENESS\n WHERE sale_date BETWEEN '2026-07-01' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY promo_name\n ORDER BY promo_roi DESC;`,
          rows: rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-22': r.roi, 'K-23': r.liftPct, 'K-24': r.redemptionPct },
        };
      },
    },
    {
      id: 'S-05', agentId: 'AG-01', pattern: 5, productIds: ['DP-02'], kpiIds: [],
      question: 'Show daily loyalty sales for the last 30 days',
      paraphrases: ['daily loyalty sales trend for the past 30 days', 'loyalty sales by day over the last 30 days', 'trend of member sales per day for 30 days'],
      terms: [{ text: 'loyalty sales', termId: 'T-009' }],
      ruleIds: ['BR-002'],
      semantic: { view: 'SV_CUSTOMER_LOYALTY', metrics: ['loyalty_share_pct'], dimensions: ['date.sales_date'], filters: ["sales_date BETWEEN '2026-09-01' AND '2026-09-30'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.dailyLoyaltySales(d, allow);
        const peak = r.days.reduce((a, b) => (b.loyalty > a.loyalty ? b : a));
        const promos = d.promos.filter((p) => peak.day >= p.from && peak.day <= p.to && (!allow || p.regions.some((x) => allow.includes(x))));
        return {
          summary: `Over the last 30 days (1–30 Sep 2026) Harbor Club members generated ${fmtCompact(r.total, 'USD')} of net sales${allow ? ' in your regions' : ''}, ${fmtPct(r.pct)} of the total. The peak day was ${peak.day} (${fmtCompact(peak.loyalty, 'USD')})${promos.length ? `, during ${promos.map((p) => p.name).join(' and ')}` : ''}; weekends run well above weekdays.${rowNote(persona)}`,
          table: { columns: ['Date', 'Loyalty sales', 'Net sales', 'Loyalty share'], rows: r.days.slice(-10).map((x) => [x.day, fmtCompact(x.loyalty, 'USD'), fmtCompact(x.net, 'USD'), fmtPct(x.pct)]) },
          chart: { kind: 'line', labels: r.days.map((x) => short(x.day)), values: r.days.map((x) => round(x.loyalty / 1e6, 2)), unit: '$M' },
          sql: `SELECT sales_date, SUM(loyalty_sales_usd) AS loyalty_sales, SUM(net_sales_usd) AS net_sales\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE\n WHERE sales_date BETWEEN '2026-09-01' AND '2026-09-30'  -- BR-002 member identified${regionWhere(persona)}\n GROUP BY 1 ORDER BY 1;`,
          rows: r.days.length, rowFiltered: Boolean(allow), explorerTarget: 'CONFORMED_GOLD.FCT_SALES',
        };
      },
    },
    {
      id: 'S-06', agentId: 'AG-02', pattern: 6, productIds: ['DP-02'], kpiIds: ['K-06'],
      question: 'Which promotions lifted comparable sales above 5% last quarter?',
      paraphrases: ['promotions that lifted comp sales above 5% in Q3', 'comparable store sales by promotion last quarter', 'which promos drove comps over 5 percent last quarter', 'comp sales during each promotion in Q3'],
      terms: [{ text: 'comparable sales', termId: 'T-004' }, { text: 'promotions', termId: 'T-018' }, { text: 'comparable store', termId: 'T-005' }],
      ruleIds: ['BR-006', 'BR-009'], instruction: 'Comp stores only, against the same weekday last year; percentages to one decimal.',
      semantic: { view: 'SV_STORE_SALES', metrics: ['comp_sales_pct'], dimensions: ['promo.promo_name'], filters: ['is_comp_store = TRUE (BR-006)', "sales_date BETWEEN '2026-07-01' AND '2026-09-30'", 'LY = same weekday 364 days earlier'] },
      doc: { docId: 'DOC-01', chunk: 9 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const rows = Q.compByPromotion(d, allow);
        const lifted = rows.filter((x) => x.pct > 5).sort((a, b) => b.pct - a.pct);
        const q3 = Q.compSales(d, Q.PERIODS.quarter, allow);
        const base = Q.compStoreCount(d, '2026-09', allow);
        return {
          summary: `${lifted.length} of ${rows.length} Q3 2026 promotions lifted comparable store sales above 5%: ${lifted.map((x) => `${x.name} (${fmtPct(x.pct)})`).join(', ')}. ${rows.filter((x) => x.pct <= 5).map((x) => x.name).join(', ')} stayed at or below 5%${rows.some((x) => x.name === 'Labor Day Weekend Sale' && x.pct <= 5) ? ' — Labor Day lapped a strong event last year' : ''}. Comp sales for the whole quarter were ${fmtPct(q3.pct)}. Comparable stores are open 13+ months with remodels excluded (BR-006): ${fmtInt(base.comp)} of ${fmtInt(base.open)} open stores in September.${rowNote(persona)}`,
          table: { columns: ['Promotion', 'Window', 'Regions', 'Comp sales %', 'TY comp sales', 'LY same days'], rows: [...rows].sort((a, b) => b.pct - a.pct).map((x) => [x.name, `${short(x.from)}–${short(x.to)}`, x.regions.length === 4 ? 'All' : x.regions.join(', '), fmtPct(x.pct), fmtCompact(x.ty, 'USD'), fmtCompact(x.ly, 'USD')]) },
          chart: { kind: 'bar', labels: rows.map((x) => x.name), values: rows.map((x) => x.pct), unit: '%' },
          sql: `SELECT promo.promo_name,\n       SUM(ty.net_sales_usd) / SUM(ly.net_sales_usd) * 100 - 100 AS comp_sales_pct\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE ty\n  JOIN ${DB}.CONFORMED_GOLD.DIM_DATE dt ON dt.calendar_date = ty.sales_date\n  JOIN ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE ly\n    ON ly.store_id = ty.store_id AND ly.channel = ty.channel\n   AND ly.sales_date = dt.same_day_last_year     -- same weekday, 364 days earlier\n WHERE ty.sales_date BETWEEN '2026-07-01' AND '2026-09-30'\n   AND ty.is_comp_store                         -- BR-006: open 13+ months, remodels excluded\n   AND ty.promo_id IS NOT NULL${regionWhere(persona, 'ty.region')}\n GROUP BY promo.promo_name\nHAVING comp_sales_pct > 5                          -- BR-009\n ORDER BY comp_sales_pct DESC;`,
          rows: rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-06': round(q3.pct, 1) }, explorerTarget: 'DATA_PRODUCTS.DP_SALES_PERFORMANCE',
        };
      },
    },
    {
      id: 'S-07', agentId: 'AG-02', pattern: 7, productIds: ['DP-02'], kpiIds: ['K-07'],
      question: 'Top 5 stores by net sales last week',
      paraphrases: ['best stores by sales last week', 'which stores sold the most last week', 'top five stores by net sales'],
      terms: [{ text: 'net sales', termId: 'T-006' }],
      ruleIds: ['BR-005', 'BR-008'],
      semantic: { view: 'SV_STORE_SALES', metrics: ['net_sales', 'basket_size'], dimensions: ['store.store_name', 'store.region'], filters: ["sales_date BETWEEN '2026-09-21' AND '2026-09-27'"] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const top = Q.topStoresByNetSales(d, Q.PERIODS.lastWeek, 5, allow);
        return {
          summary: `Last week (Mon 21 – Sun 27 Sep 2026) ${top[0].store.name} (${top[0].store.id}, ${top[0].store.format}, ${top[0].store.region}) led with ${fmtUsd(top[0].net, 0)} of net sales, including e-commerce orders attributed to the store (BR-008). The top five together took ${fmtUsd(sum(top.map((x) => x.net)), 0)}.${rowNote(persona)}`,
          table: { columns: ['Store', 'Store ID', 'Region', 'Format', 'Net sales', 'Basket size', 'E-commerce share'], rows: top.map((x) => [x.store.name, x.store.id, x.store.region, x.store.format, fmtUsd(x.net, 0), fmtUsd(x.basket), fmtPct(x.ecomPct)]) },
          chart: { kind: 'bar', labels: top.map((x) => x.store.name), values: top.map((x) => round(x.net / 1000, 1)), unit: '$K' },
          sql: `SELECT store_id, store_name, region, SUM(net_sales_usd) AS net_sales,\n       SUM(net_sales_usd) / SUM(transactions) AS basket_size\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE\n WHERE sales_date BETWEEN '2026-09-21' AND '2026-09-27'${regionWhere(persona)}\n GROUP BY 1, 2, 3\n ORDER BY net_sales DESC\n LIMIT 5;`,
          rows: top.length, rowFiltered: Boolean(allow), explorerTarget: 'CONFORMED_GOLD.DIM_STORE',
        };
      },
    },
    {
      id: 'S-08', agentId: 'AG-02', pattern: 8, productIds: ['DP-02', 'DP-06'], kpiIds: ['K-26', 'K-27'],
      question: 'What is the return rate by region this quarter, and how many returns were flagged as suspicious?',
      paraphrases: ['return rate by region and suspicious returns', 'how many returns were flagged as suspicious this quarter', 'returns and return fraud by region', 'return rate this quarter'],
      terms: [{ text: 'return rate', termId: 'T-022' }, { text: 'suspicious', termId: 'T-023' }],
      ruleIds: ['BR-016', 'BR-017'],
      semantic: { view: 'SV_STORE_SALES', metrics: ['net_sales'], dimensions: ['store.region'], filters: ["sales_date BETWEEN '2026-07-01' AND '2026-09-30'"] },
      doc: { docId: 'DOC-02', chunk: 6 },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.returnsByRegion(d, allow);
        return {
          summary: `In Q3 2026 the return rate was ${fmtPct(r.returnPct)} of gross sales${allow ? ' in your regions' : ''}. ${fmtPct(r.suspiciousPct)} of returns (${r.suspicious} in the sample, ≈ ${fmtCompact(r.suspiciousScaled)} chain-wide) were flagged as suspicious under BR-017: ${r.byReason.map((x) => `${x.n} ${x.reason.toLowerCase()}`).join(', ')}. The flag counts come from Returns & Fraud, which is a Draft product; flags are for review, not findings of fraud.${rowNote(persona)}`,
          table: { columns: ['Region', 'Return rate', 'Returns (sample)', 'Suspicious', 'Suspicious %', 'No receipt %'], rows: r.rows.map((x) => [x.region, fmtPct(x.returnPct), x.returns, x.suspicious, fmtPct(x.suspiciousPct), fmtPct(x.noReceiptPct)]) },
          chart: { kind: 'bar', labels: r.rows.map((x) => x.region), values: r.rows.map((x) => x.suspiciousPct), unit: '% suspicious' },
          sql: `SELECT region, SUM(returns_usd) / SUM(gross_sales_usd) * 100 AS return_rate_pct  -- BR-016\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE\n WHERE sales_date BETWEEN '2026-07-01' AND '2026-09-30'${regionWhere(persona)}\n GROUP BY region;\n\nSELECT region, COUNT(*) AS returns, COUNT_IF(is_suspicious) AS suspicious  -- BR-017\n  FROM ${DB}.DATA_PRODUCTS.DP_RETURNS_FRAUD  -- DRAFT, not certified\n WHERE return_date BETWEEN '2026-07-01' AND '2026-09-30'\n GROUP BY region;`,
          rows: r.rows.length, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-26': r.returnPct, 'K-27': r.suspiciousPct },
        };
      },
    },
    {
      id: 'S-09', agentId: 'AG-02', pattern: 9, productIds: ['DP-02'], kpiIds: ['K-08', 'K-09'],
      question: 'Compare basket size this quarter with the same quarter last year',
      paraphrases: ['basket size Q3 2026 vs Q3 2025', 'average transaction value this quarter versus last year', 'how has basket size changed year over year'],
      terms: [{ text: 'basket size', termId: 'T-007' }],
      ruleIds: ['BR-007'], instruction: 'Compare like-for-like quarters; currency to the cent.',
      semantic: { view: 'SV_STORE_SALES', metrics: ['basket_size', 'units_per_transaction'], dimensions: ['date.fiscal_year', 'store.region'], filters: ['Jul–Sep of 2025 and 2026'] },
      run: ({ persona }) => {
        const allow = allowedRegions(persona);
        const r = Q.basketComparison(d, allow);
        return {
          summary: `Basket size in Q3 2026 was ${fmtUsd(r.cur.basket)}, compared with ${fmtUsd(r.prev.basket)} in Q3 2025 — ${r.chg >= 0 ? 'up' : 'down'} ${fmtPct(Math.abs(r.chg))}. Units per transaction moved from ${fmtNum(r.prev.upt, 2)} to ${fmtNum(r.cur.upt, 2)}, so the gain comes from price and mix rather than more items.${rowNote(persona)}`,
          table: { columns: ['Region', 'Basket Q3 2025', 'Basket Q3 2026', 'Change'], rows: r.regions.map((x) => [x.region, fmtUsd(x.prev), fmtUsd(x.cur), fmtPct(x.chg)]) },
          chart: { kind: 'bar', labels: ['Q3 2025', 'Q3 2026'], values: [r.prev.basket, r.cur.basket], unit: 'USD' },
          sql: `SELECT YEAR(sales_date) AS fiscal_year, region,\n       SUM(net_sales_usd) / SUM(transactions) AS basket_size,  -- BR-007\n       SUM(units) / SUM(transactions) AS units_per_transaction\n  FROM ${DB}.DATA_PRODUCTS.DP_SALES_PERFORMANCE\n WHERE MONTH(sales_date) BETWEEN 7 AND 9 AND YEAR(sales_date) IN (2025, 2026)${regionWhere(persona)}\n GROUP BY 1, 2;`,
          rows: r.regions.length * 2, rowFiltered: Boolean(allow), kpiValues: allow ? undefined : { 'K-08': r.cur.basket, 'K-09': r.cur.upt, 'K-10': r.cur.ecomPct, 'K-11': r.cur.discountPct },
        };
      },
    },
    {
      id: 'S-10', agentId: 'AG-03', pattern: 10, productIds: ['DP-03'], kpiIds: ['K-12'],
      question: 'What is our sell-through rate this quarter?',
      paraphrases: ['sell-through this quarter', 'q3 sell through rate', 'how much of our available stock did we sell this quarter'],
      terms: [{ text: 'sell-through', termId: 'T-010' }],
      ruleIds: ['BR-011', 'BR-013'],
      semantic: { view: 'SV_SUPPLY_CHAIN', metrics: ['sell_through_pct'], dimensions: ['inv.category'], filters: ["week_ending BETWEEN '2026-07-01' AND '2026-09-30'"] },
      doc: { docId: 'DOC-03', chunk: 3 },
      run: () => {
        const r = Q.sellThrough(d);
        const inv = Q.inventoryHealth(d);
        const rows = [...r.rows].sort((a, b) => b.pct - a.pct);
        return {
          summary: `Sell-through for Q3 2026 (13 weeks to 27 Sep) is ${fmtPct(r.pct)}: units sold divided by opening on-hand units plus receipts (BR-011). ${rows[0].category} sold through fastest at ${fmtPct(rows[0].pct)}; ${rows[rows.length - 1].category} is lowest at ${fmtPct(rows[rows.length - 1].pct)}. Inventory is turning ${fmtNum(inv.turns, 2)} times a year.`,
          table: { columns: ['Category', 'Sell-through', 'Units sold (scaled)'], rows: rows.map((x) => [x.category, fmtPct(x.pct), fmtCompact(x.sold)]) },
          chart: { kind: 'bar', labels: rows.map((x) => x.category), values: rows.map((x) => x.pct), unit: '%' },
          sql: `SELECT category,\n       SUM(units_sold) / (SUM(IFF(week_ending = '2026-07-05', begin_on_hand_units, 0)) + SUM(units_received)) * 100 AS sell_through_pct  -- BR-011\n  FROM ${DB}.CONFORMED_GOLD.FCT_INVENTORY -- via DP_INVENTORY_HEALTH\n WHERE week_ending BETWEEN '2026-07-05' AND '2026-09-27'\n GROUP BY category\n ORDER BY sell_through_pct DESC;`,
          rows: rows.length, kpiValues: { 'K-12': r.pct, 'K-13': inv.turns },
        };
      },
    },
    {
      id: 'S-11', agentId: 'AG-03', pattern: 11, productIds: ['DP-04'], kpiIds: ['K-17'],
      question: 'Which suppliers have OTIF below 90%?',
      paraphrases: ['suppliers under 90 percent on time in full', 'late suppliers below 90% OTIF', 'vendors with poor delivery performance'],
      terms: [{ text: 'OTIF', termId: 'T-014' }],
      ruleIds: ['BR-014', 'BR-015'],
      semantic: { view: 'SV_SUPPLY_CHAIN', metrics: ['otif_pct', 'fill_rate_pct'], dimensions: ['supplier.supplier_name'], filters: ['otif_pct < 90'] },
      doc: { docId: 'DOC-04', chunk: 8 },
      run: () => {
        const all = Q.supplierPerformance(d);
        const below = all.filter((s) => s.otifPct < 90);
        const t = Q.supplierTotals(d);
        return {
          summary: `${below.length} suppliers are below 90% OTIF over the last 12 months: ${below.map((s) => `${s.supplier} (${fmtPct(s.otifPct)})`).join(', ')}. Under rule BR-015 they go on a corrective action plan with chargebacks. Overall OTIF is ${fmtPct(t.otifPct)} and fill rate ${fmtPct(t.fillPct)}.`,
          table: { columns: ['Supplier', 'Category', 'OTIF %', 'Fill rate', 'PO lines', 'Lead time (days)'], rows: below.map((s) => [s.supplier, s.category, fmtPct(s.otifPct), fmtPct(s.fillPct), s.lines, fmtNum(s.leadDays, 1)]) },
          chart: { kind: 'bar', labels: all.map((s) => s.supplier.split(' ')[0]), values: all.map((s) => s.otifPct), unit: '%' },
          sql: `SELECT supplier_name, AVG(IFF(otif_flag, 1, 0)) * 100 AS otif_pct,  -- BR-014\n       SUM(received_units) / SUM(ordered_units) * 100 AS fill_rate_pct, COUNT(*) AS po_lines\n  FROM ${DB}.DATA_PRODUCTS.DP_SUPPLIER_PERFORMANCE\n GROUP BY supplier_name\nHAVING otif_pct < 90\n ORDER BY otif_pct;`,
          rows: below.length, kpiValues: { 'K-17': t.otifPct, 'K-18': t.fillPct, 'K-19': t.leadDays, 'K-20': t.asnPct },
          explorerTarget: 'CONFORMED_GOLD.DIM_SUPPLIER',
        };
      },
    },
    {
      id: 'S-12', agentId: 'AG-03', pattern: 12, productIds: ['DP-03'], kpiIds: ['K-14'],
      question: 'What is the out-of-stock rate by category last week?',
      paraphrases: ['out of stock rate by category', 'stockouts by category last week', 'OOS rate per category for last week'],
      terms: [{ text: 'out-of-stock', termId: 'T-012' }],
      ruleIds: ['BR-012'],
      semantic: { view: 'SV_SUPPLY_CHAIN', metrics: ['oos_rate_pct', 'weeks_of_supply'], dimensions: ['inv.category'], filters: ["week_ending = '2026-09-27'"] },
      doc: { docId: 'DOC-03', chunk: 11 },
      run: () => {
        const inv = Q.inventoryHealth(d);
        const rows = [...inv.rows].sort((a, b) => b.oosPct - a.oosPct);
        return {
          summary: `At the Sunday 27 Sep 2026 snapshot, ${fmtPct(inv.oosPct)} of ranged store-SKUs were out of stock. Out-of-stock means ranged on the planogram with zero units on hand (term T-012, rule BR-012). ${rows[0].category} is worst at ${fmtPct(rows[0].oosPct)} with only ${fmtNum(rows[0].wos, 1)} weeks of supply; overall weeks of supply is ${fmtNum(inv.wos, 1)}.`,
          table: { columns: ['Category', 'Out-of-stock rate', 'SKUs out (sample)', 'Weeks of supply', 'Inventory at cost'], rows: rows.map((x) => [x.category, fmtPct(x.oosPct), fmtInt(x.oos), fmtNum(x.wos, 1), fmtCompact(x.costUsd, 'USD')]) },
          chart: { kind: 'bar', labels: rows.map((x) => x.category), values: rows.map((x) => x.oosPct), unit: '%' },
          sql: `SELECT category, SUM(skus_out_of_stock) / SUM(skus_ranged) * 100 AS oos_rate_pct  -- T-012 / BR-012\n  FROM ${DB}.DATA_PRODUCTS.DP_INVENTORY_HEALTH\n WHERE week_ending = '2026-09-27'\n GROUP BY category\n ORDER BY oos_rate_pct DESC;`,
          rows: rows.length, kpiValues: { 'K-14': inv.oosPct, 'K-15': inv.wos, 'K-16': inv.costUsd },
        };
      },
    },
    {
      id: 'S-13', agentId: 'AG-04', pattern: 13, productIds: [], kpiIds: [],
      question: 'Which critical data elements lack a steward?',
      paraphrases: ['cdes without a steward', 'unowned critical data elements', 'which CDEs have no steward assigned'],
      terms: [],
      ruleIds: [],
      run: () => {
        const p = packRef();
        const gaps = p.glossary.filter((t) => t.isCde && !t.steward);
        const draft = p.glossary.filter((t) => t.status === 'Draft');
        return {
          summary: `${gaps.length} critical data element${gaps.length === 1 ? '' : 's'} ${gaps.length === 1 ? 'has' : 'have'} no steward: ${gaps.map((t) => `${t.term} (${t.id}, owner ${t.owner})`).join(', ')}. It feeds the Draft product Returns & Fraud. Also note ${draft.length} Draft term: ${draft.map((t) => t.term).join(', ')}.`,
          table: { columns: ['Term', 'Id', 'Domain', 'Owner', 'Steward', 'Next action'], rows: gaps.map((t) => [t.term, t.id, t.domain, t.owner, '— none —', 'Assign a store-operations steward before DP-06 enters certification']) },
          sql: `SELECT t.term_id, t.term, t.domain, t.owner\n  FROM ${DB}.GLOSSARY.BUSINESS_TERM t\n  JOIN ${DB}.GLOSSARY.CDE_REGISTER c USING (term_id)\n WHERE t.is_cde AND c.steward IS NULL;`,
          rows: gaps.length, explorerTarget: 'GLOSSARY.CDE_REGISTER',
        };
      },
    },
    {
      id: 'S-14', agentId: 'AG-04', pattern: 14, productIds: [], kpiIds: [],
      question: 'Where is the term Active Member used?',
      paraphrases: ['lineage of active member', 'what uses the active member definition', 'where does active member appear'],
      terms: [{ text: 'Active Member', termId: 'T-002' }],
      ruleIds: ['BR-001'],
      run: () => {
        const p = packRef();
        const t = p.glossary.find((x) => x.id === 'T-002') as GlossaryTerm;
        const metrics = t.metricRefs;
        const products = p.products.filter((pr) => pr.semanticView && metrics.some((m) => m.startsWith(pr.semanticView!)) && pr.kpiIds.includes('K-01'));
        const agents = p.agents.filter((a) => a.productIds.some((x) => products.some((pr) => pr.id === x)));
        return {
          summary: `"Active Member" (T-002) is mapped to ${t.mappings.length} columns, defines the metric ${metrics.join(', ')}, is enforced by rule BR-001, and flows into ${products.map((x) => `${x.name} (${x.id})`).join(', ')} and the ${agents.map((a) => a.name).join(', ')} agent.`,
          table: { columns: ['Layer', 'Object', 'Usage'], rows: [
            ...t.mappings.map((m) => ['Column', `${m.fqn}.${m.column}`, m.kind]),
            ...metrics.map((m) => ['Semantic metric', m, 'defines']),
            ['Context rule', 'BR-001', 'business rule'],
            ...products.map((x) => ['Data product', `${x.id} ${x.name}`, 'KPI K-01']),
            ...agents.map((a) => ['Agent', a.objectName, 'answers with it']),
          ] },
          sql: `SELECT 'column' AS kind, object_fqn || '.' || column_name AS ref\n  FROM ${DB}.GLOSSARY.TERM_COLUMN_MAP WHERE term_id = 'T-002'\nUNION ALL\nSELECT 'rule', rule_id FROM ${DB}.CONTEXT.BUSINESS_RULES WHERE applies_to_metric ILIKE '%active_members%'\nUNION ALL\nSELECT 'product', product_id FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY WHERE semantic_view = 'SV_CUSTOMER_LOYALTY';`,
          rows: t.mappings.length + metrics.length + products.length + agents.length + 1, explorerTarget: 'GLOSSARY.TERM_COLUMN_MAP',
        };
      },
    },
    {
      id: 'S-15', agentId: 'AG-04', pattern: 15, productIds: [], kpiIds: [],
      question: 'Which data products are not yet certified, and what is blocking them?',
      paraphrases: ['uncertified products and blockers', 'what is blocking certification', 'which products are still in certification or draft'],
      terms: [],
      ruleIds: [],
      run: ({ live }) => {
        const p = packRef();
        const script = p.certificationScript;
        const pending = p.products.filter((x) => (live.productStatus[x.id] ?? x.status) !== 'Certified');
        const blockers = (id: string): string => {
          if (id === script.productId) {
            const fixed = live.fixes[id] ?? [];
            const open = script.failures.filter((f) => !fixed.includes(f.checkId));
            return open.length ? open.map((f) => `Gate ${f.gate}: ${f.detail}`).join('; ') : 'All gates pass — awaiting steward sign-off (Certify & publish)';
          }
          const prod = p.products.find((x) => x.id === id)!;
          return `${prod.steward ? '' : 'Gate 1: no steward assigned; '}no semantic view; gates 3–8 not started`;
        };
        return {
          summary: pending.length
            ? `${pending.length} data product${pending.length > 1 ? 's are' : ' is'} not yet certified: ${pending.map((x) => `${x.name} (${live.productStatus[x.id] ?? x.status})`).join(' and ')}. ${pending.some((x) => x.id === script.productId) ? `${p.products.find((x) => x.id === script.productId)!.name} is the closest to certification.` : ''}`
            : 'Every data product is certified.',
          table: { columns: ['Product', 'Status', 'Version', 'Blocking'], rows: pending.map((x) => [`${x.id} ${x.name}`, live.productStatus[x.id] ?? x.status, live.productVersion[x.id] ?? x.version, blockers(x.id)]) },
          sql: `SELECT product_id, name, status, version\n  FROM ${DB}.DATA_PRODUCTS.DP_REGISTRY\n WHERE status <> 'Certified';  -- read live`,
          rows: pending.length, explorerTarget: 'DATA_PRODUCTS.DP_REGISTRY',
        };
      },
    },
  ];
}

