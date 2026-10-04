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

## Industry packs

| Pack | Company | Database | Signature question | DP-05 (in certification) · gate-6 gap |
| --- | --- | --- | --- | --- |
| Utilities | Northvale Energy | `NVE_AI_PLATFORM` | SAIDI YTD excluding major event days, by operating company | Billing & Receivables · `FCT_BILLING.ACCOUNT_EMAIL` (PII) |
| Telecom | Altair Communications | `ALT_AI_PLATFORM` | Postpaid churn last month by plan and region | Device & Plan Profitability · `DIM_SUBSCRIBER.MSISDN` (CPNI) |
| Retail | Harbor & Pine | `HPR_AI_PLATFORM` | Promotions that lifted comparable sales above 5% last quarter | Promotion Effectiveness · `FCT_PROMO_SALES.CARD_LAST4` (PCI) |
| Banking | Ridgeline Bank | `RLB_AI_PLATFORM` | NPL ratio by loan segment and its trend this year | AML Alerts & Cases · `FCT_AML_ALERT.ACCOUNT_NUMBER` (NPI) |
| Insurance | Sentinel Mutual | `SMI_AI_PLATFORM` | Loss ratio by line of business this year, excluding catastrophes | Loss Reserves · `FCT_RESERVE.CLAIMANT_DOB` (PHI) |
| Healthcare | Crestview Health System | `CVH_AI_PLATFORM` | 30-day all-cause readmission rate by service line | Clinical Supply Chain · `FCT_SUPPLY_USAGE.PATIENT_MRN` (PHI) |
| Manufacturing | Forgepoint Industries | `FPI_AI_PLATFORM` | Lines with OEE below 65% last week and what drove the losses | Order to Delivery · `FCT_ORDER.CUSTOMER_CONTACT` (PII) |
| Public Sector | Westland County Services | `WCS_AI_PLATFORM` | Benefit applications exceeding the 30-day processing standard | Program Integrity · `FCT_PAYMENT.CASE_GOV_ID` (government ID) |

Every pack has 56–60 objects across the nine schemas, ≥ 26 glossary terms, 48 verified queries, ≥ 24 KPIs with
target ranges, six data products, four agents, four personas and 15 computed agent scenarios, and passes the
same validator and end-to-end tests.

## Release gate

| Check | How it is verified |
| --- | --- |
| Pack contract for every pack | `npm run validate:pack` (≈ 500 checks per pack) and `tests/pack-contract.test.ts` |
| Demo script steps 1–6 for every pack | `tests/e2e/demo-script.spec.ts` |
| All nine tabs at 1440 / 1024 / 390 px, light and dark, no console errors, no page-level horizontal scroll | `tests/e2e/responsive.spec.ts` |
| WCAG 2.2 AA (axe: no serious or critical violations) on every tab, both themes, every pack | `tests/e2e/a11y.spec.ts`; Lighthouse accessibility 100 on the Utilities tabs |
| No content from another pack; unique persona names; pack builds in < 1 s | `tests/pack-contract.test.ts` |
| Agent numbers equal worksheet numbers; guardrails (no access, not certified, masking) | `tests/agents.test.ts` |
| Initial bundle | ≈ 120 KB gzipped app shell; each pack is a lazy-loaded chunk |

## Build status

All milestones M1–M10 are complete: the framework, all nine tabs, and the eight industry packs (Utilities, Banking,
Healthcare, Retail, Telecom, Insurance, Manufacturing, Public Sector).
