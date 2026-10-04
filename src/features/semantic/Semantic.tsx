import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { SemanticView } from '../../types';
import { BarChart, CodeBlock, PageHeader, SimpleTable, StatusChip, Tabs } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls, fmtNum } from '../../lib/format';
import { useDb, useLive, usePack, usePackPath } from '../../app/context';
import { verifiedQueriesLive } from '../../mock-snowflake/shared-schemas';

type PanelTab = 'dims' | 'time' | 'facts' | 'metrics' | 'vq' | 'ddl';

export default function Semantic() {
  const { view } = useParams();
  const pack = usePack();
  const path = usePackPath();
  const sv = pack.semanticViews.find((s) => s.name === view);
  if (!sv) {
    const sig = pack.scenarios.find((s) => s.id && s.question === pack.signature.question)?.semantic?.view ?? pack.semanticViews[0].name;
    return <Navigate to={path(`semantic/${sig}`)} replace />;
  }
  return <SemanticInner sv={sv} />;
}

function Model({ sv }: { sv: SemanticView }) {
  const db = useDb();
  const path = usePackPath();
  const fact = sv.tables[0];
  const card = (t: SemanticView['tables'][number], strong?: boolean) => {
    const o = db.getObject(t.fqn);
    return (
      <Link to={path(`explorer/${t.fqn.replace('.', '/')}`)} className={cls('block rounded-md border bg-surface px-3 py-2 hover:border-accent', strong ? 'border-[rgb(var(--layer-gold))] border-2' : 'border-line')}>
        <div className="text-xs text-muted">{t.alias}</div>
        <div className="mono text-sm font-semibold">{t.fqn.split('.')[1]}</div>
        <div className="mono text-[11px] text-muted">PK {t.pk} · {o?.columns.length ?? 0} cols</div>
      </Link>
    );
  };
  return (
    <div className="space-y-2" aria-label="Logical model">
      <div className="max-w-xs">{card(fact, true)}</div>
      {sv.relationships.map((r) => {
        const to = sv.tables.find((t) => t.alias === r.to)!;
        return (
          <div key={`${r.from}-${r.to}`} className="grid grid-cols-[auto_1fr] items-center gap-2 pl-4 sm:grid-cols-[150px_minmax(0,320px)]">
            <div className="flex items-center gap-1 text-xs text-muted">
              <span className="h-6 w-3 border-b border-l border-line" aria-hidden />
              <span className="mono">{r.from}</span>
              <span className="mono rounded-full border border-line bg-surface2 px-1.5 py-0.5">{r.on}</span>
              <Icon name="arrowRight" size={12} />
            </div>
            {card(to)}
          </div>
        );
      })}
    </div>
  );
}

function TryMetric({ sv }: { sv: SemanticView }) {
  const pack = usePack();
  const path = usePackPath();
  const pg = sv.playground!;
  const sig = pack.scenarios.find((s) => s.question === pack.signature.question)?.semantic;
  const [m, setM] = useState(sig?.view === sv.name ? sig.metrics[0] : pg.metrics[0].name);
  const [dim, setDim] = useState(sig?.view === sv.name ? (pg.dimensions.find((d) => sig.dimensions.includes(d.name))?.name ?? pg.dimensions[0].name) : pg.dimensions[0].name);
  const [f, setF] = useState(0);
  const metric = pg.metrics.find((x) => x.name === m) ?? pg.metrics[0];
  const d = pg.dimensions.find((x) => x.name === dim) ?? pg.dimensions[0];
  const filter = pg.filters[f];
  const res = useMemo(() => {
    const rows = pg.rows().filter(filter.test);
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = String(r[d.column]);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.entries()].map(([k, rs]) => ({ k, v: metric.agg(rs, { dimension: d.name.split('.').pop()!, value: k }) })).sort((a, b) => (d.column.includes('quarter') || d.column === 'month' ? a.k.localeCompare(b.k) : b.v - a.v));
  }, [pg, filter, d, metric]);
  const sql = `SELECT *\n  FROM SEMANTIC_VIEW(\n    ${pack.database}.${pg.from}\n    METRICS ${metric.sqlExpr}\n    DIMENSIONS ${d.name}\n    WHERE ${filter.sql}\n  )\n ORDER BY ${metric.sqlExpr} DESC;`;
  const metaMetric = sv.metrics.find((x) => x.name === metric.name);
  const term = metaMetric ? pack.glossary.find((t) => t.id === metaMetric.termId) : undefined;
  return (
    <section className="panel p-4" aria-label="Try a metric">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Icon name="sparkle" className="text-accent" />
        <h3 className="font-semibold">Try a metric</h3>
        <span className="text-xs text-muted">See the SQL Cortex Analyst would generate, computed on synthetic data.</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs"><span className="label">Metric</span>
          <select className="input mt-1" value={metric.name} onChange={(e) => setM(e.target.value)}>{pg.metrics.map((x) => <option key={x.name}>{x.name}</option>)}</select>
        </label>
        <label className="text-xs"><span className="label">Dimension</span>
          <select className="input mt-1" value={d.name} onChange={(e) => setDim(e.target.value)}>{pg.dimensions.map((x) => <option key={x.name}>{x.name}</option>)}</select>
        </label>
        <label className="text-xs"><span className="label">Filter</span>
          <select className="input mt-1" value={f} onChange={(e) => setF(Number(e.target.value))}>{pg.filters.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}</select>
        </label>
      </div>
      {term && <p className="mt-2 text-xs text-muted">{metric.name} means <Link className="link" to={path(`glossary/${term.id}`)}>{term.term}</Link>: {term.definition}</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CodeBlock code={sql} maxH="max-h-56" />
        <div className="space-y-3">
          <BarChart labels={res.map((r) => r.k)} values={res.map((r) => r.v)} unit={metric.unit} decimals={metric.decimals} color={`rgb(var(--layer-semantic))`} />
          <SimpleTable columns={[d.name, metric.name]} rows={res.map((r) => [r.k, `${metric.unit === 'USD' ? '$' : ''}${fmtNum(r.v, metric.decimals)}${metric.unit === '%' ? '%' : ''}`])} />
        </div>
      </div>
    </section>
  );
}

