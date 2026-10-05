// E8 Cost model. Illustrative only: every rate below is a placeholder the presenter can change, and every volume comes
// from the pack catalog (object sizes, target lags, product query volumes, agents, DMFs). No real pricing is embedded.
import type { IndustryPack, LayerId } from '../types';
import type { CostLevers, Tooling } from './state';

export type WhSize = 'XS' | 'S' | 'M' | 'L';
export const WH_CREDITS: Record<WhSize, number> = { XS: 1, S: 2, M: 4, L: 8 };
export const LAG_STEPS = [1, 5, 15, 30, 60, 120, 240, 480, 720, 1440];

/** Placeholder rates. Presenter-editable fields live in CostLevers (credit price, currency). */
export const COST_CONFIG = {
  /** Seconds an incremental refresh takes on a Medium warehouse, before size scaling. */
  refreshBaseSec: 6,
  refreshSecPerLog10Bytes: 7,
  /** Runtime scales roughly with 1/size^0.85, so larger warehouses cost slightly more per refresh. */
  sizeScaling: 0.85,
  dailyJobSec: 45,
  biAvgSec: 3,
  biCacheHit: 0.55,
  storagePerTbMonth: 23,
  searchCreditsPerDocMonth: 0.02,
  searchCreditsPerQuery: 0.0006,
  aiTokensPerQuestion: 6800,
  aiCreditsPerMillionTokens: 2,
  sqlPerQuestion: 2,
  sqlSecPerQuery: 1.5,
  dmfCreditsPerCheck: 0.001,
  monitorHeadroom: 1.3,
  monthElapsed: 0.7,
};

export interface CostItem {
  driver: 'Dynamic table refresh' | 'Transformation jobs' | 'BI and ad-hoc queries' | 'Storage' | 'Cortex Search' | 'Cortex Analyst and agents' | 'Data metric functions';
  layer: LayerId;
  label: string;
  objectId?: string;
  productId?: string;
  agentId?: string;
  credits: number;
  usd: number;
  /** Split of agent cost between model tokens and SQL execution */
  split?: { tokens: number; sql: number };
}

export interface CostResult {
  items: CostItem[];
  total: number;
  byLayer: Record<string, number>;
  months: { label: string; byLayer: Record<string, number>; total: number }[];
  byProduct: { productId: string; usd: number; perConsumer: number; per1kQueries: number; queriesPerWeek: number; consumers: number; lagMin: number; slaMin: number; breach: boolean }[];
  byAgent: { agentId: string; usd: number; questionsPerDay: number; perQuestion: number; tokens: number; sql: number }[];
  guardrails: { monitor: string; warehouse: string; quota: number; usedPct: number; level: 'ok' | 'warn' | 'bad' }[];
  icebergNote?: string;
}

const fqn = (o: { schema: string; name: string }) => `${o.schema}.${o.name}`;

export function parseLag(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d+)\s*(minute|min|hour|day)/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2].toLowerCase().startsWith('h') ? n * 60 : m[2].toLowerCase().startsWith('d') ? n * 1440 : n;
}

/** Freshness SLA in minutes from the product's SLA text. */
export function slaMinutes(sla: string): number {
  const s = sla.toLowerCase();
  const every = s.match(/every\s+(\d+)\s*(min|hour|h)/);
  if (every) return Number(every[1]) * (every[2].startsWith('h') ? 60 : 1);
  if (s.includes('hourly')) return 60;
  if (s.includes('weekly')) return 10080;
  if (s.includes('monthly')) return 43200;
  return 1440;
}

export const fmtLag = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : `${m / 1440} d`);

/** Dynamic tables each product depends on (transitively, through views and dims). */
export function productDts(pack: IndustryPack, productId: string): string[] {
  const p = pack.products.find((x) => x.id === productId);
  if (!p) return [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    pack.objects.find((o) => fqn(o) === id)?.upstream.forEach(walk);
  };
  p.upstream.forEach(walk);
  return pack.objects.filter((o) => o.targetLag && seen.has(fqn(o))).map(fqn);
}

/**
 * Each dynamic table belongs to one group, owned by the product that reads it most directly (fewest hops),
 * ties going to the tightest freshness SLA. The group's target-lag lever scales every table in it.
 */
