import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LAYERS, LAYER_BY_ID } from '../../layers';
import type { LayerId } from '../../types';
import { Icon } from '../../components/icons';
import { layerColor, PageHeader, Stat } from '../../components/ui';
import { cls } from '../../lib/format';
import { useDb, useLive, usePack, usePackPath } from '../../app/context';
import { guidedPath } from '../../app/demoScript';
import { verifiedQueriesLive } from '../../mock-snowflake/shared-schemas';

const STACK: LayerId[] = ['agent', 'product', 'context', 'glossary', 'semantic', 'gold', 'silver', 'bronze'];
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function PlatformMap() {
  const pack = usePack();
  const db = useDb();
  const live = useLive();
  const path = usePackPath();
  const navigate = useNavigate();
  const [sel, setSel] = useState<LayerId>('semantic');
  const [lit, setLit] = useState<number>(-1);
  const timer = useRef<number[]>([]);
  const schemas = db.listSchemas();
  const count = (id: LayerId) => schemas.find((s) => s.layer.id === id)!.objects.length;

  const replay = () => {
    timer.current.forEach(clearTimeout);
    if (reduced()) return setLit(-1);
    const order = [...STACK].reverse();
    const step = 2500 / order.length;
    timer.current = order.map((_, i) => window.setTimeout(() => setLit(i), i * step));
    timer.current.push(window.setTimeout(() => setLit(-1), 2500 + 400));
  };
  useEffect(() => {
    replay();
    return () => timer.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.profile.id]);

  const litLayer = lit >= 0 ? [...STACK].reverse()[lit] : null;
  const layer = LAYER_BY_ID[sel];
  const objs = schemas.find((s) => s.layer.id === sel)!.objects;
  const certified = pack.products.filter((p) => live.productStatus[p.id] === 'Certified').length;
  const vqs = verifiedQueriesLive(pack, live).length;

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
      <PageHeader
        title={`${pack.database} layer stack`}
        sub={<>One {pack.profile.company} account carries every layer an agent needs. Data climbs from CDC sources through three data layers and three meaning layers before it is consumed as a certified product or by an agent; governance applies at every level.</>}
        layer={sel}
        right={<button className="btn" onClick={replay}><Icon name="play" size={14} />Replay flow</button>}
      />
      <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <section className="panel p-3 sm:p-4" aria-label="Layer stack diagram">
          <div className="mb-2 text-center text-xs text-muted">{pack.database} · 8 schemas + cross-cutting governance</div>
          {/* Consumers */}
          <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {pack.consumers.map((c) => <div key={c} className="rounded-md border border-dashed border-line px-2 py-1.5 text-center text-xs text-muted">{c}</div>)}
          </div>
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {STACK.map((id) => {
                const l = LAYER_BY_ID[id];
                const on = sel === id;
                const flash = litLayer === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSel(id)}
                    aria-pressed={on}
                    className={cls('group relative flex items-center gap-3 overflow-hidden rounded-md border px-3 py-2.5 text-left transition-all', on ? 'border-transparent ring-2' : 'border-line hover:border-ink/30')}
                    style={{ background: layerColor(id, flash ? 0.38 : on ? 0.2 : 0.09), ['--tw-ring-color' as string]: layerColor(id) }}
                  >
                    <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: layerColor(id) }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-semibold">{l.n}. {l.label}</span>
                        <span className="mono text-xs text-ink/80">{l.schema}</span>
                      </span>
                      <span className="block truncate text-xs text-ink/80">{l.purpose}</span>
                    </span>
                    <span className="mono shrink-0 rounded bg-surface/80 px-1.5 py-0.5 text-xs">{count(id)}</span>
                    {flash && <span className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-ink shadow" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setSel('gov')}
              aria-pressed={sel === 'gov'}
              className={cls('flex w-10 shrink-0 flex-col items-center justify-center gap-2 rounded-md border px-1 py-2 sm:w-14', sel === 'gov' ? 'border-transparent ring-2' : 'border-line')}
              style={{ background: layerColor('gov', sel === 'gov' ? 0.22 : 0.1), ['--tw-ring-color' as string]: layerColor('gov') }}
            >
              <span className="text-xs font-semibold [writing-mode:vertical-rl] rotate-180">9. Governance · {count('gov')}</span>
            </button>
          </div>
          {/* Sources */}
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            {pack.profile.sources.map((s, i) => (
              <div key={s.name} className={cls('rounded-md border border-line bg-surface2 px-2 py-1.5 text-center text-xs', lit === 0 && i === 0 && 'ring-2 ring-[rgb(var(--layer-bronze))]')} title={s.system}>
                <Icon name="database" size={12} className="mr-1 inline text-muted" />{s.name}
              </div>
            ))}
          </div>
          <div className="mt-1 text-center text-xs text-muted">Sources → Oracle GoldenGate CDC → Apache Iceberg on S3 → Snowflake</div>
        </section>

        <aside className="panel flex flex-col p-4" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="h-6 w-1.5 rounded-full" style={{ background: layerColor(sel) }} />
            <h2 className="text-md font-semibold">{layer.n}. {layer.label}</h2>
            <span className="mono ml-auto text-xs text-muted">{layer.schema}</span>
          </div>
          <p className="mt-2 text-sm">{layer.purpose}</p>
          <div className="mt-3 rounded-md border-l-4 bg-surface2/70 p-3 text-sm" style={{ borderColor: layerColor(sel) }}>
            <div className="label mb-1">What it adds for agents</div>
            {layer.addsForAgents}
            {pack.layerExamples[sel] && <div className="mt-2 text-xs text-muted">In {pack.profile.company}: {pack.layerExamples[sel]}</div>}
          </div>
          <div className="label mt-4">Snowflake features</div>
          <div className="mt-1.5 flex flex-wrap gap-1">{layer.features.map((f) => <span key={f} className="chip border-line bg-surface2">{f}</span>)}</div>
          <div className="label mt-4">Objects ({objs.length})</div>
          <ul className="mt-1.5 max-h-64 space-y-0.5 overflow-y-auto scroll-thin">
            {objs.map((o) => (
              <li key={o.name}>
                <Link className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface2" to={path(`explorer/${o.schema}/${o.name}`)}>
                  <span className="mono truncate">{o.name}</span>
                  <span className="shrink-0 text-xs text-muted">{o.type.toLowerCase()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Data products" value={pack.products.length} sub={`${certified} certified`} onClick={() => navigate(path('marketplace'))} />
        <Stat label="Agents" value={pack.agents.length} sub={`${pack.agents.filter((a) => a.status === 'Production').length} in production`} onClick={() => navigate(path('agents'))} />
        <Stat label="Glossary terms" value={pack.glossary.length} sub={`${pack.glossary.filter((t) => t.isCde).length} CDEs`} onClick={() => navigate(path('glossary'))} />
        <Stat label="Verified queries" value={vqs} sub={`${pack.semanticViews.length} semantic views`} onClick={() => navigate(path('context/verified-queries'))} />
      </div>

      <section className="panel mt-4 p-4" aria-label="Guided demo">
        <div className="label mb-2">Guided demo</div>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {guidedPath(pack).map((s, i) => (
            <li key={s.label}>
              <Link to={path(s.route)} className="flex h-full items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:border-accent">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">{i + 1}</span>
                {s.label}
                <Icon name="arrowRight" size={14} className="ml-auto text-muted" />
              </Link>
            </li>
          ))}
        </ol>
      </section>
      <p className="mt-3 text-xs text-muted">Layer order (bottom → top): {LAYERS.filter((l) => l.id !== 'gov').map((l) => l.label).join(' → ')}; Governance is cross-cutting.</p>
    </div>
  );
}
