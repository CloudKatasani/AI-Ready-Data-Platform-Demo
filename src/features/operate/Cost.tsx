import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { layerColor, PageHeader, Tabs } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, useLive, usePack, usePackPath } from '../../app/context';
import { toast } from '../../app/toast';
import { Popover } from '../../app/TopBar';
import { LAYER_BY_ID } from '../../layers';
import type { LayerId } from '../../types';
import { computeCost, costMarkdown, defaultLevers, dtOwners, fmtLag, LAG_STEPS, type CostResult, type WhSize } from '../../ext/cost';
import type { CostLevers } from '../../ext/state';

type View = 'overview' | 'products' | 'agents' | 'whatif' | 'guardrails';
const LAYER_ORDER: LayerId[] = ['bronze', 'silver', 'gold', 'semantic', 'glossary', 'context', 'product', 'agent', 'gov'];
const SIZES: WhSize[] = ['XS', 'S', 'M', 'L'];

export function Illustrative() {
  return <span className="chip border-warn/50 bg-warn/10 text-[11px] text-warn" title="Placeholder rates and synthetic volumes; not a quote">Illustrative</span>;
}

export default function Cost() {
  const pack = usePack();
  const [ext, patch] = useExt();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as View) ?? 'overview';
  const defaults = useMemo(() => defaultLevers(pack), [pack]);
  const lv: CostLevers = ext.cost ?? defaults;
  const r = useMemo(() => computeCost(pack, lv, ext.tooling), [pack, lv, ext.tooling]);
  const base = useMemo(() => computeCost(pack, defaults, ext.tooling), [pack, defaults, ext.tooling]);
  const set = (f: (l: CostLevers) => CostLevers) => patch((e) => ({ ...e, cost: f(e.cost ?? defaults) }));
  const money = (n: number, d = 0) => `${lv.currency}${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  const delta = base.total ? ((r.total - base.total) / base.total) * 100 : 0;
  const copy = async () => {
    try { await navigator.clipboard.writeText(costMarkdown(pack, r, lv)); toast('Cost summary copied', 'good'); } catch { toast('Clipboard not available in this browser', 'warn'); }
  };

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Cost"
        layer={['bronze', 'silver', 'gold', 'product', 'agent']}
        sub="What it costs to run, per layer, product and agent, and the levers that change it. Computed from the catalog's volumes with placeholder rates the presenter can edit."
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <Illustrative />
            <Popover label="Cost settings" align="right" trigger={() => <span className="btn"><Icon name="gear" size={13} />Settings</span>}>
              {() => (
                <div className="w-64 space-y-3 p-2 text-sm">
                  <label className="block"><span className="label">Currency label</span><input className="input mt-1" value={lv.currency} maxLength={4} onChange={(e) => set((l) => ({ ...l, currency: e.target.value }))} /></label>
                  <label className="block"><span className="label">Price per credit</span><input type="number" min={0.5} max={10} step={0.1} className="input mt-1" value={lv.creditPrice} onChange={(e) => set((l) => ({ ...l, creditPrice: Math.max(0.1, Number(e.target.value) || 0) }))} /></label>
                  <p className="text-xs text-muted">Placeholder: not a Snowflake price. Rates live in src/ext/cost.ts.</p>
                </div>
              )}
            </Popover>
            <button className="btn" onClick={copy}><Icon name="copy" size={13} />Copy cost summary</button>
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="panel px-4 py-3"><div className="label">Monthly total <Illustrative /></div><div className="mt-1 font-display text-xl font-semibold tabnum">{money(r.total)}</div><div className={cls('text-xs', Math.abs(delta) < 0.5 ? 'text-muted' : delta < 0 ? 'text-good' : 'text-bad')}>{Math.abs(delta) < 0.5 ? 'Baseline scenario' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(0)}% vs baseline`}</div></div>
        <div className="panel px-4 py-3"><div className="label">Per data product</div><div className="mt-1 font-display text-xl font-semibold tabnum">{money(r.byProduct.reduce((a, p) => a + p.usd, 0) / Math.max(1, r.byProduct.length))}</div><div className="text-xs text-muted">average per month</div></div>
        <div className="panel px-4 py-3"><div className="label">Per agent question</div><div className="mt-1 font-display text-xl font-semibold tabnum">{money(r.byAgent.reduce((a, x) => a + x.usd, 0) / Math.max(1, lv.questionsPerDay * 30), 3)}</div><div className="text-xs text-muted">{lv.questionsPerDay} questions per day</div></div>
        <div className="panel px-4 py-3"><div className="label">SLA breaches</div><div className={cls('mt-1 font-display text-xl font-semibold tabnum', r.byProduct.some((p) => p.breach) && 'text-bad')}>{r.byProduct.filter((p) => p.breach).length}</div><div className="text-xs text-muted">from target-lag levers</div></div>
      </div>

      <div className="mt-4"><Tabs label="Cost views" value={view} onChange={(v) => setSp(v === 'overview' ? {} : { view: v }, { replace: true })} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'products', label: 'By data product' }, { id: 'agents', label: 'By agent' }, { id: 'whatif', label: 'What-if' }, { id: 'guardrails', label: 'Guardrails' }]} /></div>
      <div className="mt-3">
        {view === 'overview' && <Overview r={r} money={money} />}
        {view === 'products' && <Products r={r} money={money} />}
        {view === 'agents' && <Agents r={r} money={money} />}
        {view === 'whatif' && <WhatIf r={r} base={base} lv={lv} defaults={defaults} set={set} money={money} reset={() => patch((e) => ({ ...e, cost: undefined }))} />}
        {view === 'guardrails' && <Guardrails r={r} />}
      </div>
      {r.icebergNote && <p className="mt-3 text-xs text-muted"><Icon name="info" size={12} className="mr-1 inline" />{r.icebergNote}</p>}
    </div>
  );
}

