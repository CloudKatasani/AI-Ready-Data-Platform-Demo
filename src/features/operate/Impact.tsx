import { Fragment, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { layerColor, PageHeader } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, useLive, usePack, usePackPath } from '../../app/context';
import { toast } from '../../app/toast';
import { hasExt, NotConfigured } from '../../ext/NotConfigured';
import { analyzeImpact, CHANGE_LABEL, planMarkdown, SEVERITY_TEXT, STAGES, type ImpactSeverity } from '../../ext/impact';
import { runEval } from '../../ext/quality';
import type { ChangeType } from '../../ext/types';

const RING: Record<ImpactSeverity, string> = { breaking: 'ring-2 ring-bad', review: 'ring-2 ring-warn ring-dashed', none: 'ring-1 ring-line' };
const SEV_CHIP: Record<ImpactSeverity, string> = { breaking: 'border-bad/60 bg-bad/10 text-ink rounded-sm', review: 'border-warn/60 bg-warn/10 text-ink rounded-sm', none: 'border-line text-muted rounded-full' };
const CHANGES: ChangeType[] = ['type', 'rename', 'drop', 'semantics', 'grain'];

export default function Impact() {
  const pack = usePack();
  if (!hasExt(pack, ['impactPresets'])) return <NotConfigured pack={pack} keys={['impactPresets']} />;
  return <Inner />;
}

