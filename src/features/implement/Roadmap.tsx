import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Drawer, PageHeader } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, usePack, usePackPath } from '../../app/context';
import { toast } from '../../app/toast';
import { FALLBACK_DEFAULTS, layout, monthLabel, PHASES, phaseFromGaps, roadmapMarkdown, weekToDate, WORKSTREAMS } from '../../ext/roadmap';
import { DIMENSIONS, overallScore, rankGaps } from '../../ext/readiness';
import { stepById } from '../../ext/buildGuide';

export default function Roadmap() {
  const pack = usePack();
  const path = usePackPath();
  const [ext, patch] = useExt();
  const [sp] = useSearchParams();
  const defaults = pack.ext?.roadmapDefaults ?? FALLBACK_DEFAULTS;
  const pos = ext.roadmap ?? { phase: defaults.phase, progress: defaults.progress, startDate: defaults.startDate, weeks: {} };
  const [sel, setSel] = useState<number>(() => Number(sp.get('phase') ?? pos.phase));
  const [drawer, setDrawer] = useState(false);
  const [highlight, setHighlight] = useState<number[]>([]);
  const placed = useMemo(() => layout(pos.weeks), [pos.weeks]);
  const total = placed[placed.length - 1].start + placed[placed.length - 1].length;
  const phase = placed.find((p) => p.id === sel) ?? placed[0];
  const save = (next: Partial<typeof pos>) => patch((e) => ({ ...e, roadmap: { ...pos, ...next } }));
  const answers = ext.readiness.answers;
  const assessed = overallScore(answers) !== undefined;

  const generate = () => {
    if (!assessed) {
      toast('Complete the readiness assessment first', 'warn');
      return;
    }
    const g = phaseFromGaps(rankGaps(answers, ext.readiness.targets).map((x) => x.dim));
    save({ phase: g.phase, generated: true });
    setHighlight(g.highlight);
    setSel(g.phase);
    toast(`Starting phase set to ${PHASES[g.phase].name} from readiness gaps`, 'good');
  };
  const copyRoadmap = async () => {
    try {
      await navigator.clipboard.writeText(roadmapMarkdown(pack.profile.company, pos.startDate, pos.weeks, pos.phase));
      toast('Roadmap copied as Markdown', 'good');
    } catch {
      toast('Clipboard not available in this browser', 'warn');
    }
  };
  const pct = (w: number) => `${(w / total) * 100}%`;
  const ticks = Array.from({ length: Math.floor(total / 4) + 1 }, (_, i) => i * 4);

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Implementation roadmap"
        layer={['bronze', 'silver', 'gold', 'semantic', 'product', 'agent']}
        sub={`The order in which an AI-ready platform is built, what each phase delivers and how you know it is done. Durations are illustrative for a mid-size enterprise.`}
        right={(
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={generate} title={assessed ? '' : 'Needs a completed readiness assessment'}><Icon name="gauge" size={13} />Generate from readiness</button>
            <button className="btn" onClick={() => setDrawer(true)}><Icon name="user" size={13} />Set position</button>
            <button className="btn" onClick={copyRoadmap}><Icon name="copy" size={13} />Copy roadmap</button>
          </div>
        )}
      />

      {/* Phase band */}
      <div className="panel overflow-x-auto p-4 scroll-thin" role="tablist" aria-label="Phases">
        <div className="flex min-w-[860px] items-center">
          {placed.map((p, i) => (
            <div key={p.id} className="flex min-w-0 flex-1 items-center">
              <button
                role="tab" aria-selected={p.id === sel} onClick={() => setSel(p.id)}
                className={cls('relative flex h-16 min-w-0 flex-1 flex-col justify-center px-5 text-left text-sm transition-colors [clip-path:polygon(0_0,calc(100%-14px)_0,100%_50%,calc(100%-14px)_100%,0_100%,14px_50%)]',
                  p.id < pos.phase ? 'bg-good/20' : p.id === pos.phase ? 'bg-accent/25' : 'bg-surface2', p.id === sel && 'ring-2 ring-inset ring-accent', highlight.includes(p.id) && 'outline outline-2 outline-warn')}
              >
                <span className="text-[11px] text-muted">Phase {p.id} · {p.length} wk</span>
                <span className="truncate font-semibold">{p.name}</span>
                {p.id === pos.phase && <span className="absolute -top-0.5 right-6 rounded-b bg-accent px-1.5 text-[10px] font-semibold text-white">You are here</span>}
              </button>
              {i < placed.length - 1 && <span className="mx-0.5 h-3 w-3 shrink-0 rotate-45 border-2 border-ink/60 bg-surface" title={`Gate: ${p.gate.label}`} aria-label={`Gate after ${p.name}: ${p.gate.label}`} />}
            </div>
          ))}
        </div>
      </div>

      {/* Gantt */}
      <section className="panel mt-4 overflow-x-auto p-4 scroll-thin" aria-label="Timeline">
        <div className="min-w-[860px]">
          <div className="relative ml-40 h-6 text-[11px] text-muted">
            {ticks.map((w) => <span key={w} className="absolute -translate-x-1/2" style={{ left: pct(w) }}>{w % 8 === 0 ? monthLabel(weekToDate(pos.startDate, w)) : `w${w}`}</span>)}
          </div>
          {WORKSTREAMS.map((ws) => (
            <div key={ws.id} className="flex items-center border-t border-line/60 py-1.5">
              <div className="w-40 shrink-0 pr-2 text-sm">{ws.label}<span className="ml-1 text-[11px] text-muted">{pos.progress[ws.id] ?? 0}%</span></div>
              <div className="relative h-7 flex-1">
                {placed.filter((p) => p.activities[ws.id]).map((p) => (
                  <button key={p.id} onClick={() => setSel(p.id)} title={`${p.name}: ${p.activities[ws.id]}`} className={cls('absolute top-0.5 h-6 truncate rounded px-1.5 text-left text-[11px] font-medium', p.id === sel ? 'bg-accent text-white' : p.id < pos.phase ? 'bg-good/30' : 'bg-surface2 hover:bg-accent/20')} style={{ left: pct(p.start), width: `calc(${pct(p.length)} - 3px)` }}>
                    {p.activities[ws.id]}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center border-t border-line/60 py-1.5">
            <div className="w-40 shrink-0 pr-2 text-sm font-medium">Gates</div>
            <div className="relative h-6 flex-1">
              {placed.slice(0, -1).map((p) => <span key={p.id} title={p.gate.label} className="absolute top-1 h-3.5 w-3.5 -translate-x-1/2 rotate-45 bg-ink/70" style={{ left: pct(p.start + p.length) }} />)}
            </div>
          </div>
        </div>
      </section>

      {/* Phase detail */}
      <section className="panel mt-4 p-4" aria-label={`Phase ${phase.id} detail`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-display text-lg font-semibold">Phase {phase.id}: {phase.name}</h2>
          <span className="text-sm text-muted">{phase.goal} · {weekToDate(pos.startDate, phase.start)} → {weekToDate(pos.startDate, phase.start + phase.length)} ({phase.weeks[0] === phase.weeks[1] ? 'ongoing' : `${phase.weeks[0]}–${phase.weeks[1]} weeks typical`})</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div><div className="label mb-1">Deliverables</div><ul className="space-y-1 text-sm">{phase.deliverables.map((d) => <li key={d} className="flex gap-1.5"><Icon name={phase.id < pos.phase ? 'pass' : 'pending'} size={14} className={cls('mt-0.5 shrink-0', phase.id < pos.phase ? 'text-good' : 'text-muted')} />{d}</li>)}</ul></div>
          <div><div className="label mb-1">Workstream activities</div><ul className="space-y-1 text-sm">{Object.entries(phase.activities).map(([k, v]) => <li key={k}><span className="text-muted">{WORKSTREAMS.find((w) => w.id === k)?.label}:</span> {v}</li>)}</ul>
            <div className="label mb-1 mt-3">Roles</div><div className="flex flex-wrap gap-1">{phase.roles.map((r) => <Link key={r} to={path('operating-model')} className="chip border-line hover:border-accent">{r}</Link>)}</div></div>
          <div><div className="label mb-1">Build Guide steps</div><ul className="space-y-1 text-sm">{phase.buildStepIds.map((sid) => { const st = stepById(sid)!; return <li key={sid}><Link className="link" to={path(`build/${st.layer}/${st.id}`)}>{st.title}</Link></li>; })}</ul>
            <div className="label mb-1 mt-3">Readiness dimensions closed</div><div className="flex flex-wrap gap-1">{phase.readinessDims.map((d) => <Link key={d} to={path('readiness/results')} className="chip border-line hover:border-accent">{DIMENSIONS.find((x) => x.id === d)!.label}</Link>)}</div></div>
          <div><div className="label mb-1">Snowflake features</div><div className="flex flex-wrap gap-1">{phase.features.map((f) => <span key={f} className="chip border-line bg-surface2">{f}</span>)}</div>
            <div className="label mb-1 mt-3">Risks</div><ul className="list-disc space-y-1 pl-5 text-sm">{phase.risks.map((r) => <li key={r}>{r}</li>)}</ul>
            <div className="label mb-1 mt-3">Exit gate</div>
            <div className="rounded-md border border-line p-2 text-sm"><span className="mr-1 inline-block h-2.5 w-2.5 rotate-45 bg-ink/70" />{phase.gate.label}{phase.gate.proofRoute && <> · <Link className="link" to={path(phase.gate.proofRoute)}>see the proof</Link></>}</div></div>
        </div>
      </section>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Set position" subtitle="Where is the client today?" width="max-w-md">
        <div className="space-y-5 text-sm">
          <label className="block"><span className="label">Current phase</span>
            <select className="input mt-1" value={pos.phase} onChange={(e) => { save({ phase: Number(e.target.value) }); setSel(Number(e.target.value)); }}>{PHASES.map((p) => <option key={p.id} value={p.id}>{p.id}. {p.name}</option>)}</select>
          </label>
          <label className="block"><span className="label">Start date</span><input type="date" className="input mt-1" value={pos.startDate} onChange={(e) => e.target.value && save({ startDate: e.target.value })} /></label>
          <fieldset><legend className="label mb-1">Percent complete per workstream</legend>
            {WORKSTREAMS.map((w) => (
              <label key={w.id} className="flex items-center gap-2 py-1"><span className="w-40">{w.label}</span><input type="range" min={0} max={100} step={5} value={pos.progress[w.id] ?? 0} onChange={(e) => save({ progress: { ...pos.progress, [w.id]: Number(e.target.value) } })} className="flex-1" aria-label={`${w.label} percent complete`} /><span className="mono w-10 text-right">{pos.progress[w.id] ?? 0}%</span></label>
            ))}
          </fieldset>
          <fieldset><legend className="label mb-1">Duration per phase (weeks)</legend>
            <div className="grid grid-cols-2 gap-2">{placed.map((p) => (
              <label key={p.id} className="flex items-center gap-2"><span className="flex-1 truncate">{p.id}. {p.name}</span><input type="number" min={1} max={52} className="input w-16 py-1 text-right" value={p.length} onChange={(e) => save({ weeks: { ...pos.weeks, [p.id]: Math.max(1, Math.min(52, Number(e.target.value) || 1)) } })} aria-label={`${p.name} duration in weeks`} /></label>
            ))}</div>
          </fieldset>
          <button className="btn" onClick={() => { patch((e) => ({ ...e, roadmap: undefined })); setHighlight([]); toast('Roadmap position reset to the pack default'); }}><Icon name="reset" size={13} />Reset to pack default</button>
        </div>
      </Drawer>
    </div>
  );
}
