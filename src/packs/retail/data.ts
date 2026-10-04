// Harbor & Pine synthetic data (spec section 6). Generated once per pack load from a seeded PRNG,
// so every demo run shows the same numbers and the agents always agree with the Explorer.
import { Rng } from '../../mock-snowflake/rng';
import { addDays, dateRange, pad, person, round, sum, toDate } from '../../mock-snowflake/generators';
import {
  AS_OF, CATEGORIES, CAT_SEASON, DCS, DOW, FORMATS, PROMOS_2025, PROMOS_2026, PRODUCTION, REGIONS, RETURN_REASONS,
  RETURN_REASON_WEIGHTS, SCALES, SEASON, SUPPLIERS, TARGETS, VOLUMES, type PromoSpec,
} from './generators.config';

export interface Store {
  key: number; id: string; name: string; city: string; state: string; region: string; regionCode: string; format: string;
  sqft: number; openDate: string; remodel?: { from: string; to: string }; base: number; growth: number; basket: number;
}
export interface Promo extends PromoSpec { key: number; year: number; offersIssued: number }
export interface Sale {
  key: number; storeKey: number; region: string; date: string; month: string; channel: 'Store' | 'E-commerce'; promoKey: number | null;
  gross: number; discount: number; returns: number; net: number; txns: number; units: number; loyalty: number;
}
export interface Member {
  key: number; id: string; first: string; last: string; email: string; phone: string; homeStoreKey: number; homeStoreId: string;
  region: string; regionCode: string; tier: 'Member' | 'Plus' | 'Elite'; priorTier?: 'Member' | 'Plus'; tierChangedOn?: string;
  enrolled: string; status: 'Active' | 'Closed'; lastPurchase: string; purchases12m: number; spend12m: number;
  storeBuyer: boolean; onlineBuyer: boolean; clv: number; points: number;
}
export interface Product { key: number; sku: string; name: string; category: string; subcategory: string; brand: string; cost: number; retail: number; supplierKey: number }
export interface Inv {
  key: number; storeKey: number; region: string; category: string; week: string; begin: number; received: number; sold: number;
  end: number; unitCost: number; skus: number; oos: number;
}
export interface Supplier { key: number; name: string; category: string; preferred: boolean; ediCompliant: boolean }
export interface PoLine {
  key: number; po: string; line: number; supplierKey: number; supplier: string; category: string; dc: string; date: string;
  requested: string; received: string; ordered: number; receivedUnits: number; unitCost: number; cost: number;
  onTime: boolean; inFull: boolean; otif: boolean; asnAccurate: boolean; leadDays: number;
}
export interface PromoSale {
  key: number; promoKey: number; date: string; storeKey: number; region: string; channel: 'Store' | 'E-commerce'; memberKey: number | null;
  productKey: number; category: string; units: number; gross: number; discount: number; net: number; baseline: number;
  incrementalMargin: number; promoCost: number; cardLast4: string | null;
}
export interface ReturnTxn {
  key: number; id: string; storeKey: number; region: string; date: string; channel: 'Store' | 'E-commerce'; memberKey: number | null;
  amount: number; reason: string; hasReceipt: boolean; suspicious: boolean; suspiciousReason: string | null;
}

/** Store-day index over the sales rows: cells[storeKey - 1][dayIndex] holds that store-day's channel rows. */
export interface SalesGrid { idx: Map<string, number>; cells: (Sale[] | undefined)[][] }

export interface RetailData {
  stores: Store[];
  promos: Promo[];
  sales: Sale[];
  members: Member[];
  products: Product[];
  inventory: Inv[];
  suppliers: Supplier[];
  poLines: PoLine[];
  promoSales: PromoSale[];
  returns: ReturnTxn[];
  /** sales index: `${storeKey}|${date}` -> rows for that store-day */
  byStoreDay: SalesGrid;
  storeScale: number;
  memberScale: number;
}

const SALES_FROM = '2025-01-01';
export const INV_WEEKS = (() => {
  const out: string[] = [];
  for (let d = '2025-10-05'; d <= AS_OF; d = addDays(d, 7)) out.push(d); // week ending Sunday
  return out;
})();

