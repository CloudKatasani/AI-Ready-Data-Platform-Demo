import type { AccessCode, IndustryPack, LiveState, Persona, Row, SfObject } from '../types';
import { applyPolicies } from './policies';
import { renderDdl } from './ddl';
import { queryId } from './generators';
import { LAYER_BY_SCHEMA, LAYERS } from '../layers';

export interface PreviewResult {
  sql: string;
  columns: string[];
  rows: Row[];
  maskedColumns: string[];
  filteredOut: number;
  rowPolicyApplied: boolean;
  queryId: string;
  ms: number;
}

export interface LineageNode { id: string; level: number; external?: boolean }

/** Facade every screen talks to (spec section 11). Could later be backed by the Snowflake SQL API. */
export class MockSnowflake {
  readonly pack: IndustryPack;
  readonly database: string;
  private byId = new Map<string, SfObject>();
  private down = new Map<string, string[]>();

  constructor(pack: IndustryPack) {
    this.pack = pack;
    this.database = pack.database;
    for (const o of pack.objects) this.byId.set(`${o.schema}.${o.name}`, o);
    for (const o of pack.objects) {
      for (const u of o.upstream) {
        const arr = this.down.get(u) ?? [];
        arr.push(`${o.schema}.${o.name}`);
        this.down.set(u, arr);
      }
    }
  }

  listSchemas() {
    return LAYERS.map((l) => ({
      layer: l,
      schema: l.schema,
      objects: this.pack.objects.filter((o) => o.schema === l.schema).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));
  }

  getObject(id: string): SfObject | undefined {
    return this.byId.get(id);
  }

  fqn(id: string) {
    return `${this.database}.${id}`;
  }

  /** All rows after policies (used by worksheets and lists). */
  query(id: string, persona: Persona, live: LiveState) {
    const o = this.byId.get(id);
    if (!o || !o.rows) return { rows: [] as Row[], maskedColumns: [] as string[], filteredOut: 0, rowPolicyApplied: false };
    return applyPolicies(o, o.rows(live), persona, live.fixes[this.pack.certificationScript.productId] ?? []);
  }

  preview(id: string, persona: Persona, live: LiveState, limit = 10): PreviewResult {
    const o = this.byId.get(id);
    const sql = `SELECT * FROM ${this.fqn(id)} LIMIT ${limit};`;
    if (!o) return { sql, columns: [], rows: [], maskedColumns: [], filteredOut: 0, rowPolicyApplied: false, queryId: queryId(id), ms: 0 };
    const res = this.query(id, persona, live);
    const ms = 400 + ((id.length * 37 + o.columns.length * 53) % 500);
    return {
      sql, columns: o.columns.map((c) => c.name), rows: res.rows.slice(0, limit), maskedColumns: res.maskedColumns,
      filteredOut: res.filteredOut, rowPolicyApplied: res.rowPolicyApplied, queryId: queryId(`${id}:${persona.roleId}`), ms,
    };
  }

  ddl(id: string, live: LiveState): string {
    const o = this.byId.get(id);
    if (!o) return '';
    const productId = this.pack.certificationScript.productId;
    const product = this.pack.products.find((p) => p.outputPort === o.name);
    const status = product ? live.productStatus[product.id] ?? product.status : undefined;
    return renderDdl(o, {
      db: this.database,
      fixes: live.fixes[productId] ?? [],
      maskingPolicyFor: (c) => {
        const cls = (c.tags ?? []).find((t) => t !== 'CDE');
        return cls ? this.pack.maskingPolicies[cls as keyof IndustryPack['maskingPolicies']] ?? this.pack.maskingPolicy : undefined;
      },
      rowAccessPolicy: this.pack.rowAccessPolicy,
      certificationTag: status === 'Certified' ? 'GOLD' : status ? 'NONE' : undefined,
    });
  }

  upstream(id: string): string[] {
    return this.byId.get(id)?.upstream ?? [];
  }
  downstream(id: string): string[] {
    return this.down.get(id) ?? [];
  }

  /** Multi-hop lineage: negative levels upstream, 0 = this object, positive levels downstream. */
  lineage(id: string, hops = 4): { nodes: LineageNode[]; edges: [string, string][] } {
    const nodes = new Map<string, LineageNode>([[id, { id, level: 0 }]]);
    const edges = new Set<string>();
    const walk = (start: string, dir: -1 | 1) => {
      let frontier = [start];
      for (let lvl = 1; lvl <= hops && frontier.length; lvl++) {
        const next: string[] = [];
        for (const f of frontier) {
          const neigh = dir < 0 ? this.upstream(f) : this.downstream(f);
          for (const n of neigh) {
            edges.add(dir < 0 ? `${n}|${f}` : `${f}|${n}`);
            if (!nodes.has(n)) {
              nodes.set(n, { id: n, level: dir * lvl, external: n.startsWith('ext:') });
              next.push(n);
            }
          }
        }
        frontier = next;
      }
    };
    walk(id, -1);
    walk(id, 1);
    return { nodes: [...nodes.values()], edges: [...edges].map((e) => e.split('|') as [string, string]) };
  }

  dmf(id: string) {
    return this.pack.dmf.filter((d) => d.fqn === id);
  }

  accessHistory(id: string) {
    return this.pack.accessHistory.filter((h) => h.fqn === id).slice(0, 5);
  }

  /** Grants derived from the access model: owner, steward, and every role granted a product built on this object. */
  grants(id: string, accessFor: (roleId: string, assetId: string) => AccessCode) {
    const o = this.byId.get(id);
    if (!o) return [];
    const out: { role: string; privilege: string; via: string }[] = [{ role: o.owner, privilege: 'OWNERSHIP', via: 'object owner' }];
    out.push({ role: 'DATA_STEWARD', privilege: 'SELECT', via: 'governance read' });
    const downstreamAll = new Set(this.lineage(id, 6).nodes.filter((n) => n.level >= 0).map((n) => n.id));
    for (const p of this.pack.products) {
      if (!downstreamAll.has(`DATA_PRODUCTS.${p.outputPort}`)) continue;
      for (const persona of this.pack.personas) {
        if (persona.roleId === 'DATA_STEWARD') continue;
        if (accessFor(persona.roleId, p.id) === 'G' && !out.some((g) => g.role === persona.roleId)) {
          out.push({ role: persona.roleId, privilege: 'SELECT', via: `${p.id} ${p.name}` });
        }
      }
    }
    return out;
  }

  layerOf(id: string) {
    const schema = id.split('.')[0];
    return LAYER_BY_SCHEMA[schema];
  }
}
