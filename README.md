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

Twenty tabs, grouped the way a client meets the platform: the nine core tabs, plus the enhancement groups
*Why AI-ready*, *Implement* and *Operate*:

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
| Why AI-ready | Layer Knockout | Switch layers off (cleansing, semantic, glossary, context, certification, governance) and watch four governed answers degrade, with computed deltas and a "what went wrong" strip |
| Why AI-ready | Raw vs. AI-ready | The same question answered from raw Bronze tables and from the governed stack, side by side, with a scorecard and SQL diff |
| Implement | Readiness | 21-question workshop assessment over seven dimensions, radar, ranked gaps linked to roadmap phases and build steps |
| Implement | Roadmap | Seven phases with gates, workstream Gantt, "You are here", generate the starting phase from readiness gaps |
| Implement | Build Guide | 35 ordered steps that create every catalog object, with DDL, dbt, Snowpark, orchestration and ingestion artifacts for the client's tooling; copy as runbook or SQL |
| Implement | Migration Coverage | Each source table's furthest level (Landed → Agent-ready), derived live; heatmap, domain view, legacy report mapping, blockers, "Simulate +4 weeks" |
| Operate | Operating Model | RACI for nine roles and 25 activities in three operating styles; the persona's role |
| Operate | Cost | Illustrative run cost by layer, product and agent; what-if levers with the cost-versus-freshness trade-off; guardrails |
| Operate | Data Health | Product health, five scripted incidents ("Break something") with live effects across the app, resolution and postmortems |
| Operate | Agent Quality | Eval scorecard and run detail, steward feedback inbox, fixes that write to the context and semantic layers |
| Operate | Impact Analysis | Column-level blast radius of a source change, severity, contract notice and version bump, change plan |

The **persona switcher** (top right) re-renders everything: masking, row filtering, Marketplace access,
My Access and agent behaviour. **Shift + A** toggles presenter-only `PLATFORM_ADMIN` mode. **/** or **Ctrl + K**
opens global search. The **⋯** presenter menu offers *Reset demo*, *Reset all packs*, admin mode, pack lock and
*Jump to demo step N*, *Break something* and *Hide Operate group* (for executive audiences). Demo state is kept in
`sessionStorage`, namespaced per pack; *Reset demo* also restores every enhancement (switches, readiness answers,
roadmap position, tooling, cost levers, incidents, feedback and fixes).

## 15-minute demo script

Pick the client's industry on the start screen first. Steps name Utilities (Northvale Energy) objects.

1. **Platform Map (2 min).** Replay the flow animation. Click Bronze, then Semantic, then Context to explain what each adds for an agent.
2. **Explorer (3 min).** Open `RAW_BRONZE.CIS_CUSTOMER_CDC` (CDC noise: `U` duplicates, `D` deletes, untrimmed names), then `CURATED_SILVER.CUSTOMER` (cleaned), then `CONFORMED_GOLD.FCT_OUTAGE` → Lineage through to `DP_SYSTEM_RELIABILITY` and `AGT_RELIABILITY_ANALYST`. Switch persona to show PII masking live.
3. **Meaning layers (3 min).** Glossary: open SAIDI and follow its lineage strip. Semantic: *Try a metric* SAIDI by OPCO. Context: rule BR-012 and search "major event day".
4. **Certification Studio (3 min).** As Data steward, run checks on Billing & Receivables (gate 4 warns: 7 of 10 verified queries; gate 6 fails: `FCT_BILLING.ACCOUNT_EMAIL` tagged PII with no masking policy), apply the two fixes, certify and publish v1.0.0.
5. **Marketplace (2 min).** Switch to Customer analyst: Billing & Receivables is now Certified with a "New" ribbon. Open its drawer (the analyst's request is pending). Switch to steward and approve it from *Requests*.
6. **Agent Studio + My Access (2 min).** As Customer analyst, ask Customer Insights "What is our days sales outstanding this month?" — it now answers with a certified source. Open My Access: DSO is answerable.

## Implementation story demo script (15 minutes)

The second story, for delivery and architecture audiences. On the Platform Map, switch the guided demo to
*Implementation story*. Steps name Utilities objects; every pack carries the same script.

1. **Readiness (3 min).** Load the *Mid-migration, BI-led* profile, adjust two answers with the client, show the radar and the top gaps (each links to a roadmap phase and build steps).
2. **Roadmap (2 min).** *Generate from readiness*: the "You are here" pin moves to the phase that closes the biggest gap; show the gate for the Meaning phase.
3. **Build Guide (3 min).** Open Semantic step 1 (`CREATE SEMANTIC VIEW`), then Context (Cortex Search service). Change *Client tooling* to Fivetran + Airflow to show the artifacts adapt. *Copy as runbook*.
4. **Knockout (3 min).** Ask the SAIDI question, switch off Context (major event days are no longer excluded: SAIDI nearly doubles), then Governance. Run *Knock out one at a time*.
5. **Data Health (2 min).** *Break something* → Late CDC feed. Show the Degraded badge in the Marketplace and the Reliability Analyst's "data as of 6 h ago" warning in Agent Studio. Resolve; the postmortem lists time to detect and resolve.
6. **Agent Quality (2 min).** As the analyst, ask "What is our total arrears balance?" and give a thumbs down ("This should exclude closed accounts"). As the steward, fix it from the inbox (*Add business rule* BR-021), *Re-run eval*: Customer Insights goes from 88% (At risk) to 94% (Meets bar), and the answer now cites the rule.

Optional extras: *Raw vs. AI-ready* for the paperless question (PII exposed and duplicates counted on the raw side),
*Impact Analysis* preset "Interval reads move to hourly" (major version bump with a 30-day notice), and *Cost* →
What-if: slow AMI Usage to every 4 h to show the SLA breach chip appear in the Marketplace.

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
| All twenty tabs at 1440 / 1024 / 390 px, light and dark, no console errors, no page-level horizontal scroll | `tests/e2e/responsive.spec.ts` |
| WCAG 2.2 AA (axe: no serious or critical violations) on every tab, both themes, every pack | `tests/e2e/a11y.spec.ts`; Lighthouse accessibility 100 on the Utilities tabs |
| No content from another pack; unique persona names; pack builds in < 1 s | `tests/pack-contract.test.ts` |
| Agent numbers equal worksheet numbers; guardrails (no access, not certified, masking) | `tests/agents.test.ts` |
| Enhancement block for every pack (E1–E11 acceptance criteria: knockout = Agent Studio, every switch bites, build guide creates every object once, coverage spread and DP-05 move, five incidents, 88% → 94% loop, impact presets) | `npm run validate:pack` (`src/ext/validateExt.ts`) and `tests/enhancements.test.ts` |
| Implementation story for every pack, ending with *Reset demo* restoring every new feature | `tests/e2e/implementation-story.spec.ts` |
| Initial bundle | ≈ 120 KB gzipped app shell; each pack and each new tab is a lazy-loaded chunk |

## Build status

All milestones M1–M10 are complete: the framework, all nine tabs, and the eight industry packs (Utilities, Banking,
Healthcare, Retail, Telecom, Insurance, Manufacturing, Public Sector). The enhancement specification (E1–E11,
waves 1–4) is implemented: shared engines live in `src/ext/`, screens in `src/features/{why,implement,operate}/`, and
each pack's industry content in `src/packs/<id>/ext/`.