const WEEK_AHEAD_MONTH = new Map(INV_WEEKS.map((w) => [w, Number(addDays(w, 21).slice(5, 7)) - 1]));
const WEEK_START = new Map(INV_WEEKS.map((w) => [w, addDays(w, -6)]));

const STORE_SUFFIX = ['Commons', 'Town Center', 'Galleria', 'Crossing', 'Marketplace', 'Square'];

export function generateRetail(seed: number): RetailData {
  const rng = new Rng(seed);

  // ---- Stores: 64 sampled stores standing in for 640
  const stores: Store[] = [];
  const nameUse = new Map<string, number>();
  for (const r of REGIONS) {
    for (let i = 0; i < r.stores; i++) {
      const [city, state] = r.towns[i % r.towns.length];
      const n = nameUse.get(city) ?? 0;
      nameUse.set(city, n + 1);
      const fmt = i === 0 ? FORMATS[0] : rng.weighted(FORMATS, FORMATS.map((f) => f.weight));
      stores.push({
        key: stores.length + 1, id: `HP${pad(100 + stores.length * 9 + rng.int(0, 8), 4)}`,
        name: n === 0 ? city : `${city} ${STORE_SUFFIX[(n - 1) % STORE_SUFFIX.length]}`, city, state, region: r.name, regionCode: r.code,
        format: fmt.name, sqft: Math.round((fmt.sqft * rng.range(0.85, 1.15)) / 100) * 100,
        openDate: addDays('2008-03-01', rng.int(0, 5600)), base: rng.lognormal(12_800, 0.2) * fmt.factor,
        growth: rng.normal(r.comp - 0.012, 0.02), basket: fmt.basket * rng.range(0.94, 1.06),
      });
    }
  }
  // New stores (not yet comparable) and remodels (excluded from comp while affected).
  const newOpens = ['2025-04-11', '2025-06-20', '2025-09-12', '2025-10-17', '2025-11-07', '2026-03-13', '2026-05-15'];
  [5, 21, 37, 44, 52, 60, 12].forEach((k, i) => (stores[k].openDate = newOpens[i]));
  stores[9].remodel = { from: '2026-02-02', to: '2026-03-15' };
  stores[29].remodel = { from: '2025-08-04', to: '2025-09-14' };
  stores[48].remodel = { from: '2026-05-04', to: '2026-06-14' };

  // ---- Promotions
  const promos: Promo[] = [...PROMOS_2025, ...PROMOS_2026].map((p, i) => ({ ...p, key: i + 1, year: Number(p.from.slice(0, 4)), offersIssued: 0 }));
  const promoFor = (region: string, date: string) => promos.find((p) => date >= p.from && date <= p.to && p.regions.includes(region));

  // ---- Daily store sales by channel, 2025-01-01 .. 2026-09-30
  const days = dateRange(SALES_FROM, AS_OF).map((d) => ({
    d, month: d.slice(0, 7), ty: d >= '2026-01-01', season: SEASON[Number(d.slice(5, 7)) - 1] * DOW[toDate(d).getUTCDay()],
    promo: Object.fromEntries(REGIONS.map((r) => [r.name, promoFor(r.name, d)])) as Record<string, Promo | undefined>,
  }));
  const sales: Sale[] = [];
  const byStoreDay: SalesGrid = { idx: new Map(days.map((x, i) => [x.d, i])), cells: stores.map(() => new Array(days.length)) };
  for (const s of stores) {
    const ecomShare = rng.range(0.23, 0.29);
    const cells = byStoreDay.cells[s.key - 1];
    for (let di = 0; di < days.length; di++) {
      const { d, month, ty, season, promo: promos_ } = days[di];
      if (d < s.openDate) continue;
      if (s.remodel && d >= s.remodel.from && d <= s.remodel.to) continue;
      const promo = promos_[s.region];
      const lift = 1 + (promo?.lift ?? 0);
      const postRemodel = s.remodel && d > s.remodel.to ? 1.1 : 1;
      const cell: Sale[] = (cells[di] = []);
      for (const channel of ['Store', 'E-commerce'] as const) {
        const ecom = channel === 'E-commerce';
        const growth = ty ? 1 + s.growth + (ecom ? 0.07 : 0) : 1;
        const base = s.base * (ecom ? ecomShare : 1) * (ecom ? 1 : postRemodel);
        const net = base * season * lift * growth * (ecom ? rng.range(0.85, 1.15) : rng.range(0.9, 1.1));
        const discRate = (ecom ? 0.09 : 0.075) + (promo ? promo.discountPct * 0.3 : 0);
        const retRate = (ecom ? 0.168 : 0.068) * rng.range(0.83, 1.17);
        const gross = net / (1 - discRate - retRate);
        const basket = (ecom ? 118 : 76 * s.basket) * (ty ? 1.02 : 1) * rng.range(0.95, 1.05);
        const txns = Math.max(1, Math.round(net / basket));
        const loyShare = (ecom ? 0.71 : 0.57) + (ty ? 0.015 : 0) + (promo?.type === 'Loyalty offer' ? 0.06 : 0);
        const row: Sale = {
          key: sales.length + 1, storeKey: s.key, region: s.region, date: d, month, channel, promoKey: promo?.key ?? null,
          gross, discount: gross * discRate, returns: gross * retRate, net, txns,
          units: Math.max(1, Math.round(txns * (ecom ? 2.1 : 2.6) * (ty ? 0.99 : 1) * rng.range(0.93, 1.07))),
          loyalty: net * Math.min(0.95, loyShare * rng.range(0.96, 1.04)),
        };
        sales.push(row);
        cell.push(row);
      }
    }
  }
  calibrateComp(stores, sales, byStoreDay);

  // ---- Loyalty members: 2,000 standing in for 5.2 M
  const storeW = stores.map((s) => s.base);
  const members: Member[] = [];
  for (let i = 0; i < VOLUMES.members; i++) {
    const st = rng.weighted(stores, storeW);
    const p = person(rng, i, 'harbormail.com');
    const tierRoll = rng.float();
    const tier = tierRoll < 0.08 ? 'Elite' : tierRoll < 0.32 ? 'Plus' : 'Member';
    const closed = rng.chance(0.03);
    const active = !closed && rng.chance(0.75);
    const daysAgo = active ? Math.min(364, Math.floor(rng.lognormal(tier === 'Elite' ? 34 : tier === 'Plus' ? 45 : 85, 0.95))) : rng.int(366, 1400);
    const purchases = active ? Math.max(1, Math.round(rng.lognormal(tier === 'Elite' ? 9 : tier === 'Plus' ? 3.6 : 1.5, 0.6))) : 0;
    const basket = tier === 'Elite' ? 142 : tier === 'Plus' ? 98 : 76;
    const spend = round(sum(Array.from({ length: purchases }, () => basket * rng.lognormal(1, 0.35))), 2);
    const online = active && rng.chance(tier === 'Elite' ? 0.52 : 0.33);
    const store = active && (!online || rng.chance(0.82));
    const hasHistory = tier !== 'Member' && rng.chance(0.28);
    members.push({
      key: i + 1, id: `HC${pad(310_000_000 + i * 2_617 + rng.int(0, 2_600), 9)}`, first: p.first, last: p.last, email: p.email,
      phone: `(${rng.int(201, 989)}) 555-${pad(rng.int(0, 9999), 4)}`, homeStoreKey: st.key, homeStoreId: st.id, region: st.region, regionCode: st.regionCode,
      tier, priorTier: hasHistory ? (tier === 'Elite' ? 'Plus' : 'Member') : undefined, tierChangedOn: hasHistory ? addDays('2025-02-01', rng.int(0, 560)) : undefined,
      enrolled: addDays('2014-05-01', rng.int(0, 4300)), status: closed ? 'Closed' : 'Active', lastPurchase: addDays(AS_OF, -daysAgo),
      purchases12m: purchases, spend12m: spend, storeBuyer: store || (active && !online), onlineBuyer: online,
      clv: round(Math.max(40, spend) * rng.lognormal(2.6, 0.3) + (active ? 0 : 60), 2), points: Math.round(spend * (tier === 'Elite' ? 3 : tier === 'Plus' ? 2 : 1) * rng.range(0.3, 1.2)),
    });
  }

  // ---- Suppliers and products
  const suppliers: Supplier[] = SUPPLIERS.map((s, i) => ({ key: i + 1, name: s.name, category: s.category, preferred: s.otif >= 0.92, ediCompliant: s.asn >= 0.93 }));
  const ADJ = ['Coastal', 'Harbor', 'Linen', 'Oak', 'Driftwood', 'Slate', 'Willow', 'Ember', 'Juniper', 'Sandstone', 'Fern', 'Maple'];
  const NOUN: Record<string, [string, string][]> = {
    Furniture: [['Sofa', 'Living'], ['Accent Chair', 'Living'], ['Dining Table', 'Dining furniture'], ['Bookcase', 'Storage'], ['Bed Frame', 'Bedroom'], ['Nightstand', 'Bedroom']],
    'Bedding & Bath': [['Duvet Cover', 'Bedding'], ['Sheet Set', 'Bedding'], ['Quilt', 'Bedding'], ['Bath Towel', 'Bath'], ['Bath Mat', 'Bath'], ['Pillow', 'Bedding']],
    'Kitchen & Dining': [['Dinnerware Set', 'Tabletop'], ['Chef Knife', 'Cookware'], ['Dutch Oven', 'Cookware'], ['Glass Tumbler', 'Glassware'], ['Serving Bowl', 'Tabletop'], ['Skillet', 'Cookware']],
    'Home Decor': [['Area Rug', 'Rugs'], ['Table Lamp', 'Lighting'], ['Wall Mirror', 'Wall decor'], ['Candle', 'Fragrance'], ['Throw Blanket', 'Textiles'], ['Vase', 'Accents']],
    'Outdoor Living': [['Patio Chair', 'Patio furniture'], ['Outdoor Rug', 'Outdoor decor'], ['Planter', 'Garden'], ['Lantern', 'Outdoor lighting'], ['Fire Pit', 'Patio furniture']],
    Seasonal: [['Wreath', 'Holiday'], ['Ornament Set', 'Holiday'], ['Harvest Garland', 'Harvest'], ['Pumpkin Decor', 'Harvest'], ['String Lights', 'Holiday']],
  };
  const products: Product[] = [];
  for (const c of CATEGORIES) {
    const sups = suppliers.filter((s) => s.category === c.name);
    for (let i = 0; i < c.products; i++) {
      const [noun, sub] = rng.pick(NOUN[c.name]);
      const cost = round(c.cost * rng.lognormal(1, 0.4), 2);
      products.push({
        key: products.length + 1, sku: `SKU-${pad(400_000 + products.length * 37 + rng.int(0, 30), 6)}`, name: `${rng.pick(ADJ)} ${noun}`,
        category: c.name, subcategory: sub, brand: rng.chance(0.6) ? 'Harbor & Pine' : rng.chance(0.5) ? 'Pine Studio' : 'Partner brand',
        cost, retail: Math.max(4.99, Math.round(cost / (1 - rng.range(0.52, 0.6))) - 0.01), supplierKey: rng.pick(sups.length ? sups : suppliers).key,
      });
    }
  }

  // ---- Weekly inventory snapshots: store × category × 52 weeks (order-up-to replenishment)
  const inventory: Inv[] = [];
  for (const s of stores) {
    const sf = s.base / 12_800;
    for (const c of CATEGORIES) {
      const skus = Math.round(c.skus * Math.min(1.6, Math.max(0.6, sf)));
      const weekly = (wk: string) => c.units * sf * CAT_SEASON[c.name][Number(wk.slice(5, 7)) - 1];
      const ahead = (wk: string) => c.units * sf * CAT_SEASON[c.name][WEEK_AHEAD_MONTH.get(wk)!];
      const unitCost = round(c.cost * rng.range(0.95, 1.05), 2);
      let onHand = Math.round(weekly(INV_WEEKS[0]) * c.wos * rng.range(0.9, 1.1));
      const wosBias = rng.range(0.8, 1.15);
      for (const wk of INV_WEEKS) {
        if (WEEK_START.get(wk)! < s.openDate) continue;
        const demand = Math.round(weekly(wk) * Math.max(0.4, rng.normal(1, 0.12)));
        const begin = onHand;
        const target = ahead(wk) * c.wos * wosBias;
        const received = Math.max(0, Math.round((target - (begin - demand)) * rng.range(0.55, 1.1)));
        const sold = Math.min(demand, begin + received);
        onHand = begin + received - sold;
        const wosNow = onHand / Math.max(1, weekly(wk));
        const oosRate = Math.min(0.3, 0.045 * Math.pow(c.wos / Math.max(1, wosNow), 1.1) * rng.range(0.7, 1.3));
        inventory.push({ key: inventory.length + 1, storeKey: s.key, region: s.region, category: c.name, week: wk, begin, received, sold, end: onHand, unitCost, skus, oos: Math.round(skus * oosRate) });
      }
    }
  }

  // ---- Purchase order lines from supplier EDI (Oct 2025 – Sep 2026)
  const poDays = dateRange('2025-10-01', AS_OF);
  const poLines: PoLine[] = [];
  let poNo = 7_100_450_000;
  while (poLines.length < VOLUMES.poLines) {
    const si = rng.weighted(SUPPLIERS.map((_, i) => i), SUPPLIERS.map((s) => (s.category === 'Kitchen & Dining' || s.category === 'Home Decor' ? 1.1 : 0.9)));
    const s = SUPPLIERS[si];
    const date = rng.pick(poDays);
    poNo += rng.int(1, 7);
    const lines = rng.int(1, 5);
    for (let l = 1; l <= lines && poLines.length < VOLUMES.poLines; l++) {
      const ordered = Math.max(6, Math.round(rng.lognormal(s.units, 0.6)));
      const unitCost = round(s.unitCost * rng.lognormal(1, 0.25), 2);
      const requested = addDays(date, s.lead + rng.int(-4, 6));
      poLines.push({
        key: poLines.length + 1, po: String(poNo), line: l * 10, supplierKey: si + 1, supplier: s.name, category: s.category, dc: rng.pick(DCS),
        date, requested, received: requested, ordered, receivedUnits: ordered, unitCost, cost: round(ordered * unitCost, 2),
        onTime: true, inFull: true, otif: true, asnAccurate: rng.chance(s.asn), leadDays: 0,
      });
    }
  }
  SUPPLIERS.forEach((s, si) => {
    const mine = poLines.filter((p) => p.supplierKey === si + 1);
    const bad = rng.shuffle([...mine]).slice(0, Math.round(mine.length * (1 - s.otif)));
    bad.forEach((p, i) => {
      if (i % 3 !== 2) { p.onTime = false; p.received = addDays(p.requested, rng.int(2, 15)); }
      if (i % 3 !== 0) { p.inFull = false; p.receivedUnits = Math.round(p.ordered * rng.range(0.62, 0.96)); }
      p.otif = false;
    });
    for (const p of mine) {
      if (p.onTime) p.received = addDays(p.requested, -rng.int(0, 3));
      if (p.inFull && rng.chance(0.3)) p.receivedUnits = p.ordered - (rng.chance(0.5) ? 0 : Math.floor(p.ordered * 0.01));
      p.leadDays = Math.max(1, Math.round((toDate(p.received).getTime() - toDate(p.date).getTime()) / 86_400_000));
    }
  });
  // POs whose requested date is after the as-of date are still open: drop them from the received sample.
  const received = poLines.filter((p) => p.received <= AS_OF).map((p, i) => ({ ...p, key: i + 1 }));

  // ---- Promotion redemption lines (2026 promotions, DP-05)
  const membersByRegion = new Map<string, Member[]>();
  for (const m of members) if (m.status === 'Active') { const a = membersByRegion.get(m.region); if (a) a.push(m); else membersByRegion.set(m.region, [m]); }
  const promoSales: PromoSale[] = [];
  for (const p of promos.filter((x) => x.year === 2026)) {
    const pStores = stores.filter((s) => p.regions.includes(s.region));
    const pProducts = products.filter((x) => p.categories.includes(x.category));
    const before = promoSales.length;
    for (const d of dateRange(p.from, p.to)) {
      const n = Math.round(VOLUMES.promoSalesPerDay * (p.regions.length / 4) * rng.range(0.8, 1.2) * (p.type === 'Loyalty offer' ? 0.8 : 1));
      for (let i = 0; i < n; i++) {
        const st = rng.pick(pStores.filter((s) => s.openDate <= d));
        const pr = rng.pick(pProducts);
        const loyal = p.type === 'Loyalty offer' || rng.chance(0.64);
        const mem = loyal ? rng.pick(membersByRegion.get(st.region) ?? members) : null;
        const units = pr.retail > 150 ? 1 : rng.int(1, 3);
        const gross = round(units * pr.retail, 2);
        const discount = round(gross * p.discountPct, 2);
        const net = round(gross - discount, 2);
        const itemLift = Math.max(0.05, rng.normal(p.itemLift, 0.12));
        const baseline = round(net / (1 + itemLift), 2);
        promoSales.push({
          key: promoSales.length + 1, promoKey: p.key, date: d, storeKey: st.key, region: st.region, channel: rng.chance(0.3) ? 'E-commerce' : 'Store',
          memberKey: mem?.key ?? null, productKey: pr.key, category: pr.category, units, gross, discount, net, baseline,
          incrementalMargin: round((net - baseline) * 0.55, 2), promoCost: round(discount * (1 - p.vendorFundedPct), 2),
          cardLast4: rng.chance(0.88) ? pad(rng.int(0, 9999), 4) : null,
        });
      }
    }
    p.offersIssued = Math.round(((promoSales.length - before) * SCALES.promoSales) / (p.redemption * rng.range(0.95, 1.05)) / 1000) * 1000;
  }

  // ---- Returns (Q3 2026 sample, DP-06)
  const q3Days = dateRange('2026-07-01', AS_OF);
  const returns: ReturnTxn[] = [];
  const serial = rng.shuffle(members.filter((m) => m.status === 'Active').slice(0, 400)).slice(0, 7);
  const retStores = stores.filter((s) => s.openDate <= '2026-07-01');
  const retW = retStores.map((s) => s.base);
  for (let i = 0; i < VOLUMES.returns; i++) {
    const st = rng.weighted(retStores, retW);
    const channel = rng.chance(0.38) ? 'E-commerce' : 'Store';
    const hasReceipt = rng.chance(0.88);
    const amount = round(hasReceipt ? rng.lognormal(72, 0.85) : rng.lognormal(115, 0.95), 2);
    const mem = rng.chance(0.6) ? rng.pick(membersByRegion.get(st.region) ?? members) : null;
    returns.push({
      key: i + 1, id: `RT-${pad(88_000_000 + i * 13 + rng.int(0, 12), 8)}`, storeKey: st.key, region: st.region, date: rng.pick(q3Days), channel,
      memberKey: mem?.key ?? null, amount, reason: rng.weighted(RETURN_REASONS, RETURN_REASON_WEIGHTS), hasReceipt, suspicious: false, suspiciousReason: null,
    });
  }
  // Serial returners: 6–8 returns inside 30 days each.
  for (const m of serial) {
    const st = stores.find((s) => s.key === m.homeStoreKey)!;
    const start = addDays('2026-07-01', rng.int(0, 55));
    for (let k = 0, n = rng.int(6, 8); k < n; k++) {
      returns.push({
        key: returns.length + 1, id: `RT-${pad(89_500_000 + returns.length * 7, 8)}`, storeKey: st.key, region: st.region, date: addDays(start, rng.int(0, 28)),
        channel: 'Store', memberKey: m.key, amount: round(rng.lognormal(140, 0.5), 2), reason: rng.pick(['Changed mind', 'Defective', 'Not as described']),
        hasReceipt: rng.chance(0.5), suspicious: false, suspiciousReason: null,
      });
    }
  }
  flagSuspicious(returns);
  returns.sort((a, b) => (a.date === b.date ? a.key - b.key : a.date < b.date ? -1 : 1));

  return {
    stores, promos, sales, members, products, inventory, suppliers, poLines: received, promoSales, returns, byStoreDay,
    storeScale: PRODUCTION.stores / stores.length, memberScale: PRODUCTION.members / VOLUMES.members,
  };
}

