import type { Column, SfObject } from '../types';
import { sensitiveTags, hasMaskingPolicy } from './policies';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function colLine(c: Column, db: string, fixes: string[], maskingPolicyFor: (c: Column) => string | undefined): string {
  const parts = [`  ${c.name.padEnd(24)} ${c.type}`];
  if (!c.nullable) parts.push('NOT NULL');
  const mp = hasMaskingPolicy(c, fixes) ? maskingPolicyFor(c) : undefined;
  if (mp) parts.push(`WITH MASKING POLICY ${db}.GOVERNANCE.${mp}`);
  const tags = [
    ...sensitiveTags(c).map((t) => `${db}.GOVERNANCE.${t === 'PII' ? 'PII' : t} = ${q(c.name)}`),
    ...((c.tags ?? []).includes('CDE') ? [`${db}.GOVERNANCE.CDE = 'TRUE'`] : []),
  ];
  if (tags.length) parts.push(`WITH TAG (${tags.join(', ')})`);
  parts.push(`COMMENT ${q(c.comment)}`);
  return parts.join(' ');
}

export interface DdlOptions {
  db: string;
  fixes: string[];
  maskingPolicyFor: (c: Column) => string | undefined;
  rowAccessPolicy?: string;
  certificationTag?: string;
}

function selectBody(o: SfObject, db: string): string {
  const ups = o.upstream.filter((u) => !u.startsWith('ext:'));
  if (!ups.length) return `SELECT * FROM ${db}.${o.schema}.${o.name}_SRC`;
  const cols = o.columns.map((c) => `    ${c.name}`).join(',\n');
  const [first, ...rest] = ups;
  const joins = rest.map((u, i) => `  LEFT JOIN ${db}.${u} u${i + 1} USING (${guessKey(o)})`).join('\n');
  let body = `SELECT\n${cols}\n  FROM ${db}.${first} u0${joins ? '\n' + joins : ''}`;
  if (o.layer === 'silver') {
    const key = o.columns[0]?.name ?? 'ID';
    body += `\n  QUALIFY ROW_NUMBER() OVER (PARTITION BY ${key} ORDER BY OP_TS DESC) = 1\n     AND OP_TYPE <> 'D'`;
  }
  return body;
}

function guessKey(o: SfObject): string {
  const k = o.columns.find((c) => c.name.endsWith('_KEY')) ?? o.columns[0];
  return k?.name ?? 'ID';
}

export function renderDdl(o: SfObject, opt: DdlOptions): string {
  const fqn = `${opt.db}.${o.schema}.${o.name}`;
  if (o.ddl) return o.ddl;
  const cols = o.columns.map((c) => colLine(c, opt.db, opt.fixes, opt.maskingPolicyFor)).join(',\n');
  const rap = opt.rowAccessPolicy && o.rowAccess ? `\n  WITH ROW ACCESS POLICY ${opt.db}.GOVERNANCE.${opt.rowAccessPolicy} ON (${o.rowAccess.column})` : '';
  const comment = `\n  COMMENT = ${q(o.comment)}`;
  switch (o.type) {
    case 'ICEBERG TABLE':
      return `CREATE OR REPLACE ICEBERG TABLE ${fqn} (\n${cols}\n)\n  CATALOG = 'SNOWFLAKE'\n  EXTERNAL_VOLUME = 'EV_S3_LANDING'\n  BASE_LOCATION = 'cdc/${o.name.toLowerCase()}/'${rap}${comment};`;
    case 'DYNAMIC TABLE':
      return `CREATE OR REPLACE DYNAMIC TABLE ${fqn} (\n${cols}\n)\n  TARGET_LAG = '${o.targetLag ?? '15 minutes'}'\n  WAREHOUSE = WH_TRANSFORM_M\n  REFRESH_MODE = INCREMENTAL${rap}${comment}\nAS\n${selectBody(o, opt.db)};`;
    case 'TABLE':
      return `CREATE OR REPLACE TABLE ${fqn} (\n${cols}\n)${rap}${comment};`;
    case 'VIEW':
    case 'SECURE VIEW': {
      const tag = opt.certificationTag ? `\n  WITH TAG (${opt.db}.GOVERNANCE.CERTIFICATION = ${q(opt.certificationTag)})` : '';
      return `CREATE OR REPLACE ${o.type} ${fqn} (\n${o.columns.map((c) => `  ${c.name}`).join(',\n')}\n)${tag}${rap}${comment}\nAS\n${selectBody(o, opt.db)};`;
    }
    case 'STREAM':
      return `CREATE OR REPLACE STREAM ${fqn}\n  ON TABLE ${opt.db}.${o.upstream[0]}\n  APPEND_ONLY = TRUE${comment};`;
    default:
      return `-- ${o.type} ${fqn}\n-- ${o.comment}`;
  }
}