export function dtOwners(pack: IndustryPack): Map<string, string> {
  const owners = new Map<string, string>();
  const hops = (pid: string, target: string): number => {
    const p = pack.products.find((x) => x.id === pid)!;
    let frontier = [...p.upstream];
    const seen = new Set<string>();
    for (let d = 0; d < 8 && frontier.length; d++) {
      if (frontier.includes(target)) return d;
      frontier.forEach((f) => seen.add(f));
      frontier = frontier.flatMap((id) => pack.objects.find((o) => fqn(o) === id)?.upstream ?? []).filter((x) => !seen.has(x));
    }
    return Infinity;
  };
  for (const o of pack.objects.filter((x) => x.targetLag)) {
    const id = fqn(o);
    const cands = pack.products.filter((p) => productDts(pack, p.id).includes(id));
    if (!cands.length) continue;
    cands.sort((a, b) => hops(a.id, id) - hops(b.id, id) || slaMinutes(a.sla) - slaMinutes(b.sla));
    owners.set(id, cands[0].id);
  }
  return owners;
}

const ownDefaultLag = (pack: IndustryPack, id: string) => parseLag(pack.objects.find((o) => fqn(o) === id)?.targetLag) ?? 60;

export function defaultLevers(pack: IndustryPack): CostLevers {
  const lagMinutes: Record<string, number> = {};
  const owners = dtOwners(pack);
  for (const [dt, pid] of owners) lagMinutes[pid] = Math.min(lagMinutes[pid] ?? Infinity, ownDefaultLag(pack, dt));
  return { lagMinutes, warehouse: { transform: 'M', bi: 'XS', ai: 'S' }, questionsPerDay: defaultQuestions(pack), dmfPerDay: 24, creditPrice: 3, currency: '$' };
}

/** Effective target lag of every dynamic table under the current levers. */
export function effectiveLags(pack: IndustryPack, lv: CostLevers): Map<string, number> {
  const base = defaultLevers(pack).lagMinutes;
  const out = new Map<string, number>();
  for (const o of pack.objects.filter((x) => x.targetLag)) out.set(fqn(o), ownDefaultLag(pack, fqn(o)));
  for (const [dt, pid] of dtOwners(pack)) out.set(dt, Math.round(ownDefaultLag(pack, dt) * ((lv.lagMinutes[pid] ?? base[pid]) / base[pid])));
  return out;
}

/** Data freshness of a product: its slowest upstream dynamic table. */
export function productFreshness(pack: IndustryPack, lv: CostLevers, productId: string, eff = effectiveLags(pack, lv)): number {
  const lags = productDts(pack, productId).map((id) => eff.get(id) ?? 60);
  return lags.length ? Math.max(...lags) : 0;
}

function defaultQuestions(pack: IndustryPack): number {
  const o = pack.ext?.costDrivers?.questionsPerDayByAgent;
  return pack.agents.reduce((a, ag) => a + (o?.[ag.id] ?? (ag.status === 'Production' ? 120 : 20)), 0);
}

const sizeFactor = (size: WhSize) => Math.pow(WH_CREDITS.M / WH_CREDITS[size], COST_CONFIG.sizeScaling) * WH_CREDITS[size];

