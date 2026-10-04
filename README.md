# Data Fabric Studio — AI-Ready Data Platform Demo

A browser-only, login-free demo app that shows a client in any industry how one Snowflake account carries every
layer an AI agent needs: landed data, curated models, a semantic layer, a business glossary, a context layer,
certified data products and governed agents. Everything runs on synthetic data generated in the browser from a
seeded PRNG, so it can be presented from a laptop with no Snowflake credentials, VPN or network.

> All companies, people and numbers are fictional. There is no connection to Snowflake and no LLM call;
> every agent answer is computed deterministically from the synthetic data. No Snowflake logos are used.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # static build in dist/
npm run build:single   # one self-contained file: dist-single/index.html (works from file://, email-able)
```

| Script | What it does |
| --- | --- |
| `npm test` | Vitest unit tests (mock Snowflake policies, agent engine, store, pack contract) |
| `npm run validate:pack [id]` | Validates a pack (or every built pack) against the pack contract |
| `npm run e2e` | Playwright walk-through of the 15-minute demo script (builds and serves `dist/`) |
| `npm run typecheck` | TypeScript strict check |

To lock the app to one industry for a client demo, open it with `?pack=utilities` (or build with
`VITE_LOCK_PACK=utilities`), or use **⋯ → Lock app** in the top bar.

## What's in the app

Nine tabs, grouped the way a client consumes the platform:

| Group | Tab | Job |
| --- | --- | --- |
| Platform | Platform Map | The nine layers as one stack, with a replayable data-flow animation |
| Platform | Database Explorer | Browse `<PREFIX>_AI_PLATFORM` like Snowsight: preview, columns, DDL, lineage, DMF quality, governance, worksheet |
| Meaning | Semantic Layer | Semantic views, logical model, metrics, verified queries, DDL and a "Try a metric" playground |
| Meaning | Glossary | Terms, CDEs, owners and stewards, DQ rules, and a term → column → metric → product → agent lineage strip |
| Meaning | Context Layer | Agent instructions, business rules, verified queries, synonyms and Cortex Search document search |
| Build & consume | Certification Studio | Walk DP-05 through eight gates, apply the two fixes, certify and publish |
| Build & consume | Agent Studio | Chat with an agent and watch the layer-by-layer "How I answered" trace |
| Build & consume | Marketplace | Discover products and agents, filter by KPI, request access, steward approval queue |
| Build & consume | My Access | What the current persona can use and the KPI coverage matrix |

The **persona switcher** (top right) re-renders everything: masking, row filtering, Marketplace access,
My Access and agent behaviour. **Shift + A** toggles presenter-only `PLATFORM_ADMIN` mode. **/** or **Ctrl + K**
opens global search. The **⋯** presenter menu offers *Reset demo*, *Reset all packs*, admin mode, pack lock and
*Jump to demo step N*. Demo state is kept in `sessionStorage`, namespaced per pack.

## 15-minute demo script

Pick the client's industry on the start screen first. Steps name Utilities (Northvale Energy) objects.

1. **Platform Map (2 min).** Replay the flow animation. Click Bronze, then Semantic, then Context to explain what each adds for an agent.
2. **Explorer (3 min).** Open `RAW_BRONZE.CIS_CUSTOMER_CDC` (CDC noise: `U` duplicates, `D` deletes, untrimmed names), then `CURATED_SILVER.CUSTOMER` (cleaned), then `CONFORMED_GOLD.FCT_OUTAGE` → Lineage through to `DP_SYSTEM_RELIABILITY` and `AGT_RELIABILITY_ANALYST`. Switch persona to show PII masking live.
3. **Meaning layers (3 min).** Glossary: open SAIDI and follow its lineage strip. Semantic: *Try a metric* SAIDI by OPCO. Context: rule BR-012 and search "major event day".
4. **Certification Studio (3 min).** As Data steward, run checks on Billing & Receivables (gate 4 warns: 7 of 10 verified queries; gate 6 fails: `FCT_BILLING.ACCOUNT_EMAIL` tagged PII with no masking policy), apply the two fixes, certify and publish v1.0.0.
5. **Marketplace (2 min).** Switch to Customer analyst: Billing & Receivables is now Certified with a "New" ribbon. Open its drawer (the analyst's request is pending). Switch to steward and approve it from *Requests*.
6. **Agent Studio + My Access (2 min).** As Customer analyst, ask Customer Insights "What is our days sales outstanding this month?" — it now answers with a certified source. Open My Access: DSO is answerable.

## Architecture

```
src/
  app/              shell: routes (/#/:pack/...), top bar, nav rail, command palette, start screen, toasts
  features/         one folder per tab
  components/       shared UI (DataGrid, LineageGraph, CodeBlock, StatusChip, charts, icons)
  mock-snowflake/   MockSnowflake facade, mulberry32 PRNG, generic generators, policies (masking + row access),
                    DDL renderer, shared-structure schemas (GLOSSARY, CONTEXT, DP registry, AGENTS, GOVERNANCE)
  packs/            pack registry, validator, shared product kit, utilities/ reference pack, _template/
  agents/engine/    matcher (synonym expansion + TF-IDF), scenario runner with guardrails, trace builder
  store/            Zustand store: persona, access requests, certification state, theme (per pack)
scripts/validate-pack.ts
tests/              unit tests and e2e/demo-script.spec.ts
```

All screens talk to the `MockSnowflake` facade and the active `IndustryPack`, so the same UI could later be
pointed at a real account through a thin API. `MockSnowflake.preview()` applies masking and row access
policies by role before returning rows, the way Snowflake enforces policies at query time. Agent scenarios,
the Explorer worksheet, the semantic playground and the validator share the same query functions, so an
agent's number always equals the worksheet's.

Stack: Vite + React 18 + TypeScript (strict), Tailwind with CSS-variable design tokens (light and dark),
React Router `HashRouter`, Zustand, Vitest, Playwright. Fonts (IBM Plex Sans/Mono, Bricolage Grotesque) are
bundled for offline use.

Deliberate simplifications versus the spec's suggested libraries, to keep the bundle small and fully offline:
lineage and charts are hand-built SVG (no React Flow / Visx), the data grid is a sticky-header table (previews
are 10 rows, so no virtualization is needed yet), SQL/YAML highlighting uses a small built-in tokenizer
(no Shiki/Prism), and free-text matching uses a built-in TF-IDF matcher (no MiniSearch).

## Adding a new industry pack

See [`src/packs/_template/README.md`](src/packs/_template/README.md). In short: copy the Utilities pack, fill
the content files, register the loader in `src/packs/index.ts`, and run `npm run validate:pack <id>`.

## Build status

| Milestone | Status |
| --- | --- |
| M1 Foundation (scaffold, tokens, shell, pack-prefixed routing, stores, start screen, command palette) | Done |
| M2 Pack framework + mock Snowflake (types, registry, shared schemas, generators, policies, DDL, facade, validator) | Done |
| M3 Utilities reference pack (Northvale Energy, 56 objects, 26 terms, 48 VQs, 26 KPIs, 15 scenarios) | Done |
| M4 Platform Map + Explorer | Done |
| M5 Semantic, Glossary, Context with cross-links and "Try a metric" | Done |
| M6 Certification Studio with the scripted DP-05 flow | Done |
| M7 Agent Studio (matcher, scenarios, streamed answers, trace, guardrails) | Done |
| M8 Marketplace + My Access (requests, steward queue, KPI matrix) | Done |
| M9 Industry packs: Banking, Healthcare, Retail, Telecom, Insurance (Must); Manufacturing, Public Sector (Should) | Next — profiles and start-screen tiles exist; packs show "in build" |
| M10 Polish (presenter menu, pack lock, resets, single-file build in place; full a11y/Lighthouse pass pending) | Partly done |