/** Minimal SQL / YAML tokenizer for syntax highlighting (no external highlighter needed offline). */
const SQL_KW = new Set(
  ('SELECT FROM WHERE AND OR NOT AS ON JOIN LEFT RIGHT INNER OUTER GROUP BY ORDER LIMIT HAVING CREATE REPLACE TABLE VIEW SECURE ' +
    'DYNAMIC ICEBERG SEMANTIC CORTEX SEARCH SERVICE AGENT WITH TAG MASKING POLICY ROW ACCESS COMMENT TARGET_LAG WAREHOUSE ' +
    'CASE WHEN THEN ELSE END SUM COUNT AVG MIN MAX DISTINCT QUALIFY OVER PARTITION ROW_NUMBER DESC ASC IN IS NULL TRUE FALSE ' +
    'BETWEEN DATE_TRUNC DATEADD CURRENT_DATE TABLES RELATIONSHIPS FACTS DIMENSIONS METRICS PRIMARY KEY REFERENCES SYNONYMS ' +
    'STREAM RETURNS USING REFRESH_MODE INCREMENTAL CATALOG EXTERNAL_VOLUME BASE_LOCATION OR TIME_DIMENSIONS ATTRIBUTES ' +
    'APPEND_ONLY NOT ROUND NULLIF IFF COALESCE YEAR QUARTER MONTH DAY WEEK INTERVAL TOOLS INSTRUCTIONS FROM SPECIFICATION ' +
    'VARCHAR NUMBER DATE TIMESTAMP_NTZ BOOLEAN FLOAT INTEGER UNION ALL LIKE ILIKE').split(' '),
);

export type Tok = { t: 'kw' | 'str' | 'num' | 'com' | 'id' | 'punc' | 'key'; v: string };

export function tokenizeSql(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_$.]*)|(\s+)|([^\sA-Za-z0-9_'])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) out.push({ t: 'com', v: m[1] });
    else if (m[2]) out.push({ t: 'str', v: m[2] });
    else if (m[3]) out.push({ t: 'num', v: m[3] });
    else if (m[4]) out.push({ t: SQL_KW.has(m[4].toUpperCase()) ? 'kw' : 'id', v: m[4] });
    else out.push({ t: 'punc', v: m[0] });
  }
  return out;
}

export function tokenizeYaml(src: string): Tok[] {
  const out: Tok[] = [];
  for (const line of src.split('\n')) {
    const m = /^(\s*-?\s*)([A-Za-z_][\w-]*)(:)(.*)$/.exec(line);
    if (m) {
      out.push({ t: 'punc', v: m[1] }, { t: 'key', v: m[2] }, { t: 'punc', v: m[3] });
      const rest = m[4];
      if (/^\s*#/.test(rest)) out.push({ t: 'com', v: rest });
      else if (/^\s*(true|false|\d+(\.\d+)?)\s*$/.test(rest)) out.push({ t: 'num', v: rest });
      else out.push({ t: 'str', v: rest });
    } else if (/^\s*#/.test(line)) out.push({ t: 'com', v: line });
    else out.push({ t: 'id', v: line });
    out.push({ t: 'punc', v: '\n' });
  }
  out.pop();
  return out;
}