function SemanticInner({ sv }: { sv: SemanticView }) {
  const pack = usePack();
  const db = useDb();
  const live = useLive();
  const path = usePackPath();
  const [tab, setTab] = useState<PanelTab>('metrics');
  const vqs = verifiedQueriesLive(pack, live).filter((v) => v.semanticView === sv.name);
  const agents = pack.agents.filter((a) => a.tools.some((t) => t.target === sv.name));
  const products = pack.products.filter((p) => sv.productIds.includes(p.id));
  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader title="Semantic Layer" layer="semantic" sub={<>Semantic views turn tables into named business metrics that BI tools and agents share, so “{pack.glossary.find((t) => t.id === pack.signature.termId)?.term}” means one thing everywhere.</>} />
      <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-[260px_minmax(0,1fr)_minmax(360px,440px)]">
        <nav aria-label="Semantic views" className="grid grid-cols-1 content-start gap-2 sm:grid-cols-2 min-[1280px]:grid-cols-1">
          {pack.semanticViews.map((s) => {
            const ps = pack.products.filter((p) => s.productIds.includes(p.id));
            return (
              <Link key={s.name} to={path(`semantic/${s.name}`)} className={cls('panel block p-3 hover:border-accent', s.name === sv.name && 'border-[rgb(var(--layer-semantic))] ring-1 ring-[rgb(var(--layer-semantic))]')}>
                <div className="mono text-sm font-semibold">{s.name}</div>
                <div className="mt-0.5 text-xs text-muted">{s.description}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {ps.map((p) => <StatusChip key={p.id} status={live.productStatus[p.id]} label={`${p.id} ${live.productStatus[p.id]}`} />)}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 space-y-4">
          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mono text-md font-semibold">{sv.name}</h2>
              <span className="text-xs text-muted">backs {products.map((p) => `${p.id} ${p.name}`).join(', ')}</span>
            </div>
            <Model sv={sv} />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="label">Used by agents</span>
              {agents.length ? agents.map((a) => <Link key={a.id} to={path(`agents/${a.id}`)} className="chip border-transparent bg-[rgb(var(--layer-agent)/0.14)] hover:underline"><Icon name="bot" size={11} />{a.name}</Link>) : <span className="text-muted">none</span>}
              <span className="label ml-2">BI</span><span className="chip border-line">Power BI via semantic view</span>
            </div>
          </section>
          {sv.playground && <TryMetric key={sv.name} sv={sv} />}
        </div>
        <section className="panel min-w-0 p-3">
          <Tabs label="Semantic view details" value={tab} onChange={setTab} tabs={[
            { id: 'metrics', label: 'Metrics', count: sv.metrics.length }, { id: 'dims', label: 'Dimensions', count: sv.dimensions.length },
            { id: 'time', label: 'Time', count: sv.timeDimensions.length }, { id: 'facts', label: 'Facts', count: sv.facts.length },
            { id: 'vq', label: 'Verified queries', count: vqs.length }, { id: 'ddl', label: 'Definition' },
          ]} />
          <div className="mt-3 max-h-[70vh] overflow-y-auto scroll-thin">
            {tab === 'metrics' && (
              <ul className="space-y-2">
                {sv.metrics.map((m) => {
                  const t = pack.glossary.find((g) => g.id === m.termId);
                  return (
                    <li key={m.name} className="rounded-md border border-line p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono text-sm font-semibold">{m.name}</span>
                        <span className="text-xs text-muted">{m.unit}</span>
                        {t && <Link to={path(`glossary/${t.id}`)} className="chip ml-auto border-transparent bg-[rgb(var(--layer-glossary)/0.14)] hover:underline">{t.id} {t.term}</Link>}
                      </div>
                      <div className="mt-1 text-xs">{m.description}</div>
                      <code className="mono mt-1 block break-words text-[11px] text-muted">{m.expr}</code>
                      {m.synonyms.length > 0 && <div className="mt-1 text-[11px] text-muted">Synonyms: {m.synonyms.join(', ')}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
            {tab === 'dims' && <SimpleTable columns={['Dimension', 'Expression', 'Synonyms']} rows={sv.dimensions.map((d) => [d.name, d.expr, d.synonyms.join(', ') || '—'])} />}
            {tab === 'time' && <SimpleTable columns={['Time dimension', 'Expression']} rows={sv.timeDimensions.map((d) => [d.name, d.expr])} />}
            {tab === 'facts' && <SimpleTable columns={['Fact', 'Expression']} rows={sv.facts.map((d) => [d.name, d.expr])} />}
            {tab === 'vq' && (
              <div className="space-y-2">
                <div className="text-xs text-muted">{vqs.length} verified queries · <Link className="link" to={path(`context/verified-queries?sv=${sv.name}`)}>open in Context Layer</Link></div>
                <ul className="space-y-1">{vqs.map((v) => <li key={v.id} className="flex gap-2 text-sm"><span className="mono shrink-0 text-xs text-muted">{v.id}</span>{v.question}</li>)}</ul>
              </div>
            )}
            {tab === 'ddl' && <CodeBlock code={db.ddl(`SEMANTIC.${sv.name}`, live)} maxH="max-h-[60vh]" />}
          </div>
        </section>
      </div>
    </div>
  );
}
