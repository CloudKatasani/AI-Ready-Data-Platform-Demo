import { describe, expect, it } from 'vitest';
import { isPackReady, loadPack, PROFILES } from '../src/packs';
import { validatePack } from '../src/packs/validate';

describe('pack contract', () => {
  for (const p of PROFILES.filter((x) => isPackReady(x.id))) {
    it(`${p.id} passes the validator`, async () => {
      const pack = await loadPack(p.id);
      expect(validatePack(pack).errors).toEqual([]);
    });
  }
  it('every profile has a unique database prefix and seed', () => {
    expect(new Set(PROFILES.map((p) => p.dbPrefix)).size).toBe(PROFILES.length);
    expect(new Set(PROFILES.map((p) => p.seed)).size).toBe(PROFILES.length);
  });
});
