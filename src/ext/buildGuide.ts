// E3 "How it's built" walkthrough. Steps and artifacts are generated from the active pack's catalog, so object
// names, columns and policies always match the Explorer. Tooling settings change the artifacts of affected steps.
import type { IndustryPack, LayerId, LiveState, SfObject } from '../types';
import type { MockSnowflake } from '../mock-snowflake';
import type { Tooling } from './state';

export type GuideLayer = 'setup' | LayerId;
export type RoleKey = 'platform_owner' | 'data_engineer' | 'analytics_engineer' | 'product_owner' | 'steward' | 'sme' | 'ai_engineer' | 'gov_lead' | 'consumer';

export interface Artifact { label: string; lang: 'sql' | 'yaml' | 'python' | 'jil' | 'text'; code: string }
export interface BuildCtx { pack: IndustryPack; db: MockSnowflake; tooling: Tooling; live: LiveState }

export interface BuildStep {
  id: string;
  layer: GuideLayer;
  title: string;
  why: string;
  effort: 'S' | 'M' | 'L';
  features: string[];
  roles: RoleKey[];
  prereqs: string[];
  /** Tooling setting that changes this step's artifacts */
  tooling?: keyof Tooling;
  preview?: string;
  artifacts: (c: BuildCtx) => Artifact[];
  /** Catalog objects (SCHEMA.NAME) this step creates */
  creates: (c: BuildCtx) => string[];
  pitfalls: [string, string];
}

export const GUIDE_LAYERS: { id: GuideLayer; n: number; label: string }[] = [
  { id: 'setup', n: 0, label: 'Platform setup' },
  { id: 'bronze', n: 1, label: 'Bronze' },
  { id: 'silver', n: 2, label: 'Silver' },
  { id: 'gold', n: 3, label: 'Gold' },
  { id: 'semantic', n: 4, label: 'Semantic' },
  { id: 'glossary', n: 5, label: 'Glossary' },
  { id: 'context', n: 6, label: 'Context' },
  { id: 'product', n: 7, label: 'Data products' },
  { id: 'agent', n: 8, label: 'Agents' },
  { id: 'gov', n: 9, label: 'Governance' },
];

const SCHEMAS = ['RAW_BRONZE', 'CURATED_SILVER', 'CONFORMED_GOLD', 'SEMANTIC', 'GLOSSARY', 'CONTEXT', 'DATA_PRODUCTS', 'AGENTS', 'GOVERNANCE'];
const id = (o: SfObject) => `${o.schema}.${o.name}`;
const objs = (c: BuildCtx, f: (o: SfObject) => boolean) => c.pack.objects.filter(f).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const ddl = (c: BuildCtx, o: SfObject) => c.db.ddl(id(o), c.live);
const lower = (s: string) => s.toLowerCase();
const srcTable = (o: SfObject) => o.name.replace(/_CDC$/, '');
const sourceOf = (o: SfObject) => (o.upstream.find((u) => u.startsWith('ext:')) ?? 'ext:source').slice(4);
const join = (xs: string[]) => xs.join('\n\n');
const consumerRoles = (p: IndustryPack) => p.personas.filter((x) => x.archetype !== 'D').map((x) => x.roleId);

function bronzeTables(c: BuildCtx) {
  return objs(c, (o) => o.schema === 'RAW_BRONZE' && o.type === 'ICEBERG TABLE');
}
function silverObjs(c: BuildCtx) {
  return objs(c, (o) => o.schema === 'CURATED_SILVER');
}
function goldDims(c: BuildCtx) {
  return objs(c, (o) => o.schema === 'CONFORMED_GOLD' && !o.name.startsWith('FCT_'));
}
function goldFacts(c: BuildCtx) {
  return objs(c, (o) => o.schema === 'CONFORMED_GOLD' && o.name.startsWith('FCT_'));
}
const cdeCols = (o: SfObject) => o.columns.filter((x) => (x.tags ?? []).includes('CDE'));

function dbtModel(_c: BuildCtx, o: SfObject): string {
  const ups = o.upstream.filter((u) => !u.startsWith('ext:'));
  const key = o.columns[0]?.name ?? 'ID';
  const refs = ups.map((u) => `{{ ref('${lower(u.split('.')[1])}') }}`);
  const cols = o.columns.map((x) => `    ${x.name}`).join(',\n');
  const dedup = o.layer === 'silver'
    ? `\nqualify row_number() over (partition by ${key} order by op_ts desc) = 1\n   and op_type <> 'D'`
    : '';
  return `-- models/${o.layer}/${lower(o.name)}.sql
{{ config(
    materialized = 'dynamic_table',
    target_lag = '${o.targetLag ?? '15 minutes'}',
    snowflake_warehouse = 'WH_TRANSFORM_M',
    schema = '${o.schema}'
) }}

select
${cols}
from ${refs[0] ?? `{{ source('raw', '${lower(o.name)}') }}`}${refs.slice(1).map((r, i) => `\nleft join ${r} as u${i + 1} using (${o.columns.find((x) => x.name.endsWith('_KEY'))?.name ?? key})`).join('')}${dedup}`;
}

function dbtSchemaYml(objsIn: SfObject[]): string {
  return `# models/schema.yml
version: 2
models:
${objsIn.map((o) => `  - name: ${lower(o.name)}
    description: "${o.comment.replace(/"/g, "'")}"
    columns:
${(cdeCols(o).length ? cdeCols(o) : o.columns.slice(0, 1)).map((x) => `      - name: ${lower(x.name)}
        tests:
          - not_null${x === o.columns[0] ? '\n          - unique' : ''}`).join('\n')}`).join('\n')}`;
}

function snowparkModel(o: SfObject): string {
  const key = o.columns[0]?.name ?? 'ID';
  const up = o.upstream.find((u) => !u.startsWith('ext:')) ?? '';
  return `# snowpark/${lower(o.name)}.py
from snowflake.snowpark import Session, Window
from snowflake.snowpark.functions import col, row_number

def build(session: Session) -> None:
    src = session.table("${up}")
    w = Window.partition_by(col("${key}")).order_by(col("OP_TS").desc())
    out = (src.with_column("RN", row_number().over(w))
              .filter((col("RN") == 1) & (col("OP_TYPE") != "D"))
              .select(${o.columns.slice(0, 6).map((x) => `"${x.name}"`).join(', ')}${o.columns.length > 6 ? ', ...' : ''}))
    out.write.mode("overwrite").save_as_table("${o.schema}.${o.name}")`;
}