export function computeCost(pack: IndustryPack, lv: CostLevers, tooling?: Tooling, itemsOnly = false): CostResult {
  const C = COST_CONFIG;
  const usd = (credits: number) => credits * lv.creditPrice;
  const items: CostItem[] = [];
  const add = (i: Omit<CostItem, 'usd'>) => items.push({ ...i, usd: usd(i.credits) });

  const effLag = effectiveLags(pack, lv);

  for (const o of pack.objects) {
    const id = fqn(o);
    if (o.targetLag) {
      const lag = effLag.get(id) ?? parseLag(o.targetLag) ?? 60;
      const refreshes = (30 * 1440) / lag;
      const sec = C.refreshBaseSec + C.refreshSecPerLog10Bytes * Math.log10((o.bytes ?? 1e8) / 1e8 + 1);
      add({ driver: 'Dynamic table refresh', layer: o.layer, label: o.name, objectId: id, credits: (refreshes * sec * sizeFactor(lv.warehouse.transform)) / 3600 });
    } else if ((o.layer === 'silver' || o.layer === 'gold') && o.type.includes('TABLE')) {
      add({ driver: 'Transformation jobs', layer: o.layer, label: o.name, objectId: id, credits: (30 * C.dailyJobSec * sizeFactor(lv.warehouse.transform)) / 3600 });
    }
    if (o.bytes) {
      const tb = o.bytes / 1e12;
      const onIceberg = tooling?.format !== 'native' && (o.layer === 'bronze' || o.layer === 'silver');
      items.push({ driver: 'Storage', layer: o.layer, label: o.name, objectId: id, credits: 0, usd: onIceberg ? 0 : tb * C.storagePerTbMonth });
    }
    if (o.type === 'CORTEX SEARCH SERVICE') add({ driver: 'Cortex Search', layer: 'context', label: o.name, objectId: id, credits: (o.rowCount || 100) * C.searchCreditsPerDocMonth + lv.questionsPerDay * 30 * 0.4 * C.searchCreditsPerQuery });
  }

  for (const p of pack.products) {
    const q = (pack.ext?.costDrivers?.queriesPerDayByProduct?.[p.id] ?? p.queriesPerWeek / 7) * 30;
    add({ driver: 'BI and ad-hoc queries', layer: 'product', label: p.name, productId: p.id, objectId: `DATA_PRODUCTS.${p.outputPort}`, credits: (q * C.biAvgSec * (1 - C.biCacheHit) * WH_CREDITS[lv.warehouse.bi]) / 3600 });
  }

  const baseQ = defaultQuestions(pack) || 1;
  const byAgent: CostResult['byAgent'] = [];
  for (const a of pack.agents) {
    const share = (pack.ext?.costDrivers?.questionsPerDayByAgent?.[a.id] ?? (a.status === 'Production' ? 120 : 20)) / baseQ;
    const qpd = lv.questionsPerDay * share;
    const tokens = (qpd * 30 * C.aiTokensPerQuestion * C.aiCreditsPerMillionTokens) / 1e6;
    const sql = (qpd * 30 * C.sqlPerQuestion * C.sqlSecPerQuery * WH_CREDITS[lv.warehouse.ai]) / 3600;
    add({ driver: 'Cortex Analyst and agents', layer: 'agent', label: a.name, agentId: a.id, objectId: `AGENTS.${a.objectName}`, credits: tokens + sql, split: { tokens: usd(tokens), sql: usd(sql) } });
    byAgent.push({ agentId: a.id, usd: usd(tokens + sql), questionsPerDay: Math.round(qpd), perQuestion: qpd ? usd(tokens + sql) / (qpd * 30) : 0, tokens: usd(tokens), sql: usd(sql) });
  }

  add({ driver: 'Data metric functions', layer: 'gov', label: `${pack.dmf.length} checks × ${lv.dmfPerDay}/day`, objectId: 'GOVERNANCE.DMF_RESULTS', credits: pack.dmf.length * lv.dmfPerDay * 30 * C.dmfCreditsPerCheck });

  if (itemsOnly) return { items, total: 0, byLayer: {}, months: [], byProduct: [], byAgent, guardrails: [] };
  const byLayer: Record<string, number> = {};
  for (const i of items) byLayer[i.layer] = (byLayer[i.layer] ?? 0) + i.usd;
  const total = items.reduce((a, i) => a + i.usd, 0);

  // Six synthetic months: adoption grows towards the current scenario.
  const GROWTH = [0.71, 0.77, 0.84, 0.9, 0.95, 1];
  const now = new Date('2026-10-01');
  const months = GROWTH.map((g, k) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - k), 1);
    const bl: Record<string, number> = {};
    for (const [l, v] of Object.entries(byLayer)) bl[l] = v * (l === 'agent' ? g * g : g);
    return { label: d.toLocaleString('en-US', { month: 'short' }), byLayer: bl, total: Object.values(bl).reduce((a, b) => a + b, 0) };
  });

  const byProduct = pack.products.map((p) => {
    const dts = new Set(productDts(pack, p.id));
    const shareOf = (id: string) => pack.products.filter((x) => productDts(pack, x.id).includes(id)).length || 1;
    const usdP = items.filter((i) => i.productId === p.id || (i.objectId && dts.has(i.objectId) && i.driver === 'Dynamic table refresh')).reduce((a, i) => a + (i.productId === p.id ? i.usd : i.usd / shareOf(i.objectId!)), 0);
    const lagMin = productFreshness(pack, lv, p.id, effLag);
    const slaMin = slaMinutes(p.sla);
    return { productId: p.id, usd: usdP, perConsumer: usdP / Math.max(1, p.consumers), per1kQueries: (usdP / Math.max(1, (p.queriesPerWeek * 30) / 7)) * 1000, queriesPerWeek: p.queriesPerWeek, consumers: p.consumers, lagMin, slaMin, breach: lagMin > slaMin };
  });

  const wh = (k: keyof CostLevers['warehouse'], name: string, drivers: CostItem['driver'][]) => {
    const credits = items.filter((i) => drivers.includes(i.driver)).reduce((a, i) => a + i.credits, 0);
    const base = computeBaseline(pack, k, drivers, tooling);
    const quota = Math.max(50, Math.ceil((base * C.monitorHeadroom) / 50) * 50);
    const usedPct = Math.round(((credits * C.monthElapsed) / quota) * 100);
    return { monitor: `RM_${name}`, warehouse: `${name}_${lv.warehouse[k]}`, quota, usedPct, level: (usedPct >= 100 ? 'bad' : usedPct >= 75 ? 'warn' : 'ok') as 'ok' | 'warn' | 'bad' };
  };
  const guardrails = [
    wh('transform', 'WH_TRANSFORM', ['Dynamic table refresh', 'Transformation jobs']),
    wh('bi', 'WH_ANALYTICS', ['BI and ad-hoc queries']),
    wh('ai', 'WH_AGENTS', ['Cortex Analyst and agents']),
  ];

  return {
    items, total, byLayer, months, byProduct, byAgent, guardrails,
    icebergNote: tooling?.format !== 'native' ? 'Bronze and Silver are Apache Iceberg tables on the client\'s S3: $0 Snowflake storage, billed by the client\'s cloud provider.' : undefined,
  };
}

