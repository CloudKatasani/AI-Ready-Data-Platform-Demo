# Industry pack template

A pack fills the same nine schemas with one industry's content. UI code never changes: every screen reads
only from the active `IndustryPack` (see `src/types.ts`). Utilities (`src/packs/utilities`) is the reference
implementation; copy its structure.

## Steps (about one day per pack)

1. `cp -r src/packs/utilities src/packs/<pack-id>` and set the profile in `pack.ts`
   (id, industry, company, `dbPrefix`, account, icon, accent, sources, sensitive classes). The seed is
   `BASE_SEED + packIndex` and the database is always `<PREFIX>_AI_PLATFORM`.
2. Fill the content files:

   | File | What goes in it | Contract minimum |
   | --- | --- | --- |
   | `generators.config.ts` | entities, volumes, distributions, calibration targets, `KPI_RANGES` | a realistic min–max per KPI |
   | `data.ts` | seeded generators producing the in-memory sample | uses `Rng(profile.seed)` only |
   | `catalog.ts` | Bronze / Silver / Gold objects and the six product output ports | Bronze 5–6 (with `OP_TYPE`, `OP_TS`), Silver 5–6, Gold 8–10 |
   | `semantic.ts` | four semantic views with metrics, synonyms and a `playground` | 4 views |
   | `glossary.ts` | business terms and mappings | ≥ 17 terms, ≥ 12 CDEs, exactly 1 Draft, exactly 1 CDE without a steward |
   | `context.ts` | instructions per agent, rules, verified queries, synonyms, 4 documents | ≥ 10 rules, ≥ 40 VQs (DP-05's view has exactly 7), ≥ 15 synonyms |
   | `products.ts` | DP-01..DP-06 | 4 Certified, DP-05 In certification, DP-06 Draft |
   | `agents.ts` | AG-01..AG-04 | 3 domain agents + Data Steward Assistant |
   | `kpis.ts` | KPI dictionary | ≥ 22, each with a term and a metric |
   | `personas.ts` | archetypes A–D and the initial access matrix | A has a row filter and a pending DP-05 request |
   | `scenarios.ts` | 15 agent scenarios on the coverage pattern in spec section 9 | numbers computed, never hard-coded |
   | `index.ts` | assembles the pack, worksheet presets, DMF results, certification script | DP-05 fails gate 4 (7 of 10 VQs) and gate 6 (one sensitive column unmasked) |

3. Register the loader in `src/packs/index.ts` (`LOADERS`) and mark the profile `ready: true`.
4. Run `npm run validate:pack <pack-id>`. It checks counts against the pack contract, that every KPI maps to a
   term and a metric, that every scenario's computed numbers fall inside the KPI ranges, that paraphrases
   match their scenario, that every upstream object exists, and that DP-05 starts with exactly the two
   expected failures.
5. Add the pack's objects to `tests/e2e/demo-script.spec.ts` (`PACKS`) and run `npm run e2e`.
