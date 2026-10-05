import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, Stat, Tabs } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, usePack, usePackPath } from '../../app/context';
import { toast } from '../../app/toast';
import { bandOf, DEFAULT_TARGET, DEMO_COMPANY_ANSWERS, DIMENSIONS, dimScore, overallScore, PRESETS, QUESTIONS, questionText, rankGaps, type ReadinessDim } from '../../ext/readiness';
import { phaseForDim } from '../../ext/roadmap';
import { stepById } from '../../ext/buildGuide';
import { useCoverage } from '../../ext/hooks';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied as Markdown`, 'good');
  } catch {
    toast('Clipboard not available in this browser', 'warn');
  }
}

/** Use-case → readiness dims it needs (by agent scenario coverage pattern). */
const PATTERN_DIMS: Record<number, ReadinessDim[]> = {
  1: ['semantics'], 2: ['vocabulary', 'context'], 3: ['governance'], 4: ['governance'], 5: ['foundation', 'semantics'], 6: ['context', 'semantics'],
  7: ['modelling', 'semantics'], 8: ['governance'], 9: ['modelling'], 10: ['semantics', 'vocabulary'], 11: ['semantics'], 12: ['vocabulary'],
  13: ['vocabulary', 'governance'], 14: ['vocabulary'], 15: ['governance'],
};

export function Radar({ series, size = 320 }: { series: { label: string; values: number[]; color: string; dashed?: boolean }[]; size?: number }) {
  const n = DIMENSIONS.length;
  const c = size / 2;
  const r = size / 2 - 56;
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rr = (Math.max(0, v - 0) / 5) * r;
    return [c + rr * Math.cos(a), c + rr * Math.sin(a)] as const;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[380px]" role="img" aria-label={`Radar: ${series.map((s) => `${s.label} ${s.values.map((v, i) => `${DIMENSIONS[i].label} ${v.toFixed(1)}`).join(', ')}`).join('; ')}`}>
      {[1, 2, 3, 4, 5].map((lvl) => (
        <polygon key={lvl} points={DIMENSIONS.map((_, i) => pt(i, lvl).join(',')).join(' ')} fill="none" stroke="rgb(var(--line))" strokeWidth={1} />
      ))}
      {DIMENSIONS.map((d, i) => {
        const [x, y] = pt(i, 5);
        const [lx, ly] = pt(i, 6.1);
        return (
          <g key={d.id}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="rgb(var(--line))" />
            <text x={lx} y={ly} fontSize={10.5} textAnchor={Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end'} dominantBaseline="middle" fill="rgb(var(--muted))">{d.label}</text>
          </g>
        );
      })}
      {series.map((s) => (
        <polygon key={s.label} points={s.values.map((v, i) => pt(i, v).join(',')).join(' ')} fill={s.dashed ? 'none' : s.color} fillOpacity={s.dashed ? 0 : 0.18} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} />
      ))}
    </svg>
  );
}

export default function Readiness() {
  const { mode } = useParams();
  const [ext] = useExt();
  const path = usePackPath();
  const answered = Object.keys(ext.readiness.answers).length;
  if (mode !== 'assess' && mode !== 'results') return <Navigate to={path(answered >= QUESTIONS.length ? 'readiness/results' : 'readiness/assess')} replace />;
  return <ReadinessInner mode={mode} />;
}

function ReadinessInner({ mode }: { mode: 'assess' | 'results' }) {
  const pack = usePack();
  const navigate = useNavigate();
  const path = usePackPath();
  const [ext, patch] = useExt();
  const answers = ext.readiness.answers;
  const wording = pack.ext?.readinessPreset.wording;
  const preset = pack.ext?.readinessPreset.defaultProfile ?? 'mid';
  const done = Object.keys(answers).length;
  const overall = overallScore(answers);

  const setAnswer = (id: string, v: number) => patch((e) => ({ ...e, readiness: { ...e.readiness, answers: { ...e.readiness.answers, [id]: v } } }));
  const loadPreset = (id: (typeof PRESETS)[number]['id']) => {
    const p = PRESETS.find((x) => x.id === id)!;
    patch((e) => ({ ...e, readiness: { ...e.readiness, answers: { ...p.answers }, profile: id } }));
    toast(`Loaded example profile: ${p.label}`);
  };

  return (
    <div className="mx-auto max-w-[1300px] p-4 sm:p-6">
      <PageHeader
        title="AI-readiness assessment"
        layer={['glossary', 'semantic', 'context', 'gov']}
        sub={`Score ${pack.profile.company}'s client (or your own organisation) on seven dimensions and see the gaps mapped to what an AI-ready platform needs.`}
        right={<div className="text-right text-sm"><div className="label">Overall</div><div className="font-display text-xl font-semibold">{overall !== undefined ? `${overall.toFixed(1)} · ${bandOf(overall)}` : 'Not assessed'}</div></div>}
      />
      <Tabs label="Readiness" value={mode} onChange={(t) => navigate(path(`readiness/${t}`))} tabs={[{ id: 'assess', label: 'Assess', count: done }, { id: 'results', label: 'Results' }]} />
      <div className="mt-4">
        {mode === 'assess'
          ? <Assess answers={answers} setAnswer={setAnswer} loadPreset={loadPreset} defaultPreset={preset} wording={wording} onFinish={() => navigate(path('readiness/results'))} />
          : <Results />}
      </div>
    </div>
  );
}

