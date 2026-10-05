// E11 change impact analysis. Everything is derived from catalog lineage, semantic views, glossary mappings, products,
// agents, verified queries and eval sets; there are no hand-coded graphs. Pack presets only name the change and the
// downstream column names (aliases) that carry the changed column.
import type { IndustryPack, LayerId, LiveState } from '../types';
import type { ChangeType } from './types';
import { downstreamOf } from './coverage';

export type ImpactSeverity = 'breaking' | 'review' | 'none';
export const SEVERITY_TEXT: Record<ImpactSeverity, string> = { breaking: 'Breaking', review: 'Needs review', none: 'No impact' };
export const CHANGE_LABEL: Record<ChangeType, string> = { type: 'Type change', rename: 'Rename', drop: 'Drop column', semantics: 'Semantics change', grain: 'Grain change' };

export type Stage = 'source' | 'silver' | 'gold' | 'semantic' | 'glossary' | 'product' | 'agent' | 'consumer';
export const STAGES: { id: Stage; label: string; layer: LayerId }[] = [
  { id: 'source', label: 'Changed column', layer: 'bronze' },
  { id: 'silver', label: 'Silver', layer: 'silver' },
  { id: 'gold', label: 'Gold', layer: 'gold' },
  { id: 'semantic', label: 'Semantic', layer: 'semantic' },
  { id: 'glossary', label: 'Glossary', layer: 'glossary' },
  { id: 'product', label: 'Data products', layer: 'product' },
  { id: 'agent', label: 'Agents', layer: 'agent' },
  { id: 'consumer', label: 'Consumers', layer: 'gov' },
];

export interface ImpactNode { id: string; stage: Stage; label: string; sub?: string; route: string; severity: ImpactSeverity; why: string }
export interface ImpactResult {
  nodes: ImpactNode[];
  kpis: string[];
  verifiedQueries: string[];
  evalQuestions: number;
  consumers: { role: string; count: number }[];
  contracts: { productId: string; name: string; noticeDays: number; bump: 'major' | 'minor'; from: string; to: string; policy: string }[];
  plan: string[];
}

const RANK: Record<ImpactSeverity, number> = { none: 0, review: 1, breaking: 2 };
const worst = (xs: ImpactSeverity[]): ImpactSeverity => xs.reduce<ImpactSeverity>((a, b) => (RANK[b] > RANK[a] ? b : a), 'none');
const fqnOf = (o: { schema: string; name: string }) => `${o.schema}.${o.name}`;

function bump(version: string, kind: 'major' | 'minor'): string {
  const [ma, mi] = version.split('.').map((x) => Number(x) || 0);
  return kind === 'major' ? `${ma + 1}.0.0` : `${ma}.${mi + 1}.0`;
}

function contractPolicy(yaml: string): { versioning: string; noticeDays: number } {
  const v = yaml.match(/versioning:\s*([\w-]+)/)?.[1] ?? 'semver';
  const n = Number(yaml.match(/breaking_change_notice_days:\s*(\d+)/)?.[1] ?? 30);
  return { versioning: v, noticeDays: n };
}

