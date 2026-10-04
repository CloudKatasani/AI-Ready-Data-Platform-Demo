// npm run validate:pack [packId]  — checks a pack (or every built pack) against the pack contract.
import { loadPack, PROFILES, isPackReady } from '../src/packs';
import { validatePack } from '../src/packs/validate';
import type { PackId } from '../src/types';

const arg = process.argv[2];
const ids = (arg ? [arg] : PROFILES.filter((p) => isPackReady(p.id)).map((p) => p.id)) as PackId[];
let failed = false;
for (const id of ids) {
  if (!isPackReady(id)) {
    console.error(`✗ ${id}: pack is not registered in src/packs/index.ts`);
    failed = true;
    continue;
  }
  const t = Date.now();
  const pack = await loadPack(id);
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
