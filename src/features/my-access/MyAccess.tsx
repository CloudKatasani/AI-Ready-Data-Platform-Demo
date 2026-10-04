import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CertifiedSeal, KpiChip, PageHeader, Stat, StatusChip } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useAccess, useLive, usePack, usePackPath, usePackState, usePersona } from '../../app/context';

export default function MyAccess() {
  const pack = usePack();
  const persona = usePersona();
  const access = useAccess();
  const live = useLive();
  const st = usePackState();
  const path = usePackPath();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const focusKpi = sp.get('kpi');
  const [q, setQ] = useState(focusKpi ? pack.kpis.find((k) => k.id === focusKpi)?.name ?? '' : '');

  const products = pack.products.filter((p) => access(p.id) === 'G');
  const agents = pack.agents.filter((a) => access(a.id) === 'G');
  const visibleProducts = pack.products.filter((p) => access(p.id) !== '-');
  const visibleAgents = pack.agents.filter((a) => access(a.id) !== '-' && a.kpiIds.length);
  const answerable = (kpiId: string) => pack.kpis.find((k) => k.id === kpiId)!.productIds.some((pid) => access(pid) === 'G');
  const pending = (st?.requests ?? []).filter((r) => r.role === persona.roleId && r.status === 'pending');
  const since = (id: string) => {
    const r = (st?.requests ?? []).filter((x) => x.role === persona.roleId && x.assetId === id && x.status === 'approved').pop();
    return r?.decidedAt?.slice(0, 10) ?? (pack.initialAccess[persona.roleId]?.[id] === 'G' ? '2026-03-02' : '—');
  };
  // Search KPI names, definitions, metrics and the synonyms of their glossary term, word by word, so a question
  // like "Which product answers DSO?" finds Days sales outstanding.
  const kpiText = (k: (typeof pack.kpis)[number]) => {
    const t = pack.glossary.find((g) => g.id === k.termId);
    return `${k.name} ${k.id} ${k.definition} ${k.metric} ${t?.term ?? ''} ${(t?.synonyms ?? []).join(' ')}`.toLowerCase();
  };
  const STOP = new Set(['which', 'what', 'product', 'products', 'answers', 'answer', 'the', 'a', 'an', 'is', 'of', 'for', 'my', 'does', 'who', 'can', 'i']);
  const words = q.toLowerCase().replace(/[^a-z0-9%\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  const kpis = pack.kpis.filter((k) => !words.length || words.every((w) => kpiText(k).includes(w)));

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader title="My Access" layer="gov" sub={<>What can {persona.name} (<span className="mono">{persona.roleId}</span>) use today, and which KPIs can they answer with it?</>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Products granted" value={products.length} sub={`of ${visibleProducts.length} discoverable`} />
        <Stat label="Agents available" value={agents.length} sub={`of ${pack.agents.filter((a) => access(a.id) !== '-').length} discoverable`} />
        <Stat label="KPIs answerable" value={pack.kpis.filter((k) => answerable(k.id)).length} sub={`of ${pack.kpis.length} in the catalog`} />
        <Stat label="Requests pending" value={pending.length} sub={pending.map((r) => r.assetId).join(', ') || 'none'} onClick={() => navigate(path('marketplace'))} />
      </div>

      <section className="panel mt-4 p-4" aria-label="My data products">
        <h2 className="mb-2 font-semibold">My data products</h2>
        <div tabIndex={0} role="region" aria-label="My data products table" className="overflow-x-auto scroll-thin">
          <table className="min-w-full text-sm">
            <thead className="bg-surface2 text-left text-xs"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Access since</th><th className="px-3 py-2">KPIs</th><th className="px-3 py-2">Actions</th></tr></thead>
            <tbody>
              {products.map((p) => {
                const agent = pack.agents.find((a) => a.productIds.includes(p.id) && access(a.id) === 'G');
                return (
                  <tr key={p.id} className="border-t border-line/70 align-top">
                    <td className="px-3 py-2"><div className="font-medium">{p.name}</div><div className="mono text-[11px] text-muted">{p.id}</div></td>
                    <td className="px-3 py-2">{live.productStatus[p.id] === 'Certified' ? <CertifiedSeal /> : <StatusChip status={live.productStatus[p.id]} />}</td>
                    <td className="mono px-3 py-2 text-xs">{live.productVersion[p.id]}</td>
                    <td className="mono px-3 py-2 text-xs">{since(p.id)}</td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{p.kpiIds.map((k) => <KpiChip key={k} name={pack.kpis.find((x) => x.id === k)!.name} />)}</div></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button className="btn text-xs" onClick={() => navigate(path(`explorer/DATA_PRODUCTS/${p.outputPort}`))}><Icon name="database" size={12} />Open in Explorer</button>
                        {agent && <button className="btn text-xs" onClick={() => navigate(path(`agents/${agent.id}?q=${encodeURIComponent(p.sampleQuestions[0])}`))}><Icon name="bot" size={12} />Ask agent</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!products.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No products granted yet. <Link className="link" to={path('marketplace')}>Browse the Marketplace</Link>.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4" aria-label="My agents">
        <h2 className="mb-2 font-semibold">My agents</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <div key={a.id} className="panel flex flex-col p-4">
              <div className="flex items-center gap-2"><Icon name="bot" size={16} /><span className="font-semibold">{a.name}</span><span className="ml-auto"><StatusChip status={a.status} /></span></div>
              <div className="mt-2 flex flex-wrap gap-1">
                {a.productIds.map((pid) => <span key={pid} className={cls('chip', access(pid) === 'G' ? 'border-good/40 text-good' : 'border-line text-muted')}><Icon name={access(pid) === 'G' ? 'check' : 'lock'} size={11} />{pack.products.find((p) => p.id === pid)!.name}</span>)}
                {!a.productIds.length && <span className="chip border-line text-muted">Governance metadata</span>}
              </div>
              <ul className="mt-2 flex-1 space-y-1 text-sm">
                {pack.scenarios.filter((s) => s.agentId === a.id).slice(0, 3).map((s) => <li key={s.id}><Link className="link inline-block py-1" to={path(`agents/${a.id}?q=${encodeURIComponent(s.question)}`)}>{s.question}</Link></li>)}
              </ul>
              <button className="btn-primary mt-3 self-start" onClick={() => navigate(path(`agents/${a.id}`))}><Icon name="send" size={13} />Chat</button>
            </div>
          ))}
          {!agents.length && <p className="text-sm text-muted">No agents granted.</p>}
        </div>
      </section>

      <section className="panel mt-4 p-4" aria-label="KPI coverage matrix">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">KPI coverage</h2>
          <div className="relative ml-auto w-full max-w-xs">
            <Icon name="search" size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <input className="input pl-8" placeholder="Which product answers DSO?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter KPIs" />
          </div>
        </div>
        <div tabIndex={0} role="region" aria-label="KPI coverage table" className="overflow-x-auto scroll-thin">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-surface2">
                <th scope="col" className="sticky left-0 z-[1] bg-surface2 px-3 py-2 text-left">KPI</th>
                <th scope="col" className="px-2 py-2">Answerable</th>
                {visibleProducts.map((p) => <th key={p.id} scope="col" className="whitespace-nowrap px-2 py-2 font-medium" title={p.name}>{p.id}<div className="font-normal text-muted">{p.name.split(' ')[0]}</div></th>)}
                {visibleAgents.map((a) => <th key={a.id} scope="col" className="whitespace-nowrap px-2 py-2 font-medium" title={a.name}>{a.id}<div className="font-normal text-muted">{a.name.split(' ')[0]}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {kpis.map((k) => (
                <tr key={k.id} className={cls('border-t border-line/70', focusKpi === k.id && 'bg-accent/5')}>
                  <th scope="row" className="sticky left-0 bg-surface px-3 py-1.5 text-left font-medium">{k.name}<div className="mono font-normal text-muted">{k.metric}</div></th>
                  <td className="px-2 py-1.5 text-center">{answerable(k.id) ? <span className="inline-flex items-center gap-1 text-good"><Icon name="pass" size={14} />Yes</span> : <span className="inline-flex items-center gap-1 text-muted"><Icon name="lock" size={13} />No</span>}</td>
                  {visibleProducts.map((p) => <Cell key={p.id} has={k.productIds.includes(p.id)} code={access(p.id)} assetId={p.id} />)}
                  {visibleAgents.map((a) => <Cell key={a.id} has={a.kpiIds.includes(k.id)} code={access(a.id) === 'G' && !k.productIds.some((pid) => access(pid) === 'G') ? 'R' : access(a.id)} assetId={access(a.id) === 'G' ? k.productIds[0] : a.id} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><Icon name="pass" size={13} className="text-good" />answerable</span>
          <span className="inline-flex items-center gap-1"><Icon name="lock" size={12} />needs access (request)</span>
          <span className="inline-flex items-center gap-1"><Icon name="pending" size={12} className="text-warn" />request pending</span>
          <span>· not available from this asset</span>
        </div>
      </section>
    </div>
  );
}

function Cell({ has, code, assetId }: { has: boolean; code: string; assetId: string }) {
  const path = usePackPath();
  if (!has) return <td className="px-2 py-1.5 text-center text-muted" aria-label="not available">·</td>;
  if (code === 'G') return <td className="px-2 py-1.5 text-center text-good" aria-label="answerable"><Icon name="pass" size={14} className="inline" /></td>;
  if (code === 'P') return <td className="px-2 py-1.5 text-center text-warn" aria-label="request pending"><Icon name="pending" size={13} className="inline" /></td>;
  return (
    <td className="px-2 py-1.5 text-center">
      <Link to={path(`marketplace?item=${assetId}&tab=access`)} className="inline-flex items-center gap-0.5 text-muted hover:text-accent" aria-label={`needs access, request ${assetId}`}><Icon name="lock" size={12} />Request</Link>
    </td>
  );
}