/** BR-017: suspicious when no receipt and over $250, or the member made more than 5 returns in 30 days. */
function flagSuspicious(rs: ReturnTxn[]) {
  const byMember = new Map<number, ReturnTxn[]>();
  for (const r of rs) if (r.memberKey) { const a = byMember.get(r.memberKey); if (a) a.push(r); else byMember.set(r.memberKey, [r]); }
  for (const r of rs) {
    if (!r.hasReceipt && r.amount > 250) {
      r.suspicious = true;
      r.suspiciousReason = 'No receipt over $250';
      continue;
    }
    const mine = r.memberKey ? byMember.get(r.memberKey)! : [];
    const near = mine.filter((x) => Math.abs(toDate(x.date).getTime() - toDate(r.date).getTime()) <= 30 * 86_400_000);
    if (near.length > 5) {
      r.suspicious = true;
      r.suspiciousReason = 'More than 5 returns in 30 days';
    }
  }
}

// ---- Comparable store logic (BR-006): open 13+ full months before the month starts, remodels excluded.
const monthStart = (m: string) => `${m}-01`;
export function addMonths(m: string, n: number) {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(mo / 12);
  return `${yy}-${pad(((mo % 12) + 12) % 12 + 1)}`;
}
const overlapsMonth = (w: { from: string; to: string }, m: string) => w.from <= `${m}-31` && w.to >= monthStart(m);