const baselineCache = new WeakMap<IndustryPack, Map<string, number>>();
function computeBaseline(pack: IndustryPack, k: string, drivers: CostItem['driver'][], tooling?: Tooling): number {
  const m = baselineCache.get(pack) ?? new Map<string, number>();
  baselineCache.set(pack, m);
  if (!m.has(k)) {
    const r = computeCost(pack, defaultLevers(pack), tooling, true);
    m.set(k, r.items.filter((i) => drivers.includes(i.driver)).reduce((a, i) => a + i.credits, 0));
  }
  return m.get(k)!;
}

/** Products whose freshness SLA is breached by the current cost levers (Marketplace chip). */
export function slaBreaches(pack: IndustryPack, lv: CostLevers | undefined): Set<string> {
  if (!lv) return new Set();
  const eff = effectiveLags(pack, lv);
  return new Set(pack.products.filter((p) => productFreshness(pack, lv, p.id, eff) > slaMinutes(p.sla)).map((p) => p.id));
}

export function costMarkdown(pack: IndustryPack, r: CostResult, lv: CostLevers): string {
  const f = (n: number) => `${lv.currency}${Math.round(n).toLocaleString('en-US')}`;
  const drivers = [...new Set(r.items.map((i) => i.driver))];
  return `## ${pack.profile.company}: illustrative monthly run cost\n\n_Illustrative. Credit price ${lv.currency}${lv.creditPrice}; placeholder rates, not a quote._\n\n| Driver | Monthly |\n| --- | --- |\n${drivers.map((d) => `| ${d} | ${f(r.items.filter((i) => i.driver === d).reduce((a, i) => a + i.usd, 0))} |`).join('\n')}\n| **Total** | **${f(r.total)}** |\n\n| Data product | Target lag | SLA | Monthly | Per consumer |\n| --- | --- | --- | --- | --- |\n${r.byProduct.map((p) => `| ${pack.products.find((x) => x.id === p.productId)?.name} | ${fmtLag(p.lagMin)} | ${fmtLag(p.slaMin)}${p.breach ? ' (breached)' : ''} | ${f(p.usd)} | ${f(p.perConsumer)} |`).join('\n')}\n`;
}
