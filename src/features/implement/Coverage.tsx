import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Drawer, PageHeader, Tabs } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, useLive, usePack, usePackPath } from '../../app/context';
import { hasExt, NotConfigured } from '../../ext/NotConfigured';
import { atLeast, groupBy, LEVELS, levelHistogram, reportStatus, simulate, type CoverageRow, type ReportStatus } from '../../ext/coverage';
import { useCoverage } from '../../ext/hooks';
import { FALLBACK_DEFAULTS, PHASES } from '../../ext/roadmap';

type View = 'heatmap' | 'domains' | 'reports';
const shade = (n: number) => `rgb(var(--accent) / ${n === 0 ? 0.04 : 0.12 + n * 0.13})`;
const STATUS_TONE: Record<ReportStatus, string> = { Replaced: 'border-good/40 bg-good/10 text-good', 'Partially covered': 'border-warn/50 bg-warn/10 text-warn', 'Not covered': 'border-bad/40 bg-bad/10 text-bad' };

export default function Coverage() {
  const pack = usePack();
  if (!hasExt(pack, ['sourceInventory', 'legacyReports'])) return <NotConfigured pack={pack} keys={['sourceInventory', 'legacyReports']} />;
  return <CoverageInner />;
}

function CoverageInner() {
  const pack = usePack();
  const [ext] = useExt();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as View) ?? 'heatmap';
  const base = useCoverage();
  const [weeks, setWeeks] = useState(0);
  const [blockers, setBlockers] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [cell, setCell] = useState<{ title: string; rows: CoverageRow[]; level: number } | null>(null);
  const defaults = pack.ext?.roadmapDefaults ?? FALLBACK_DEFAULTS;
  const phaseNow = ext.roadmap?.phase ?? defaults.phase;
  const sim = useMemo(() => simulate(base, weeks, phaseNow, ext.roadmap?.weeks ?? {}), [base, weeks, phaseNow, ext.roadmap?.weeks]);
  const rows = sim.rows;
  const hist = levelHistogram(rows);
  const systems = groupBy(rows, 'source');
  const agentReady = atLeast(rows, 6);

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Migration coverage"
        layer={['bronze', 'silver', 'gold', 'semantic', 'product', 'agent']}
        sub={`How far each of ${pack.profile.company}'s ${rows.length} source tables has climbed the AI-ready ladder. Levels are derived live from the catalog, glossary, products and agents.`}
        right={(
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blockers} onChange={(e) => setBlockers(e.target.checked)} />Show blockers</label>
            <label className="flex items-center gap-2 text-sm">
              <span className="whitespace-nowrap">Simulate +{weeks} weeks</span>
              <input type="range" min={0} max={24} step={4} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Simulate weeks ahead on the roadmap" />
            </label>
          </div>
        )}
      />
      {weeks > 0 && <div role="status" className="mb-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm"><Icon name="route" size={14} className="mr-1 inline" />Simulated: {weeks} weeks ahead on the roadmap reaches phase {sim.phase} ({PHASES[sim.phase].name}). Tables advance one level per 4 weeks, up to what that phase delivers.</div>}

      {/* Summary bar */}
      <section className="panel p-4" aria-label="Summary by level">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm"><span className="font-display text-2xl font-semibold tabnum">{Math.round((agentReady / rows.length) * 100)}%</span> agent-ready · <span className="tabnum">{atLeast(rows, 2)}</span> of {rows.length} curated or higher</div>
          <div className="text-xs text-muted">Each table counts once, at its furthest level</div>
        </div>
        <div className="mt-2 flex h-7 overflow-hidden rounded-md border border-line" role="img" aria-label={hist.map((n, i) => `${LEVELS[i].name}: ${n}`).join(', ')}>
          {hist.map((n, i) => n > 0 && <div key={i} className="grid place-items-center text-[11px] font-semibold" style={{ width: `${(n / rows.length) * 100}%`, background: shade(i) }} title={`${LEVELS[i].name}: ${n}`}><span className="rounded bg-surface/90 px-1 text-ink">{n}</span></div>)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {LEVELS.map((l) => <span key={l.n} className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-line" style={{ background: shade(l.n) }} />{l.n} {l.name} <span className="tabnum text-muted">{hist[l.n]} ({Math.round((hist[l.n] / rows.length) * 100)}%)</span></span>)}
        </div>
      </section>

      <div className="mt-4"><Tabs label="Coverage views" value={view} onChange={(v) => setSp(v === 'heatmap' ? {} : { view: v }, { replace: true })} tabs={[{ id: 'heatmap', label: 'Heatmap' }, { id: 'domains', label: 'By domain' }, { id: 'reports', label: 'Legacy reports', count: pack.ext!.legacyReports.length }]} /></div>

      {view === 'heatmap' && (
        <section className="panel mt-3 overflow-x-auto scroll-thin" aria-label="Coverage heatmap">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Source system / table</th>
                {LEVELS.slice(1).map((l) => <th key={l.n} className="w-[11%] px-1 py-2 text-center font-medium" title={l.rule}>{l.n}. {l.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {systems.map((g) => {
                const isOpen = open[g.name];
                return (
                  <Fragment key={g.name}>
                    <tr className="border-b border-line/60">
                      <th scope="row" className="px-3 py-1.5 text-left font-medium">
                        <button className="flex items-center gap-1.5" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.name]: !isOpen }))}>
                          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />{g.name}<span className="text-xs font-normal text-muted">{g.rows.length} tables</span>
                        </button>
                      </th>
                      {LEVELS.slice(1).map((l) => {
                        const reached = g.rows.filter((r) => r.levelNow >= l.n);
                        const frac = reached.length / g.rows.length;
                        return (
                          <td key={l.n} className="p-0.5">
                            <button className="h-8 w-full rounded text-xs font-semibold tabnum" style={{ background: frac ? `rgb(var(--accent) / ${0.1 + frac * 0.75})` : 'rgb(var(--surface2))' }}
                              onClick={() => setCell({ title: `${g.name} · ${l.name}`, rows: g.rows.filter((r) => r.levelNow === l.n), level: l.n })}
                              aria-label={`${g.name}: ${reached.length} of ${g.rows.length} tables reached ${l.name}`}>{reached.length ? <span className="rounded bg-surface/90 px-1.5 text-ink">{reached.length}</span> : ''}</button>
                          </td>
                        );
                      })}
                    </tr>
                    {isOpen && g.rows.map((r) => (
                      <tr key={r.id} className="border-b border-line/40 bg-surface2/30">
                        <th scope="row" className="py-1 pl-8 pr-3 text-left font-normal">
                          <span className="mono text-xs">{r.table}</span>{!r.derived && <span className="ml-1 text-[10px] text-muted">(inventory)</span>}
                          {blockers && r.blocker && <div className="mt-0.5 flex items-start gap-1 text-[11px] text-warn"><Icon name="warn" size={11} className="mt-0.5 shrink-0" />{r.blocker}</div>}
                        </th>
                        {LEVELS.slice(1).map((l) => (
                          <td key={l.n} className="p-0.5">
                            <button className={cls('h-6 w-full rounded', r.levelNow === l.n && 'ring-2 ring-ink/70')} style={{ background: r.levelNow >= l.n ? shade(l.n) : 'transparent' }}
                              onClick={() => setCell({ title: `${r.source}.${r.table} · ${l.name}`, rows: [r], level: l.n })}
                              aria-label={`${r.table}: ${r.levelNow >= l.n ? 'reached' : 'not reached'} ${l.name}${r.levelNow === l.n ? ' (furthest)' : ''}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-xs text-muted"><th scope="row" className="px-3 py-2 text-left font-medium">All tables ({rows.length})</th>{LEVELS.slice(1).map((l) => <td key={l.n} className="text-center tabnum">{atLeast(rows, l.n)}</td>)}</tr>
            </tfoot>
          </table>
        </section>
      )}

      {view === 'domains' && <Domains rows={rows} />}
      {view === 'reports' && <Reports />}

      <Drawer open={Boolean(cell)} onClose={() => setCell(null)} title={cell?.title ?? ''} subtitle={cell ? LEVELS[cell.level].rule : ''} width="max-w-lg">
        {cell && <CellDetail rows={cell.rows} level={cell.level} />}
      </Drawer>
    </div>
  );
}

function CellDetail({ rows, level }: { rows: CoverageRow[]; level: number }) {
  const path = usePackPath();
  if (!rows.length) return <p className="text-sm text-muted">No tables have this as their furthest level.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border border-line p-3">
          <div className="flex items-center justify-between gap-2"><span className="mono font-medium">{r.source}.{r.table}</span><span className="chip border-line">Level {r.levelNow}: {LEVELS[r.levelNow].name}</span></div>
          {(r.objectsAt[level] ?? []).length > 0 && (
            <div className="mt-2"><div className="label mb-1">Objects at this level</div>
              <div className="flex flex-wrap gap-1">{r.objectsAt[level].map((o) => <Link key={o} className="chip border-line font-mono hover:border-accent" to={path(`explorer/${o.replace('.', '/')}`)}>{o}</Link>)}</div>
            </div>
          )}
          {r.blocker && <p className="mt-2 flex items-start gap-1.5 text-xs text-warn"><Icon name="warn" size={12} className="mt-0.5 shrink-0" />Blocker: {r.blocker}</p>}
          {r.note && <p className="mt-1 text-xs text-muted">{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}

function Domains({ rows }: { rows: CoverageRow[] }) {
  const groups = groupBy(rows, 'domain').sort((a, b) => b.mean - a.mean);
  return (
    <section className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Coverage by domain">
      {groups.map((g, i) => (
        <div key={g.name} className="panel p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">{g.name}{i === 0 && <span className="chip ml-2 border-good/40 bg-good/10 text-good">Closest to agent-ready</span>}</h2>
            <span className="text-sm text-muted">mean level <span className="font-semibold tabnum text-ink">{g.mean.toFixed(1)}</span></span>
          </div>
          <div className="mt-2 flex h-5 overflow-hidden rounded border border-line" role="img" aria-label={g.hist.map((n, k) => `${LEVELS[k].name}: ${n}`).join(', ')}>
            {g.hist.map((n, k) => n > 0 && <div key={k} style={{ width: `${(n / g.rows.length) * 100}%`, background: shade(k) }} title={`${LEVELS[k].name}: ${n}`} />)}
          </div>
          <div className="mt-2 text-xs text-muted">{g.rows.length} tables · {atLeast(g.rows, 6)} agent-ready · {atLeast(g.rows, 5)} productized · {g.hist[0] + g.hist[1]} not yet curated</div>
        </div>
      ))}
    </section>
  );
}

function Reports() {
  const pack = usePack();
  const live = useLive();
  const path = usePackPath();
  const [filter, setFilter] = useState<ReportStatus | 'all'>('all');
  const reps = pack.ext!.legacyReports.map((r) => ({ r, s: reportStatus(pack, live, r.kpiIds, r.missing) }));
  const count = (st: ReportStatus) => reps.filter((x) => x.s.status === st).length;
  const pct = Math.round((count('Replaced') / reps.length) * 100);
  const kpiName = (id: string) => pack.kpis.find((k) => k.id === id)?.name ?? id;
  const segs: [ReportStatus, string][] = [['Replaced', 'rgb(var(--good))'], ['Partially covered', 'rgb(var(--warn))'], ['Not covered', 'rgb(var(--bad))']];
  let acc = 0;
  return (
    <section className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]" aria-label="Legacy report mapping">
      <div className="panel flex flex-col items-center p-4">
        <svg viewBox="0 0 42 42" className="h-40 w-40" role="img" aria-label={`${pct}% of legacy reports replaced`}>
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="rgb(var(--surface2))" strokeWidth="6" />
          {segs.map(([st, col]) => {
            const v = (count(st) / reps.length) * 100;
            const el = <circle key={st} cx="21" cy="21" r="15.9" fill="none" stroke={col} strokeWidth="6" strokeDasharray={`${v} ${100 - v}`} strokeDashoffset={25 - acc} />;
            acc += v;
            return el;
          })}
          <text x="21" y="22" textAnchor="middle" className="fill-current text-[7px] font-semibold">{pct}%</text>
          <text x="21" y="27" textAnchor="middle" className="fill-current text-[3px]">replaced</text>
        </svg>
        <ul className="mt-3 w-full space-y-1 text-sm">
          {segs.map(([st, col]) => (
            <li key={st}><button className={cls('flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-surface2', filter === st && 'bg-surface2 font-semibold')} onClick={() => setFilter(filter === st ? 'all' : st)} aria-pressed={filter === st}><span className="h-3 w-3 rounded-sm" style={{ background: col }} />{st}<span className="ml-auto tabnum">{count(st)}</span></button></li>
          ))}
        </ul>
      </div>
      <div className="panel overflow-x-auto scroll-thin">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-3 py-2 font-medium">Report</th><th className="px-3 py-2 font-medium">Replacing product</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Missing</th></tr></thead>
          <tbody>
            {reps.filter((x) => filter === 'all' || x.s.status === filter).map(({ r, s }) => {
              const prod = pack.products.find((p) => p.id === s.productId);
              const missing = [...s.uncovered.map(kpiName), ...r.missing];
              return (
                <tr key={r.id} className="border-b border-line/50 align-top">
                  <td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.id} · {r.tool} · {r.owner}</div></td>
                  <td className="px-3 py-2">{prod ? <Link className="link" to={path(`marketplace?item=${prod.id}`)}>{prod.name}</Link> : <span className="text-muted">None yet</span>}</td>
                  <td className="px-3 py-2"><span className={cls('chip', STATUS_TONE[s.status])}>{s.status}</span></td>
                  <td className="px-3 py-2 text-xs">{missing.length ? missing.join(', ') : <span className="text-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
