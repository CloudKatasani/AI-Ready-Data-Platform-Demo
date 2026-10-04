// npm run validate:pack [packId]  — checks a pack (or every built pack) against the pack contract.
// An unregistered pack id is loaded straight from src/packs/<id>/index.ts, so a pack can be validated while in build.
import { loadPack, PROFILES, isPackReady } from '../src/packs';
import { validatePack } from '../src/packs/validate';
import type { IndustryPack, PackId } from '../src/types';

const arg = process.argv[2];
const ids = (arg ? [arg] : PROFILES.filter((p) => isPackReady(p.id)).map((p) => p.id)) as PackId[];
let failed = false;
for (const id of ids) {
  const t = Date.now();
  let pack: IndustryPack;
  try {
    pack = isPackReady(id) ? await loadPack(id) : (await import(`../src/packs/${id}/index.ts`)).buildPack();
  } catch (e) {
    console.error(`✗ ${id}: could not build pack — ${(e as Error).stack}`);
    failed = true;
    continue;
  }
  const r = validatePack(pack);
  if (r.errors.length) {
    failed = true;
    console.error(`✗ ${id}: ${r.errors.length} of ${r.checks} checks failed`);
    for (const e of r.errors) console.error(`   - ${e}`);
  } else {
    console.log(`✓ ${id}: ${r.checks} checks passed (${pack.objects.length} objects, ${pack.scenarios.length} scenarios, built in ${Date.now() - t} ms)`);
  }
}
process.exit(failed ? 1 : 0);
