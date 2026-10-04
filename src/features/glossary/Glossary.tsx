import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { GlossaryTerm, LayerId } from '../../types';
import { Icon } from '../../components/icons';
import { layerColor, PageHeader, StatusChip } from '../../components/ui';
import { cls } from '../../lib/format';
import { useDb, usePack, usePackPath } from '../../app/context';
import { LAYER_BY_SCHEMA } from '../../layers';

export default function Glossary() {
  const { term } = useParams();
  const pack = usePack();
  const path = usePackPath();
  const t = pack.glossary.find((g) => g.id === term);
  if (!t) return <Navigate to={path(`glossary/${pack.signature.termId}`)} replace />;
  return <GlossaryInner t={t} />;
}

function StripNode({ layer, label, sub, to }: { layer: LayerId; label: string; sub?: string; to: string }) {
  return (
    <Link to={to} className="block rounded-md border border-line bg-surface px-2.5 py-1.5 text-left hover:border-accent" style={{ borderLeft: `4px solid ${layerColor(layer)}` }}>
      <div className="mono truncate text-xs font-medium">{label}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </Link>
  );
}

function StripCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="label">{title}</div>
      {children}
    </div>
  );
}

/** Term → mapped columns → semantic metric → data products → agents (spec section 7.4). */
export function TermLineage({ t }: { t: GlossaryTerm }) {
  const pack = usePack();
  const db = useDb();
  const path = usePackPath();
  const metrics = t.metricRefs;
  const views = [...new Set(metrics.map((m) => m.split('.')[0]))];
  const kpiProducts = pack.kpis.filter((k) => k.termId === t.id).flatMap((k) => k.productIds);
  const colProducts = pack.products.filter((p) => t.mappings.some((m) => {
    const lin = db.lineage(m.fqn, 6);
    return lin.nodes.some((n) => n.level >= 0 && n.id === `DATA_PRODUCTS.${p.outputPort}`);
  })).map((p) => p.id);
  const products = pack.products.filter((p) => [...new Set([...kpiProducts, ...colProducts, ...pack.products.filter((pp) => pp.semanticView && views.includes(pp.semanticView)).map((pp) => pp.id)])].includes(p.id));
  const agents = pack.agents.filter((a) => a.productIds.some((pid) => products.some((p) => p.id === pid)) || a.tools.some((tt) => views.includes(tt.target)));
  const arrow = <Icon name="arrowRight" size={14} className="mt-6 hidden shrink-0 text-muted md:block" />;
  return (
    <div className="flex flex-col gap-3 md:flex-row" aria-label="Term lineage">
      <StripCol title="Term"><StripNode layer="glossary" label={t.term} sub={`${t.id}${t.isCde ? ' · CDE' : ''}`} to={path(`glossary/${t.id}`)} /></StripCol>
      {arrow}
      <StripCol title="Mapped columns">
        {t.mappings.map((m) => (
          <StripNode key={m.fqn + m.column} layer={LAYER_BY_SCHEMA[m.fqn.split('.')[0]].id} label={`${m.fqn.split('.')[1]}.${m.column}`} sub={`${m.kind} · ${m.fqn.split('.')[0]}`} to={path(`explorer/${m.fqn.replace('.', '/')}`)} />
        ))}
      </StripCol>
      {arrow}
      <StripCol title="Semantic metric">
        {metrics.length ? metrics.map((m) => <StripNode key={m} layer="semantic" label={m.split('.')[1]} sub={m.split('.')[0]} to={m.startsWith('SV_') ? path(`semantic/${m.split('.')[0]}`) : path(`explorer/DATA_PRODUCTS/${m.split('.')[0]}`)} />) : <div className="text-xs text-muted">No metric</div>}
      </StripCol>
      {arrow}
      <StripCol title="Data products">
        {products.length ? products.map((p) => <StripNode key={p.id} layer="product" label={`${p.id} ${p.name}`} sub={p.status} to={path(`certify/${p.id}`)} />) : <div className="text-xs text-muted">None</div>}
      </StripCol>
      {arrow}
      <StripCol title="Agents">
        {agents.length ? agents.map((a) => <StripNode key={a.id} layer="agent" label={a.name} sub={a.objectName} to={path(`agents/${a.id}`)} />) : <div className="text-xs text-muted">None</div>}
      </StripCol>
    </div>
  );
}

