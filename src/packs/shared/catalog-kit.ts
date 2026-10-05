// Reusable building blocks for a pack's catalog and metadata. Every pack imports these instead of copying them.
import type { Column, ColumnTag, IndustryPack, Row, SfObject } from '../../types';
import { Rng } from '../../mock-snowflake/rng';
import { addDays, pad, ts } from '../../mock-snowflake/generators';

/** Check id of the DP-05 gate-6 failure (masking policy missing on one sensitive column). */
export const GATE6_CHECK = 'G6-MASK';
/** Check id of the DP-05 gate-4 failure (7 of 10 verified queries). */
export const GATE4_CHECK = 'G4-VQ';
/** Every pack reports data as of the same day (spec section 6 reporting window). */
export const AS_OF_DATE = '2026-09-30';

export const col = (name: string, type: string, comment: string, opts: { tags?: ColumnTag[]; termId?: string; nullable?: boolean; maskPendingFix?: string } = {}): Column => ({
  name, type, comment, nullable: opts.nullable ?? true, tags: opts.tags, termId: opts.termId, maskPendingFix: opts.maskPendingFix,
});

/** Lazily computed, cached value (row generators run once, on first preview). */
export const memo = <T,>(f: () => T) => {
  let v: T | undefined;
  return () => (v ??= f());
};

/**
 * Like `memo`, for row generators that draw from a shared Rng: the stream is reseeded with `seed` before the first
 * computation, so each table's rows are identical whichever table is previewed first.
 */
export const memoRng = <T,>(rng: Rng, seed: number, f: () => T) => {
  let v: T | undefined;
  return () => {
    if (v === undefined) { rng.reseed(seed); v = f(); }
    return v;
  };
};

export const dateKey = (d: string) => Number(d.replace(/-/g, ''));

export const cdcColumns = (): Column[] => [
  col('OP_TYPE', 'VARCHAR(1)', 'CDC operation: I insert, U update, D delete'),
  col('OP_TS', 'TIMESTAMP_NTZ', 'GoldenGate commit timestamp'),
];

/** Bronze rows with visible CDC noise: ~4% U duplicates, ~1% D, plus whatever noise `toRow` adds (mixed case,
 * untrimmed strings). One U and one D are forced into the first rows that `visible` says every persona can see
 * (pass the archetype-A row filter), so the 10-row preview always shows the noise. */
export function withCdc<T>(rng: Rng, items: T[], toRow: (x: T) => Row, baseDate: string, visible: (x: T) => boolean = () => true): Row[] {
  const out: Row[] = [];
  const vis = items.map((x, i) => (visible(x) ? i : -1)).filter((i) => i >= 0);
  const forced = [vis[1] ?? 1, vis[4] ?? 4];
  items.forEach((x, i) => {
    const day = addDays(baseDate, Math.floor(i / 40));
    const m = 300 + ((i * 17) % 900);
    out.push({ ...toRow(x), OP_TYPE: 'I', OP_TS: ts(day, m) });
    if (i === forced[0] || rng.chance(0.04)) out.push({ ...toRow(x), OP_TYPE: 'U', OP_TS: ts(day, m + 41) });
    if (i === forced[1] || rng.chance(0.01)) out.push({ ...toRow(x), OP_TYPE: 'D', OP_TS: ts(addDays(day, 1), 120) });
  });
  return out;
}

/** Data metric function results for every watched object. `warn`/`fail` name objects that should show issues. */
export function buildDmf(physical: SfObject[], seed: number, issues: { warn?: string[]; fail?: string[] } = {}): IndustryPack['dmf'] {
  const rng = new Rng(seed + 99);
  return physical
    .filter((o) => o.layer !== 'bronze' || o.type === 'ICEBERG TABLE')
    .flatMap((o) => {
      const id = `${o.schema}.${o.name}`;
      const warn = issues.warn?.includes(o.name) ?? false;
      const fail = issues.fail?.includes(o.name) ?? false;
      return [
        { fqn: id, metric: 'NULL_COUNT', value: fail ? 112 : 0, threshold: '= 0 on CDE columns', status: fail ? 'warn' : 'pass', measuredAt: ts(AS_OF_DATE, 361) },
        { fqn: id, metric: 'DUPLICATE_COUNT', value: warn ? 3 : 0, threshold: '= 0', status: warn ? 'warn' : 'pass', measuredAt: ts(AS_OF_DATE, 362) },
        { fqn: id, metric: 'FRESHNESS', value: fail ? 1_520 : rng.int(4, 55), threshold: fail ? '< 1,440 min' : '< 60 min', status: fail ? 'fail' : 'pass', measuredAt: ts(AS_OF_DATE, 363) },
        { fqn: id, metric: 'ROW_COUNT', value: o.rowCount, threshold: '±5% of forecast', status: 'pass', measuredAt: ts(AS_OF_DATE, 364) },
      ] as IndustryPack['dmf'];
    });
}

/** Five access-history rows per object; consumer roles on Gold and products, platform roles below. */
export function buildAccessHistory(physical: SfObject[], consumerRoles: string[], platformRoles = ['TRANSFORM_ADMIN', 'DATA_STEWARD']): IndustryPack['accessHistory'] {
  return physical.flatMap((o, i) =>
    Array.from({ length: 5 }, (_, k) => {
      const role = o.schema === 'DATA_PRODUCTS' || o.schema === 'CONFORMED_GOLD' ? consumerRoles[(i + k) % consumerRoles.length] : platformRoles[k % platformRoles.length];
      return {
        queryId: `01b7${pad(i * 7 + k, 4)}-0001-7f3c-0000-${pad(41_000 + i * 31 + k * 7, 12)}`, role, fqn: `${o.schema}.${o.name}`,
        columns: o.columns.slice(0, 3 + (k % 3)).map((c) => c.name).join(', '), ts: ts(addDays(AS_OF_DATE, -k), 600 - k * 47 + i),
      };
    }),
  );
}
