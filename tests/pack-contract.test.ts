import { describe, expect, it } from 'vitest';
import { isPackReady, loadPack, PROFILES } from '../src/packs';
import { validatePack } from '../src/packs/validate';
import type { IndustryPack } from '../src/types';

const ready = PROFILES.filter((x) => isPackReady(x.id));

/** Everything a viewer can read from a pack, as one string. */
function packText(p: IndustryPack): string {
  return JSON.stringify({
    objects: p.objects.map((o) => ({ n: o.name, c: o.comment, cols: o.columns, u: o.upstream, d: o.ddl })),
    sv: p.semanticViews.map(({ playground: _pg, ...rest }) => rest), g: p.glossary, ctx: p.context, products: p.products, agents: p.agents,
    kpis: p.kpis, personas: p.personas, scenarios: p.scenarios.map((s) => [s.question, s.paraphrases]), ex: p.layerExamples, sig: p.signature,
  });
}

describe('pack contract', () => {
  for (const p of ready) {
    it(`${p.id} passes the validator`, async () => {
      const pack = await loadPack(p.id);
      expect(validatePack(pack).errors).toEqual([]);
    });
  }

  it('every profile has a unique database prefix and seed', () => {
    expect(new Set(PROFILES.map((p) => p.dbPrefix)).size).toBe(PROFILES.length);
    expect(new Set(PROFILES.map((p) => p.seed)).size).toBe(PROFILES.length);
  });

  it('no pack mentions another pack’s company or database', async () => {
    const packs = await Promise.all(ready.map((p) => loadPack(p.id)));
    for (const a of packs) {
      const text = packText(a);
      for (const b of PROFILES.filter((x) => x.id !== a.profile.id)) {
        expect(text.includes(b.company), `${a.profile.id} mentions ${b.company}`).toBe(false);
        expect(text.includes(`${b.dbPrefix}_AI_PLATFORM`), `${a.profile.id} mentions ${b.dbPrefix}_AI_PLATFORM`).toBe(false);
      }
    }
  });

  it('persona names are unique across packs', async () => {
    const packs = await Promise.all(ready.map((p) => loadPack(p.id)));
    const names = packs.flatMap((p) => p.personas.map((x) => `${x.name}`));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('each pack builds fast enough to switch in under a second', async () => {
    for (const p of ready) {
      const mod = await import(/* @vite-ignore */ `../src/packs/${p.id}/index.ts`);
      const t = performance.now();
      mod.buildPack();
      expect(performance.now() - t, p.id).toBeLessThan(900);
    }
  });
});