function GlossaryInner({ t }: { t: GlossaryTerm }) {
  const pack = usePack();
  const path = usePackPath();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState('');
  const [cdeOnly, setCdeOnly] = useState(false);
  const [noSteward, setNoSteward] = useState(false);
  const domains = [...new Set(pack.glossary.map((g) => g.domain))].sort();
  const list = useMemo(() => pack.glossary.filter((g) =>
    (!q || `${g.term} ${g.id} ${g.synonyms.join(' ')} ${g.definition}`.toLowerCase().includes(q.toLowerCase())) &&
    (!domain || g.domain === domain) && (!status || g.status === status) && (!cdeOnly || g.isCde) && (!noSteward || (g.isCde && !g.steward))), [pack, q, domain, status, cdeOnly, noSteward]);
  const kpis = pack.kpis.filter((k) => k.termId === t.id);
  const rules = pack.context.rules.filter((r) => t.metricRefs.some((m) => r.metric === m));
  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader title="Glossary" layer="glossary" sub="The business vocabulary is owned, approved and mapped to physical data. Critical data elements carry DQ rules and a steward." />
      <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="panel min-w-0 p-3" aria-label="Terms">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Icon name="search" size={14} className="absolute left-2.5 top-2.5 text-muted" />
              <input className="input pl-8" placeholder="Search terms, synonyms, definitions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search terms" />
            </div>
            <select className="input w-auto" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain"><option value="">All domains</option>{domains.map((d) => <option key={d}>{d}</option>)}</select>
            <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option>Approved</option><option>Draft</option><option>Deprecated</option></select>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={cdeOnly} onChange={(e) => setCdeOnly(e.target.checked)} />CDE only</label>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={noSteward} onChange={(e) => setNoSteward(e.target.checked)} />Missing steward</label>
          </div>
          <div tabIndex={0} role="region" aria-label="Terms table" className="overflow-x-auto scroll-thin">
            <table className="min-w-full text-sm">
              <thead className="bg-surface2 text-left text-xs">
                <tr><th className="px-2.5 py-2">Term</th><th className="px-2.5 py-2">Domain</th><th className="px-2.5 py-2">Status</th><th className="px-2.5 py-2">CDE</th><th className="px-2.5 py-2">Owner</th><th className="px-2.5 py-2">Steward</th><th className="px-2.5 py-2 text-right">Cols</th></tr>
              </thead>
              <tbody>
                {list.map((g) => (
                  <tr key={g.id} onClick={() => navigate(path(`glossary/${g.id}`))} className={cls('cursor-pointer border-t border-line/70 hover:bg-surface2/60', g.id === t.id && 'bg-surface2/60 shadow-[inset_3px_0_0_rgb(var(--layer-glossary))]')}>
                    <td className="px-2.5 py-1.5"><Link to={path(`glossary/${g.id}`)} className="font-medium hover:underline">{g.term}</Link><div className="mono text-[11px] text-muted">{g.id}</div></td>
                    <td className="px-2.5 py-1.5 text-xs">{g.domain}</td>
                    <td className="px-2.5 py-1.5"><StatusChip status={g.status} /></td>
                    <td className="px-2.5 py-1.5">{g.isCde ? <span className="chip border-seal/50 bg-seal/10 text-seal">CDE</span> : <span className="text-xs text-muted">—</span>}</td>
                    <td className="px-2.5 py-1.5 text-xs">{g.owner}</td>
                    <td className="px-2.5 py-1.5 text-xs">{g.steward ?? <span className="inline-flex items-center gap-1 text-bad"><Icon name="warn" size={12} />None</span>}</td>
                    <td className="mono px-2.5 py-1.5 text-right text-xs">{g.mappings.length}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">No terms match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-muted">{pack.glossary.length} terms · {pack.glossary.filter((g) => g.isCde).length} CDEs · {pack.glossary.filter((g) => g.status === 'Draft').length} Draft · {pack.glossary.filter((g) => g.isCde && !g.steward).length} CDE without steward</div>
        </section>

        <section className="panel min-w-0 p-4" aria-label={`Term ${t.term}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-semibold">{t.term}</h2>
            <span className="mono text-xs text-muted">{t.id}</span>
            <StatusChip status={t.status} />
            {t.isCde && <span className="chip border-seal/50 bg-seal/10 text-seal">Critical data element</span>}
          </div>
          <p className="mt-2">{t.definition}</p>
          {t.formula && <div className="mt-3 rounded-md bg-surface2/70 p-3 text-sm"><div className="label mb-1">Formula in plain words</div>{t.formula}</div>}
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="label">Domain</dt><dd>{t.domain}</dd></div>
            <div><dt className="label">Owner</dt><dd>{t.owner}</dd></div>
            <div><dt className="label">Steward</dt><dd>{t.steward ?? <span className="text-bad">Not assigned</span>}</dd></div>
            <div><dt className="label">Synonyms</dt><dd className="text-xs">{t.synonyms.join(', ') || '—'}</dd></div>
            <div className="col-span-2"><dt className="label">Related terms</dt><dd className="flex flex-wrap gap-1">{t.related.map((r) => { const rt = pack.glossary.find((g) => g.id === r); return rt ? <Link key={r} to={path(`glossary/${r}`)} className="chip border-line hover:border-accent">{rt.term}</Link> : null; })}{!t.related.length && '—'}</dd></div>
          </dl>
          {t.isCde && (
            <div className="mt-3 rounded-md border border-line p-3">
              <div className="flex items-center justify-between"><div className="label">Data quality</div>{t.dqScore !== undefined && <span className={cls('mono text-sm font-semibold', t.dqScore >= 95 ? 'text-good' : 'text-warn')}>{t.dqScore}%</span>}</div>
              <ul className="mt-1 list-disc pl-5 text-sm">{(t.dqRules ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
          {(kpis.length > 0 || rules.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {kpis.map((k) => <Link key={k.id} to={path(`my-access?kpi=${k.id}`)} className="chip border-line hover:border-accent"><Icon name="sparkle" size={11} />KPI {k.name}</Link>)}
              {rules.map((r) => <Link key={r.id} to={path(`context/rules?rule=${r.id}`)} className="chip border-transparent bg-[rgb(var(--layer-context)/0.14)] hover:underline">{r.id}</Link>)}
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <div className="label mb-2">Term lineage</div>
            <TermLineage t={t} />
          </div>
        </section>
      </div>
    </div>
  );
}