function orchestration(c: BuildCtx): Artifact {
  const db = c.pack.database;
  const short = c.pack.profile.dbPrefix;
  if (c.tooling.orchestration === 'tasks') {
    return { label: 'Snowflake Tasks', lang: 'sql', code: `CREATE OR REPLACE TASK ${db}.CURATED_SILVER.T_${short}_TRANSFORM
  WAREHOUSE = WH_TRANSFORM_M
  SCHEDULE = 'USING CRON 0 * * * * America/New_York'
AS
  EXECUTE DBT PROJECT ${db}.CURATED_SILVER.${short}_DBT ARGS = 'build --select silver gold';

ALTER TASK ${db}.CURATED_SILVER.T_${short}_TRANSFORM RESUME;` };
  }
  if (c.tooling.orchestration === 'airflow') {
    return { label: 'Airflow DAG', lang: 'python', code: `# dags/${lower(short)}_transform.py
from airflow import DAG
from airflow.providers.snowflake.operators.snowflake import SnowflakeOperator
from datetime import datetime

with DAG("${lower(short)}_transform", start_date=datetime(2026, 1, 1), schedule="@hourly", catchup=False) as dag:
    refresh = SnowflakeOperator(
        task_id="refresh_dynamic_tables",
        snowflake_conn_id="snowflake_${lower(short)}",
        sql=[${silverObjs(c).slice(0, 3).map((o) => `"ALTER DYNAMIC TABLE ${db}.${o.schema}.${o.name} REFRESH"`).join(', ')}],
    )` };
  }
  return { label: 'AutoSys JIL', lang: 'jil', code: `/* AutoSys job: run the dbt build after the CDC landing window */
insert_job: ${short}_DBT_SILVER_GOLD   job_type: CMD
box_name: ${short}_DAILY
command: dbt build --project-dir /apps/${lower(short)}_dbt --select silver gold --target prod
machine: dbt-runner-01
owner: svc_${lower(short)}_dbt
condition: s(${short}_CDC_LANDED)
std_out_file: /logs/${lower(short)}_dbt.out
std_err_file: /logs/${lower(short)}_dbt.err
alarm_if_fail: 1` };
}

function ingestion(c: BuildCtx): Artifact[] {
  const db = c.pack.database;
  const tables = bronzeTables(c);
  const t = tables[0];
  switch (c.tooling.ingestion) {
    case 'snowpipe':
      return [{ label: 'Snowpipe Streaming profile', lang: 'text', code: `# profile.json for the Snowpipe Streaming SDK (one channel per source table)
{
  "user": "SVC_${c.pack.profile.dbPrefix}_INGEST",
  "account": "${c.pack.profile.account.toLowerCase()}",
  "private_key_file": "/secrets/ingest_rsa_key.p8",
  "role": "INGEST_ADMIN",
  "database": "${db}",
  "schema": "RAW_BRONZE"
}
# channels: ${tables.map((x) => x.name).join(', ')}` }];
    case 'openflow':
      return [{ label: 'Openflow connector', lang: 'yaml', code: `# Openflow (Apache NiFi based) CDC connector configuration
connector: database-cdc
source:
  system: ${sourceOf(t)}
  tables:
${tables.map((x) => `    - ${srcTable(x)}`).join('\n')}
destination:
  database: ${db}
  schema: RAW_BRONZE
  table_format: ${c.tooling.format === 'iceberg' ? 'iceberg' : 'snowflake'}
  add_cdc_columns: [OP_TYPE, OP_TS]` }];
    case 'fivetran':
      return [{ label: 'Fivetran connector', lang: 'yaml', code: `# Fivetran connector (managed via Terraform or the REST API)
service: ${lower(sourceOf(t)).replace(/[^a-z0-9]+/g, '_')}
destination: ${lower(db)}
schema_prefix: raw_bronze
sync_frequency: 15
history_mode: true          # keeps update/delete history, mapped to OP_TYPE / OP_TS
tables:
${tables.map((x) => `  - ${lower(srcTable(x))}`).join('\n')}` }];
    default:
      return [{ label: 'GoldenGate replicat (excerpt)', lang: 'text', code: `-- Oracle GoldenGate for Distributed Applications: replicat to ${c.tooling.format === 'iceberg' ? 'Iceberg on S3' : 'Snowflake'}
REPLICAT R${c.pack.profile.dbPrefix}CDC
TARGETDB LIBFILE libggjava.so SET property=dirprm/snowflake.props
REPORTCOUNT EVERY 1 MINUTES, RATE
${tables.map((x) => `MAP ${sourceOf(x).split(' ')[0].toUpperCase()}.${srcTable(x)}, TARGET ${db}.RAW_BRONZE.${x.name},
  COLMAP (USEDEFAULTS, OP_TYPE = @GETENV('GGHEADER', 'OPTYPE'), OP_TS = @GETENV('GGHEADER', 'COMMITTIMESTAMP'));`).join('\n')}` }];
  }
}

const setupSql = (c: BuildCtx) => `CREATE DATABASE IF NOT EXISTS ${c.pack.database}
  COMMENT = '${c.pack.profile.company} AI-ready data platform';

${SCHEMAS.map((s) => `CREATE SCHEMA IF NOT EXISTS ${c.pack.database}.${s} WITH MANAGED ACCESS;`).join('\n')}`;