function Inner() {
  const pack = usePack();
  const live = useLive();
  const path = usePackPath();
  const [ext] = useExt();
  const [sp, setSp] = useSearchParams();
  const presets = pack.ext!.impactPresets;
  const preset = presets.find((p) => p.id === sp.get('preset'));
  const objectFqn = sp.get('object') ?? preset?.objectFqn ?? presets[0].objectFqn;
  const obj = pack.objects.find((o) => `${o.schema}.${o.name}` === objectFqn);
  const column = sp.get('column') ?? preset?.column ?? (sp.get('object') ? obj?.columns[0]?.name : presets[0].column) ?? '';
  const change = (sp.get('change') as ChangeType) ?? preset?.change ?? presets[0].change;
  const active = preset ?? presets.find((p) => p.objectFqn === objectFqn && p.column === column && p.change === change);
  const aliases = active?.aliases ?? [];
  const r = useMemo(() => analyzeImpact(pack, live, { objectFqn, column, change, aliases }, (id) => runEval(pack, ext, id).length), [pack, live, objectFqn, column, change, aliases, ext]);
  const candidates = pack.objects.filter((o) => ['bronze', 'silver', 'gold'].includes(o.layer) && o.columns.length);
  const set = (next: Record<string, string>) => setSp({ object: objectFqn, column, change, ...next }, { replace: true });
  const count = (sev: ImpactSeverity) => r.nodes.filter((n) => n.severity === sev).length;
  const copy = async () => {
    try { await navigator.clipboard.writeText(planMarkdown(pack, { objectFqn, column, change }, r)); toast('Change plan copied as Markdown', 'good'); } catch { toast('Clipboard not available in this browser', 'warn'); }
  };

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Impact analysis"
        layer={['bronze', 'silver', 'gold', 'semantic', 'glossary', 'product', 'agent']}
        sub="Because every layer is connected by lineage and contracts, a source change can be assessed before it breaks a product or an agent."
        right={<button className="btn" onClick={copy}><Icon name="copy" size={13} />Copy change plan</button>}
      />

      <section className="panel p-4" aria-label="Pick a change">
        <div className="flex flex-wrap gap-1.5">
          <span className="label mr-1 self-center">Presets</span>
          {presets.map((p) => <button key={p.id} className={cls('chip py-1', active?.id === p.id ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:border-accent')} onClick={() => setSp({ preset: p.id }, { replace: true })} aria-pressed={active?.id === p.id}>{p.label}</button>)}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm"><span className="label">Object</span>
            <select className="input mt-1" value={objectFqn} onChange={(e) => { const o = pack.objects.find((x) => `${x.schema}.${x.name}` === e.target.value); set({ object: e.target.value, column: o?.columns[0]?.name ?? '' }); }}>
              {candidates.map((o) => <option key={o.name} value={`${o.schema}.${o.name}`}>{o.schema}.{o.name}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="label">Column</span>
            <select className="input mt-1" value={column} onChange={(e) => set({ column: e.target.value })}>{obj?.columns.map((c) => <option key={c.name}>{c.name}</option>)}</select>
          </label>
          <label className="text-sm"><span className="label">Change type</span>
            <select className="input mt-1" value={change} onChange={(e) => set({ change: e.target.value })}>{CHANGES.map((c) => <option key={c} value={c}>{CHANGE_LABEL[c]}</option>)}</select>
          </label>
        </div>
        {active && <p className="mt-2 text-sm text-muted">{active.note}{aliases.length > 0 && <> Carried downstream as <span className="mono">{aliases.join(', ')}</span>.</>}</p>}
      </section>

      <section className="panel mt-4 overflow-x-auto p-4 scroll-thin" aria-label="Blast radius">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
          <h2 className="text-sm font-semibold">Blast radius</h2>
          {(['breaking', 'review', 'none'] as const).map((s) => <span key={s} className={cls('chip', SEV_CHIP[s])}>{SEVERITY_TEXT[s]} · {count(s)}</span>)}
        </div>
        <div className="flex min-w-[1100px] items-stretch gap-1">
          {STAGES.map((st, i) => {
            const ns = r.nodes.filter((n) => n.stage === st.id);
            return (
              <Fragment key={st.id}>
                {i > 0 && <div className="flex items-center text-muted" aria-hidden><Icon name="arrowRight" size={14} /></div>}
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: layerColor(st.layer) }} />{st.label}<span className="font-normal text-muted">{ns.length}</span></div>
                  <ul className="space-y-1.5">
                    {ns.map((n) => (
                      <li key={n.id}>
                        <Link to={path(n.route)} title={n.why} className={cls('block rounded-md bg-surface px-2 py-1.5 text-xs hover:bg-surface2', RING[n.severity])} style={{ borderLeft: `3px solid ${layerColor(st.layer)}` }}>
                          <span className="block break-all font-medium">{n.label}</span>
                          {n.sub && <span className="block text-[11px] text-muted">{n.sub}</span>}
                          <span className={cls('mt-1 inline-block rounded px-1 text-[10px] font-semibold', n.severity === 'breaking' ? 'bg-bad/15 text-bad' : n.severity === 'review' ? 'bg-warn/15 text-warn' : 'bg-surface2 text-muted')}>{SEVERITY_TEXT[n.severity]}</span>
                        </Link>
                      </li>
                    ))}
                    {!ns.length && <li className="rounded-md border border-dashed border-line px-2 py-3 text-center text-[11px] text-muted">Not affected</li>}
                  </ul>
                </div>
              </Fragment>
            );
          })}
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="panel p-4 text-sm" aria-label="Summary">
          <h2 className="mb-2 font-semibold">Summary</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STAGES.slice(1, 7).map((st) => <div key={st.id}><dt className="label">{st.label}</dt><dd className="font-display text-lg font-semibold tabnum">{r.nodes.filter((n) => n.stage === st.id && n.severity !== 'none').length}</dd></div>)}
            <div><dt className="label">Verified queries</dt><dd className="font-display text-lg font-semibold tabnum">{r.verifiedQueries.length}</dd></div>
            <div><dt className="label">Eval questions</dt><dd className="font-display text-lg font-semibold tabnum">{r.evalQuestions}</dd></div>
          </dl>
          <div className="mt-3"><span className="label">Affected KPIs</span><div className="mt-1 flex flex-wrap gap-1">{r.kpis.length ? r.kpis.map((k) => <span key={k} className="chip border-line">{k}</span>) : <span className="text-muted">None</span>}</div></div>
          <div className="mt-3"><span className="label">Consumers to notify</span><div className="mt-1 flex flex-wrap gap-1">{r.consumers.length ? r.consumers.map((c) => <span key={c.role} className="chip mono border-line">{c.role} · {c.count}</span>) : <span className="text-muted">None</span>}</div></div>
          <div className="mt-3"><span className="label">Data contracts</span>
            {r.contracts.length ? (
              <table className="mt-1 w-full text-xs"><thead><tr className="text-left text-muted"><th className="py-1 font-medium">Product</th><th className="py-1 font-medium">Version</th><th className="py-1 font-medium">Change notice</th></tr></thead>
                <tbody>{r.contracts.map((c) => <tr key={c.productId} className="border-t border-line/60"><td className="py-1"><Link className="hover:underline" to={path(`certify/${c.productId}`)}>{c.name}</Link></td><td className="mono py-1">{c.from} → {c.to} <span className={cls('ml-1 rounded px-1', c.bump === 'major' ? 'bg-bad/15 text-bad' : 'bg-surface2')}>{c.bump}</span></td><td className="py-1">{c.noticeDays ? `${c.noticeDays} days (breaking)` : 'Release notes only'}</td></tr>)}</tbody>
              </table>
            ) : <p className="text-muted">No contract change needed.</p>}
          </div>
        </section>
        <section className="panel p-4 text-sm" aria-label="Change plan">
          <div className="mb-2 flex items-center gap-2"><h2 className="font-semibold">Change plan</h2><button className="btn ml-auto" onClick={copy}><Icon name="copy" size={13} />Copy</button></div>
          <ol className="space-y-1.5">{r.plan.map((p, i) => <li key={i} className="flex gap-2"><input type="checkbox" className="mt-1" aria-label={p} /><span>{p}</span></li>)}</ol>
          {!r.plan.length && <p className="text-muted">Nothing downstream uses this column.</p>}
        </section>
      </div>
    </div>
  );
}
