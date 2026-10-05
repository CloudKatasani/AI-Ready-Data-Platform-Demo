import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Drawer, layerColor, PageHeader, Sparkline, Tabs } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, useLive, usePack, usePackPath } from '../../app/context';
import { toast } from '../../app/toast';
import { hasExt, NotConfigured } from '../../ext/NotConfigured';
import { productHealth, type HealthStatus } from '../../ext/health';
import { defaultLevers, fmtLag, productFreshness, slaMinutes } from '../../ext/cost';
import { ALL_ON, type IncidentScript } from '../../ext/types';
import type { IndustryPack, LayerId } from '../../types';

const STEP_MS = 1150;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const STATUS_TONE: Record<HealthStatus, string> = {
  Healthy: 'border-good/40 bg-good/10 text-good rounded-full',
  Degraded: 'border-warn/50 bg-warn/10 text-warn rounded-sm',
  Down: 'border-bad/40 bg-bad/10 text-bad rounded-sm',
};
export function HealthPill({ status }: { status: HealthStatus }) {
  return <span className={cls('chip', STATUS_TONE[status])}><Icon name={status === 'Healthy' ? 'pass' : status === 'Down' ? 'fail' : 'warn'} size={11} />{status}</span>;
}

function seeded(seed: string, n: number, base: number, spread: number): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ i;
    return base + (((h >>> 0) % 1000) / 1000 - 0.5) * spread;
  });
}

/** Upstream chain of a product, ordered from Bronze up. */
function lineageStrip(pack: IndustryPack, productId: string): { id: string; layer: LayerId }[] {
  const p = pack.products.find((x) => x.id === productId)!;
  const seen = new Map<string, LayerId>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    const o = pack.objects.find((x) => `${x.schema}.${x.name}` === id);
    if (!o) return;
    seen.set(id, o.layer);
    o.upstream.forEach(walk);
  };
  p.upstream.forEach(walk);
  const order: LayerId[] = ['bronze', 'silver', 'gold'];
  return [...seen.entries()].filter(([, l]) => order.includes(l)).sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1])).map(([id, layer]) => ({ id, layer }));
}

export default function Health() {
  const pack = usePack();
  const { tab } = useParams();
  const path = usePackPath();
  if (!hasExt(pack, ['incidents'])) return <NotConfigured pack={pack} keys={['incidents']} />;
  if (tab && tab !== 'incidents') return <Navigate to={path('health')} replace />;
  return <HealthInner tab={tab === 'incidents' ? 'incidents' : 'overview'} />;
}

function HealthInner({ tab }: { tab: 'overview' | 'incidents' }) {
  const pack = usePack();
  const path = usePackPath();
  const navigate = useNavigate();
  const [ext, patch] = useExt();
  const [sp, setSp] = useSearchParams();
  const breakOpen = sp.get('break') === '1';
  const open = ext.incidents.open;

  const start = (i: IncidentScript) => {
    patch((e) => (e.incidents.open.some((o) => o.id === i.id) ? e : { ...e, incidents: { ...e.incidents, open: [...e.incidents.open, { id: i.id, openedAt: new Date().toISOString() }] } }));
    setSp({}, { replace: true });
    navigate(path('health/incidents'));
    toast(`Incident started: ${i.title}`, 'warn');
  };

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Data health"
        layer={['silver', 'product', 'agent', 'gov']}
        sub="Trust is enforced automatically: when data goes wrong, data metric functions detect it, products are flagged and agents warn users before anyone acts on a bad number."
        right={<button className="btn-primary" onClick={() => setSp({ break: '1' }, { replace: true })}><Icon name="blast" size={14} />Break something</button>}
      />
      <Tabs label="Health views" value={tab} onChange={(t) => navigate(path(t === 'overview' ? 'health' : 'health/incidents'))} tabs={[{ id: 'overview', label: 'Health overview' }, { id: 'incidents', label: 'Incidents', count: open.length }]} />
      <div className="mt-3">{tab === 'overview' ? <Overview /> : <Incidents />}</div>

      <Drawer open={breakOpen} onClose={() => setSp({}, { replace: true })} title="Break something" subtitle="Inject a scripted fault and watch the platform react" width="max-w-lg">
        {ext.studioSim && (
          <div role="alert" className="mb-3 space-y-2 rounded-md border border-warn/50 bg-warn/10 p-3 text-sm">
            <p><strong>Agent Studio is simulating layers off.</strong> Incidents and the layer switches can&apos;t run at the same time.</p>
            <button className="btn-primary" onClick={() => patch((e) => ({ ...e, studioSim: false, studioSwitches: { ...ALL_ON } }))}><Icon name="power" size={13} />Turn all layers on</button>
          </div>
        )}
        <ul className="space-y-2">
          {pack.ext!.incidents.map((i) => {
            const isOpen = open.some((o) => o.id === i.id);
            return (
              <li key={i.id} className="rounded-md border border-line p-3 text-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><div className="font-semibold">{i.title}</div><p className="text-muted">{i.fault}</p>
                    <div className="mt-1 text-xs">Affects {i.affects.map((a) => `${pack.products.find((p) => p.id === a.productId)?.name} (${a.status})`).join(', ')}</div></div>
                  <button className="btn shrink-0" disabled={isOpen || ext.studioSim} onClick={() => start(i)}>{isOpen ? 'Open' : 'Start'}</button>
                </div>
              </li>
            );
          })}
        </ul>
      </Drawer>
    </div>
  );
}