export const STEPS: BuildStep[] = [
  // ------------------------------------------------------------------ 0. Setup
  { id: 'setup-database', layer: 'setup', title: 'Create the database and nine schemas', effort: 'S',
    why: 'One database with a schema per layer makes the stack visible in every tool and lets grants follow the layers. Managed-access schemas keep grant decisions with the schema owner.',
    features: ['Databases and schemas', 'Managed access'], roles: ['platform_owner'], prereqs: [],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: setupSql(c) }], creates: () => [],
    pitfalls: ['Creating one database per source makes cross-layer lineage and grants harder.', 'Leaving schemas unmanaged lets object owners grant access around the steward.'] },
  { id: 'setup-roles', layer: 'setup', title: 'Roles and the grants hierarchy', effort: 'M',
    why: 'Functional roles for each persona and access roles per layer let policies key off roles, not users. Agents later run as the asking user’s role, so the hierarchy is the security model for AI too.',
    features: ['RBAC', 'Database roles'], roles: ['platform_owner', 'gov_lead'], prereqs: ['setup-database'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: `${['INGEST_ADMIN', 'TRANSFORM_ADMIN', 'SEMANTIC_ADMIN', 'DATA_PRODUCT_OWNER', 'AI_PLATFORM_ADMIN', 'GOVERNANCE_ADMIN', ...c.pack.personas.map((p) => p.roleId)].map((r) => `CREATE ROLE IF NOT EXISTS ${r};`).join('\n')}

-- Consumers read certified output ports only
${consumerRoles(c.pack).map((r) => `GRANT USAGE ON DATABASE ${c.pack.database} TO ROLE ${r};\nGRANT USAGE ON SCHEMA ${c.pack.database}.DATA_PRODUCTS TO ROLE ${r};`).join('\n')}

GRANT ROLE TRANSFORM_ADMIN TO ROLE SYSADMIN;
GRANT ROLE GOVERNANCE_ADMIN TO ROLE SECURITYADMIN;` }], creates: () => [],
    pitfalls: ['Granting consumers access to Gold tables bypasses product contracts and certification.', 'Using one service role for all agents removes per-user masking and row access.'] },
  { id: 'setup-warehouses', layer: 'setup', title: 'Warehouses by workload', effort: 'S',
    why: 'Separate warehouses for ingestion, transformation, BI and AI make cost attributable and stop one workload starving another. Auto-suspend keeps idle cost near zero.',
    features: ['Virtual warehouses', 'Auto-suspend'], roles: ['platform_owner'], prereqs: ['setup-roles'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: [['WH_INGEST_S', 'SMALL'], ['WH_TRANSFORM_M', 'MEDIUM'], [c.pack.warehouse, 'XSMALL'], ['WH_AI_S', 'SMALL']].map(([n, s]) => `CREATE WAREHOUSE IF NOT EXISTS ${n}\n  WAREHOUSE_SIZE = '${s}' AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE;`).join('\n\n') }], creates: () => [],
    pitfalls: ['One large shared warehouse hides which layer drives cost.', 'Auto-suspend above 5 minutes on BI warehouses burns idle credits.'] },
  { id: 'setup-monitors', layer: 'setup', title: 'Resource monitors and budgets', effort: 'S',
    why: 'Cost guardrails are part of the foundation, not an afterthought. Monitors notify at 80% and suspend at 100% of the monthly quota.',
    features: ['Resource monitors', 'Budgets'], roles: ['platform_owner'], prereqs: ['setup-warehouses'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: `CREATE RESOURCE MONITOR RM_${c.pack.profile.dbPrefix}_PLATFORM
  WITH CREDIT_QUOTA = 1200 FREQUENCY = MONTHLY START_TIMESTAMP = IMMEDIATELY
  TRIGGERS ON 80 PERCENT DO NOTIFY
           ON 100 PERCENT DO SUSPEND;

ALTER WAREHOUSE WH_TRANSFORM_M SET RESOURCE_MONITOR = RM_${c.pack.profile.dbPrefix}_PLATFORM;
ALTER WAREHOUSE ${c.pack.warehouse} SET RESOURCE_MONITOR = RM_${c.pack.profile.dbPrefix}_PLATFORM;` }], creates: () => [],
    pitfalls: ['Suspending the BI warehouse mid-month without notice breaks product SLAs.', 'Quotas set before measuring a baseline are either useless or disruptive.'] },

  // ------------------------------------------------------------------ 1. Bronze
  { id: 'bronze-cdc', layer: 'bronze', title: 'Capture changes from the source systems', effort: 'L', tooling: 'ingestion',
    why: 'Bronze keeps every insert, update and delete so any number can be replayed to its source record. OP_TYPE and OP_TS travel with each row so Silver can deduplicate deterministically.',
    features: ['Change data capture', 'Snowpipe Streaming'], roles: ['data_engineer', 'platform_owner'], prereqs: ['setup-roles'],
    artifacts: (c) => ingestion(c), creates: () => [],
    pitfalls: ['Dropping deletes at ingestion makes Silver counts drift upward over time.', 'Converting timestamps in flight loses the commit order needed for deduplication.'] },
  { id: 'bronze-volume', layer: 'bronze', title: 'External volume and catalog integration', effort: 'M', tooling: 'format',
    why: 'Iceberg on the client’s S3 keeps raw data in an open format other engines can read, while Snowflake manages the table. The external volume is the trust boundary to the bucket.',
    features: ['External volumes', 'Apache Iceberg tables', 'Catalog integrations'], roles: ['platform_owner', 'data_engineer'], prereqs: ['bronze-cdc'],
    artifacts: (c) => c.tooling.format === 'native'
      ? [{ label: 'Note', lang: 'text', code: 'Native Snowflake tables need no external volume or catalog integration: storage is managed by Snowflake.\nSkip to the next step.' }]
      : [
        { label: 'External volume', lang: 'sql', code: `CREATE EXTERNAL VOLUME IF NOT EXISTS EV_S3_LANDING
  STORAGE_LOCATIONS = ((
    NAME = 's3-landing'
    STORAGE_PROVIDER = 'S3'
    STORAGE_BASE_URL = 's3://${lower(c.pack.profile.dbPrefix)}-ai-platform-landing/'
    STORAGE_AWS_ROLE_ARN = 'arn:aws:iam::<account-id>:role/${lower(c.pack.profile.dbPrefix)}-snowflake-iceberg'
  ))
  ALLOW_WRITES = TRUE;

DESC EXTERNAL VOLUME EV_S3_LANDING;  -- copy the IAM user ARN and external ID into the role trust policy` },
        { label: 'Catalog integration (optional)', lang: 'sql', code: `-- Only when an external writer registers tables in Snowflake Open Catalog instead of Snowflake
CREATE CATALOG INTEGRATION OPEN_CATALOG_CDC
  CATALOG_SOURCE = POLARIS
  TABLE_FORMAT = ICEBERG
  CATALOG_NAMESPACE = 'raw_bronze'
  REST_CONFIG = (CATALOG_URI = 'https://<org>-<account>.snowflakecomputing.com/polaris/api/catalog' CATALOG_NAME = 'cdc')
  REST_AUTHENTICATION = (TYPE = OAUTH OAUTH_CLIENT_ID = '<client-id>' OAUTH_CLIENT_SECRET = '<secret>' OAUTH_ALLOWED_SCOPES = ('PRINCIPAL_ROLE:ALL'))
  ENABLED = TRUE;` },
      ],
    creates: () => [],
    pitfalls: ['A trust policy without the external ID lets any Snowflake account assume the role.', 'Mixing Snowflake-managed and externally-catalogued tables in one schema confuses ownership.'] },
  { id: 'bronze-tables', layer: 'bronze', title: 'Register the Bronze tables', effort: 'M', tooling: 'format',
    why: 'Each source table lands as one append-only Bronze table with the CDC columns. Sensitive columns are tagged from day one so masking follows the data upward.',
    features: ['Apache Iceberg tables', 'Object tagging'], roles: ['data_engineer'], prereqs: ['bronze-volume'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: join(bronzeTables(c).map((o) => {
      const d = ddl(c, o);
      return c.tooling.format === 'native'
        ? d.replace('CREATE OR REPLACE ICEBERG TABLE', 'CREATE OR REPLACE TABLE').replace(/\n {2}CATALOG = 'SNOWFLAKE'\n {2}EXTERNAL_VOLUME = 'EV_S3_LANDING'\n {2}BASE_LOCATION = '[^']*'/, '\n  CHANGE_TRACKING = TRUE')
        : d;
    })) }],
    creates: (c) => bronzeTables(c).map(id),
    pitfalls: ['Typing Bronze columns aggressively rejects rows; keep Bronze close to the source.', 'Untagged PII in Bronze is readable by every engineer role.'] },
  { id: 'bronze-streams', layer: 'bronze', title: 'Streams for change capture', effort: 'S',
    why: 'Streams let downstream jobs consume only new changes. Dynamic tables track changes themselves, so streams are kept for the few incremental jobs that need them.',
    features: ['Streams'], roles: ['data_engineer'], prereqs: ['bronze-tables'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: join(objs(c, (o) => o.schema === 'RAW_BRONZE' && o.type === 'STREAM').map((o) => ddl(c, o))) || '-- This pack uses dynamic tables only; no streams are needed.' }],
    creates: (c) => objs(c, (o) => o.schema === 'RAW_BRONZE' && o.type === 'STREAM').map(id),
    pitfalls: ['A stream not consumed within the retention period goes stale.', 'Several consumers sharing one stream lose changes; create one stream per consumer.'] },

  // ------------------------------------------------------------------ 2. Silver
  { id: 'silver-main', layer: 'silver', title: 'Deduplicate the main entity with SCD2', effort: 'L', tooling: 'transformation',
    why: 'Silver keeps one clean row per entity version, so a CDC update is never counted twice and history is preserved. This is where the duplicates and deletes in Bronze disappear.',
    features: ['Dynamic tables', 'TARGET_LAG'], roles: ['data_engineer'], prereqs: ['bronze-tables'],
    artifacts: (c) => {
      const o = silverObjs(c)[0];
      if (!o) return [];
      if (c.tooling.transformation === 'snowpark') return [{ label: 'Snowpark Python', lang: 'python', code: snowparkModel(o) }];
      if (c.tooling.transformation === 'dynamic') return [{ label: 'Dynamic table', lang: 'sql', code: ddl(c, o) }];
      return [{ label: 'dbt model', lang: 'sql', code: dbtModel(c, o) }, { label: 'Dynamic table (compiled)', lang: 'sql', code: ddl(c, o) }];
    },
    creates: (c) => silverObjs(c).slice(0, 1).map(id),
    pitfalls: ['Deduplicating on load time instead of commit time keeps the wrong version.', 'Forgetting OP_TYPE = ’D’ leaves deleted entities in every count.'] },
  { id: 'silver-entities', layer: 'silver', title: 'Curate the remaining Silver entities', effort: 'M', tooling: 'transformation',
    why: 'Each Bronze table gets a typed, trimmed and deduplicated Silver counterpart with a lag that matches its business need. Lags are set per entity, not globally.',
    features: ['Dynamic tables', 'Incremental refresh'], roles: ['data_engineer'], prereqs: ['silver-main'],
    artifacts: (c) => {
      const rest = silverObjs(c).slice(1);
      if (c.tooling.transformation === 'snowpark') return [{ label: 'Snowpark Python', lang: 'python', code: rest.map(snowparkModel).join('\n\n') }];
      if (c.tooling.transformation === 'dynamic') return [{ label: 'Dynamic tables', lang: 'sql', code: join(rest.map((o) => ddl(c, o))) }];
      return [{ label: 'dbt models', lang: 'sql', code: join(rest.map((o) => dbtModel(c, o))) }];
    },
    creates: (c) => silverObjs(c).slice(1).map(id),
    pitfalls: ['A 1-minute lag on every table multiplies refresh cost for no business benefit.', 'Casting with TRY_ functions silently hides bad source data; log rejects instead.'] },
  { id: 'silver-dq', layer: 'silver', title: 'Data quality expectations', effort: 'M', tooling: 'transformation',
    why: 'Quality rules on critical columns turn “the numbers look wrong” into an alert before anyone uses them. The same results feed certification gate 3 and the Data Health tab.',
    features: ['Data metric functions', 'dbt tests'], roles: ['data_engineer', 'steward'], prereqs: ['silver-entities'],
    artifacts: (c) => [
      ...(c.tooling.transformation === 'dbt' ? [{ label: 'dbt schema.yml', lang: 'yaml' as const, code: dbtSchemaYml(silverObjs(c)) }] : []),
      { label: 'Data metric functions', lang: 'sql', code: silverObjs(c).map((o) => {
        const cols = (cdeCols(o).length ? cdeCols(o) : o.columns.slice(0, 1)).slice(0, 2);
        return `ALTER TABLE ${c.pack.database}.${o.schema}.${o.name} SET DATA_METRIC_SCHEDULE = 'TRIGGER_ON_CHANGES';
${cols.map((x) => `ALTER TABLE ${c.pack.database}.${o.schema}.${o.name} ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT ON (${x.name});`).join('\n')}
ALTER TABLE ${c.pack.database}.${o.schema}.${o.name} ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.DUPLICATE_COUNT ON (${o.columns[0].name});`;
      }).join('\n\n') },
    ],
    creates: () => [],
    pitfalls: ['Checking every column on every change is expensive; focus on CDEs and keys.', 'Rules without an owner are ignored when they fail.'] },
  { id: 'silver-orchestration', layer: 'silver', title: 'Orchestration hook', effort: 'S', tooling: 'orchestration',
    why: 'Dynamic tables schedule themselves, but jobs outside Snowflake still need to start after landing completes. The hook makes the platform part of the client’s existing schedule.',
    features: ['Tasks', 'External schedulers'], roles: ['data_engineer', 'platform_owner'], prereqs: ['silver-entities'],
    artifacts: (c) => [orchestration(c)], creates: () => [],
    pitfalls: ['Two schedulers triggering the same refresh doubles cost.', 'Time-based triggers race late CDC batches; trigger on landing completion instead.'] },

  // ------------------------------------------------------------------ 3. Gold
  { id: 'gold-dims', layer: 'gold', title: 'Conformed dimensions with surrogate keys', effort: 'L', tooling: 'transformation',
    why: 'Conformed dimensions make “customer”, “date” and other shared entities mean the same thing in every fact. Surrogate keys decouple facts from source identifiers.',
    features: ['Dynamic tables', 'Sequences'], roles: ['analytics_engineer', 'data_engineer'], prereqs: ['silver-entities'],
    artifacts: (c) => c.tooling.transformation === 'dbt'
      ? [{ label: 'dbt models', lang: 'sql', code: join(goldDims(c).map((o) => dbtModel(c, o))) }, { label: 'DDL (compiled)', lang: 'sql', code: join(goldDims(c).map((o) => ddl(c, o))) }]
      : [{ label: 'DDL', lang: 'sql', code: join(goldDims(c).map((o) => ddl(c, o))) }],
    creates: (c) => goldDims(c).map(id),
    pitfalls: ['Different keys for the same entity in two facts makes joins silently wrong.', 'Rebuilding surrogate keys on every load breaks history.'] },
  { id: 'gold-facts', layer: 'gold', title: 'Facts at a declared grain', effort: 'L', tooling: 'transformation',
    why: 'Each fact states its grain (one row per statement, event or day) so metrics can be summed safely. Facts join to dimensions only through surrogate keys.',
    features: ['Dynamic tables'], roles: ['analytics_engineer'], prereqs: ['gold-dims'],
    artifacts: (c) => c.tooling.transformation === 'dbt'
      ? [{ label: 'dbt models', lang: 'sql', code: join(goldFacts(c).map((o) => dbtModel(c, o))) }, { label: 'DDL (compiled)', lang: 'sql', code: join(goldFacts(c).map((o) => ddl(c, o))) }]
      : [{ label: 'DDL', lang: 'sql', code: join(goldFacts(c).map((o) => ddl(c, o))) }],
    creates: (c) => goldFacts(c).map(id),
    pitfalls: ['Mixing grains in one fact is the most common cause of double counting.', 'Copying dimension attributes into facts drifts from the conformed dimension.'] },
  { id: 'gold-clustering', layer: 'gold', title: 'Clustering decisions', effort: 'S',
    why: 'Large facts are clustered on the columns most queries filter by, usually the date key. Small tables are left alone because clustering has an ongoing cost.',
    features: ['Clustering keys', 'Automatic clustering'], roles: ['data_engineer'], prereqs: ['gold-facts'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: goldFacts(c).filter((o) => o.rowCount > 10_000_000).map((o) => `ALTER DYNAMIC TABLE ${c.pack.database}.${o.schema}.${o.name} CLUSTER BY (${o.columns.find((x) => x.name === 'DATE_KEY')?.name ?? o.columns[0].name});`).join('\n') || '-- No fact is large enough to justify clustering yet.' }],
    creates: () => [],
    pitfalls: ['Clustering every table adds background credits with no query benefit.', 'High-cardinality clustering keys (timestamps) cluster poorly; use the date key.'] },

  // ------------------------------------------------------------------ 4. Semantic
  { id: 'semantic-views', layer: 'semantic', title: 'A semantic view per domain', effort: 'L',
    why: 'Semantic views turn columns into named metrics, dimensions and relationships, so BI and agents compute a metric the same way. The agent never writes its own join logic.',
    features: ['Semantic views'], roles: ['analytics_engineer', 'product_owner'], prereqs: ['gold-facts'],
    artifacts: (c) => objs(c, (o) => o.schema === 'SEMANTIC').map((o) => ({ label: o.name, lang: 'sql' as const, code: ddl(c, o) })),
    creates: (c) => objs(c, (o) => o.schema === 'SEMANTIC').map(id),
    pitfalls: ['Defining the same metric in a BI tool and a semantic view creates two truths.', 'Missing relationships force Cortex Analyst to guess joins.'] },
  { id: 'semantic-vq', layer: 'semantic', title: 'Verified queries', effort: 'M',
    why: 'Verified question-and-SQL pairs anchor the agent on known-good answers and become its evaluation set. Certification requires at least ten per product.',
    features: ['Verified queries', 'Cortex Analyst'], roles: ['analytics_engineer', 'sme'], prereqs: ['semantic-views'],
    artifacts: (c) => [{ label: 'Verified queries YAML', lang: 'yaml', code: `verified_queries:\n${c.pack.context.verifiedQueries.slice(0, 4).map((v) => `  - name: ${v.id.toLowerCase()}\n    semantic_view: ${v.semanticView}\n    question: "${v.question}"\n    verified_by: ${v.verifiedBy}\n    verified_at: ${v.verifiedOn}\n    sql: |\n${v.sql.split('\n').map((l) => `      ${l}`).join('\n')}`).join('\n')}\n  # … ${Math.max(0, c.pack.context.verifiedQueries.length - 4)} more` }],
    creates: (c) => objs(c, (o) => o.schema === 'CONTEXT' && o.name === 'VERIFIED_QUERIES').map(id),
    pitfalls: ['Verified queries copied from old reports may encode the old (wrong) definition.', 'Unowned verified queries go stale when the model changes.'] },
  { id: 'semantic-test', layer: 'semantic', title: 'Test with Cortex Analyst', effort: 'S',
    why: 'Before any agent is built, ask Cortex Analyst the verified questions and compare. Accuracy below 90% means the semantic view, not the model, needs work.',
    features: ['Cortex Analyst'], roles: ['analytics_engineer', 'ai_engineer'], prereqs: ['semantic-vq'],
    artifacts: (c) => {
      const sv = c.pack.semanticViews[0];
      return [{ label: 'REST request', lang: 'text', code: `POST /api/v2/cortex/analyst/message
Authorization: Bearer <token>
Content-Type: application/json

{
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "${c.pack.context.verifiedQueries.find((v) => v.semanticView === sv.name)?.question ?? 'How many?'}" }] }],
  "semantic_view": "${c.pack.database}.SEMANTIC.${sv.name}"
}` }];
    },
    creates: () => [],
    pitfalls: ['Testing only the questions used to build the view overstates accuracy.', 'Running tests as an admin role hides access problems users will hit.'] },

  // ------------------------------------------------------------------ 5. Glossary
  { id: 'glossary-terms', layer: 'glossary', title: 'Load terms and critical data elements', effort: 'M',
    why: 'Every word a user types needs an owned, approved definition. CDEs carry a steward and DQ rules because they drive regulated or financial numbers.',
    features: ['Tables', 'Object comments'], roles: ['steward', 'sme'], prereqs: ['setup-database'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: `${ddl(c, c.pack.objects.find((o) => o.schema === 'GLOSSARY' && o.name === 'BUSINESS_TERM')!)}

INSERT INTO ${c.pack.database}.GLOSSARY.BUSINESS_TERM VALUES
${c.pack.glossary.slice(0, 4).map((t) => `  ('${t.id}', '${t.term.replace(/'/g, "''")}', '${t.definition.replace(/'/g, "''").slice(0, 80)}…', '${t.domain}', '${t.owner}', ${t.steward ? `'${t.steward}'` : 'NULL'}, '${t.status}', ${t.isCde ? 'TRUE' : 'FALSE'})`).join(',\n')};
-- … ${c.pack.glossary.length - 4} more terms` }],
    creates: (c) => objs(c, (o) => o.schema === 'GLOSSARY' && (o.name === 'BUSINESS_TERM' || o.name === 'CDE_REGISTER')).map(id),
    pitfalls: ['Importing a thousand terms at once buries the twenty that matter.', 'A CDE without a steward is a governance gap, not a term.'] },
  { id: 'glossary-map', layer: 'glossary', title: 'Map terms to columns', effort: 'M',
    why: 'Mappings tie each term to the columns that define, derive or filter it, giving the term a lineage to products and agents. The Glossary tab’s lineage strip reads these rows.',
    features: ['Tables'], roles: ['steward', 'analytics_engineer'], prereqs: ['glossary-terms'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: `INSERT INTO ${c.pack.database}.GLOSSARY.TERM_COLUMN_MAP VALUES
${c.pack.glossary.flatMap((t) => t.mappings.map((m) => `  ('${t.id}', '${c.pack.database}.${m.fqn}', '${m.column}', '${m.kind}')`)).slice(0, 8).join(',\n')};` }],
    creates: (c) => objs(c, (o) => o.schema === 'GLOSSARY' && o.name === 'TERM_COLUMN_MAP').map(id),
    pitfalls: ['Mapping only Gold columns leaves Silver changes invisible to impact analysis.', 'Free-text mappings break when columns are renamed; use FQNs.'] },
  { id: 'glossary-tags', layer: 'glossary', title: 'Tag CDE columns', effort: 'S',
    why: 'A CDE tag on the physical column lets policies, DMF schedules and certification checks find critical data automatically.',
    features: ['Object tagging'], roles: ['steward', 'gov_lead'], prereqs: ['glossary-map', 'gov-tags'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: c.pack.objects.filter((o) => o.schema === 'CONFORMED_GOLD').flatMap((o) => cdeCols(o).map((x) => `ALTER TABLE ${c.pack.database}.${o.schema}.${o.name} MODIFY COLUMN ${x.name} SET TAG ${c.pack.database}.GOVERNANCE.CDE = 'TRUE';`)).slice(0, 12).join('\n') }],
    creates: () => [],
    pitfalls: ['Tagging by hand drifts from the CDE register; generate tags from it.', 'Tags on views are not inherited by base tables.'] },

  // ------------------------------------------------------------------ 6. Context
  { id: 'context-instructions', layer: 'context', title: 'Agent instructions', effort: 'S',
    why: 'Persona, response, guardrail and orchestration instructions are versioned data, not prompts hidden in code. Stewards and SMEs can review them like any other content.',
    features: ['Tables'], roles: ['ai_engineer', 'sme'], prereqs: ['setup-database'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: `INSERT INTO ${c.pack.database}.CONTEXT.AGENT_INSTRUCTIONS VALUES
${c.pack.context.instructions.slice(0, 4).map((i) => `  ('${c.pack.agents.find((a) => a.id === i.agentId)?.objectName}', '${i.type}', '${i.text.replace(/'/g, "''")}', '${i.version}')`).join(',\n')};` }],
    creates: (c) => objs(c, (o) => o.schema === 'CONTEXT' && o.name === 'AGENT_INSTRUCTIONS').map(id),
    pitfalls: ['Instructions that restate metric formulas drift from the semantic view.', 'Unversioned instructions make agent regressions impossible to explain.'] },
  { id: 'context-rules', layer: 'context', title: 'Business rules and synonyms', effort: 'M',
    why: 'Rules carry the judgment an expert applies (what to exclude, how to round) with the document they come from. Synonyms map how people speak to the approved term.',
    features: ['Tables'], roles: ['sme', 'steward'], prereqs: ['glossary-terms'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: `INSERT INTO ${c.pack.database}.CONTEXT.BUSINESS_RULES VALUES
${c.pack.context.rules.slice(0, 4).map((r) => `  ('${r.id}', '${r.domain}', '${r.text.replace(/'/g, "''")}', '${r.metric}', '${r.sourceDoc}')`).join(',\n')};

INSERT INTO ${c.pack.database}.CONTEXT.SYNONYMS VALUES
${c.pack.context.synonyms.slice(0, 5).map((s) => `  ('${s.term}', '${s.synonym}', '${s.scope}')`).join(',\n')};` }],
    creates: (c) => objs(c, (o) => o.schema === 'CONTEXT' && (o.name === 'BUSINESS_RULES' || o.name === 'SYNONYMS')).map(id),
    pitfalls: ['Rules without a source document cannot be audited.', 'Global synonyms collide across domains; scope them.'] },
  { id: 'context-search', layer: 'context', title: 'Document stage and Cortex Search', effort: 'M',
    why: 'Policies and standards are chunked and indexed so the agent can cite the paragraph behind an answer. The service refreshes on a lag, like a dynamic table.',
    features: ['Stages', 'Cortex Search', 'PARSE_DOCUMENT'], roles: ['ai_engineer', 'sme'], prereqs: ['context-rules'],
    artifacts: (c) => [
      { label: 'Stage and chunks', lang: 'sql', code: `CREATE STAGE IF NOT EXISTS ${c.pack.database}.CONTEXT.DOCS
  DIRECTORY = (ENABLE = TRUE) ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE');

CREATE OR REPLACE TABLE ${c.pack.database}.CONTEXT.DOC_CHUNKS AS
SELECT d.RELATIVE_PATH AS SOURCE,
       c.INDEX AS CHUNK_NO,
       c.VALUE::STRING AS CHUNK_TEXT
  FROM DIRECTORY(@${c.pack.database}.CONTEXT.DOCS) d,
       LATERAL FLATTEN(SNOWFLAKE.CORTEX.SPLIT_TEXT_RECURSIVE_CHARACTER(
         SNOWFLAKE.CORTEX.PARSE_DOCUMENT(@${c.pack.database}.CONTEXT.DOCS, d.RELATIVE_PATH, {'mode': 'LAYOUT'}):content::STRING,
         'markdown', 1500, 200)) c;` },
      { label: 'Cortex Search service', lang: 'sql', code: ddl(c, c.pack.objects.find((o) => o.type === 'CORTEX SEARCH SERVICE')!) },
    ],
    creates: (c) => objs(c, (o) => o.type === 'CORTEX SEARCH SERVICE').map(id),
    pitfalls: ['Indexing whole PDFs as one chunk makes citations useless.', 'Indexing drafts alongside approved policies lets the agent cite superseded rules.'] },

  // ------------------------------------------------------------------ 7. Data products
  { id: 'product-ports', layer: 'product', title: 'Secure view output ports', effort: 'M',
    why: 'A product’s secure view is its only public interface: consumers and agents never touch Gold directly. Secure views hide the definition and keep policies intact.',
    features: ['Secure views'], roles: ['product_owner', 'analytics_engineer'], prereqs: ['gold-facts', 'semantic-views'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: join(objs(c, (o) => o.schema === 'DATA_PRODUCTS' && o.type === 'SECURE VIEW').map((o) => ddl(c, o))) }],
    creates: (c) => objs(c, (o) => o.schema === 'DATA_PRODUCTS' && o.type === 'SECURE VIEW').map(id),
    pitfalls: ['SELECT * in an output port turns every Gold change into a breaking change.', 'Non-secure views expose the definition and allow optimizer side channels.'] },
  { id: 'product-registry', layer: 'product', title: 'Registry entry and data contract', effort: 'M',
    why: 'The registry and contract state owner, steward, SLA, schema and change policy. Certification and impact analysis read them.',
    features: ['Tables', 'Data contracts'], roles: ['product_owner', 'steward'], prereqs: ['product-ports'],
    artifacts: (c) => {
      const p = c.pack.products.find((x) => x.id === c.pack.certificationScript.productId)!;
      return [
        { label: 'Registry', lang: 'sql', code: `INSERT INTO ${c.pack.database}.DATA_PRODUCTS.DP_REGISTRY VALUES
${c.pack.products.map((x) => `  ('${x.id}', '${x.name.replace(/'/g, "''")}', '${x.domain}', '${x.version}', '${x.status}', '${x.owner}', ${x.steward ? `'${x.steward}'` : 'NULL'}, '${x.sla}', ${x.semanticView ? `'${x.semanticView}'` : 'NULL'}, '${c.pack.database}.DATA_PRODUCTS.${x.outputPort}')`).join(',\n')};` },
        { label: `${p.id} contract`, lang: 'yaml', code: p.contractYaml },
      ];
    },
    creates: (c) => objs(c, (o) => o.schema === 'DATA_PRODUCTS' && o.type === 'TABLE').map(id),
    pitfalls: ['Contracts written after release describe what shipped, not what was promised.', 'No change-notice period means every change surprises consumers.'] },
  { id: 'product-dmf', layer: 'product', title: 'Data metric functions on CDEs', effort: 'S',
    why: 'Quality is measured where the product is built and published with it. Certification gate 3 and the Data Health tab read these results.',
    features: ['Data metric functions'], roles: ['steward', 'data_engineer'], prereqs: ['product-ports', 'glossary-tags'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: goldFacts(c).map((o) => `ALTER TABLE ${c.pack.database}.${o.schema}.${o.name} SET DATA_METRIC_SCHEDULE = '60 MINUTE';
${cdeCols(o).slice(0, 2).map((x) => `ALTER TABLE ${c.pack.database}.${o.schema}.${o.name} ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT ON (${x.name});`).join('\n')}
ALTER TABLE ${c.pack.database}.${o.schema}.${o.name} ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.FRESHNESS ON (${o.columns.find((x) => x.type.startsWith('TIMESTAMP'))?.name ?? 'DATE_KEY'});`).join('\n\n') }],
    creates: () => [],
    pitfalls: ['FRESHNESS on a date key measures business date, not load time.', 'Schedules more frequent than the product SLA add cost without value.'] },
  { id: 'product-listing', layer: 'product', title: 'Internal Marketplace listing', effort: 'S', preview: 'Organization listings',
    why: 'Listing a certified product in the internal Marketplace makes it discoverable with its contract, owner and request workflow. Access requests replace ad hoc grants.',
    features: ['Internal Marketplace', 'Organization listings'], roles: ['product_owner'], prereqs: ['product-registry'],
    artifacts: (c) => {
      const p = c.pack.products[0];
      return [{ label: 'Listing manifest', lang: 'yaml', code: `title: "${p.name}"
subtitle: "${p.description}"
description: |
  ${p.purpose}
  Owner: ${p.owner}. Steward: ${p.steward}. SLA: ${p.sla}.
organization_targets:
  discovery: [all_internal_accounts]
  access: [account: ${c.pack.profile.account}, roles: [${consumerRoles(c.pack).join(', ')}]]
request_approval_type: REQUEST_AND_APPROVE_IN_SNOWFLAKE
approver_contact: data-stewards@${lower(c.pack.profile.dbPrefix)}.example
data_dictionary:
  featured:
    database: ${c.pack.database}
    objects:
      - { schema: DATA_PRODUCTS, name: ${p.outputPort}, domain: VIEW }` }];
    },
    creates: () => [],
    pitfalls: ['Listing draft products erodes trust in the Marketplace.', 'Approval by the platform team instead of the steward slows access and loses context.'] },

  // ------------------------------------------------------------------ 8. Agents
  { id: 'agent-spec', layer: 'agent', title: 'Agent specification with tools', effort: 'M', preview: 'Cortex Agents',
    why: 'Each agent binds instructions to tools: Cortex Analyst on semantic views and Cortex Search on documents. The agent can only reach what its tools and the user’s role allow.',
    features: ['Cortex Agents', 'Cortex Analyst', 'Cortex Search'], roles: ['ai_engineer'], prereqs: ['semantic-views', 'context-search'],
    artifacts: (c) => objs(c, (o) => o.type === 'AGENT').map((o) => ({ label: o.name, lang: 'sql' as const, code: ddl(c, o) })),
    creates: (c) => objs(c, (o) => o.type === 'AGENT').map(id),
    pitfalls: ['Giving an agent a SQL tool over Gold bypasses semantic views and certification.', 'Instructions that hard-code numbers go stale on the next refresh.'] },
  { id: 'agent-grants', layer: 'agent', title: 'Grants to consumer roles', effort: 'S',
    why: 'Agents are granted like data products: a role can chat with an agent only when granted. Snowflake Intelligence then shows each user the agents they may use.',
    features: ['RBAC', 'Snowflake Intelligence'], roles: ['ai_engineer', 'steward'], prereqs: ['agent-spec'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: c.pack.agents.flatMap((a) => c.pack.personas.filter((p) => c.pack.initialAccess[p.roleId]?.[a.id] === 'G').map((p) => `GRANT USAGE ON AGENT ${c.pack.database}.AGENTS.${a.objectName} TO ROLE ${p.roleId};`)).join('\n') }],
    creates: () => [],
    pitfalls: ['Granting the agent to PUBLIC makes the access matrix meaningless.', 'Forgetting product grants means users get polite refusals instead of answers.'] },
  { id: 'agent-eval', layer: 'agent', title: 'Evaluation set and registry', effort: 'M',
    why: 'An agent is released only when it passes its evaluation set (target 90%). Results are stored so accuracy can be tracked like any other product KPI.',
    features: ['Agent evaluations'], roles: ['ai_engineer', 'steward'], prereqs: ['agent-spec', 'semantic-vq'],
    artifacts: (c) => {
      const a = c.pack.agents[0];
      return [{ label: 'Eval set YAML', lang: 'yaml', code: `eval_set: ${a.objectName.replace('AGT_', '').toLowerCase()}_golden_v3
agent: ${c.pack.database}.AGENTS.${a.objectName}
pass_threshold: 0.90
questions:
${c.pack.scenarios.filter((s) => s.agentId === a.id).slice(0, 4).map((s) => `  - id: ${s.id}\n    question: "${s.question}"\n    expected_source: ${s.productIds.join(', ') || 'metadata'}`).join('\n')}` }];
    },
    creates: (c) => objs(c, (o) => o.schema === 'AGENTS' && o.type === 'TABLE').map(id),
    pitfalls: ['Eval sets written by the agent builder alone miss real user phrasing.', 'Not re-running evals after a semantic change hides regressions.'] },

  // ------------------------------------------------------------------ 9. Governance
  { id: 'gov-tags', layer: 'gov', title: 'Classification and certification tags', effort: 'S',
    why: 'Tags are the vocabulary policies key off: sensitive class, CDE, domain and certification level. One tag-based policy then protects every column carrying the tag.',
    features: ['Object tagging'], roles: ['gov_lead'], prereqs: ['setup-database'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: join(objs(c, (o) => o.type === 'TAG').map((o) => ddl(c, o))) }],
    creates: (c) => objs(c, (o) => o.type === 'TAG').map(id),
    pitfalls: ['Free-text tag values break policy conditions; use ALLOWED_VALUES.', 'Too many tag types leave stewards unsure which to apply.'] },
  { id: 'gov-masking', layer: 'gov', title: 'Masking policies', effort: 'M',
    why: 'Masking is enforced at query time for people and agents alike: only the steward role sees sensitive values in clear. Attaching the policy to the tag protects new columns automatically.',
    features: ['Masking policies', 'Tag-based masking'], roles: ['gov_lead', 'steward'], prereqs: ['gov-tags'],
    artifacts: (c) => [{ label: 'SQL', lang: 'sql', code: `${join(objs(c, (o) => o.type === 'MASKING POLICY').map((o) => ddl(c, o)))}

-- Tag-based: every column carrying the class tag is masked
${Object.entries(c.pack.maskingPolicies).map(([cls, mp]) => `ALTER TAG ${c.pack.database}.GOVERNANCE.${cls} SET MASKING POLICY ${c.pack.database}.GOVERNANCE.${mp};`).join('\n')}` }],
    creates: (c) => objs(c, (o) => o.type === 'MASKING POLICY').map(id),
    pitfalls: ['A column tagged but not covered by a tag policy stays in clear (the DP-05 gate-6 failure).', 'Masking in views instead of policies is bypassed by anyone with base-table access.'] },
  { id: 'gov-rap', layer: 'gov', title: 'Row access policy', effort: 'M',
    why: 'Row access limits each role to its regions or business units, everywhere the column appears. The agent inherits it because it runs as the user.',
    features: ['Row access policies'], roles: ['gov_lead', 'steward'], prereqs: ['gov-tags'],
    artifacts: (c) => {
      const rap = c.pack.objects.find((o) => o.type === 'ROW ACCESS POLICY')!;
      const targets = c.pack.objects.filter((o) => o.rowAccess && (o.schema === 'CONFORMED_GOLD' || o.schema === 'DATA_PRODUCTS')).slice(0, 6);
      return [{ label: 'SQL', lang: 'sql', code: `${ddl(c, rap)}

${targets.map((o) => `ALTER ${o.type === 'SECURE VIEW' ? 'VIEW' : o.type === 'DYNAMIC TABLE' ? 'DYNAMIC TABLE' : 'TABLE'} ${c.pack.database}.${o.schema}.${o.name} ADD ROW ACCESS POLICY ${c.pack.database}.GOVERNANCE.${rap.name} ON (${o.rowAccess!.column});`).join('\n')}` }];
    },
    creates: (c) => objs(c, (o) => o.type === 'ROW ACCESS POLICY').map(id),
    pitfalls: ['Mapping roles to values inside the policy body does not scale; use a mapping table.', 'Forgetting the policy on one output port leaks every row through it.'] },
  { id: 'gov-monitoring', layer: 'gov', title: 'Access history, quality results and alerts', effort: 'S',
    why: 'Who read what, and whether quality held, is visible in one schema. Alerts notify the steward and product owner when a DMF threshold is breached.',
    features: ['Access history', 'Alerts', 'Data metric functions'], roles: ['gov_lead', 'platform_owner'], prereqs: ['product-dmf'],
    artifacts: (c) => [
      { label: 'Views', lang: 'sql', code: `CREATE OR REPLACE VIEW ${c.pack.database}.GOVERNANCE.ACCESS_HISTORY_V AS
SELECT ah.QUERY_ID, ah.USER_NAME, q.ROLE_NAME AS ROLE, obj.value:objectName::STRING AS OBJECT_FQN,
       ARRAY_TO_STRING(ARRAY_AGG(col.value:columnName::STRING), ', ') AS COLUMNS, ah.QUERY_START_TIME AS QUERY_TS
  FROM SNOWFLAKE.ACCOUNT_USAGE.ACCESS_HISTORY ah
  JOIN SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY q USING (QUERY_ID),
       LATERAL FLATTEN(ah.BASE_OBJECTS_ACCESSED) obj,
       LATERAL FLATTEN(obj.value:columns) col
 WHERE obj.value:objectName::STRING ILIKE '${c.pack.database}.%'
 GROUP BY 1, 2, 3, 4, 6;

CREATE OR REPLACE TABLE ${c.pack.database}.GOVERNANCE.DMF_RESULTS AS
SELECT TABLE_DATABASE || '.' || TABLE_SCHEMA || '.' || TABLE_NAME AS OBJECT_FQN, METRIC_NAME AS METRIC, VALUE, MEASUREMENT_TIME AS MEASURED_AT
  FROM SNOWFLAKE.LOCAL.DATA_QUALITY_MONITORING_RESULTS
 WHERE TABLE_DATABASE = '${c.pack.database}';` },
      { label: 'Alert', lang: 'sql', code: `CREATE OR REPLACE ALERT ${c.pack.database}.GOVERNANCE.ALERT_DQ_BREACH
  WAREHOUSE = WH_TRANSFORM_M
  SCHEDULE = '15 MINUTE'
  IF (EXISTS (
    SELECT 1 FROM SNOWFLAKE.LOCAL.DATA_QUALITY_MONITORING_RESULTS
     WHERE TABLE_DATABASE = '${c.pack.database}'
       AND MEASUREMENT_TIME > SNOWFLAKE.ALERT.LAST_SUCCESSFUL_SCHEDULED_TIME()
       AND ((METRIC_NAME = 'NULL_COUNT' AND VALUE > 0) OR (METRIC_NAME = 'DUPLICATE_COUNT' AND VALUE > 0))))
  THEN CALL SYSTEM$SEND_EMAIL('DATA_STEWARDS', 'data-stewards@${lower(c.pack.profile.dbPrefix)}.example',
         'DQ breach in ${c.pack.database}', 'A data metric function breached its threshold. Open Data Health for details.');

ALTER ALERT ${c.pack.database}.GOVERNANCE.ALERT_DQ_BREACH RESUME;` },
    ],
    creates: (c) => objs(c, (o) => o.schema === 'GOVERNANCE' && (o.name === 'ACCESS_HISTORY_V' || o.name === 'DMF_RESULTS')).map(id),
    pitfalls: ['ACCOUNT_USAGE has latency; do not build real-time alerts on it.', 'Alerting everyone on every breach trains people to ignore alerts.'] },
];

export const stepById = (sid: string) => STEPS.find((s) => s.id === sid);
export const stepsForLayer = (l: GuideLayer) => STEPS.filter((s) => s.layer === l);
export const stepIndex = (sid: string) => STEPS.findIndex((s) => s.id === sid);

/** Which step creates an object (SCHEMA.NAME). */
export function creatorOf(c: BuildCtx, objectId: string): BuildStep | undefined {
  return STEPS.find((s) => s.creates(c).includes(objectId));
}

const fence = (a: Artifact) => `\`\`\`${a.lang === 'jil' ? 'text' : a.lang}\n${a.code}\n\`\`\``;

/** "Copy as runbook": Markdown for the whole guide or one layer. */
export function runbookMarkdown(c: BuildCtx, layer?: GuideLayer): string {
  const steps = layer ? stepsForLayer(layer) : STEPS;
  const head = `# ${c.pack.profile.company} — AI-ready platform runbook${layer ? ` (${GUIDE_LAYERS.find((l) => l.id === layer)?.label})` : ''}\n\nDatabase \`${c.pack.database}\` · tooling: ${c.tooling.ingestion}, ${c.tooling.transformation}, ${c.tooling.orchestration}, ${c.tooling.format}\n`;
  return head + steps.map((s, i) => `\n## ${i + 1}. ${s.title}\n\n${s.why}\n\n- Owner roles: ${s.roles.join(', ')}\n- Prerequisites: ${s.prereqs.map((p) => stepById(p)?.title).filter(Boolean).join('; ') || 'none'}\n${s.preview ? `- Preview feature: ${s.preview}\n` : ''}\n${s.artifacts(c).map((a) => `**${a.label}**\n\n${fence(a)}`).join('\n\n')}\n`).join('');
}

/** "Copy SQL only": one ordered script with section comments. */
export function sqlScript(c: BuildCtx): string {
  return STEPS.map((s, i) => {
    const sql = s.artifacts(c).filter((a) => a.lang === 'sql').map((a) => a.code).join('\n\n');
    return sql ? `-- =====================================================================\n-- ${i + 1}. ${s.title}\n-- =====================================================================\n${sql}` : '';
  }).filter(Boolean).join('\n\n');
}