export function analyzeImpact(pack: IndustryPack, live: LiveState, change: { objectFqn: string; column: string; change: ChangeType; aliases?: string[] }, evalCount: (agentId: string) => number = () => 0): ImpactResult {
  const { objectFqn, column, change: kind } = change;
  const names = new Set([column, ...(change.aliases ?? [])]);
  const src = pack.objects.find((o) => fqnOf(o) === objectFqn);
  const down = downstreamOf(pack, objectFqn);
  const nodes: ImpactNode[] = [];
  const isMetricOrJoinCol = (name: string) =>
    pack.semanticViews.some((v) => v.metrics.some((m) => m.expr.includes(name)) || v.facts.some((f) => f.expr.includes(name)) || v.relationships.some((r) => r.on.includes(name)) || v.tables.some((t) => t.pk === name));

  nodes.push({ id: `${objectFqn}.${column}`, stage: 'source', label: `${objectFqn.split('.')[1]}.${column}`, sub: CHANGE_LABEL[kind], route: `explorer/${objectFqn.replace('.', '/')}`, severity: kind === 'drop' || kind === 'rename' || kind === 'grain' ? 'breaking' : 'review', why: `${CHANGE_LABEL[kind]} at the source.` });

  // Column-level lineage: downstream objects that carry the column (same name or a declared alias).
  const affectedCols: { fqn: string; col: string; layer: LayerId }[] = [];
  const silverAliases = pack.objects.some((o) => o.layer === 'silver' && down.has(fqnOf(o)) && o.columns.some((c) => names.has(c.name) && c.name !== column));
  for (const o of pack.objects) {
    const id = fqnOf(o);
    if (id === objectFqn || !down.has(id) || !['silver', 'gold'].includes(o.layer)) continue;
    const cols = o.columns.filter((c) => names.has(c.name));
    const grainHit = kind === 'grain' && o.layer === 'gold' && o.name.startsWith('FCT_');
    if (!cols.length && !grainHit) continue;
    for (const c of cols.length ? cols : [{ name: '(grain)' } as { name: string }]) {
      affectedCols.push({ fqn: id, col: c.name, layer: o.layer });
      let sev: ImpactSeverity;
      let why: string;
      if (kind === 'drop') { sev = 'breaking'; why = 'The column disappears from every downstream model.'; }
      else if (kind === 'rename') { sev = silverAliases ? (o.layer === 'silver' ? 'review' : 'none') : 'breaking'; why = silverAliases ? (o.layer === 'silver' ? 'Silver aliases the source column: update the alias only.' : 'Shielded by the Silver alias.') : 'No alias in Silver: the rename breaks every reference.'; }
      else if (kind === 'type') { sev = isMetricOrJoinCol(c.name) ? 'breaking' : 'review'; why = isMetricOrJoinCol(c.name) ? 'Used in a metric or join: the type must match.' : 'Carried through; check casts and lengths.'; }
      else if (kind === 'semantics') { sev = 'review'; why = 'Same column, new meaning: review filters and groupings.'; }
      else { sev = o.layer === 'gold' && (o.name.startsWith('FCT_') || isMetricOrJoinCol(c.name)) ? 'breaking' : 'review'; why = o.name.startsWith('FCT_') ? 'Facts built on this object change grain.' : 'Downstream of the grain change.'; }
      nodes.push({ id: `${id}.${c.name}`, stage: o.layer === 'silver' ? 'silver' : 'gold', label: `${o.name}.${c.name}`, route: `explorer/${id.replace('.', '/')}`, severity: sev, why });
    }
  }
  const colSev = (fqn: string) => worst(nodes.filter((n) => n.id.startsWith(`${fqn}.`)).map((n) => n.severity));
  const hitObjects = new Set(affectedCols.map((c) => c.fqn));
  const hitNames = new Set(affectedCols.map((c) => c.col).concat([...names]));

  // Semantic: metrics, facts and dimensions whose expressions reference an affected column of an affected table.
  const metricSev = new Map<string, ImpactSeverity>();
  for (const v of pack.semanticViews) {
    const aliases = v.tables.filter((t) => hitObjects.has(t.fqn)).map((t) => t.alias);
    if (!aliases.length && kind !== 'grain') continue;
    const touches = (expr: string) => aliases.some((a) => [...hitNames].some((n) => expr.includes(`${a}.${n}`) || expr.includes(n)));
    // Grain: facts on the affected table, and metrics that aggregate those facts.
    const grainFacts = v.facts.filter((f) => aliases.some((a) => f.name.startsWith(`${a}.`) || f.expr.includes(`${a}.`)));
    const onGrain = (expr: string) => aliases.some((a) => expr.includes(`${a}.`)) || grainFacts.some((f) => expr.includes(f.name) || expr.includes(f.name.split('.').pop()!));
    const items = [
      ...v.metrics.map((m) => ({ kind: 'metric', name: m.name, expr: m.expr })),
      ...v.facts.map((m) => ({ kind: 'fact', name: m.name, expr: m.expr })),
      ...v.dimensions.map((m) => ({ kind: 'dimension', name: m.name, expr: m.expr })),
    ].filter((x) => (kind === 'grain' ? x.kind !== 'dimension' && (grainFacts.some((f) => f.name === x.name) || onGrain(x.expr)) : touches(x.expr)));
    for (const x of items) {
      const base = worst(v.tables.filter((t) => hitObjects.has(t.fqn)).map((t) => colSev(t.fqn)));
      const sev: ImpactSeverity = kind === 'semantics' ? 'review' : kind === 'grain' ? 'breaking' : kind === 'type' ? (x.kind === 'dimension' ? 'review' : 'breaking') : base;
      if (sev === 'none') continue;
      const id = `${v.name}.${x.name}`;
      metricSev.set(id, sev);
      nodes.push({ id, stage: 'semantic', label: id, sub: x.kind, route: `semantic/${v.name}`, severity: sev, why: `${x.kind} expression uses the changed column.` });
    }
  }

  // Glossary: terms mapped to an affected column, or referencing an affected metric. CDEs escalate on semantics changes.
  for (const g of pack.glossary) {
    const mapped = g.mappings.some((m) => hitObjects.has(m.fqn) && hitNames.has(m.column)) || (g.mappings.some((m) => m.fqn === objectFqn && names.has(m.column)));
    const viaMetric = g.metricRefs.filter((m) => metricSev.has(m));
    if (!mapped && !viaMetric.length) continue;
    const sev: ImpactSeverity = kind === 'semantics' ? (g.isCde ? 'breaking' : 'review') : worst([...viaMetric.map((m) => metricSev.get(m)!), mapped ? worst(g.mappings.filter((m) => hitObjects.has(m.fqn)).map((m) => colSev(m.fqn))) : 'none']);
    if (sev === 'none') continue;
    nodes.push({ id: g.id, stage: 'glossary', label: g.term, sub: `${g.id}${g.isCde ? ' · CDE' : ''}`, route: `glossary/${g.id}`, severity: sev, why: g.isCde && kind === 'semantics' ? 'Critical data element: a meaning change is breaking.' : 'Mapped to the changed column or one of its metrics.' });
  }

  // Products: upstream reaches an affected object (or the product's semantic view has an affected metric).
  const prodSev = new Map<string, ImpactSeverity>();
  for (const p of pack.products) {
    // A product is reached when an object it reads directly carries the column, or its semantic view is affected.
    const port = pack.objects.find((o) => fqnOf(o) === `DATA_PRODUCTS.${p.outputPort}`);
    const direct = p.upstream.filter((id) => hitObjects.has(id));
    const portHit = Boolean(port?.columns.some((c) => hitNames.has(c.name)));
    const svHits = [...metricSev.entries()].filter(([k]) => p.semanticView && k.startsWith(`${p.semanticView}.`)).map(([, v]) => v);
    if (!direct.length && !portHit && !svHits.length) continue;
    const sev = worst([...direct.map(colSev), ...svHits, portHit ? colSev(direct[0] ?? '') : 'none']);
    prodSev.set(p.id, sev);
    nodes.push({ id: p.id, stage: 'product', label: p.name, sub: `${p.id} · v${live.productVersion[p.id] ?? p.version}`, route: `marketplace?item=${p.id}`, severity: sev, why: 'Built on an affected object or metric.' });
  }

  // Agents and consumers.
  const agentSev = new Map<string, ImpactSeverity>();
  for (const a of pack.agents) {
    if (!a.productIds.some((id) => prodSev.has(id))) continue;
    const sev = worst(a.productIds.filter((id) => prodSev.has(id)).map((id) => prodSev.get(id)!));
    agentSev.set(a.id, sev);
    nodes.push({ id: a.id, stage: 'agent', label: a.name, sub: a.id, route: `agents/${a.id}`, severity: sev, why: 'Answers from an affected product.' });
  }
  const consumers = Object.entries(pack.initialAccess)
    .map(([role, grants]) => ({ role, count: Object.entries(grants).filter(([id, c]) => c === 'G' && ((prodSev.get(id) ?? 'none') !== 'none' || (agentSev.get(id) ?? 'none') !== 'none')).length }))
    .filter((c) => c.count > 0);
  for (const c of consumers) nodes.push({ id: `role:${c.role}`, stage: 'consumer', label: c.role, sub: `${c.count} affected asset${c.count > 1 ? 's' : ''}`, route: 'my-access', severity: 'review', why: 'Has access to an affected product or agent: notify.' });

  const kpis = pack.kpis.filter((k) => metricSev.has(k.metric) || nodes.some((n) => n.stage === 'glossary' && n.id === k.termId)).map((k) => k.name);
  const vqs = pack.context.verifiedQueries.filter((v) => [...metricSev.keys()].some((m) => m.startsWith(`${v.semanticView}.`) && new RegExp(`\\b${m.split('.').pop()}\\b`, 'i').test(v.sql))).map((v) => v.id);
  const reAgents = [...agentSev.entries()].filter(([, v]) => v !== 'none').map(([k]) => k);
  const evalQuestions = reAgents.reduce((a, id) => a + evalCount(id), 0);
  const contracts = pack.products.filter((p) => prodSev.has(p.id) && prodSev.get(p.id) !== 'none').map((p) => {
    const pol = contractPolicy(p.contractYaml);
    const kindBump = prodSev.get(p.id) === 'breaking' ? 'major' : 'minor';
    const from = live.productVersion[p.id] ?? p.version;
    return { productId: p.id, name: p.name, noticeDays: kindBump === 'major' ? pol.noticeDays : 0, bump: kindBump as 'major' | 'minor', from, to: bump(from, kindBump), policy: pol.versioning };
  });

  const touchedModels = nodes.filter((n) => (n.stage === 'silver' || n.stage === 'gold') && n.severity !== 'none').map((n) => n.label.split('.')[0]);
  const plan = [
    ...(touchedModels.length ? [`Update dbt models: ${[...new Set(touchedModels)].map((m) => m.toLowerCase()).join(', ')}`] : []),
    ...(metricSev.size ? [`Update semantic views: ${[...new Set([...metricSev.keys()].map((k) => k.split('.')[0]))].join(', ')} (${metricSev.size} expressions)`] : []),
    ...(vqs.length ? [`Re-verify verified queries: ${vqs.join(', ')}`] : []),
    ...(nodes.some((n) => n.stage === 'glossary') ? [`Review glossary terms with their stewards: ${nodes.filter((n) => n.stage === 'glossary').map((n) => n.label).join(', ')}`] : []),
    ...(reAgents.length ? [`Re-run eval sets for ${reAgents.map((id) => pack.agents.find((a) => a.id === id)?.name).join(', ')} (${evalQuestions} questions)`] : []),
    ...(contracts.length ? [`Notify consumers: ${consumers.map((c) => c.role).join(', ')}${contracts.some((c) => c.noticeDays) ? ` (${Math.max(...contracts.map((c) => c.noticeDays))}-day breaking-change notice)` : ''}`] : []),
    ...contracts.map((c) => `Bump ${c.name} ${c.from} → ${c.to} (${c.bump}, ${c.policy})`),
  ];
  if (!src) plan.unshift('Source object not found in the catalog');
  return { nodes, kpis, verifiedQueries: vqs, evalQuestions, consumers, contracts, plan };
}

export function planMarkdown(pack: IndustryPack, change: { objectFqn: string; column: string; change: ChangeType }, r: ImpactResult): string {
  const count = (s: ImpactSeverity) => r.nodes.filter((n) => n.severity === s).length;
  return `## Change plan: ${CHANGE_LABEL[change.change]} on ${change.objectFqn}.${change.column}\n\n${pack.profile.company} · ${count('breaking')} breaking, ${count('review')} to review.\n\n${r.plan.map((p) => `- [ ] ${p}`).join('\n')}\n\n**Affected KPIs:** ${r.kpis.join(', ') || 'none'}\n\n| Contract | Bump | Notice |\n| --- | --- | --- |\n${r.contracts.map((c) => `| ${c.name} | ${c.from} → ${c.to} (${c.bump}) | ${c.noticeDays ? `${c.noticeDays} days` : 'none'} |`).join('\n') || '| — | — | — |'}\n`;
}
