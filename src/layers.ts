import type { LayerId, SchemaName } from './types';

export interface LayerInfo {
  id: LayerId;
  n: number;
  schema: SchemaName;
  label: string;
  short: string;
  purpose: string;
  addsForAgents: string;
  features: string[];
  objectTypes: string;
}

/** The nine layers never change between packs (spec section 5). Order = bottom to top, governance last. */
export const LAYERS: LayerInfo[] = [
  { id: 'bronze', n: 1, schema: 'RAW_BRONZE', label: 'Bronze', short: 'Landed CDC',
    purpose: 'Append-only CDC records landed from source systems, with OP_TYPE and OP_TS.',
    addsForAgents: 'Bronze: a complete, replayable history so every number can be traced back to the source record.',
    features: ['Apache Iceberg tables', 'Streams', 'Snowpipe Streaming'], objectTypes: 'Iceberg table, stream' },
  { id: 'silver', n: 2, schema: 'CURATED_SILVER', label: 'Silver', short: 'Cleansed',
    purpose: 'Deduplicated, typed, SCD2 entities with data quality rules applied.',
    addsForAgents: 'Silver: one clean, current record per entity, so the agent never counts a CDC update twice.',
    features: ['Dynamic Tables', 'Data metric functions'], objectTypes: 'Dynamic table' },
  { id: 'gold', n: 3, schema: 'CONFORMED_GOLD', label: 'Gold', short: 'Modelled',
    purpose: 'Conformed star model: shared dimensions and facts.',
    addsForAgents: 'Gold: conformed keys and grains, so customer, circuit and date mean the same thing in every fact.',
    features: ['Dynamic Tables', 'Clustering'], objectTypes: 'Table, dynamic table' },
  { id: 'semantic', n: 4, schema: 'SEMANTIC', label: 'Semantic', short: 'Metrics',
    purpose: 'Semantic views defining business metrics, dimensions, relationships and synonyms.',
    addsForAgents: 'Semantic: turns columns into named metrics so the agent never writes its own join logic.',
    features: ['Semantic Views', 'Cortex Analyst'], objectTypes: 'Semantic view' },
  { id: 'glossary', n: 5, schema: 'GLOSSARY', label: 'Glossary', short: 'Meaning',
    purpose: 'Business terms, the critical data element register and term-to-column mappings.',
    addsForAgents: 'Glossary: an owned, approved definition for every word a user types, mapped to physical columns.',
    features: ['Horizon tags', 'Object comments'], objectTypes: 'Table' },
  { id: 'context', n: 6, schema: 'CONTEXT', label: 'Context', short: 'Judgment',
    purpose: 'Agent instructions, business rules, verified queries, synonyms and document search.',
    addsForAgents: 'Context: the rules and judgment of an expert — what to exclude, how to round, which document to cite.',
    features: ['Cortex Search', 'Verified queries'], objectTypes: 'Table, Cortex Search service' },
  { id: 'product', n: 7, schema: 'DATA_PRODUCTS', label: 'Data products', short: 'Certified',
    purpose: 'Secure views forming each product’s output port, plus the product registry and contracts.',
    addsForAgents: 'Data products: a certified, versioned output port with an SLA, so the agent only answers from trusted data.',
    features: ['Secure views', 'Internal Marketplace', 'Data contracts'], objectTypes: 'Secure view, table' },
  { id: 'agent', n: 8, schema: 'AGENTS', label: 'Agents', short: 'Answers',
    purpose: 'Cortex Agent definitions, tool bindings and evaluation results.',
    addsForAgents: 'Agents: orchestrate the layers below and show their work, with an evaluated accuracy score.',
    features: ['Cortex Agents', 'Snowflake Intelligence', 'Agent evaluations'], objectTypes: 'Cortex Agent, table' },
  { id: 'gov', n: 9, schema: 'GOVERNANCE', label: 'Governance', short: 'Cross-cutting',
    purpose: 'Tags, masking and row access policies, data metric results and access history.',
    addsForAgents: 'Governance: the same masking and row policies apply to the agent as to the person asking.',
    features: ['Horizon tags', 'Masking policies', 'Row access policies', 'Access history'], objectTypes: 'Tag, policy, table' },
];

export const LAYER_BY_ID: Record<LayerId, LayerInfo> = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<LayerId, LayerInfo>;
export const LAYER_BY_SCHEMA: Record<string, LayerInfo> = Object.fromEntries(LAYERS.map((l) => [l.schema, l]));

export const layerVar = (id: LayerId) => `rgb(var(--layer-${id}))`;