function Overview() {
  const pack = usePack();
  const live = useLive();
  const path = usePackPath();
  const [ext] = useExt();
  const levers = ext.cost ?? defaultLevers(pack);
  return (
    <section className="panel overflow-x-auto scroll-thin" aria-label="Product health">
      <table className="w-full min-w-[980px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted">
          <th className="px-3 py-2 font-medium">Data product</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Freshness vs SLA</th>
          <th className="px-3 py-2 font-medium">DQ score (30 d)</th><th className="px-3 py-2 font-medium">Freshness lag (30 d)</th><th className="px-3 py-2 font-medium">Last refresh</th><th className="px-3 py-2 font-medium">Lineage</th>
        </tr></thead>
        <tbody>
          {pack.products.map((p) => {
            const h = productHealth(pack, ext, p.id);
            const failing = new Set(h.incidents.map((i) => i.objectFqn));
            const sla = slaMinutes(p.sla);
            const lag = productFreshness(pack, levers, p.id) || sla;
            const late = h.incidents.find((i) => i.dmf.metric === 'FRESHNESS');
            const effLag = late ? late.dmf.value : lag;
            const dqNow = h.status === 'Down' ? Math.round(p.qualityScore * 0.55) : h.status === 'Degraded' ? Math.round(p.qualityScore * 0.82) : p.qualityScore;
            const dq = [...seeded(`${p.id}dq`, 29, p.qualityScore, 3).map((v) => Math.min(100, v)), dqNow];
            const lags = [...seeded(`${p.id}lag`, 29, Math.min(lag, sla) * 0.6, Math.min(lag, sla) * 0.5).map((v) => Math.max(1, v)), effLag];
            const strip = lineageStrip(pack, p.id);
            return (
              <tr key={p.id} className="border-b border-line/50 align-middle">
                <td className="px-3 py-2"><Link className="font-medium hover:underline" to={path(`marketplace?item=${p.id}`)}>{p.name}</Link><div className="text-xs text-muted">{p.id} · {live.productStatus[p.id]}</div></td>
                <td className="px-3 py-2"><HealthPill status={h.status} />{h.incidents.length > 0 && <Link className="ml-1 text-xs text-accent hover:underline" to={path('health/incidents')}>{h.incidents.length} open</Link>}</td>
                <td className="px-3 py-2"><span className={cls('tabnum', effLag > sla && 'font-semibold text-bad')}>{fmtLag(Math.round(effLag))}</span> <span className="text-xs text-muted">/ SLA {fmtLag(sla)}</span></td>
                <td className="px-3 py-2"><div className="flex items-center gap-2"><Sparkline values={dq} w={96} h={24} tone={h.status === 'Healthy' ? 'good' : 'bad'} /><span className="tabnum">{dqNow}%</span></div></td>
                <td className="px-3 py-2"><Sparkline values={lags} w={96} h={24} tone={late ? 'bad' : 'accent'} /></td>
                <td className="px-3 py-2 text-xs">{late ? '6 h ago' : p.freshness}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-0.5" aria-label={`Lineage of ${p.name}`}>
                    {strip.map((s, k) => (
                      <span key={s.id} className="inline-flex items-center">
                        {k > 0 && <Icon name="chevronRight" size={10} className="text-muted" />}
                        <Link to={path(`explorer/${s.id.replace('.', '/')}`)} title={s.id} className={cls('h-3 w-5 rounded-sm', failing.has(s.id) && 'animate-pulse ring-2 ring-bad')} style={{ background: layerColor(s.layer, failing.has(s.id) ? 1 : 0.55) }} aria-label={`${s.id}${failing.has(s.id) ? ' (source of the problem)' : ''}`} />
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Incidents() {
  const pack = usePack();
  const [ext] = useExt();
  const open = ext.incidents.open.map((o) => ({ o, i: pack.ext!.incidents.find((x) => x.id === o.id)! })).filter((x) => x.i);
  return (
    <div className="space-y-4">
      {!open.length && <div className="panel p-6 text-center text-sm text-muted">No open incidents. Use <strong>Break something</strong> to inject one.</div>}
      {open.map(({ o, i }) => <Timeline key={i.id} i={i} openedAt={o.openedAt} />)}
      <Postmortems />
    </div>
  );
}

function Timeline({ i, openedAt }: { i: IncidentScript; openedAt: string }) {
  const pack = usePack();
  const path = usePackPath();
  const [, patch] = useExt();
  const elapsed = () => Date.now() - new Date(openedAt).getTime();
  const [now, setNow] = useState(elapsed);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    if (reduced() || now > STEP_MS * 7) return;
    const h = window.setTimeout(() => setNow(elapsed()), 250);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);
  const shown = reduced() ? 7 : Math.min(7, Math.floor(now / STEP_MS) + 1);
  const products = i.affects.map((a) => ({ a, p: pack.products.find((x) => x.id === a.productId)! }));
  const agents = i.agentEffect.map((e) => ({ e, a: pack.agents.find((x) => x.id === e.agentId)! }));
  const firstQ = (agentId: string, scenarioIds?: string[]) => pack.scenarios.find((s) => s.agentId === agentId && (!scenarioIds || scenarioIds.includes(s.id)))?.question ?? '';
  const steps: { title: string; detail: string; to?: string; layer: LayerId }[] = [
    { title: 'Fault injected', detail: i.fault, to: `explorer/${i.objectFqn.replace('.', '/')}`, layer: pack.objects.find((x) => `${x.schema}.${x.name}` === i.objectFqn)?.layer ?? 'bronze' },
    { title: 'DMF detected', detail: `${i.dmf.metric} on ${i.objectFqn}${i.column ? `.${i.column}` : ''}: ${i.dmf.value.toLocaleString('en-US')}${i.dmf.unit} against a threshold of ${i.dmf.threshold}${i.dmf.unit}.`, to: 'explorer/GOVERNANCE/DMF_RESULTS', layer: 'gov' },
    { title: 'Alert sent', detail: `To ${[...new Set(products.flatMap(({ p }) => [p.steward ? `${p.steward} (data steward)` : 'the domain data steward', `${p.owner} (product owner)`]))].join(', ')}.`, to: 'operating-model?role=steward', layer: 'gov' },
    { title: 'Product status changed', detail: products.map(({ a, p }) => `${p.name} → ${a.status}`).join('; '), to: 'health', layer: 'product' },
    { title: 'Marketplace badge updated', detail: `${products.map(({ p }) => p.name).join(' and ')} now show${products.length > 1 ? '' : 's'} the ${products.map(({ a }) => a.status).join('/')} badge to every consumer.`, to: `marketplace?item=${products[0].p.id}`, layer: 'product' },
    { title: 'Agent behavior changed', detail: agents.map(({ e, a }) => `${a.name} ${e.mode === 'block' ? 'withholds' : 'warns on'} affected answers: “${e.message}”`).join(' '), to: `agents/${agents[0].a.id}?q=${encodeURIComponent(firstQ(agents[0].a.id, agents[0].e.scenarioIds))}`, layer: 'agent' },
  ];
  const resolve = () => {
    setResolving(true);
    window.setTimeout(() => {
      patch((e) => ({ ...e, incidents: { open: e.incidents.open.filter((o) => o.id !== i.id), postmortems: [{ incidentId: i.id, openedAt, resolvedAt: new Date().toISOString(), ttdMin: i.ttdMin, ttrMin: i.ttrMin }, ...e.incidents.postmortems] } }));
      toast(`Resolved: ${i.title}`, 'good');
    }, reduced() ? 0 : 1500);
  };
  return (
    <section className="panel p-4" aria-label={`Incident ${i.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip border-bad/40 bg-bad/10 text-bad"><Icon name="blast" size={11} />{i.id}</span>
        <h2 className="font-semibold">{i.title}</h2>
        <span className="text-xs text-muted">opened {new Date(openedAt).toLocaleTimeString()}</span>
        <button className="btn-primary ml-auto" disabled={shown < 7 || resolving} onClick={resolve}><Icon name={resolving ? 'pending' : 'check'} size={13} />{resolving ? 'Playing the fix…' : 'Resolve incident'}</button>
      </div>
      <ol className="mt-3 space-y-0" aria-live="polite">
        {steps.slice(0, shown).map((s, k) => (
          <li key={s.title} className="relative flex gap-3 pb-3 pl-1">
            <span className="relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: layerColor(s.layer) }}>{k + 1}</span>
            {k < steps.length - 1 && <span className="absolute left-[15px] top-6 h-full w-px bg-line" aria-hidden />}
            <div className="min-w-0 text-sm"><div className="font-medium">{s.title}{s.to && <Link className="ml-2 text-xs font-normal text-accent hover:underline" to={path(s.to)}>See it</Link>}</div><p className="text-muted">{s.detail}</p></div>
          </li>
        ))}
        {shown >= 7 && (
          <li className="flex gap-3 pl-1 text-sm">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-dashed border-good text-[11px] font-semibold text-good">7</span>
            <div><div className="font-medium">Resolution</div><p className="text-muted">{i.resolution}</p></div>
          </li>
        )}
        {shown < 7 && <li className="typing pl-10 text-xs text-muted" aria-hidden><span>●</span><span>●</span><span>●</span></li>}
      </ol>
    </section>
  );
}

function Postmortems() {
  const pack = usePack();
  const [ext] = useExt();
  const pms = ext.incidents.postmortems;
  if (!pms.length) return null;
  return (
    <section className="panel overflow-x-auto p-4 scroll-thin" aria-label="Postmortems">
      <h2 className="mb-2 font-semibold">Postmortems</h2>
      <table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pr-3 font-medium">Incident</th><th className="py-2 pr-3 font-medium">Cause</th><th className="py-2 pr-3 font-medium">Impact window</th><th className="py-2 pr-3 font-medium">Products and agents</th><th className="py-2 pr-3 text-right font-medium">Time to detect</th><th className="py-2 text-right font-medium">Time to resolve</th></tr></thead>
        <tbody>{pms.map((pm) => {
          const i = pack.ext!.incidents.find((x) => x.id === pm.incidentId);
          if (!i) return null;
          return (
            <tr key={pm.incidentId + pm.resolvedAt} className="border-b border-line/50 align-top">
              <td className="py-2 pr-3 font-medium">{i.title}</td><td className="py-2 pr-3">{i.fault} {i.resolution}</td>
              <td className="py-2 pr-3 text-xs">{new Date(pm.openedAt).toLocaleTimeString()} → {new Date(pm.resolvedAt).toLocaleTimeString()} (scripted {i.ttdMin + i.ttrMin} min)</td>
              <td className="py-2 pr-3 text-xs">{[...i.affects.map((a) => pack.products.find((p) => p.id === a.productId)?.name), ...i.agentEffect.map((e) => pack.agents.find((a) => a.id === e.agentId)?.name)].join(', ')}</td>
              <td className="py-2 pr-3 text-right tabnum">{pm.ttdMin} min</td><td className="py-2 text-right tabnum">{pm.ttrMin} min</td>
            </tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}