type Money = (n: number, d?: number) => string;

function StackedMonths({ r, money }: { r: CostResult; money: Money }) {
  const max = Math.max(...r.months.map((m) => m.total), 1);
  const layers = LAYER_ORDER.filter((l) => r.months.some((m) => (m.byLayer[l] ?? 0) > 0));
  return (
    <div>
      <div className="flex h-56 items-end gap-3" role="img" aria-label={`Monthly cost for the last six months, ${r.months.map((m) => `${m.label} ${money(m.total)}`).join(', ')}`}>
        {r.months.map((m) => (
          <div key={m.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <div className="mb-1 text-[11px] tabnum text-muted">{money(m.total)}</div>
            <div className="flex w-full max-w-[64px] flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(m.total / max) * 85}%` }}>
              {layers.map((l) => <div key={l} style={{ height: `${((m.byLayer[l] ?? 0) / m.total) * 100}%`, background: layerColor(l) }} title={`${LAYER_BY_ID[l].label}: ${money(m.byLayer[l] ?? 0)}`} />)}
            </div>
            <div className="mt-1 text-xs">{m.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">{layers.map((l) => <span key={l} className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: layerColor(l) }} />{LAYER_BY_ID[l].label} <span className="tabnum text-muted">{money(r.byLayer[l] ?? 0)}</span></span>)}</div>
    </div>
  );
}

function Overview({ r, money }: { r: CostResult; money: Money }) {
  const path = usePackPath();
  const top = [...r.items].sort((a, b) => b.usd - a.usd).slice(0, 5);
  const drivers = [...new Set(r.items.map((i) => i.driver))].map((d) => ({ d, usd: r.items.filter((i) => i.driver === d).reduce((a, i) => a + i.usd, 0) })).sort((a, b) => b.usd - a.usd);
  return (
    <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="panel p-4" aria-label="Last six months by layer"><div className="mb-3 flex items-center gap-2"><h2 className="font-semibold">Last 6 months by layer</h2><Illustrative /></div><StackedMonths r={r} money={money} /></section>
      <div className="space-y-4">
        <section className="panel p-4" aria-label="Top cost objects"><div className="mb-2 flex items-center gap-2"><h2 className="font-semibold">Top five cost objects</h2><Illustrative /></div>
          <ol className="space-y-1.5 text-sm">{top.map((i) => <li key={i.driver + i.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: layerColor(i.layer) }} />{i.objectId ? <Link className="mono truncate hover:underline" to={path(`explorer/${i.objectId.replace('.', '/')}`)}>{i.label}</Link> : <span className="truncate">{i.label}</span>}<span className="truncate text-xs text-muted">{i.driver}</span><span className="ml-auto tabnum">{money(i.usd)}</span></li>)}</ol>
        </section>
        <section className="panel p-4" aria-label="By cost driver"><div className="mb-2 flex items-center gap-2"><h2 className="font-semibold">By cost driver</h2><Illustrative /></div>
          <ul className="space-y-1.5 text-sm">{drivers.map((d) => <li key={d.d}><div className="flex justify-between gap-2"><span>{d.d}</span><span className="tabnum">{money(d.usd)}</span></div><div className="mt-0.5 h-1.5 rounded-full bg-surface2"><div className="h-full rounded-full bg-accent" style={{ width: `${(d.usd / Math.max(1, drivers[0].usd)) * 100}%` }} /></div></li>)}</ul>
        </section>
      </div>
    </div>
  );
}

function Products({ r, money }: { r: CostResult; money: Money }) {
  const pack = usePack();
  const path = usePackPath();
  const liveState = useLive();
  return (
    <section className="panel overflow-x-auto scroll-thin" aria-label="Cost by data product">
      <table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-3 py-2 font-medium">Data product</th><th className="px-3 py-2 text-right font-medium">Monthly <Illustrative /></th><th className="px-3 py-2 text-right font-medium">Per consumer</th><th className="px-3 py-2 text-right font-medium">Per 1,000 queries</th><th className="px-3 py-2 text-right font-medium">Queries / week</th><th className="px-3 py-2 text-right font-medium">Consumers</th><th className="px-3 py-2 font-medium">Freshness</th></tr></thead>
        <tbody>{r.byProduct.map((p) => { const prod = pack.products.find((x) => x.id === p.productId)!; return (
          <tr key={p.productId} className="border-b border-line/50">
            <td className="px-3 py-2"><Link className="font-medium hover:underline" to={path(`marketplace?item=${p.productId}`)}>{prod.name}</Link><div className="text-xs text-muted">{p.productId} · {liveState.productStatus[p.productId] ?? prod.status}</div></td>
            <td className="px-3 py-2 text-right tabnum">{money(p.usd)}</td><td className="px-3 py-2 text-right tabnum">{money(p.perConsumer, 2)}</td><td className="px-3 py-2 text-right tabnum">{money(p.per1kQueries, 2)}</td>
            <td className="px-3 py-2 text-right tabnum">{p.queriesPerWeek.toLocaleString('en-US')}</td><td className="px-3 py-2 text-right tabnum">{p.consumers}</td>
            <td className="px-3 py-2"><SlaChip lag={p.lagMin} sla={p.slaMin} /></td>
          </tr>); })}</tbody>
      </table>
    </section>
  );
}

export function SlaChip({ lag, sla }: { lag: number; sla: number }) {
  const breach = lag > sla;
  return <span className={cls('chip', breach ? 'border-bad/40 bg-bad/10 text-bad' : 'border-line')}>{breach && <Icon name="warn" size={11} />}every {fmtLag(lag)} · SLA {fmtLag(sla)}{breach ? ' breached' : ''}</span>;
}

function Agents({ r, money }: { r: CostResult; money: Money }) {
  const pack = usePack();
  return (
    <section className="panel overflow-x-auto scroll-thin" aria-label="Cost by agent">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-3 py-2 font-medium">Agent</th><th className="px-3 py-2 text-right font-medium">Questions / day</th><th className="px-3 py-2 text-right font-medium">Monthly <Illustrative /></th><th className="px-3 py-2 text-right font-medium">Per question</th><th className="w-[30%] px-3 py-2 font-medium">Model tokens vs SQL execution</th></tr></thead>
        <tbody>{r.byAgent.map((a) => { const ag = pack.agents.find((x) => x.id === a.agentId)!; const t = a.usd ? (a.tokens / a.usd) * 100 : 0; return (
          <tr key={a.agentId} className="border-b border-line/50">
            <td className="px-3 py-2"><div className="font-medium">{ag.name}</div><div className="text-xs text-muted">{ag.status}</div></td>
            <td className="px-3 py-2 text-right tabnum">{a.questionsPerDay}</td><td className="px-3 py-2 text-right tabnum">{money(a.usd)}</td><td className="px-3 py-2 text-right tabnum">{money(a.perQuestion, 3)}</td>
            <td className="px-3 py-2"><div className="flex h-4 overflow-hidden rounded" role="img" aria-label={`${t.toFixed(0)}% model tokens, ${(100 - t).toFixed(0)}% SQL execution`}><div style={{ width: `${t}%`, background: layerColor('agent') }} /><div style={{ width: `${100 - t}%`, background: layerColor('product') }} /></div><div className="mt-0.5 flex justify-between text-[11px] text-muted"><span>tokens {money(a.tokens)}</span><span>SQL {money(a.sql)}</span></div></td>
          </tr>); })}</tbody>
      </table>
    </section>
  );
}

function WhatIf({ r, base, lv, defaults, set, money, reset }: { r: CostResult; base: CostResult; lv: CostLevers; defaults: CostLevers; set: (f: (l: CostLevers) => CostLevers) => void; money: Money; reset: () => void }) {
  const pack = usePack();
  const owners = dtOwners(pack);
  const refreshOf = (res: CostResult, pid: string) => { const ids = new Set([...owners].filter(([, o]) => o === pid).map(([dt]) => dt)); return res.items.filter((i) => i.driver === 'Dynamic table refresh' && i.objectId && ids.has(i.objectId)).reduce((a, i) => a + i.usd, 0); };
  const groups = pack.products.filter((p) => p.id in defaults.lagMinutes);
  const changedLag = groups.filter((p) => lv.lagMinutes[p.id] !== defaults.lagMinutes[p.id]);
  return (
    <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="panel space-y-5 p-4" aria-label="Levers">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Levers</h2><button className="btn ml-auto" onClick={reset}><Icon name="reset" size={13} />Reset levers</button></div>
        <fieldset><legend className="label mb-2">Target lag per dynamic table group (fastest table in the group)</legend>
          <div className="space-y-2">{groups.map((p) => {
            const lag = lv.lagMinutes[p.id] ?? 60;
            const idx = Math.max(0, LAG_STEPS.findIndex((x) => x >= lag));
            const slaRow = r.byProduct.find((x) => x.productId === p.id)!;
            return (
              <div key={p.id} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <span className="min-w-0"><span className="block truncate">{p.name}</span><span className="block text-[11px] text-muted">{fmtLag(lag)} · {[...owners].filter(([, o]) => o === p.id).length} tables</span></span>
                <input type="range" min={0} max={LAG_STEPS.length - 1} value={idx} onChange={(e) => set((l) => ({ ...l, lagMinutes: { ...l.lagMinutes, [p.id]: LAG_STEPS[Number(e.target.value)] } }))} aria-label={`${p.name} target lag`} aria-valuetext={fmtLag(lag)} />
                <SlaChip lag={lag} sla={slaRow.slaMin} />
              </div>
            );
          })}</div>
        </fieldset>
        <fieldset><legend className="label mb-2">Warehouse size per workload</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{(['transform', 'bi', 'ai'] as const).map((k) => (
            <label key={k} className="text-sm"><span className="text-muted">{{ transform: 'Transformation', bi: 'BI and ad-hoc', ai: 'Agents (SQL)' }[k]}</span>
              <select className="input mt-1" value={lv.warehouse[k]} onChange={(e) => set((l) => ({ ...l, warehouse: { ...l.warehouse, [k]: e.target.value as WhSize } }))}>{SIZES.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
          ))}</div>
        </fieldset>
        <label className="block text-sm"><span className="label">Agent questions per day: <span className="tabnum text-ink">{lv.questionsPerDay}</span></span><input type="range" className="mt-1 w-full" min={0} max={5000} step={50} value={lv.questionsPerDay} onChange={(e) => set((l) => ({ ...l, questionsPerDay: Number(e.target.value) }))} /></label>
        <label className="block text-sm"><span className="label">DMF checks per day: <span className="tabnum text-ink">{lv.dmfPerDay}</span></span><input type="range" className="mt-1 w-full" min={1} max={96} value={lv.dmfPerDay} onChange={(e) => set((l) => ({ ...l, dmfPerDay: Number(e.target.value) }))} /></label>
      </section>
      <div className="space-y-4">
        <section className="panel p-4" aria-live="polite" aria-label="Scenario result">
          <div className="flex items-center gap-2"><h2 className="font-semibold">Scenario</h2><Illustrative /></div>
          <div className="mt-2 flex items-baseline gap-3"><span className="font-display text-2xl font-semibold tabnum">{money(r.total)}</span><span className="text-sm text-muted">vs {money(base.total)} baseline</span></div>
          <ul className="mt-3 space-y-1 text-sm">{LAYER_ORDER.filter((l) => (r.byLayer[l] ?? 0) > 0 || (base.byLayer[l] ?? 0) > 0).map((l) => { const now = r.byLayer[l] ?? 0; const was = base.byLayer[l] ?? 0; return (
            <li key={l}><div className="flex justify-between gap-2"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: layerColor(l) }} />{LAYER_BY_ID[l].label}</span><span className="tabnum">{money(now)}{Math.abs(now - was) > 0.5 && <span className={cls('ml-1 text-xs', now < was ? 'text-good' : 'text-bad')}>{now < was ? '−' : '+'}{money(Math.abs(now - was))}</span>}</span></div>
              <div className="mt-0.5 h-1.5 rounded-full bg-surface2"><div className="h-full rounded-full transition-all" style={{ width: `${(now / Math.max(...Object.values(r.byLayer), ...Object.values(base.byLayer), 1)) * 100}%`, background: layerColor(l) }} /></div></li>); })}</ul>
        </section>
        {changedLag.length > 0 && (
          <section className="panel p-4" aria-label="Freshness trade-offs"><h2 className="mb-2 font-semibold">Cost versus freshness</h2>
            <ul className="space-y-2 text-sm">{changedLag.map((p) => {
              const was = refreshOf(base, p.id); const now = refreshOf(r, p.id); const d = was ? ((now - was) / was) * 100 : 0; const row = r.byProduct.find((x) => x.productId === p.id)!;
              return <li key={p.id} className={cls('rounded-md border px-3 py-2', row.breach ? 'border-bad/40 bg-bad/5' : 'border-line')}><strong>{p.name}</strong> refreshes every {fmtLag(defaults.lagMinutes[p.id])} → every {fmtLag(lv.lagMinutes[p.id])}: <span className="tabnum">{d <= 0 ? '−' : '+'}{Math.abs(d).toFixed(0)}%</span> refresh cost, {row.breach ? <span className="font-semibold text-bad">freshness SLA breached ({p.sla})</span> : <span className="text-good">SLA still met ({p.sla})</span>}.</li>;
            })}</ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Guardrails({ r }: { r: CostResult }) {
  const path = usePackPath();
  return (
    <section className="panel p-4" aria-label="Guardrails">
      <div className="mb-3 flex items-center gap-2"><h2 className="font-semibold">Resource monitors and budgets</h2><Illustrative /></div>
      <ul className="space-y-3">{r.guardrails.map((g) => (
        <li key={g.monitor} className="text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><span><span className="mono font-medium">{g.monitor}</span> on <span className="mono">{g.warehouse}</span></span><span className="text-muted">quota {g.quota.toLocaleString('en-US')} credits / month · notify 75%, suspend 100%</span></div>
          <div className="mt-1 h-3 overflow-hidden rounded-full bg-surface2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, g.usedPct)} aria-label={`${g.monitor} month to date`}><div className={cls('h-full rounded-full', g.level === 'bad' ? 'bg-bad' : g.level === 'warn' ? 'bg-warn' : 'bg-good')} style={{ width: `${Math.min(100, g.usedPct)}%` }} /></div>
          <div className={cls('mt-0.5 text-xs', g.level === 'bad' ? 'text-bad' : g.level === 'warn' ? 'text-warn' : 'text-muted')}>{g.usedPct}% used month to date{g.level === 'bad' ? ': warehouse would be suspended' : g.level === 'warn' ? ': alert sent to the platform owner' : ''}</div>
        </li>
      ))}</ul>
      <p className="mt-4 text-xs text-muted">Monitors, budgets and alerts are created in the Governance step of the <Link className="link" to={path('build/setup/setup-monitors')}>Build Guide</Link>.</p>
    </section>
  );
}
