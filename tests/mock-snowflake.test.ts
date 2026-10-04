import { describe, expect, it } from 'vitest';
import { mulberry32, Rng } from '../src/mock-snowflake/rng';
import { MockSnowflake } from '../src/mock-snowflake';
import { maskValue } from '../src/mock-snowflake/policies';
import { initialLive } from '../src/packs/validate';
import { buildPack } from '../src/packs/utilities';
import { persona, utilities } from './helpers';

describe('seeded PRNG', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(20261003);
    const b = mulberry32(20261003);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });
  it('weighted picks respect weights roughly', () => {
    const r = new Rng(1);
    const n = Array.from({ length: 5000 }, () => r.weighted(['a', 'b'], [0.8, 0.2])).filter((x) => x === 'a').length;
    expect(n / 5000).toBeGreaterThan(0.75);
    expect(n / 5000).toBeLessThan(0.85);
  });
  it('the same pack builds identical numbers twice', () => {
    const a = buildPack().scenarios[5].run({ persona: persona(utilities(), 'D'), live: initialLive(utilities()) });
    const b = buildPack().scenarios[5].run({ persona: persona(utilities(), 'D'), live: initialLive(utilities()) });
    expect(a.summary).toEqual(b.summary);
  });
});

describe('policies', () => {
  const pack = utilities();
  const db = new MockSnowflake(pack);
  const live = initialLive(pack);

  it('masks emails and names', () => {
    expect(maskValue('priya.iyer@examplemail.com')).toBe('p****@****.com');
    expect(maskValue('Priya')).toBe('****');
    expect(maskValue(null)).toBeNull();
  });

  it('masks PII for the analyst and not for the steward', () => {
    const a = db.preview('CONFORMED_GOLD.DIM_CUSTOMER', persona(pack, 'A'), live);
    const d = db.preview('CONFORMED_GOLD.DIM_CUSTOMER', persona(pack, 'D'), live);
    expect(a.maskedColumns).toContain('CUSTOMER_NAME');
    expect(a.rows.every((r) => r.CUSTOMER_NAME === '****')).toBe(true);
    expect(d.maskedColumns).toEqual([]);
    expect(d.rows.some((r) => r.CUSTOMER_NAME !== '****')).toBe(true);
  });

  it('row access limits the analyst to Ohio and Indiana', () => {
    const a = db.query('CONFORMED_GOLD.DIM_CUSTOMER', persona(pack, 'A'), live);
    const b = db.query('CONFORMED_GOLD.DIM_CUSTOMER', persona(pack, 'B'), live);
    expect(new Set(a.rows.map((r) => r.OPCO))).toEqual(new Set(['Northvale Ohio', 'Northvale Indiana']));
    expect(new Set(b.rows.map((r) => r.OPCO)).size).toBe(4);
    expect(a.filteredOut).toBeGreaterThan(0);
  });

  it('row access maps Bronze state codes to opcos', () => {
    const a = db.query('RAW_BRONZE.CIS_CUSTOMER_CDC', persona(pack, 'A'), live);
    expect(a.rows.every((r) => ['OH', 'IN'].includes(String(r.ST)))).toBe(true);
  });

  it('FCT_BILLING.ACCOUNT_EMAIL stays unmasked until the gate-6 fix is applied', () => {
    const before = db.preview('CONFORMED_GOLD.FCT_BILLING', persona(pack, 'A'), live);
    expect(before.maskedColumns).not.toContain('ACCOUNT_EMAIL');
    const after = db.preview('CONFORMED_GOLD.FCT_BILLING', persona(pack, 'A'), { ...live, fixes: { 'DP-05': ['G6-MASK'] } });
    expect(after.maskedColumns).toContain('ACCOUNT_EMAIL');
    expect(db.ddl('CONFORMED_GOLD.FCT_BILLING', { ...live, fixes: { 'DP-05': ['G6-MASK'] } })).toContain('ACCOUNT_EMAIL');
  });

  it('Bronze shows CDC noise and Silver does not', () => {
    const bronze = db.query('RAW_BRONZE.CIS_CUSTOMER_CDC', persona(pack, 'D'), live).rows;
    expect(bronze.some((r) => r.OP_TYPE === 'U')).toBe(true);
    expect(bronze.some((r) => r.OP_TYPE === 'D')).toBe(true);
    const silver = db.query('CURATED_SILVER.CUSTOMER', persona(pack, 'D'), live).rows;
    expect(silver.every((r) => String(r.FIRST_NAME) === String(r.FIRST_NAME).trim())).toBe(true);
  });

  it('lineage reaches the product and the agent', () => {
    const lin = db.lineage('CONFORMED_GOLD.FCT_OUTAGE', 6);
    const ids = lin.nodes.map((n) => n.id);
    expect(ids).toContain('DATA_PRODUCTS.DP_SYSTEM_RELIABILITY');
    expect(ids).toContain('AGENTS.AGT_RELIABILITY_ANALYST');
    expect(ids).toContain('ext:OMS / ADMS');
  });
});
