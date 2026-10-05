// Bronze / Silver / Gold objects and product output ports for HPR_AI_PLATFORM (spec section 5).
import type { Row, SfObject } from '../../types';
import { cdcColumns, col, dateKey, GATE6_CHECK, memo, memoRng, withCdc } from '../shared/catalog-kit';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, noisy, pad, round, ts } from '../../mock-snowflake/generators';
import { INV_WEEKS, isCompInMonth, type RetailData } from './data';
import { AS_OF, CATEGORIES, REGION_CODE_MAP } from './generators.config';

export { GATE6_CHECK };

const cdc = cdcColumns();
const regionAccess = (column = 'REGION') => ({ column });
const codeAccess = (column: string) => ({ column, map: REGION_CODE_MAP });
const A_REGIONS = ['Northeast', 'Mid-Atlantic'];
const TENDERS = ['VISA', 'VISA', 'MC', 'MC', 'AMEX', 'DISC', 'CASH', 'GIFT'];

export function buildCatalog(d: RetailData, seed: number): SfObject[] {
  const rng = new Rng(seed + 7);
  const memSample = d.members.slice(0, 400);
  const storeByKey = new Map(d.stores.map((s) => [s.key, s]));
  const promoByKey = new Map(d.promos.map((p) => [p.key, p]));
  const memberByKey = new Map(d.members.map((m) => [m.key, m]));
  const supplierByKey = new Map(d.suppliers.map((s) => [s.key, s]));
  const productsByCat = new Map<string, RetailData['products']>(CATEGORIES.map((c) => [c.name, d.products.filter((p) => p.category === c.name)]));

  // POS transactions and e-commerce orders for the latest business days (Bronze/Silver previews).
  const posTxns = memo(() => {
    const out: { id: string; storeKey: number; date: string; reg: number; memberId: string | null; type: 'SALE' | 'RETURN'; gross: number; disc: number; items: number; tender: string; card: string | null; promo: string | null }[] = [];
    const days = [AS_OF, addDays(AS_OF, -1)];
    for (const day of days) {
      for (const s of d.stores) {
        const cell = d.byStoreDay.cells[s.key - 1][d.byStoreDay.idx.get(day)!]?.find((x) => x.channel === 'Store');
        if (!cell) continue;
        const basket = cell.net / cell.txns;
        for (let i = 0; i < 3; i++) {
          const tender = rng.pick(TENDERS);
          const ret = rng.chance(0.08);
          const gross = round(basket * rng.lognormal(1, 0.5) * (ret ? -0.8 : 1.1), 2);
          const mem = rng.chance(0.58) ? d.members[(s.key * 31 + i * 7) % d.members.length] : null;
          out.push({
            id: `${s.id}-${day.replace(/-/g, '').slice(2)}-${pad(rng.int(1, 12), 2)}-${pad(rng.int(1000, 9999), 4)}`, storeKey: s.key, date: day,
            reg: rng.int(1, 8), memberId: mem?.id ?? null, type: ret ? 'RETURN' : 'SALE', gross, disc: ret ? 0 : round(Math.abs(gross) * (cell.promoKey ? 0.18 : 0.06) * rng.range(0, 1.5), 2),
            items: rng.int(1, 6), tender, card: tender === 'CASH' || tender === 'GIFT' ? null : pad(rng.int(0, 9999), 4), promo: cell.promoKey ? promoByKey.get(cell.promoKey)!.id : null,
          });
        }
      }
    }
    return out;
  });
  const ecomOrders = memo(() => {
    const out: { id: string; member: (typeof d.members)[number]; ts: string; storeKey: number; type: 'SHIP' | 'BOPIS'; amount: number; card: string; status: string }[] = [];
    for (let i = 0; i < 260; i++) {
      const m = d.members[(i * 13) % d.members.length];
      const day = addDays(AS_OF, -Math.floor(i / 90));
      out.push({
        id: `W${pad(51_200_000 + i * 17 + rng.int(0, 16), 9)}`, member: m, ts: ts(day, rng.int(0, 1439)), storeKey: m.homeStoreKey,
        type: rng.chance(0.27) ? 'BOPIS' : 'SHIP', amount: round(rng.lognormal(112, 0.6), 2), card: pad(rng.int(0, 9999), 4),
        status: rng.pick(['PLACED', 'RELEASED', 'SHIPPED', 'SHIPPED', 'DELIVERED', 'DELIVERED', 'PICKED_UP']),
      });
    }
    return out;
  });

  const bronze: SfObject[] = [
    {
      schema: 'RAW_BRONZE', name: 'LOYALTY_MEMBER_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 1,
      comment: 'Harbor Club loyalty member master, change data capture from the loyalty platform, landed as Apache Iceberg',
      columns: [
        col('MBR_ID', 'VARCHAR(12)', 'Harbor Club member number', { nullable: false, tags: ['PII'] }),
        col('FST_NM', 'VARCHAR(40)', 'First name (raw)', { tags: ['PII'] }), col('LST_NM', 'VARCHAR(40)', 'Last name (raw)', { tags: ['PII'] }),
        col('EMAIL_ADDR', 'VARCHAR(120)', 'Email (raw)', { tags: ['PII'] }), col('PHONE_NO', 'VARCHAR(20)', 'Mobile number', { tags: ['PII'] }),
        col('HOME_STORE_NO', 'VARCHAR(8)', 'Home store number'), col('RGN_CD', 'VARCHAR(4)', 'Store region code (NE, MID, MW, WST)'),
        col('TIER_CD', 'VARCHAR(3)', 'Tier code (MBR, PLS, ELT)'), col('ENROLL_DT', 'DATE', 'Enrolment date'),
        col('STAT_CD', 'VARCHAR(1)', 'Status code (A active, C closed)'), ...cdc,
      ],
      rowCount: 21_406_118, bytes: 3.4e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:12:40', upstream: ['ext:Loyalty'],
      rowAccess: codeAccess('RGN_CD'),
      rows: memoRng(rng, seed + 701, () => withCdc(rng, memSample, (m) => ({
        MBR_ID: rng.chance(0.3) ? `${m.id}  ` : m.id, FST_NM: noisy(rng, m.first), LST_NM: noisy(rng, m.last),
        EMAIL_ADDR: rng.chance(0.3) ? m.email.toUpperCase() : m.email, PHONE_NO: m.phone, HOME_STORE_NO: m.homeStoreId,
        RGN_CD: rng.chance(0.2) ? m.regionCode.toLowerCase() : m.regionCode, TIER_CD: m.tier === 'Elite' ? 'ELT' : m.tier === 'Plus' ? 'PLS' : 'MBR',
        ENROLL_DT: m.enrolled, STAT_CD: m.status === 'Active' ? 'A' : 'C',
      }), '2026-09-01', (m) => A_REGIONS.includes(m.region))),
    },
    {
      schema: 'RAW_BRONZE', name: 'LOYALTY_MEMBER_CDC_STRM', layer: 'bronze', type: 'STREAM', order: 2,
      comment: 'Append-only stream feeding CURATED_SILVER.LOYALTY_MEMBER', columns: [], rowCount: 2_318, owner: 'INGEST_ADMIN',
      lastAltered: '2026-09-30 06:13:00', upstream: ['RAW_BRONZE.LOYALTY_MEMBER_CDC'],
    },
    {
      schema: 'RAW_BRONZE', name: 'POS_TRANSACTION_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 3,
      comment: 'Store POS sales and returns (transaction headers) streamed from the store systems',
      columns: [
        col('TXN_ID', 'VARCHAR(24)', 'Store-date-register-sequence id'), col('STORE_NO', 'VARCHAR(8)', 'Store number'), col('RGN_CD', 'VARCHAR(4)', 'Store region code'),
        col('BUS_DT', 'DATE', 'Business date'), col('REG_NO', 'NUMBER(3)', 'Register'), col('MBR_ID', 'VARCHAR(12)', 'Loyalty member scanned', { tags: ['PII'] }),
        col('TXN_TYPE', 'VARCHAR(8)', 'SALE / RETURN'), col('GROSS_AMT', 'NUMBER(12,2)', 'Gross amount'), col('DISC_AMT', 'NUMBER(12,2)', 'Discount amount'),
        col('TENDER_CD', 'VARCHAR(6)', 'Tender type'), col('CARD_LAST4', 'VARCHAR(4)', 'Payment card last four digits', { tags: ['PCI'] }), col('PROMO_CD', 'VARCHAR(12)', 'Promotion code'), ...cdc,
      ],
      rowCount: 2_184_660_215, bytes: 4.1e11, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:15:00', upstream: ['ext:POS transactions'],
      rowAccess: codeAccess('RGN_CD'),
      rows: memoRng(rng, seed + 702, () => withCdc(rng, posTxns(), (t) => {
        const s = storeByKey.get(t.storeKey)!;
        return { TXN_ID: t.id, STORE_NO: rng.chance(0.25) ? ` ${s.id}` : s.id, RGN_CD: s.regionCode, BUS_DT: t.date, REG_NO: t.reg, MBR_ID: t.memberId, TXN_TYPE: t.type, GROSS_AMT: t.gross, DISC_AMT: t.disc, TENDER_CD: t.tender, CARD_LAST4: t.card, PROMO_CD: t.promo };
      }, '2026-09-29')),
    },
    {
      schema: 'RAW_BRONZE', name: 'ECOM_ORDER_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 4,
      comment: 'Web and app orders from the commerce platform (order headers)',
      columns: [
        col('ORDER_NO', 'VARCHAR(12)', 'Order number'), col('CUST_EMAIL', 'VARCHAR(120)', 'Customer email (raw)', { tags: ['PII'] }), col('MBR_ID', 'VARCHAR(12)', 'Loyalty member', { tags: ['PII'] }),
        col('ORDER_TS', 'TIMESTAMP_NTZ', 'Order time'), col('FULFIL_STORE_NO', 'VARCHAR(8)', 'Fulfilling / pickup store'), col('FULFIL_TYPE', 'VARCHAR(6)', 'SHIP / BOPIS'),
        col('ORDER_AMT', 'NUMBER(12,2)', 'Order amount'), col('CARD_LAST4', 'VARCHAR(4)', 'Payment card last four digits', { tags: ['PCI'] }), col('ORDER_STATUS', 'VARCHAR(12)', 'Order status'), ...cdc,
      ],
      rowCount: 186_204_771, bytes: 3.9e10, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 06:09:12', upstream: ['ext:E-commerce orders'],
      rows: memoRng(rng, seed + 703, () => withCdc(rng, ecomOrders(), (o) => ({
        ORDER_NO: o.id, CUST_EMAIL: rng.chance(0.3) ? o.member.email.toUpperCase() : o.member.email, MBR_ID: o.member.id, ORDER_TS: o.ts,
        FULFIL_STORE_NO: storeByKey.get(o.storeKey)!.id, FULFIL_TYPE: o.type, ORDER_AMT: o.amount, CARD_LAST4: o.card, ORDER_STATUS: noisy(rng, o.status),
      }), '2026-09-28')),
    },
    {
      schema: 'RAW_BRONZE', name: 'WMS_INVENTORY_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 5,
      comment: 'Stock on hand by location and SKU from the warehouse and store inventory system',
      columns: [col('LOC_NO', 'VARCHAR(8)', 'Store or DC number'), col('DEPT_CD', 'VARCHAR(4)', 'Merchandise department code'), col('SKU_NO', 'VARCHAR(12)', 'SKU'), col('ON_HAND_QTY', 'NUMBER(10)', 'Units on hand'), col('ON_ORDER_QTY', 'NUMBER(10)', 'Units on order'), col('SNAPSHOT_TS', 'TIMESTAMP_NTZ', 'Snapshot time'), ...cdc],
      rowCount: 9_812_440_018, bytes: 6.2e11, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 05:40:00', upstream: ['ext:WMS inventory'],
      rows: memoRng(rng, seed + 704, () => withCdc(rng, d.inventory.filter((x) => x.week === INV_WEEKS[INV_WEEKS.length - 1]), (x) => {
        const c = CATEGORIES.find((cc) => cc.name === x.category)!;
        const p = rng.pick(productsByCat.get(x.category)!);
        return { LOC_NO: storeByKey.get(x.storeKey)!.id, DEPT_CD: rng.chance(0.25) ? c.code.toLowerCase() : c.code, SKU_NO: p.sku, ON_HAND_QTY: Math.round(x.end / Math.max(1, x.skus) * rng.range(0.5, 2)), ON_ORDER_QTY: rng.int(0, 24), SNAPSHOT_TS: ts(x.week, 1380) };
      }, '2026-09-27')),
    },
    {
      schema: 'RAW_BRONZE', name: 'SUPPLIER_EDI_CDC', layer: 'bronze', type: 'ICEBERG TABLE', order: 6,
      comment: 'Supplier EDI documents: 850 purchase orders and 856 advance ship notices',
      columns: [col('EDI_DOC', 'VARCHAR(3)', 'EDI transaction set (850 PO, 856 ASN)'), col('PO_NO', 'VARCHAR(12)', 'PO number'), col('LINE_NO', 'NUMBER', 'Line'), col('VENDOR_NO', 'VARCHAR(8)', 'Vendor number'), col('ORD_QTY', 'NUMBER(10)', 'Ordered units'), col('SHIP_QTY', 'NUMBER(10)', 'Shipped units (ASN)'), col('REQ_DLV_DT', 'DATE', 'Requested delivery date'), col('RCV_DT', 'DATE', 'Received at DC'), ...cdc],
      rowCount: 14_208_552, bytes: 2.2e9, owner: 'INGEST_ADMIN', lastAltered: '2026-09-30 04:20:00', upstream: ['ext:Supplier EDI'],
      rows: memoRng(rng, seed + 705, () => withCdc(rng, d.poLines.slice(-300).reverse(), (l) => ({
        EDI_DOC: rng.chance(0.5) ? '850' : '856', PO_NO: l.po, LINE_NO: l.line, VENDOR_NO: `V${pad(20_400 + l.supplierKey * 17, 6)}`, ORD_QTY: l.ordered,
        SHIP_QTY: l.asnAccurate ? l.receivedUnits : l.receivedUnits + rng.int(1, 12), REQ_DLV_DT: l.requested, RCV_DT: l.received,
      }), '2026-09-15')),
    },
  ];

  const silver: SfObject[] = [
    {
      schema: 'CURATED_SILVER', name: 'LOYALTY_MEMBER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 1,
      comment: 'Deduplicated SCD2 loyalty member entity (one row per member version)',
      columns: [
        col('MEMBER_ID', 'VARCHAR(12)', 'Harbor Club member number (trimmed)', { nullable: false, termId: 'T-001', tags: ['CDE', 'PII'] }),
        col('FIRST_NAME', 'VARCHAR(40)', 'First name', { tags: ['PII'] }), col('LAST_NAME', 'VARCHAR(40)', 'Last name', { tags: ['PII'] }),
        col('EMAIL', 'VARCHAR(120)', 'Email (lowercased)', { tags: ['PII'] }), col('PHONE', 'VARCHAR(20)', 'Mobile number', { tags: ['PII'] }),
        col('HOME_STORE_ID', 'VARCHAR(8)', 'Home store'), col('REGION', 'VARCHAR(20)', 'Store region of the home store', { termId: 'T-003' }),
        col('TIER', 'VARCHAR(8)', 'Member / Plus / Elite'), col('MEMBER_STATUS', 'VARCHAR(8)', 'Active / Closed', { termId: 'T-002' }),
        col('ENROLLED_DATE', 'DATE', 'Enrolment date'), col('EFFECTIVE_FROM', 'DATE', 'SCD2 valid from'), col('EFFECTIVE_TO', 'DATE', 'SCD2 valid to'), col('IS_CURRENT', 'BOOLEAN', 'Current version flag'),
      ],
      rowCount: 5_412_904, bytes: 7.6e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:28:10', upstream: ['RAW_BRONZE.LOYALTY_MEMBER_CDC_STRM'],
      rowAccess: regionAccess(),
      rows: memo(() => memSample.flatMap((m) => {
        const cur = { MEMBER_ID: m.id, FIRST_NAME: m.first, LAST_NAME: m.last, EMAIL: m.email, PHONE: m.phone, HOME_STORE_ID: m.homeStoreId, REGION: m.region, TIER: m.tier, MEMBER_STATUS: m.status, ENROLLED_DATE: m.enrolled };
        return m.priorTier
          ? [{ ...cur, TIER: m.priorTier, EFFECTIVE_FROM: m.enrolled, EFFECTIVE_TO: addDays(m.tierChangedOn!, -1), IS_CURRENT: false }, { ...cur, EFFECTIVE_FROM: m.tierChangedOn!, EFFECTIVE_TO: null, IS_CURRENT: true }]
          : [{ ...cur, EFFECTIVE_FROM: m.enrolled, EFFECTIVE_TO: null, IS_CURRENT: true }];
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'POS_TRANSACTION', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '5 minutes', order: 2,
      comment: 'Typed, deduplicated store transactions (sales and returns)',
      columns: [
        col('TXN_ID', 'VARCHAR(24)', 'Transaction id'), col('STORE_ID', 'VARCHAR(8)', 'Store (trimmed)'), col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003' }),
        col('BUSINESS_DATE', 'DATE', 'Business date'), col('MEMBER_ID', 'VARCHAR(12)', 'Loyalty member', { tags: ['PII'], termId: 'T-001' }), col('TXN_TYPE', 'VARCHAR(8)', 'SALE / RETURN'),
        col('NET_AMOUNT_USD', 'NUMBER(12,2)', 'Net of discount', { termId: 'T-006' }), col('DISCOUNT_USD', 'NUMBER(12,2)', 'Discount', { termId: 'T-028' }), col('ITEM_COUNT', 'NUMBER(4)', 'Items'),
        col('TENDER_TYPE', 'VARCHAR(6)', 'Tender'), col('CARD_LAST4', 'VARCHAR(4)', 'Payment card last four', { tags: ['PCI'] }), col('PROMO_ID', 'VARCHAR(12)', 'Promotion applied', { termId: 'T-018' }),
      ],
      rowCount: 2_160_118_402, bytes: 2.6e11, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:20:31', upstream: ['RAW_BRONZE.POS_TRANSACTION_CDC'],
      rowAccess: regionAccess(),
      rows: memo(() => posTxns().map((t) => {
        const s = storeByKey.get(t.storeKey)!;
        return { TXN_ID: t.id, STORE_ID: s.id, REGION: s.region, BUSINESS_DATE: t.date, MEMBER_ID: t.memberId, TXN_TYPE: t.type, NET_AMOUNT_USD: round(t.gross - t.disc, 2), DISCOUNT_USD: t.disc, ITEM_COUNT: t.items, TENDER_TYPE: t.tender, CARD_LAST4: t.card, PROMO_ID: t.promo };
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'ECOM_ORDER', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 3,
      comment: 'Typed web and app orders attributed to the fulfilling or pickup store',
      columns: [
        col('ORDER_ID', 'VARCHAR(12)', 'Order id'), col('MEMBER_ID', 'VARCHAR(12)', 'Loyalty member', { tags: ['PII'], termId: 'T-001' }), col('EMAIL', 'VARCHAR(120)', 'Customer email (lowercased)', { tags: ['PII'] }),
        col('ORDER_TS', 'TIMESTAMP_NTZ', 'Order time'), col('FULFILLING_STORE_ID', 'VARCHAR(8)', 'Attributed store'), col('REGION', 'VARCHAR(20)', 'Region of the attributed store', { termId: 'T-003' }),
        col('FULFILMENT_TYPE', 'VARCHAR(12)', 'Ship to home / Pickup in store'), col('ORDER_AMOUNT_USD', 'NUMBER(12,2)', 'Order amount'), col('CARD_LAST4', 'VARCHAR(4)', 'Payment card last four', { tags: ['PCI'] }),
        col('ORDER_STATUS', 'VARCHAR(12)', 'Order status (upper-cased)'),
      ],
      rowCount: 181_550_906, bytes: 2.4e10, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:16:48', upstream: ['RAW_BRONZE.ECOM_ORDER_CDC'],
      rowAccess: regionAccess(),
      rows: memo(() => ecomOrders().map((o) => {
        const s = storeByKey.get(o.storeKey)!;
        return { ORDER_ID: o.id, MEMBER_ID: o.member.id, EMAIL: o.member.email, ORDER_TS: o.ts, FULFILLING_STORE_ID: s.id, REGION: s.region, FULFILMENT_TYPE: o.type === 'SHIP' ? 'Ship to home' : 'Pickup in store', ORDER_AMOUNT_USD: o.amount, CARD_LAST4: o.card, ORDER_STATUS: o.status };
      })),
    },
    {
      schema: 'CURATED_SILVER', name: 'STORE_INVENTORY', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 4,
      comment: 'Weekly stock position by store and merchandise category (rolled up from SKU)',
      columns: [
        col('STORE_ID', 'VARCHAR(8)', 'Store'), col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003' }), col('CATEGORY', 'VARCHAR(30)', 'Merchandise category'),
        col('WEEK_ENDING', 'DATE', 'Week ending (Sunday)'), col('ON_HAND_UNITS', 'NUMBER(10)', 'Units on hand at week end', { termId: 'T-013' }), col('UNITS_SOLD', 'NUMBER(10)', 'Units sold in the week', { termId: 'T-010' }),
        col('UNITS_RECEIVED', 'NUMBER(10)', 'Units received in the week'), col('SKUS_RANGED', 'NUMBER(6)', 'SKUs on the planogram'), col('SKUS_OUT_OF_STOCK', 'NUMBER(6)', 'Ranged SKUs with zero on hand', { termId: 'T-012' }),
      ],
      rowCount: 199_680, bytes: 1.1e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:55:00', upstream: ['RAW_BRONZE.WMS_INVENTORY_CDC'],
      rowAccess: regionAccess(),
      rows: memo(() => d.inventory.slice().reverse().map((x) => ({ STORE_ID: storeByKey.get(x.storeKey)!.id, REGION: x.region, CATEGORY: x.category, WEEK_ENDING: x.week, ON_HAND_UNITS: x.end, UNITS_SOLD: x.sold, UNITS_RECEIVED: x.received, SKUS_RANGED: x.skus, SKUS_OUT_OF_STOCK: x.oos }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'SUPPLIER_PO_LINE', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 5,
      comment: 'Purchase order lines matched to ASNs and DC receipts',
      columns: [
        col('PO_NUMBER', 'VARCHAR(12)', 'PO number'), col('LINE_NUMBER', 'NUMBER', 'Line'), col('SUPPLIER_ID', 'NUMBER', 'Supplier'), col('CATEGORY', 'VARCHAR(30)', 'Merchandise category'),
        col('DC_NAME', 'VARCHAR(40)', 'Receiving distribution center'), col('ORDERED_UNITS', 'NUMBER(10)', 'Ordered'), col('RECEIVED_UNITS', 'NUMBER(10)', 'Received', { termId: 'T-015' }),
        col('REQUESTED_DATE', 'DATE', 'Requested delivery date'), col('RECEIVED_DATE', 'DATE', 'Received at DC'), col('ASN_MATCHED', 'BOOLEAN', 'ASN matched the receipt', { termId: 'T-017' }),
      ],
      rowCount: 13_920_114, bytes: 1.3e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 04:35:00', upstream: ['RAW_BRONZE.SUPPLIER_EDI_CDC'],
      rows: memo(() => d.poLines.slice().reverse().map((l) => ({ PO_NUMBER: l.po, LINE_NUMBER: l.line, SUPPLIER_ID: l.supplierKey, CATEGORY: l.category, DC_NAME: l.dc, ORDERED_UNITS: l.ordered, RECEIVED_UNITS: l.receivedUnits, REQUESTED_DATE: l.requested, RECEIVED_DATE: l.received, ASN_MATCHED: l.asnAccurate }))),
    },
    {
      schema: 'CURATED_SILVER', name: 'RETURN_TXN', layer: 'silver', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 6,
      comment: 'Store and mail-in returns with receipt status and fraud flags',
      columns: [
        col('RETURN_ID', 'VARCHAR(12)', 'Return id'), col('STORE_ID', 'VARCHAR(8)', 'Store accepting the return'), col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003' }),
        col('RETURN_DATE', 'DATE', 'Return date'), col('CHANNEL', 'VARCHAR(12)', 'Channel of the original sale'), col('MEMBER_ID', 'VARCHAR(12)', 'Loyalty member', { tags: ['PII'], termId: 'T-001' }),
        col('RETURN_AMOUNT_USD', 'NUMBER(12,2)', 'Refund amount', { termId: 'T-022' }), col('REASON', 'VARCHAR(30)', 'Return reason'), col('HAS_RECEIPT', 'BOOLEAN', 'Receipt or order presented'),
        col('IS_SUSPICIOUS', 'BOOLEAN', 'Flagged by rule BR-017', { termId: 'T-023', tags: ['CDE'] }), col('SUSPICIOUS_REASON', 'VARCHAR(40)', 'Why it was flagged'),
      ],
      rowCount: 34_660_480, bytes: 3.0e9, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-28 23:10:00', upstream: ['RAW_BRONZE.POS_TRANSACTION_CDC', 'RAW_BRONZE.ECOM_ORDER_CDC'],
      rowAccess: regionAccess(),
      rows: memo(() => d.returns.slice().reverse().map((r) => ({ RETURN_ID: r.id, STORE_ID: storeByKey.get(r.storeKey)!.id, REGION: r.region, RETURN_DATE: r.date, CHANNEL: r.channel, MEMBER_ID: r.memberKey ? memberByKey.get(r.memberKey)!.id : null, RETURN_AMOUNT_USD: r.amount, REASON: r.reason, HAS_RECEIPT: r.hasReceipt, IS_SUSPICIOUS: r.suspicious, SUSPICIOUS_REASON: r.suspiciousReason }))),
    },
  ];

  const allDates: string[] = [];
  for (let x = '2025-01-01'; x <= AS_OF; x = addDays(x, 1)) allDates.push(x);
  const promoDays = new Set(d.promos.flatMap((p) => { const out: string[] = []; for (let x = p.from; x <= p.to; x = addDays(x, 1)) out.push(x); return out; }));
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const salesRow = (x: RetailData['sales'][number]): Row => ({
    SALES_KEY: x.key, DATE_KEY: dateKey(x.date), STORE_KEY: x.storeKey, REGION: x.region, CHANNEL: x.channel, PROMO_KEY: x.promoKey,
    IS_COMP_STORE: isCompInMonth(storeByKey.get(x.storeKey)!, x.month), GROSS_SALES_USD: x.gross, DISCOUNT_USD: x.discount, RETURNS_USD: x.returns,
    NET_SALES_USD: x.net, TRANSACTIONS: x.txns, UNITS: x.units, LOYALTY_SALES_USD: x.loyalty,
  });

  const gold: SfObject[] = [
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_STORE', layer: 'gold', type: 'TABLE', order: 1, comment: 'Store dimension with region, format and comparable-store attributes',
      columns: [
        col('STORE_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('STORE_ID', 'VARCHAR(8)', 'Store number'), col('STORE_NAME', 'VARCHAR(60)', 'Store name'),
        col('CITY', 'VARCHAR(40)', 'City'), col('STATE', 'VARCHAR(2)', 'State'), col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003', tags: ['CDE'] }),
        col('FORMAT', 'VARCHAR(20)', 'Flagship / Mall / Lifestyle center / Outlet'), col('SELLING_SQFT', 'NUMBER(7)', 'Selling square feet'),
        col('OPEN_DATE', 'DATE', 'Store opening date', { termId: 'T-005' }), col('REMODEL_START', 'DATE', 'Remodel closure start'), col('REMODEL_END', 'DATE', 'Remodel closure end'),
        col('IS_COMP_STORE', 'BOOLEAN', 'Comparable in the current month (Sep 2026), rule BR-006', { termId: 'T-005', tags: ['CDE'] }),
      ],
      rowCount: 640, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-01 02:00:00', upstream: ['CURATED_SILVER.POS_TRANSACTION'], rowAccess: regionAccess(),
      rows: memo(() => d.stores.map((s) => ({ STORE_KEY: s.key, STORE_ID: s.id, STORE_NAME: s.name, CITY: s.city, STATE: s.state, REGION: s.region, FORMAT: s.format, SELLING_SQFT: s.sqft, OPEN_DATE: s.openDate, REMODEL_START: s.remodel?.from ?? null, REMODEL_END: s.remodel?.to ?? null, IS_COMP_STORE: isCompInMonth(s, '2026-09') }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_CUSTOMER', layer: 'gold', type: 'TABLE', order: 2, comment: 'Conformed loyalty member dimension (current version)',
      columns: [
        col('CUSTOMER_KEY', 'NUMBER', 'Surrogate key', { nullable: false }), col('MEMBER_ID', 'VARCHAR(12)', 'Harbor Club member number', { termId: 'T-001', tags: ['CDE', 'PII'] }),
        col('MEMBER_NAME', 'VARCHAR(80)', 'Member name', { tags: ['PII'] }), col('EMAIL', 'VARCHAR(120)', 'Email', { tags: ['PII'] }),
        col('HOME_STORE_KEY', 'NUMBER', 'Home store'), col('HOME_REGION', 'VARCHAR(20)', 'Region of the home store', { termId: 'T-003', tags: ['CDE'] }), col('TIER', 'VARCHAR(8)', 'Loyalty tier'),
        col('MEMBER_STATUS', 'VARCHAR(8)', 'Active / Closed', { termId: 'T-002' }), col('ENROLLED_DATE', 'DATE', 'Enrolled'), col('LAST_PURCHASE_DATE', 'DATE', 'Most recent purchase (any channel)', { termId: 'T-002', tags: ['CDE'] }),
        col('PURCHASES_12M', 'NUMBER(4)', 'Purchase days, trailing 12 months', { termId: 'T-026' }), col('SPEND_12M_USD', 'NUMBER(12,2)', 'Net spend, trailing 12 months', { termId: 'T-030' }),
        col('IS_OMNICHANNEL', 'BOOLEAN', 'Bought in store and online in 12 months', { termId: 'T-027' }), col('PREDICTED_CLV_USD', 'NUMBER(12,2)', 'Predicted 3-year customer lifetime value (draft model)', { termId: 'T-024' }),
        col('POINTS_BALANCE', 'NUMBER(10)', 'Harbor Club points'),
      ],
      rowCount: 5_200_000, bytes: 6.1e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:31:00', upstream: ['CURATED_SILVER.LOYALTY_MEMBER'], rowAccess: regionAccess('HOME_REGION'),
      rows: memo(() => d.members.map((m) => ({ CUSTOMER_KEY: m.key, MEMBER_ID: m.id, MEMBER_NAME: `${m.first} ${m.last}`, EMAIL: m.email, HOME_STORE_KEY: m.homeStoreKey, HOME_REGION: m.region, TIER: m.tier, MEMBER_STATUS: m.status, ENROLLED_DATE: m.enrolled, LAST_PURCHASE_DATE: m.lastPurchase, PURCHASES_12M: m.purchases12m, SPEND_12M_USD: m.spend12m, IS_OMNICHANNEL: m.storeBuyer && m.onlineBuyer, PREDICTED_CLV_USD: m.clv, POINTS_BALANCE: m.points }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_PRODUCT', layer: 'gold', type: 'TABLE', order: 3, comment: 'Product (SKU) dimension with merchandise hierarchy',
      columns: [col('PRODUCT_KEY', 'NUMBER', 'Surrogate key'), col('SKU', 'VARCHAR(12)', 'SKU'), col('PRODUCT_NAME', 'VARCHAR(80)', 'Product'), col('CATEGORY', 'VARCHAR(30)', 'Merchandise category'), col('SUBCATEGORY', 'VARCHAR(30)', 'Subcategory'), col('BRAND', 'VARCHAR(30)', 'Brand'), col('UNIT_COST_USD', 'NUMBER(10,2)', 'Unit cost'), col('RETAIL_PRICE_USD', 'NUMBER(10,2)', 'Ticket price'), col('SUPPLIER_KEY', 'NUMBER', 'Primary supplier')],
      rowCount: 48_212, bytes: 6.4e6, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-29 02:00:00', upstream: ['CURATED_SILVER.STORE_INVENTORY'],
      rows: memo(() => d.products.map((p) => ({ PRODUCT_KEY: p.key, SKU: p.sku, PRODUCT_NAME: p.name, CATEGORY: p.category, SUBCATEGORY: p.subcategory, BRAND: p.brand, UNIT_COST_USD: p.cost, RETAIL_PRICE_USD: p.retail, SUPPLIER_KEY: p.supplierKey }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_SUPPLIER', layer: 'gold', type: 'TABLE', order: 4, comment: 'Supplier dimension',
      columns: [col('SUPPLIER_KEY', 'NUMBER', 'Surrogate key'), col('SUPPLIER_NAME', 'VARCHAR(60)', 'Supplier'), col('CATEGORY', 'VARCHAR(30)', 'Primary merchandise category'), col('PREFERRED', 'BOOLEAN', 'Preferred supplier'), col('EDI_COMPLIANT', 'BOOLEAN', 'Meets the EDI / ASN compliance standard')],
      rowCount: 412, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-08-15 02:00:00', upstream: ['CURATED_SILVER.SUPPLIER_PO_LINE'],
      rows: memo(() => d.suppliers.map((s) => ({ SUPPLIER_KEY: s.key, SUPPLIER_NAME: s.name, CATEGORY: s.category, PREFERRED: s.preferred, EDI_COMPLIANT: s.ediCompliant }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_PROMOTION', layer: 'gold', type: 'TABLE', order: 5, comment: 'Promotion calendar: events, windows, regions and funding',
      columns: [
        col('PROMO_KEY', 'NUMBER', 'Surrogate key'), col('PROMO_ID', 'VARCHAR(12)', 'Promotion id', { termId: 'T-018', tags: ['CDE'] }), col('PROMO_NAME', 'VARCHAR(60)', 'Promotion'),
        col('PROMO_TYPE', 'VARCHAR(20)', 'Event / Clearance / Category event / Loyalty offer'), col('START_DATE', 'DATE', 'First day'), col('END_DATE', 'DATE', 'Last day'),
        col('REGIONS', 'VARCHAR(80)', 'Regions where the promotion ran'), col('DISCOUNT_PCT', 'NUMBER(4,1)', 'Headline discount %'), col('VENDOR_FUNDED_PCT', 'NUMBER(4,1)', 'Share of discount funded by suppliers'),
        col('OFFERS_ISSUED', 'NUMBER(10)', 'Offers / coupons distributed', { termId: 'T-021' }),
      ],
      rowCount: d.promos.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-02 02:00:00', upstream: ['CURATED_SILVER.POS_TRANSACTION'],
      rows: memo(() => d.promos.slice().reverse().map((p) => ({ PROMO_KEY: p.key, PROMO_ID: p.id, PROMO_NAME: p.name, PROMO_TYPE: p.type, START_DATE: p.from, END_DATE: p.to, REGIONS: p.regions.join(', '), DISCOUNT_PCT: round(p.discountPct * 100, 1), VENDOR_FUNDED_PCT: round(p.vendorFundedPct * 100, 1), OFFERS_ISSUED: p.offersIssued || null }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'DIM_DATE', layer: 'gold', type: 'TABLE', order: 6, comment: 'Calendar with fiscal periods, same-day-last-year alignment and promotion days',
      columns: [col('DATE_KEY', 'NUMBER(8)', 'yyyymmdd'), col('CALENDAR_DATE', 'DATE', 'Date'), col('DAY_OF_WEEK', 'VARCHAR(3)', 'Day of week'), col('FISCAL_QUARTER', 'VARCHAR(7)', 'Fiscal quarter (FY = calendar year)'), col('FISCAL_YEAR', 'NUMBER(4)', 'Fiscal year'), col('SAME_DAY_LAST_YEAR', 'DATE', 'Comparable day last year (364 days earlier, same weekday)', { termId: 'T-004' }), col('IS_PROMO_DAY', 'BOOLEAN', 'A promotion ran in at least one region')],
      rowCount: allDates.length, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 00:05:00', upstream: [],
      rows: memo(() => allDates.slice().reverse().map((x) => ({ DATE_KEY: dateKey(x), CALENDAR_DATE: x, DAY_OF_WEEK: DOW[new Date(`${x}T00:00:00Z`).getUTCDay()], FISCAL_QUARTER: `${x.slice(0, 4)}-Q${Math.floor((Number(x.slice(5, 7)) - 1) / 3) + 1}`, FISCAL_YEAR: Number(x.slice(0, 4)), SAME_DAY_LAST_YEAR: addDays(x, -364), IS_PROMO_DAY: promoDays.has(x) }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_SALES', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '15 minutes', order: 7, comment: 'Daily sales by store and channel, with the promotion running and the comparable-store flag',
      columns: [
        col('SALES_KEY', 'NUMBER', 'Surrogate key'), col('DATE_KEY', 'NUMBER(8)', 'Business date'), col('STORE_KEY', 'NUMBER', 'Store'),
        col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003', tags: ['CDE'] }), col('CHANNEL', 'VARCHAR(12)', 'Store / E-commerce', { termId: 'T-025' }),
        col('PROMO_KEY', 'NUMBER', 'Promotion running that day in the store’s region', { termId: 'T-018' }), col('IS_COMP_STORE', 'BOOLEAN', 'Store comparable in this month (BR-006)', { termId: 'T-005', tags: ['CDE'] }),
        col('GROSS_SALES_USD', 'NUMBER(14,2)', 'Gross sales before discounts and returns'), col('DISCOUNT_USD', 'NUMBER(14,2)', 'Promotional and markdown discounts', { termId: 'T-028' }),
        col('RETURNS_USD', 'NUMBER(14,2)', 'Returns refunded', { termId: 'T-022', tags: ['CDE'] }), col('NET_SALES_USD', 'NUMBER(14,2)', 'Gross − discounts − returns, excl. tax', { termId: 'T-006', tags: ['CDE'] }),
        col('TRANSACTIONS', 'NUMBER(8)', 'Sales transactions', { termId: 'T-007', tags: ['CDE'] }), col('UNITS', 'NUMBER(9)', 'Units sold', { termId: 'T-008' }),
        col('LOYALTY_SALES_USD', 'NUMBER(14,2)', 'Net sales identified to a Harbor Club member', { termId: 'T-009', tags: ['CDE'] }),
      ],
      rowCount: 816_640, bytes: 6.8e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:33:12', upstream: ['CURATED_SILVER.POS_TRANSACTION', 'CURATED_SILVER.ECOM_ORDER', 'CONFORMED_GOLD.DIM_STORE', 'CONFORMED_GOLD.DIM_PROMOTION'], rowAccess: regionAccess(),
      rows: memo(() => d.sales.slice().reverse().map(salesRow)),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_INVENTORY', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 8, comment: 'Weekly inventory position by store and merchandise category',
      columns: [
        col('INVENTORY_KEY', 'NUMBER', 'Surrogate key'), col('DATE_KEY', 'NUMBER(8)', 'Week ending (Sunday)'), col('STORE_KEY', 'NUMBER', 'Store'), col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003' }),
        col('CATEGORY', 'VARCHAR(30)', 'Merchandise category'), col('BEGIN_ON_HAND_UNITS', 'NUMBER(10)', 'Units on hand at week start', { termId: 'T-010' }), col('UNITS_RECEIVED', 'NUMBER(10)', 'Units received', { termId: 'T-010' }),
        col('UNITS_SOLD', 'NUMBER(10)', 'Units sold', { termId: 'T-010', tags: ['CDE'] }), col('ON_HAND_UNITS', 'NUMBER(10)', 'Units on hand at week end', { termId: 'T-013' }),
        col('ON_HAND_COST_USD', 'NUMBER(14,2)', 'Inventory at cost, week end', { termId: 'T-029', tags: ['CDE'] }), col('COGS_USD', 'NUMBER(14,2)', 'Cost of goods sold in the week', { termId: 'T-011', tags: ['CDE'] }),
        col('SKUS_RANGED', 'NUMBER(6)', 'SKUs on the planogram'), col('SKUS_OUT_OF_STOCK', 'NUMBER(6)', 'Ranged SKUs with zero on hand', { termId: 'T-012', tags: ['CDE'] }),
      ],
      rowCount: 199_680, bytes: 1.4e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 05:58:40', upstream: ['CURATED_SILVER.STORE_INVENTORY', 'CONFORMED_GOLD.DIM_STORE'], rowAccess: regionAccess(),
      rows: memo(() => d.inventory.slice().reverse().map((x) => ({ INVENTORY_KEY: x.key, DATE_KEY: dateKey(x.week), STORE_KEY: x.storeKey, REGION: x.region, CATEGORY: x.category, BEGIN_ON_HAND_UNITS: x.begin, UNITS_RECEIVED: x.received, UNITS_SOLD: x.sold, ON_HAND_UNITS: x.end, ON_HAND_COST_USD: round(x.end * x.unitCost, 2), COGS_USD: round(x.sold * x.unitCost, 2), SKUS_RANGED: x.skus, SKUS_OUT_OF_STOCK: x.oos }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_SUPPLIER_DELIVERY', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 9, comment: 'Supplier delivery performance at PO line grain',
      columns: [
        col('PO_LINE_KEY', 'NUMBER', 'PO line'), col('SUPPLIER_KEY', 'NUMBER', 'Supplier'), col('DATE_KEY', 'NUMBER(8)', 'PO date'), col('CATEGORY', 'VARCHAR(30)', 'Merchandise category'), col('DC_NAME', 'VARCHAR(40)', 'Receiving DC'),
        col('ORDERED_UNITS', 'NUMBER(10)', 'Ordered units', { termId: 'T-015' }), col('RECEIVED_UNITS', 'NUMBER(10)', 'Received units', { termId: 'T-015', tags: ['CDE'] }), col('COST_USD', 'NUMBER(14,2)', 'Line cost', { termId: 'T-031' }),
        col('REQUESTED_DATE', 'DATE', 'Requested delivery date'), col('RECEIVED_DATE', 'DATE', 'Received at DC'), col('OTIF_FLAG', 'BOOLEAN', 'On time and in full (BR-014)', { termId: 'T-014', tags: ['CDE'] }),
        col('ASN_ACCURATE', 'BOOLEAN', 'ASN matched the receipt', { termId: 'T-017' }), col('LEAD_TIME_DAYS', 'NUMBER(4)', 'PO to receipt days', { termId: 'T-016' }),
      ],
      rowCount: 13_920_114, bytes: 9.6e8, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 04:50:00', upstream: ['CURATED_SILVER.SUPPLIER_PO_LINE', 'CONFORMED_GOLD.DIM_SUPPLIER'],
      rows: memo(() => d.poLines.slice().reverse().map((l) => ({ PO_LINE_KEY: l.key, SUPPLIER_KEY: l.supplierKey, DATE_KEY: dateKey(l.date), CATEGORY: l.category, DC_NAME: l.dc, ORDERED_UNITS: l.ordered, RECEIVED_UNITS: l.receivedUnits, COST_USD: l.cost, REQUESTED_DATE: l.requested, RECEIVED_DATE: l.received, OTIF_FLAG: l.otif, ASN_ACCURATE: l.asnAccurate, LEAD_TIME_DAYS: l.leadDays }))),
    },
    {
      schema: 'CONFORMED_GOLD', name: 'FCT_PROMO_SALES', layer: 'gold', type: 'DYNAMIC TABLE', targetLag: '1 hour', order: 10, comment: 'Promotion redemption lines with baseline, incremental margin and promotion cost',
      columns: [
        col('PROMO_SALE_KEY', 'NUMBER', 'Redemption line'), col('PROMO_KEY', 'NUMBER', 'Promotion', { termId: 'T-018', tags: ['CDE'] }), col('DATE_KEY', 'NUMBER(8)', 'Sale date'), col('STORE_KEY', 'NUMBER', 'Store'),
        col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003' }), col('CUSTOMER_KEY', 'NUMBER', 'Loyalty member (when identified)'), col('PRODUCT_KEY', 'NUMBER', 'Product'), col('CHANNEL', 'VARCHAR(12)', 'Store / E-commerce'),
        col('UNITS', 'NUMBER(6)', 'Units'), col('GROSS_SALES_USD', 'NUMBER(12,2)', 'Ticket value'), col('DISCOUNT_USD', 'NUMBER(12,2)', 'Promotional discount', { termId: 'T-028' }),
        col('NET_SALES_USD', 'NUMBER(12,2)', 'Net of discount', { termId: 'T-006' }), col('BASELINE_SALES_USD', 'NUMBER(12,2)', 'Modelled sales without the promotion', { termId: 'T-019', tags: ['CDE'] }),
        col('INCREMENTAL_MARGIN_USD', 'NUMBER(12,2)', 'Gross margin on sales above baseline', { termId: 'T-020', tags: ['CDE'] }), col('PROMO_COST_USD', 'NUMBER(12,2)', 'Discount funded by Harbor & Pine (net of vendor funding)', { termId: 'T-020' }),
        col('CARD_LAST4', 'VARCHAR(4)', 'Payment card last four digits (from the tender)', { tags: ['PCI'], maskPendingFix: GATE6_CHECK }),
      ],
      rowCount: 432_118, bytes: 5.2e7, owner: 'TRANSFORM_ADMIN', lastAltered: '2026-09-30 06:05:44', upstream: ['CURATED_SILVER.POS_TRANSACTION', 'CURATED_SILVER.ECOM_ORDER', 'CONFORMED_GOLD.DIM_PROMOTION', 'CONFORMED_GOLD.DIM_CUSTOMER'], rowAccess: regionAccess(),
      rows: memo(() => d.promoSales.slice().reverse().map((x) => ({ PROMO_SALE_KEY: x.key, PROMO_KEY: x.promoKey, DATE_KEY: dateKey(x.date), STORE_KEY: x.storeKey, REGION: x.region, CUSTOMER_KEY: x.memberKey, PRODUCT_KEY: x.productKey, CHANNEL: x.channel, UNITS: x.units, GROSS_SALES_USD: x.gross, DISCOUNT_USD: x.discount, NET_SALES_USD: x.net, BASELINE_SALES_USD: x.baseline, INCREMENTAL_MARGIN_USD: x.incrementalMargin, PROMO_COST_USD: x.promoCost, CARD_LAST4: x.cardLast4 }))),
    },
  ];

  const products: SfObject[] = [
    {
      schema: 'DATA_PRODUCTS', name: 'DP_CUSTOMER_LOYALTY_360', layer: 'product', type: 'SECURE VIEW', order: 3, comment: 'Output port of Customer & Loyalty 360',
      columns: [
        col('MEMBER_ID', 'VARCHAR(12)', 'Harbor Club member number', { termId: 'T-001', tags: ['CDE', 'PII'] }), col('MEMBER_NAME', 'VARCHAR(80)', 'Member name', { tags: ['PII'] }),
        col('EMAIL', 'VARCHAR(120)', 'Email', { tags: ['PII'] }), col('REGION', 'VARCHAR(20)', 'Home store region', { termId: 'T-003', tags: ['CDE'] }), col('HOME_STORE_ID', 'VARCHAR(8)', 'Home store'),
        col('TIER', 'VARCHAR(8)', 'Loyalty tier'), col('IS_ACTIVE', 'BOOLEAN', 'Active member (rule BR-001)', { termId: 'T-002', tags: ['CDE'] }), col('IS_OMNICHANNEL', 'BOOLEAN', 'Store and online buyer', { termId: 'T-027' }),
        col('PURCHASES_12M', 'NUMBER(4)', 'Purchase days, 12 months', { termId: 'T-026' }), col('SPEND_12M_USD', 'NUMBER(12,2)', 'Net spend, 12 months', { termId: 'T-030' }),
        col('LAST_PURCHASE_DATE', 'DATE', 'Last purchase'), col('PREDICTED_CLV_USD', 'NUMBER(12,2)', 'Predicted CLV (draft model)', { termId: 'T-024' }), col('POINTS_BALANCE', 'NUMBER(10)', 'Points'),
      ],
      rowCount: 5_200_000, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:00:00', upstream: ['CONFORMED_GOLD.DIM_CUSTOMER', 'CONFORMED_GOLD.FCT_SALES', 'CONFORMED_GOLD.DIM_STORE'], rowAccess: regionAccess(),
      rows: memo(() => {
        const since = addDays(AS_OF, -365);
        return d.members.map((m) => ({
          MEMBER_ID: m.id, MEMBER_NAME: `${m.first} ${m.last}`, EMAIL: m.email, REGION: m.region, HOME_STORE_ID: m.homeStoreId, TIER: m.tier,
          IS_ACTIVE: m.status === 'Active' && m.lastPurchase > since, IS_OMNICHANNEL: m.storeBuyer && m.onlineBuyer, PURCHASES_12M: m.purchases12m, SPEND_12M_USD: m.spend12m,
          LAST_PURCHASE_DATE: m.lastPurchase, PREDICTED_CLV_USD: m.clv, POINTS_BALANCE: m.points,
        }));
      }),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_SALES_PERFORMANCE', layer: 'product', type: 'SECURE VIEW', order: 4, comment: 'Output port of Sales Performance',
      columns: [
        col('SALES_DATE', 'DATE', 'Business date'), col('STORE_ID', 'VARCHAR(8)', 'Store'), col('STORE_NAME', 'VARCHAR(60)', 'Store name'), col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003', tags: ['CDE'] }),
        col('CHANNEL', 'VARCHAR(12)', 'Store / E-commerce', { termId: 'T-025' }), col('IS_COMP_STORE', 'BOOLEAN', 'Comparable store this month (BR-006)', { termId: 'T-005', tags: ['CDE'] }),
        col('PROMO_ID', 'VARCHAR(12)', 'Promotion running', { termId: 'T-018' }), col('PROMO_NAME', 'VARCHAR(60)', 'Promotion name'), col('NET_SALES_USD', 'NUMBER(14,2)', 'Net sales', { termId: 'T-006', tags: ['CDE'] }),
        col('GROSS_SALES_USD', 'NUMBER(14,2)', 'Gross sales'), col('DISCOUNT_USD', 'NUMBER(14,2)', 'Discounts', { termId: 'T-028' }), col('RETURNS_USD', 'NUMBER(14,2)', 'Returns', { termId: 'T-022' }),
        col('TRANSACTIONS', 'NUMBER(8)', 'Transactions', { termId: 'T-007', tags: ['CDE'] }), col('UNITS', 'NUMBER(9)', 'Units', { termId: 'T-008' }), col('LOYALTY_SALES_USD', 'NUMBER(14,2)', 'Loyalty-identified net sales', { termId: 'T-009' }),
      ],
      rowCount: 816_640, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:34:00', upstream: ['CONFORMED_GOLD.FCT_SALES', 'CONFORMED_GOLD.DIM_STORE', 'CONFORMED_GOLD.DIM_PROMOTION'], rowAccess: regionAccess(),
      rows: memo(() => d.sales.slice().reverse().map((x) => {
        const s = storeByKey.get(x.storeKey)!;
        const p = x.promoKey ? promoByKey.get(x.promoKey)! : null;
        return { SALES_DATE: x.date, STORE_ID: s.id, STORE_NAME: s.name, REGION: x.region, CHANNEL: x.channel, IS_COMP_STORE: isCompInMonth(s, x.month), PROMO_ID: p?.id ?? null, PROMO_NAME: p?.name ?? null, NET_SALES_USD: x.net, GROSS_SALES_USD: x.gross, DISCOUNT_USD: x.discount, RETURNS_USD: x.returns, TRANSACTIONS: x.txns, UNITS: x.units, LOYALTY_SALES_USD: x.loyalty };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_INVENTORY_HEALTH', layer: 'product', type: 'SECURE VIEW', order: 5, comment: 'Output port of Inventory Health',
      columns: [
        col('WEEK_ENDING', 'DATE', 'Week ending'), col('STORE_ID', 'VARCHAR(8)', 'Store'), col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003' }), col('CATEGORY', 'VARCHAR(30)', 'Merchandise category'),
        col('ON_HAND_UNITS', 'NUMBER(10)', 'Units on hand'), col('ON_HAND_COST_USD', 'NUMBER(14,2)', 'Inventory at cost', { termId: 'T-029' }), col('UNITS_SOLD', 'NUMBER(10)', 'Units sold', { termId: 'T-010', tags: ['CDE'] }),
        col('UNITS_RECEIVED', 'NUMBER(10)', 'Units received', { termId: 'T-010' }), col('SKUS_RANGED', 'NUMBER(6)', 'Ranged SKUs'), col('SKUS_OUT_OF_STOCK', 'NUMBER(6)', 'Out-of-stock SKUs', { termId: 'T-012', tags: ['CDE'] }),
        col('WEEKS_OF_SUPPLY', 'NUMBER(6,1)', 'On hand ÷ units sold this week', { termId: 'T-013' }),
      ],
      rowCount: 199_680, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:10:00', upstream: ['CONFORMED_GOLD.FCT_INVENTORY', 'CONFORMED_GOLD.DIM_STORE', 'CONFORMED_GOLD.DIM_PRODUCT'], rowAccess: regionAccess(),
      rows: memo(() => d.inventory.slice().reverse().map((x) => ({ WEEK_ENDING: x.week, STORE_ID: storeByKey.get(x.storeKey)!.id, REGION: x.region, CATEGORY: x.category, ON_HAND_UNITS: x.end, ON_HAND_COST_USD: round(x.end * x.unitCost, 2), UNITS_SOLD: x.sold, UNITS_RECEIVED: x.received, SKUS_RANGED: x.skus, SKUS_OUT_OF_STOCK: x.oos, WEEKS_OF_SUPPLY: round(x.end / Math.max(1, x.sold), 1) }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_SUPPLIER_PERFORMANCE', layer: 'product', type: 'SECURE VIEW', order: 6, comment: 'Output port of Supplier Performance',
      columns: [
        col('PO_NUMBER', 'VARCHAR(12)', 'PO'), col('LINE_NUMBER', 'NUMBER', 'Line'), col('PO_DATE', 'DATE', 'PO date'), col('SUPPLIER_NAME', 'VARCHAR(60)', 'Supplier'), col('CATEGORY', 'VARCHAR(30)', 'Category'),
        col('DC_NAME', 'VARCHAR(40)', 'Receiving DC'), col('ORDERED_UNITS', 'NUMBER(10)', 'Ordered'), col('RECEIVED_UNITS', 'NUMBER(10)', 'Received', { termId: 'T-015', tags: ['CDE'] }), col('COST_USD', 'NUMBER(14,2)', 'Cost', { termId: 'T-031' }),
        col('OTIF_FLAG', 'BOOLEAN', 'On time in full', { termId: 'T-014', tags: ['CDE'] }), col('ASN_ACCURATE', 'BOOLEAN', 'ASN accurate', { termId: 'T-017' }), col('LEAD_TIME_DAYS', 'NUMBER(4)', 'Lead time', { termId: 'T-016' }),
      ],
      rowCount: 13_920_114, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 05:00:00', upstream: ['CONFORMED_GOLD.FCT_SUPPLIER_DELIVERY', 'CONFORMED_GOLD.DIM_SUPPLIER'],
      rows: memo(() => d.poLines.slice().reverse().map((l) => ({ PO_NUMBER: l.po, LINE_NUMBER: l.line, PO_DATE: l.date, SUPPLIER_NAME: supplierByKey.get(l.supplierKey)!.name, CATEGORY: l.category, DC_NAME: l.dc, ORDERED_UNITS: l.ordered, RECEIVED_UNITS: l.receivedUnits, COST_USD: l.cost, OTIF_FLAG: l.otif, ASN_ACCURATE: l.asnAccurate, LEAD_TIME_DAYS: l.leadDays }))),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_PROMOTION_EFFECTIVENESS', layer: 'product', type: 'SECURE VIEW', order: 7, comment: 'Output port of Promotion Effectiveness (in certification)',
      columns: [
        col('PROMO_ID', 'VARCHAR(12)', 'Promotion', { termId: 'T-018', tags: ['CDE'] }), col('PROMO_NAME', 'VARCHAR(60)', 'Promotion name'), col('SALE_DATE', 'DATE', 'Sale date'), col('STORE_ID', 'VARCHAR(8)', 'Store'),
        col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003' }), col('CHANNEL', 'VARCHAR(12)', 'Channel'), col('CATEGORY', 'VARCHAR(30)', 'Merchandise category'), col('NET_SALES_USD', 'NUMBER(12,2)', 'Net sales', { termId: 'T-006' }),
        col('DISCOUNT_USD', 'NUMBER(12,2)', 'Discount', { termId: 'T-028' }), col('BASELINE_SALES_USD', 'NUMBER(12,2)', 'Baseline sales', { termId: 'T-019', tags: ['CDE'] }),
        col('INCREMENTAL_MARGIN_USD', 'NUMBER(12,2)', 'Incremental margin', { termId: 'T-020', tags: ['CDE'] }), col('PROMO_COST_USD', 'NUMBER(12,2)', 'Promotion cost', { termId: 'T-020' }),
        col('CARD_LAST4', 'VARCHAR(4)', 'Payment card last four (from FCT_PROMO_SALES)', { tags: ['PCI'], maskPendingFix: GATE6_CHECK }),
      ],
      rowCount: 432_118, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-30 06:06:00', upstream: ['CONFORMED_GOLD.FCT_PROMO_SALES', 'CONFORMED_GOLD.DIM_PROMOTION', 'CONFORMED_GOLD.DIM_STORE'], rowAccess: regionAccess(),
      rows: memo(() => d.promoSales.slice().reverse().map((x) => {
        const p = promoByKey.get(x.promoKey)!;
        return { PROMO_ID: p.id, PROMO_NAME: p.name, SALE_DATE: x.date, STORE_ID: storeByKey.get(x.storeKey)!.id, REGION: x.region, CHANNEL: x.channel, CATEGORY: x.category, NET_SALES_USD: x.net, DISCOUNT_USD: x.discount, BASELINE_SALES_USD: x.baseline, INCREMENTAL_MARGIN_USD: x.incrementalMargin, PROMO_COST_USD: x.promoCost, CARD_LAST4: x.cardLast4 };
      })),
    },
    {
      schema: 'DATA_PRODUCTS', name: 'DP_RETURNS_FRAUD', layer: 'product', type: 'SECURE VIEW', order: 8, comment: 'Output port of Returns & Fraud (draft)',
      columns: [
        col('RETURN_ID', 'VARCHAR(12)', 'Return'), col('RETURN_DATE', 'DATE', 'Return date'), col('STORE_ID', 'VARCHAR(8)', 'Store'), col('REGION', 'VARCHAR(20)', 'Store region', { termId: 'T-003' }),
        col('CHANNEL', 'VARCHAR(12)', 'Original channel'), col('MEMBER_ID', 'VARCHAR(12)', 'Loyalty member', { tags: ['PII'], termId: 'T-001' }), col('RETURN_AMOUNT_USD', 'NUMBER(12,2)', 'Refund amount', { termId: 'T-022' }),
        col('REASON', 'VARCHAR(30)', 'Return reason'), col('HAS_RECEIPT', 'BOOLEAN', 'Receipt presented'), col('IS_SUSPICIOUS', 'BOOLEAN', 'Suspicious return (BR-017)', { termId: 'T-023', tags: ['CDE'] }),
        col('SUSPICIOUS_REASON', 'VARCHAR(40)', 'Why flagged'),
      ],
      rowCount: 34_660_480, owner: 'DATA_PRODUCT_OWNER', lastAltered: '2026-09-29 02:00:00', upstream: ['CURATED_SILVER.RETURN_TXN', 'CONFORMED_GOLD.FCT_SALES'], rowAccess: regionAccess(),
      rows: memo(() => d.returns.slice().reverse().map((r) => ({ RETURN_ID: r.id, RETURN_DATE: r.date, STORE_ID: storeByKey.get(r.storeKey)!.id, REGION: r.region, CHANNEL: r.channel, MEMBER_ID: r.memberKey ? memberByKey.get(r.memberKey)!.id : null, RETURN_AMOUNT_USD: r.amount, REASON: r.reason, HAS_RECEIPT: r.hasReceipt, IS_SUSPICIOUS: r.suspicious, SUSPICIOUS_REASON: r.suspiciousReason }))),
    },
  ];

  return [...bronze, ...silver, ...gold, ...products];
}