function Assess({ answers, setAnswer, loadPreset, defaultPreset, wording, onFinish }: { answers: Record<string, number>; setAnswer: (id: string, v: number) => void; loadPreset: (id: 'early' | 'mid' | 'advanced') => void; defaultPreset: string; wording?: Record<string, string>; onFinish: () => void }) {
  const [dimIdx, setDimIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const dim = DIMENSIONS[dimIdx];
  const qs = QUESTIONS.filter((q) => q.dim === dim.id);
  const q = qs[qIdx];
  const total = QUESTIONS.length;
  const done = Object.keys(answers).length;
  const flat = QUESTIONS.findIndex((x) => x.id === q.id);
  const go = (delta: number) => {
    const next = Math.max(0, Math.min(total - 1, flat + delta));
    const nq = QUESTIONS[next];
    setDimIdx(DIMENSIONS.findIndex((d) => d.id === nq.dim));
    setQIdx(QUESTIONS.filter((x) => x.dim === nq.dim).findIndex((x) => x.id === nq.id));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        setAnswer(q.id, Number(e.key));
        if (flat < total - 1) setTimeout(() => go(1), 150);
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id, flat]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="panel p-3">
          <div className="label mb-2">Load example profile</div>
          <div className="space-y-1.5">
            {PRESETS.map((p) => (
              <button key={p.id} className="btn w-full justify-between" onClick={() => loadPreset(p.id)}>
                {p.label}{p.id === defaultPreset && <span className="text-[10px] uppercase tracking-wide text-muted">default</span>}
              </button>
            ))}
          </div>
        </div>
        <nav aria-label="Dimensions" className="panel p-2">
          {DIMENSIONS.map((d, i) => {
            const n = QUESTIONS.filter((x) => x.dim === d.id && answers[x.id]).length;
            return (
              <button key={d.id} onClick={() => { setDimIdx(i); setQIdx(0); }} aria-current={i === dimIdx ? 'step' : undefined} className={cls('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm', i === dimIdx ? 'bg-surface2 font-semibold' : 'hover:bg-surface2/60')}>
                <span className={cls('grid h-5 w-5 place-items-center rounded-full text-[10px]', n === 3 ? 'bg-good text-white' : 'bg-surface2')}>{n === 3 ? <Icon name="check" size={11} /> : i + 1}</span>
                {d.label}<span className="ml-auto text-xs text-muted">{n}/3</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <section className="panel p-5 sm:p-8" aria-label="Question">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-surface2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Questions answered">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span className="text-xs text-muted">{done} of {total}</span>
        </div>
        <div className="label">{dim.label} · question {qIdx + 1} of 3</div>
        <h2 className="mt-2 font-display text-[22px] font-semibold leading-snug sm:text-[26px]">{questionText(q, wording)}</h2>
        <div role="radiogroup" aria-label="Maturity level" className="mt-5 grid gap-2">
          {q.levels.map((lvl, i) => {
            const v = i + 1;
            const on = answers[q.id] === v;
            return (
              <button key={v} role="radio" aria-checked={on} onClick={() => setAnswer(q.id, v)} className={cls('flex items-center gap-3 rounded-lg border p-3 text-left text-base', on ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/60')}>
                <span className={cls('grid h-8 w-8 shrink-0 place-items-center rounded-full font-semibold', on ? 'bg-accent text-white' : 'bg-surface2')}>{v}</span>
                {lvl}
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button className="btn" onClick={() => go(-1)} disabled={flat === 0}><Icon name="arrowRight" size={13} className="rotate-180" />Previous</button>
          <button className="btn" onClick={() => go(1)} disabled={flat === total - 1}>Next<Icon name="arrowRight" size={13} /></button>
          <span className="text-xs text-muted">Keyboard: 1–5 to answer, arrows to move</span>
          <button className="btn-primary ml-auto" onClick={onFinish} disabled={done < total}>See results</button>
        </div>
      </section>
    </div>
  );
}

function Results() {
  const pack = usePack();
  const path = usePackPath();
  const [ext, patch] = useExt();
  const [overlay, setOverlay] = useState(false);
  const answers = ext.readiness.answers;
  const targets = ext.readiness.targets;
  const overall = overallScore(answers);
  const gaps = useMemo(() => rankGaps(answers, targets), [answers, targets]);
  const scoreOf = (d: ReadinessDim) => dimScore(d, answers) ?? 1;
  const cov = useCoverage();
  if (Object.keys(answers).length < QUESTIONS.length) {
    return <div className="panel p-6 text-sm">Answer all {QUESTIONS.length} questions (or load an example profile) to see results. <Link className="link" to={path('readiness/assess')}>Go to the assessment</Link></div>;
  }
  const useCases = pack.scenarios.filter((s) => s.agentId !== 'AG-04').map((s) => {
    const dims = PATTERN_DIMS[s.pattern] ?? ['semantics'];
    const blocking = dims.filter((d) => scoreOf(d) < 3);
    return { s, blocking };
  });
  const summary = `# ${pack.profile.company} — AI-readiness summary

Overall score **${overall!.toFixed(1)}** (${bandOf(overall!)}).

| Dimension | Score | Target |
| --- | --- | --- |
${DIMENSIONS.map((d) => `| ${d.label} | ${scoreOf(d.id).toFixed(1)} | ${(targets[d.id] ?? DEFAULT_TARGET).toFixed(1)} |`).join('\n')}

## Top gaps
${gaps.slice(0, 5).map((g, i) => `${i + 1}. **${g.label}** ${g.score.toFixed(1)} → ${g.target.toFixed(1)}: ${g.actions.join('; ')}. Closed in phase ${phaseForDim(g.dim).id} (${phaseForDim(g.dim).name}).`).join('\n')}

## Recommended phases
${[...new Set(gaps.slice(0, 5).map((g) => phaseForDim(g.dim).id))].sort().map((id) => `- Phase ${id}: ${phaseForDim(gaps.find((g) => phaseForDim(g.dim).id === id)!.dim).name}`).join('\n')}
`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Overall" value={overall!.toFixed(1)} sub={bandOf(overall!)} />
        <Stat label="Largest gap" value={gaps[0]?.label ?? 'None'} sub={gaps[0] ? `${gaps[0].score.toFixed(1)} → ${gaps[0].target.toFixed(1)}` : 'All targets met'} />
        <Stat label="Use cases ready today" value={useCases.filter((u) => !u.blocking.length).length} sub={`of ${useCases.length} in the agent question bank`} />
        <Stat label="Start phase" value={gaps[0] ? phaseForDim(gaps[0].dim).name : 'Scale'} sub="from the largest gap" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="panel p-4" aria-label="Radar">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-accent/60" />Current</span>
            <span className="inline-flex items-center gap-1"><span className="h-0 w-4 border-t-2 border-dashed border-good" />Target</span>
            {overlay && <span className="inline-flex items-center gap-1"><span className="h-0 w-4 border-t-2 border-dashed border-seal" />{pack.profile.company} (demo)</span>}
            <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />Overlay demo company</label>
          </div>
          <Radar series={[
            { label: 'Current', values: DIMENSIONS.map((d) => scoreOf(d.id)), color: 'rgb(var(--accent))' },
            { label: 'Target', values: DIMENSIONS.map((d) => targets[d.id] ?? DEFAULT_TARGET), color: 'rgb(var(--good))', dashed: true },
            ...(overlay ? [{ label: pack.profile.company, values: DIMENSIONS.map((d) => dimScore(d.id, DEMO_COMPANY_ANSWERS) ?? 5), color: 'rgb(var(--seal))', dashed: true }] : []),
          ]} />
          <div tabIndex={0} role="region" aria-label="Scores and targets" className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1">Dimension</th><th className="py-1 text-right">Score</th><th className="py-1 text-right">Target</th></tr></thead>
              <tbody>{DIMENSIONS.map((d) => (
                <tr key={d.id} className="border-t border-line/70">
                  <td className="py-1">{d.label}{d.weight > 1 && <span className="ml-1 text-[10px] text-muted">×{d.weight}</span>}
                    {d.id === 'foundation' && cov.length > 0 && <Link to={path('coverage')} className="block text-[11px] text-accent hover:underline">Evidence: {cov.filter((r) => r.levelNow >= 1).length} of {cov.length} source tables landed, {cov.filter((r) => r.levelNow >= 2).length} curated</Link>}</td>
                  <td className="mono py-1 text-right">{scoreOf(d.id).toFixed(1)}</td>
                  <td className="py-1 text-right"><input aria-label={`Target for ${d.label}`} type="number" min={1} max={5} step={0.5} className="input w-16 py-0.5 text-right" value={targets[d.id] ?? DEFAULT_TARGET} onChange={(e) => patch((x) => ({ ...x, readiness: { ...x.readiness, targets: { ...x.readiness.targets, [d.id]: Math.max(1, Math.min(5, Number(e.target.value) || DEFAULT_TARGET)) } } }))} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
        <section className="panel p-4" aria-label="Top gaps">
          <div className="mb-2 flex items-center gap-2"><h2 className="text-sm font-semibold">Top gaps</h2><button className="btn ml-auto" onClick={() => copy(summary, 'Readiness summary')}><Icon name="copy" size={13} />Copy summary</button></div>
          {gaps.length === 0 && <p className="text-sm text-muted">Every dimension meets its target.</p>}
          <ol className="space-y-2">
            {gaps.map((g, i) => {
              const ph = phaseForDim(g.dim);
              return (
                <li key={g.dim} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-surface2 text-xs font-semibold">{i + 1}</span><span className="font-semibold">{g.label}</span><span className="mono text-xs text-muted">{g.score.toFixed(1)} → {g.target.toFixed(1)} · gap {g.gap.toFixed(1)}</span></div>
                  <ul className="mt-1.5 list-disc pl-5 text-sm">{g.actions.map((a) => <li key={a}>{a}</li>)}</ul>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <Link className="chip border-accent/40 bg-accent/5 text-accent hover:underline" to={path(`roadmap?phase=${ph.id}`)}><Icon name="route" size={11} />Phase {ph.id}: {ph.name}</Link>
                    {ph.buildStepIds.slice(0, 2).map((sid) => { const st = stepById(sid)!; return <Link key={sid} className="chip border-line hover:border-accent" to={path(`build/${st.layer}/${st.id}`)}><Icon name="hammer" size={11} />{st.title}</Link>; })}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      <section className="panel p-4" aria-label="What you can do today">
        <h2 className="mb-2 text-sm font-semibold">What you can do today</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[{ title: 'Supported at your current maturity', items: useCases.filter((u) => !u.blocking.length), ok: true }, { title: 'Blocked by gaps', items: useCases.filter((u) => u.blocking.length), ok: false }].map((col) => (
            <div key={col.title}>
              <div className={cls('label mb-1', col.ok ? 'text-good' : 'text-bad')}>{col.title} ({col.items.length})</div>
              <ul className="space-y-1 text-sm">
                {col.items.map(({ s, blocking }) => (
                  <li key={s.id} className="flex gap-1.5"><Icon name={col.ok ? 'pass' : 'lock'} size={14} className={cls('mt-0.5 shrink-0', col.ok ? 'text-good' : 'text-muted')} /><span>{s.question}{blocking.length > 0 && <span className="text-xs text-muted"> — needs {blocking.map((b) => DIMENSIONS.find((d) => d.id === b)!.label).join(', ')}</span>}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
