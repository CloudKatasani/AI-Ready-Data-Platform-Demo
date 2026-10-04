import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CodeBlock, layerColor, PageHeader, Tabs } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useDb, useExt, useLive, usePack, usePackPath } from '../../app/context';
import { toast } from '../../app/toast';
import { Popover } from '../../app/TopBar';
import { GUIDE_LAYERS, runbookMarkdown, sqlScript, stepById, stepIndex, STEPS, stepsForLayer, type BuildCtx, type GuideLayer } from '../../ext/buildGuide';
import { DEFAULT_TOOLING, type Tooling } from '../../ext/state';
import { ROLE_LABEL } from '../../ext/raci';

const TOOLING_OPTIONS: { key: keyof Tooling; label: string; options: { v: string; label: string }[] }[] = [
  { key: 'ingestion', label: 'Ingestion', options: [{ v: 'goldengate', label: 'GoldenGate CDC' }, { v: 'snowpipe', label: 'Snowpipe Streaming' }, { v: 'openflow', label: 'Openflow' }, { v: 'fivetran', label: 'Fivetran' }] },
  { key: 'transformation', label: 'Transformation', options: [{ v: 'dbt', label: 'dbt' }, { v: 'dynamic', label: 'Dynamic Tables only' }, { v: 'snowpark', label: 'Snowpark Python' }] },
  { key: 'orchestration', label: 'Orchestration', options: [{ v: 'autosys', label: 'AutoSys' }, { v: 'tasks', label: 'Snowflake Tasks' }, { v: 'airflow', label: 'Airflow' }] },
  { key: 'format', label: 'Table format', options: [{ v: 'iceberg', label: 'Apache Iceberg' }, { v: 'native', label: 'Native Snowflake tables' }] },
];

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`, 'good');
  } catch {
    toast('Clipboard not available in this browser', 'warn');
  }
}

export default function BuildGuide() {
  const { layer, step } = useParams();
  const path = usePackPath();
  const s = step ? stepById(step) : undefined;
  if (!s || s.layer !== layer) {
    const first = layer ? stepsForLayer(layer as GuideLayer)[0] : STEPS[0];
    return <Navigate to={path(`build/${(first ?? STEPS[0]).layer}/${(first ?? STEPS[0]).id}`)} replace />;
  }
  return <Guide stepId={s.id} />;
}

function Guide({ stepId }: { stepId: string }) {
  const pack = usePack();
  const db = useDb();
  const live = useLive();
  const path = usePackPath();
  const navigate = useNavigate();
  const [ext, patch] = useExt();
  const step = stepById(stepId)!;
  const idx = stepIndex(stepId);
  const ctx: BuildCtx = useMemo(() => ({ pack, db, tooling: ext.tooling, live }), [pack, db, ext.tooling, live]);
  const artifacts = useMemo(() => step.artifacts(ctx), [step, ctx]);
  const creates = useMemo(() => step.creates(ctx), [step, ctx]);
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({ [step.layer]: true });
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setTab(0);
    setOpen((o) => ({ ...o, [step.layer]: true }));
    // Scroll the rail to the current step (deep links open at that step).
    setTimeout(() => railRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' }), 0);
  }, [stepId, step.layer]);
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];
  const changedByTooling = step.tooling ? ext.tooling[step.tooling] !== DEFAULT_TOOLING[step.tooling] : false;

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="How it's built"
        layer={step.layer === 'setup' ? ['gov'] : step.layer}
        sub={`The exact artifacts that create each layer of ${pack.database}, in build order. Generated from the pack catalog, so every name matches the Explorer.`}
        right={(
          <div className="flex flex-wrap gap-2">
            <Popover label="Client tooling" align="right" trigger={() => <span className="btn"><Icon name="gear" size={13} />Client tooling</span>}>
              {() => (
                <div className="w-[300px] space-y-3 p-2">
                  {TOOLING_OPTIONS.map((t) => (
                    <label key={t.key} className="block text-sm"><span className="label">{t.label}</span>
                      <select className="input mt-1" value={ext.tooling[t.key]} onChange={(e) => patch((x) => ({ ...x, tooling: { ...x.tooling, [t.key]: e.target.value } }))}>
                        {t.options.map((o) => <option key={o.v} value={o.v}>{o.label}{o.v === DEFAULT_TOOLING[t.key] ? ' (default)' : ''}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </Popover>
            <button className="btn" onClick={() => copy(runbookMarkdown(ctx, step.layer), 'Layer runbook')}><Icon name="copy" size={13} />Copy layer runbook</button>
            <button className="btn" onClick={() => copy(runbookMarkdown(ctx), 'Full runbook')}><Icon name="doc" size={13} />Copy as runbook</button>
            <button className="btn" onClick={() => copy(sqlScript(ctx), 'SQL script')}><Icon name="database" size={13} />Copy SQL only</button>
          </div>
        )}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] min-[1280px]:grid-cols-[260px_minmax(0,1fr)_280px]">
        <nav ref={railRef} aria-label="Build steps" className="panel max-h-72 overflow-y-auto p-2 scroll-thin lg:max-h-[calc(100vh-220px)]">
          <ol>
            {GUIDE_LAYERS.map((l) => {
              const steps = stepsForLayer(l.id);
              const doneN = steps.filter((s) => stepIndex(s.id) < idx).length;
              const isOpen = open[l.id];
              return (
                <li key={l.id}>
                  <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface2" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [l.id]: !isOpen }))}>
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: l.id === 'setup' ? 'rgb(var(--muted))' : layerColor(l.id) }} />
                    <span className="flex-1 font-medium">{l.n}. {l.label}</span>
                    <span className="text-[11px] text-muted">{doneN}/{steps.length}</span>
                    <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} className="text-muted" />
                  </button>
                  {isOpen && (
                    <ol className="mb-1 ml-5 border-l border-line pl-1">
                      {steps.map((s) => {
                        const cur = s.id === stepId;
                        const done = stepIndex(s.id) < idx;
                        return (
                          <li key={s.id}>
                            <Link to={path(`build/${s.layer}/${s.id}`)} aria-current={cur ? 'step' : undefined} className={cls('flex items-center gap-1.5 rounded px-2 py-1 text-xs', cur ? 'bg-accent/10 font-semibold' : 'hover:bg-surface2')}>
                              <Icon name={done ? 'pass' : cur ? 'arrowRight' : 'pending'} size={12} className={done ? 'text-good' : 'text-muted'} />
                              <span className="flex-1">{s.title}</span>
                              <span className="rounded bg-surface2 px-1 text-[10px]">{s.effort}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="panel min-w-0 p-4" aria-label={step.title}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">{GUIDE_LAYERS.find((l) => l.id === step.layer)!.n}. {GUIDE_LAYERS.find((l) => l.id === step.layer)!.label}</span>
            <span className="chip border-line">Effort {step.effort}</span>
            {step.preview && <span className="chip border-warn/50 bg-warn/10 text-warn"><Icon name="sparkle" size={11} />Preview feature: {step.preview}</span>}
            {changedByTooling && <span className="chip border-accent/50 bg-accent/10 text-accent">Adjusted for client tooling</span>}
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold">{step.title}</h2>
          <p className="mt-1 max-w-3xl text-sm">{step.why}</p>
          {artifacts.length > 1 && <div className="mt-3"><Tabs label="Artifacts" value={String(tab)} onChange={(t) => setTab(Number(t))} tabs={artifacts.map((a, i) => ({ id: String(i), label: a.label }))} /></div>}
          {artifacts[tab] && (
            <div className="mt-3">
              {artifacts.length === 1 && <div className="label mb-1">{artifacts[0].label}</div>}
              <CodeBlock code={artifacts[tab].code} lang={artifacts[tab].lang === 'yaml' ? 'yaml' : 'sql'} maxH="max-h-[52vh]" />
            </div>
          )}
          <div className="mt-4 rounded-md border border-line p-3">
            <div className="label mb-1">Result</div>
            {creates.length ? (
              <div className="flex flex-wrap gap-1.5">
                {creates.map((o) => <Link key={o} to={path(`explorer/${o.replace('.', '/')}`)} className="chip border-line font-mono hover:border-accent"><Icon name="database" size={11} />{o}</Link>)}
              </div>
            ) : <p className="text-sm text-muted">Configuration only: this step creates no catalog object shown in the Explorer.</p>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <button className="btn" disabled={!prev} onClick={() => prev && navigate(path(`build/${prev.layer}/${prev.id}`))}><Icon name="arrowRight" size={13} className="rotate-180" />Previous</button>
            <div className="min-w-[160px] flex-1">
              <div className="text-xs text-muted">Step {idx + 1} of {STEPS.length}</div>
              <div className="mt-1 h-1.5 rounded-full bg-surface2"><div className="h-full rounded-full bg-accent" style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} /></div>
            </div>
            <button className="btn-primary" disabled={!next} onClick={() => next && navigate(path(`build/${next.layer}/${next.id}`))}>Next<Icon name="arrowRight" size={13} /></button>
          </div>
        </section>

        <aside className="panel space-y-4 p-4 text-sm lg:col-span-2 min-[1280px]:col-span-1" aria-label="Step context">
          <div><div className="label mb-1">Snowflake features</div><div className="flex flex-wrap gap-1">{step.features.map((f) => <span key={f} className="chip border-line bg-surface2">{f}</span>)}</div></div>
          <div><div className="label mb-1">Roles involved</div><div className="flex flex-wrap gap-1">{step.roles.map((r) => <Link key={r} to={path(`operating-model?role=${r}`)} className="chip border-line hover:border-accent">{ROLE_LABEL[r]}</Link>)}</div></div>
          <div><div className="label mb-1">Prerequisites</div>{step.prereqs.length ? <ul className="space-y-1">{step.prereqs.map((p) => { const ps = stepById(p)!; return <li key={p}><Link className="link" to={path(`build/${ps.layer}/${ps.id}`)}>{ps.title}</Link></li>; })}</ul> : <p className="text-muted">None — start here.</p>}</div>
          <div><div className="label mb-1">Common pitfalls</div><ul className="list-disc space-y-1 pl-5">{step.pitfalls.map((p) => <li key={p}>{p}</li>)}</ul></div>
        </aside>
      </div>
    </div>
  );
}