const compCache = new WeakMap<Store, Map<string, boolean>>();
/** Whether a store counts as comparable in TY month `m` (YYYY-MM). */
export function isCompInMonth(s: Store, m: string): boolean {
  let c = compCache.get(s);
  if (!c) compCache.set(s, (c = new Map()));
  let v = c.get(m);
  if (v === undefined) {
    v = !(s.openDate > monthStart(addMonths(m, -13))) && !(s.remodel && (overlapsMonth(s.remodel, m) || overlapsMonth(s.remodel, addMonths(m, -12))));
    c.set(m, v);
  }
  return v;
}

/** TY/LY comp-store sales over TY dates (LY = same weekday 364 days earlier). */
export function compTotals(stores: Store[], grid: SalesGrid, tyDates: string[], include: (s: Store, d: string) => boolean = () => true, channel?: Sale['channel']) {
  let ty = 0;
  let ly = 0;
  let storeDays = 0;
  for (const s of stores) {
    const cells = grid.cells[s.key - 1];
    for (const d of tyDates) {
      if (!include(s, d) || !isCompInMonth(s, d.slice(0, 7))) continue;
      const di = grid.idx.get(d);
      if (di === undefined || di < 364) continue;
      const a = cells[di];
      const b = cells[di - 364];
      if (!a || !b) continue;
      for (const x of a) if (!channel || x.channel === channel) ty += x.net;
      for (const x of b) if (!channel || x.channel === channel) ly += x.net;
      storeDays++;
    }
  }
  return { ty, ly, pct: ly ? ((ty - ly) / ly) * 100 : 0, storeDays };
}

/** Scale TY sales volumes so YTD comparable store sales land on the configured target. */
function calibrateComp(stores: Store[], sales: Sale[], byStoreDay: SalesGrid) {
  const ytd = dateRange('2026-01-01', AS_OF);
  // Comp is linear in TY volumes, so one uniform scale lands it exactly. Money is rounded to cents in the same pass.
  const c = compTotals(stores, byStoreDay, ytd);
  const k = (c.ly * (1 + TARGETS.compYtd)) / c.ty;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  for (const x of sales) {
    const f = x.date < '2026-01-01' ? 1 : k;
    x.gross = r2(x.gross * f); x.discount = r2(x.discount * f); x.returns = r2(x.returns * f); x.loyalty = r2(x.loyalty * f);
    x.net = r2(x.gross - x.discount - x.returns);
  }
}
