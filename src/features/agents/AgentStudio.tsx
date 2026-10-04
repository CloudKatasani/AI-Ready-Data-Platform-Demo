import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { create } from 'zustand';
import type { AccessCode, Agent, AgentAnswer, IndustryPack, LayerId, ScenarioContext, TraceStep } from '../../types';
import { AccessChip, BarChart, CertifiedSeal, CodeBlock, Drawer, layerColor, LineChart, PageHeader, SimpleTable, StatusChip } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { LAYER_BY_ID } from '../../layers';
import { useAccess, useExt, useLive, usePack, usePackPath, usePersona } from '../../app/context';
import { runKnockout, SEVERITY_LABEL, type KnockoutRun } from '../../ext/knockout';
import { ALL_ON, SWITCHES } from '../../ext/types';
import { ConfidenceBadge, SwitchRow } from '../why/parts';
import { respond } from '../../agents/engine/respond';
import { useStore } from '../../store';
import { toast } from '../../app/toast';

// ---------------------------------------------------------------------------------------------------------------
// Chat state lives outside the component so a conversation survives a detour to another tab. It is keyed by
// pack + agent, never persisted, and every message carries its own answer, so rendering never depends on
// anything outside the message itself.

interface Msg { id: string; role: 'user' | 'agent'; text: string; answer?: AgentAnswer; error?: string; persona: string; sim?: { run: KnockoutRun; off: string[] } }

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

const useChats = create<{ chats: Record<string, Msg[]>; push: (k: string, ...m: Msg[]) => void; clear: (k: string) => void }>((set, get) => ({
  chats: {},
  push: (k, ...m) => set({ chats: { ...get().chats, [k]: [...(get().chats[k] ?? []), ...m] } }),
  clear: (k) => set({ chats: { ...get().chats, [k]: [] } }),
}));

const EMPTY: Msg[] = [];

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const layerLabel = (id: LayerId) => LAYER_BY_ID[id]?.label ?? id;

/** Contains a failure to one message or panel instead of the whole tab. */
class Contain extends Component<{ children: ReactNode; what: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error(`[Agent Studio] ${this.props.what} failed to render:`, e);
  }
  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-xs">
        <span className="font-semibold">The {this.props.what} could not be shown.</span> <span className="mono">{this.state.error}</span>
      </div>
    );
  }
}

/** Re-answer a knockout question with the Studio's layer switches (simulation affects only this chat). */
function simulate(pack: IndustryPack, answer: AgentAnswer, switches: typeof ALL_ON, ctx: ScenarioContext): { answer: AgentAnswer; sim: Msg['sim'] } | undefined {
  const ks = pack.ext?.knockoutScenarios.find((k) => k.scenarioId === answer.scenarioId);
  const off = SWITCHES.filter((x) => !switches[x.id]);
  if (!ks || !off.length || answer.kind !== 'answer') return undefined;
  const run = runKnockout(pack, ks, switches, ctx);
  const r = run.result;
  const trace: TraceStep[] = run.trace.map((st, i) => ({ title: st.skipped ? `${st.title} (skipped)` : st.title, layer: st.layer, detail: st.note, ms: st.skipped ? 0 : answer.trace[i]?.ms ?? 120, refs: st.skipped ? [] : answer.trace[i]?.refs ?? [] }));
  return {
    answer: {
      ...answer,
      summary: `${r.valueText} — ${r.caption}${r.notes.length ? `\n${r.notes.join(' ')}` : ''}`,
      table: r.table ? { columns: r.table.columns, rows: r.table.rows, masked: r.table.masked } : undefined,
      chart: undefined,
      sql: r.sql,
      sources: r.sources,
      banner: undefined,
      trace,
    },
    sim: { run, off: off.map((x) => x.label) },
  };
}

// ---------------------------------------------------------------------------------------------------------------

export default function AgentStudio() {
  const { agent } = useParams();
  const pack = usePack();
  const access = useAccess();
  const path = usePackPath();
  const [sp] = useSearchParams();
  const visible = pack.agents.filter((x) => access(x.id) !== '-');
  const a = visible.find((x) => x.id === agent);
  if (!a) {
    const preferred = [pack.agents.find((x) => x.id === pack.signature.agentId), ...visible].filter((x): x is Agent => Boolean(x));
    const pick = preferred.find((x) => access(x.id) === 'G') ?? visible[0] ?? pack.agents[0];
    const q = sp.toString();
    return <Navigate to={path(`agents/${pick.id}${q ? `?${q}` : ''}`)} replace />;
  }
  // Keyed so every agent (and every pack) starts with fresh local state.
  return <Studio key={`${pack.profile.id}:${a.id}`} a={a} />;
}

// ---------------------------------------------------------------------------------------------------------------

function refHref(path: (p: string) => string, r: TraceStep['refs'][number]): string {
  switch (r.kind) {
    case 'term': return path(`glossary/${r.id}`);
    case 'rule': return path(`context/rules?rule=${encodeURIComponent(r.id)}`);
    case 'view': return path(`semantic/${r.id}`);
    case 'metric': return path(`semantic/${r.id.split('.')[0]}`);
    case 'doc': return path('context/search');
    case 'object': return path(`explorer/${r.id.replace('.', '/')}`);
    default: return path(`explorer/GOVERNANCE/${r.id}`);
  }
}

function TraceTimeline({ steps, revealed }: { steps: TraceStep[]; revealed: number }) {
  const path = usePackPath();
  const [closed, setClosed] = useState<Record<number, boolean>>({});
  if (!steps.length) return <p className="text-sm text-muted">Ask a question to see which layer contributed what.</p>;
  return (
    <ol className="space-y-2" aria-label="How I answered">
      {steps.map((s, i) => {
        if (i >= revealed) return null;
        const open = !closed[i];
        return (
          <li key={i}>
            <div className="rounded-md border border-line" style={{ borderLeft: `4px solid ${layerColor(s.layer)}` }}>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setClosed((c) => ({ ...c, [i]: open }))} aria-expanded={open}>
                <span className="text-sm font-semibold">{s.title}</span>
                <span className="chip border-transparent text-[11px]" style={{ background: layerColor(s.layer, 0.14) }}>{layerLabel(s.layer)}</span>
                <span className="mono ml-auto text-[11px] text-muted">{s.ms} ms</span>
              </button>
              {open && (
                <div className="px-3 pb-2.5">
                  <p className="text-xs leading-5">{s.detail}</p>
                  {(s.refs ?? []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.refs.map((r) => <Link key={`${r.kind}:${r.id}`} to={refHref(path, r)} className="chip border-line text-[11px] hover:border-accent">{r.label ?? r.id}</Link>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
      {revealed < steps.length && <li className="typing px-1 text-xs text-muted" aria-hidden><span>●</span><span>●</span><span>●</span></li>}
    </ol>
  );
}

function Sources({ pack, a }: { pack: IndustryPack; a: AgentAnswer }) {
  if (a.kind !== 'answer') return null;
  if (!a.sources.length) return <span className="chip border-line text-muted"><Icon name="layers" size={11} />Governed metadata</span>;
  return (
    <>
      {a.sources.map((s) => {
        const p = pack.products.find((x) => x.id === s.productId);
        const name = p?.name ?? s.productId;
        return s.certified
          ? <span key={s.productId} className="inline-flex items-center gap-1.5 text-xs"><CertifiedSeal version={s.version} /><span className="text-muted">Certified source: {name}</span></span>
          : <span key={s.productId} className="inline-flex items-center gap-1.5 text-xs"><StatusChip status={p?.status ?? 'Draft'} label={`${name} v${s.version}`} /></span>;
      })}
    </>
  );
}

function AnswerView({ m, onAsk, animate, onSwitch, access }: { m: Msg; onAsk: (q: string) => void; animate: boolean; onSwitch: (id: string) => void; access: (id: string) => AccessCode }) {
  const pack = usePack();
  const path = usePackPath();
  const navigate = useNavigate();
  const persona = usePersona();
  const requestAccess = useStore((s) => s.requestAccess);
  const [sql, setSql] = useState(false);
  const a = m.answer!;
  const summary = a.summary ?? '';
  const [shown, setShown] = useState(animate && !prefersReducedMotion() ? 0 : summary.length);
  useEffect(() => {
    if (shown >= summary.length) return;
    // Typewriter: ~40 characters per 100 ms frame.
    const h = window.setTimeout(() => setShown((n) => Math.min(summary.length, n + 40)), 100);
    return () => window.clearTimeout(h);
  }, [shown, summary.length]);
  const done = shown >= summary.length;
  const req = a.requestAssetId;
  const reqState = req ? access(req) : undefined;
  const chart = a.chart && a.chart.labels.length === a.chart.values.length && a.chart.values.length > 0 ? a.chart : undefined;
  const ks = pack.ext?.knockoutScenarios.find((k) => k.scenarioId === a.scenarioId);
  return (
    <div className="space-y-3">
      {m.sim && (
        <div className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Icon name="power" size={15} className="text-warn" /><strong>Simulated with layers off:</strong> {m.sim.off.join(', ')}<ConfidenceBadge c={m.sim.run.confidence} /></div>
          {m.sim.run.failures.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{m.sim.run.failures.map((f) => <li key={f.layer}><span className="font-semibold">{SEVERITY_LABEL[f.severity]}:</span> {f.reason}</li>)}</ul>}
        </div>
      )}
      {a.banner === 'not-certified' && (
        <div className="flex items-start gap-2 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-ink">
          <Icon name="warn" size={16} className="mt-0.5 shrink-0 text-warn" />
          <span><strong>Not certified: use with caution.</strong> {(a.bannerText ?? '').replace('Not certified: use with caution. ', '')}</span>
        </div>
      )}
      {a.banner === 'no-access' && (
        <div className="flex items-start gap-2 rounded-md border border-line bg-surface2 px-3 py-2 text-sm">
          <Icon name="lock" size={16} className="mt-0.5 shrink-0 text-muted" />
          <span>No data was returned: access is checked before any query runs.</span>
        </div>
      )}
      <p className="whitespace-pre-line text-sm leading-6">{summary.slice(0, shown)}{!done && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />}</p>
      {done && (
        <>
          {chart && (chart.kind === 'line'
            ? <LineChart labels={chart.labels} values={chart.values} unit={chart.unit} />
            : <BarChart labels={chart.labels} values={chart.values} unit={chart.unit} decimals={chart.unit === 'interruptions' ? 3 : chart.values.every((v) => Number.isInteger(v)) ? 0 : 1} />)}
          {a.table && a.table.rows.length > 0 && <SimpleTable columns={a.table.columns} rows={a.table.rows} masked={a.table.masked} />}
          {a.suggestions && a.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {a.suggestions.map((s) => <button key={s} className="chip border-accent/40 bg-accent/5 py-1 text-accent hover:bg-accent/10" onClick={() => onAsk(s)}>{s}</button>)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Sources pack={pack} a={a} />
            {a.sql && <button className="btn-ghost text-xs" onClick={() => setSql(!sql)}><Icon name="table" size={13} />{sql ? 'Hide SQL' : 'Show SQL'}</button>}
            {ks?.raw && <button className="btn-ghost text-xs" onClick={() => navigate(path(`why/compare?q=${ks.id}`))}><Icon name="scale" size={13} />Compare with raw</button>}
            {a.explorerTarget && <button className="btn-ghost text-xs" onClick={() => navigate(path(`explorer/${a.explorerTarget!.replace('.', '/')}`))}><Icon name="external" size={13} />Open in Explorer</button>}
            {a.switchAgentId && <button className="btn text-xs" onClick={() => onSwitch(a.switchAgentId!)}><Icon name="bot" size={13} />Switch to {pack.agents.find((x) => x.id === a.switchAgentId)?.name ?? a.switchAgentId}</button>}
            {req && (reqState === 'P'
              ? <span className="chip border-warn/50 bg-warn/10 text-warn"><Icon name="pending" size={11} />Request pending</span>
              : reqState === 'G'
                ? <button className="chip border-good/40 bg-good/10 text-good" onClick={() => onAsk(m.text)}><Icon name="check" size={11} />Access granted — ask again</button>
                : <button className="btn-primary text-xs" onClick={() => { requestAccess(pack.profile.id, persona.roleId, req, `Requested from Agent Studio: "${m.text}"`, '90d'); toast(`Access to ${req} requested · waiting for the data steward`); }}><Icon name="key" size={13} />Request access</button>)}
          </div>
          {sql && a.sql && <CodeBlock code={a.sql} maxH="max-h-64" />}
        </>
      )}
    </div>
  );
}

function SettingsPanel({ a }: { a: Agent }) {
  const pack = usePack();
  const path = usePackPath();
  return (
    <div className="space-y-4 text-sm">
      <div><div className="label">Object</div><div className="mono break-all">{pack.database}.AGENTS.{a.objectName}</div></div>
      <div><div className="label mb-1">Tools bound</div><ul className="space-y-1">{a.tools.map((t) => <li key={t.kind + t.target} className="flex flex-wrap gap-2"><span className="chip border-line">{t.kind.replace('_', ' ')}</span><span className="mono break-all">{t.target}</span></li>)}</ul></div>
      <div><div className="label mb-1">Products used</div><div className="flex flex-wrap gap-1">{a.productIds.map((id) => <Link key={id} className="chip border-line hover:border-accent" to={path(`certify/${id}`)}>{id} {pack.products.find((p) => p.id === id)?.name}</Link>)}{!a.productIds.length && <span className="text-muted">Glossary, Governance, DP registry</span>}</div></div>
      <div><div className="label mb-1">Instructions</div><ul className="space-y-1.5">{pack.context.instructions.filter((i) => i.agentId === a.id).map((i) => <li key={i.id}><span className="chip mr-1 border-line">{i.type}</span>{i.text}</li>)}</ul><Link className="link mt-1 inline-block text-xs" to={path('context/instructions')}>Open in Context Layer</Link></div>
      <div><div className="label">Evaluation</div><div>{a.evalAccuracy}% on {a.evalQuestions} questions · eval set <span className="mono">{a.objectName.replace('AGT_', '').toLowerCase()}_golden_v3</span></div></div>
    </div>
  );
}

function AgentList({ current }: { current: Agent }) {
  const pack = usePack();
  const access = useAccess();
  const path = usePackPath();
  return (
    <nav aria-label="Agents" className="grid grid-cols-1 content-start gap-2 sm:grid-cols-2 lg:grid-cols-1 lg:overflow-y-auto">
      {pack.agents.filter((x) => access(x.id) !== '-').map((x) => {
        const code = access(x.id);
        return (
          <Link key={x.id} to={path(`agents/${x.id}`)} aria-current={x.id === current.id ? 'page' : undefined} className={cls('panel block p-3 hover:border-accent', x.id === current.id && 'border-[rgb(var(--layer-agent))] ring-1 ring-[rgb(var(--layer-agent))]')}>
            <div className="flex items-center gap-2"><Icon name="bot" size={15} /><span className="text-sm font-semibold">{x.name}</span></div>
            <div className="mt-1 flex flex-wrap items-center gap-1"><StatusChip status={x.status} /><span className="text-xs text-muted">{x.domain}</span></div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted"><span className="truncate">{x.productIds.join(', ') || 'Metadata'}</span>{code !== 'G' && <AccessChip code={code} />}</div>
          </Link>
        );
      })}
    </nav>
  );
}

function Studio({ a }: { a: Agent }) {
  const pack = usePack();
  const persona = usePersona();
  const live = useLive();
  const access = useAccess();
  const path = usePackPath();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const requestAccess = useStore((s) => s.requestAccess);
  const key = `${pack.profile.id}:${a.id}`;
  const msgs = useChats((s) => s.chats[key] ?? EMPTY);
  const push = useChats((s) => s.push);
  const clear = useChats((s) => s.clear);
  const starters = useMemo(() => pack.scenarios.filter((s) => s.agentId === a.id).map((s) => s.question), [pack, a.id]);
  const [input, setInput] = useState<string>(() => (a.id === pack.signature.agentId ? pack.signature.question : starters[0] ?? ''));
  const [animateId, setAnimateId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [settings, setSettings] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [ext, patchExt] = useExt();
  const simOn = ext.studioSim && SWITCHES.some((x) => !ext.studioSwitches[x.id]);
  const scroller = useRef<HTMLDivElement>(null);
  const code = access(a.id);
  const canChat = code === 'G';

  let lastAgent: Msg | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'agent') { lastAgent = msgs[i]; break; }
  const trace = lastAgent?.answer?.trace ?? [];

  const ask = (raw: string) => {
    const q = (raw ?? '').trim();
    if (!q || !canChat) return;
    const userMsg: Msg = { id: nextId(), role: 'user', text: q, persona: persona.roleId };
    const agentMsg: Msg = { id: nextId(), role: 'agent', text: q, persona: persona.roleId };
    try {
      agentMsg.answer = respond(pack, a.id, q, persona, live, (asset) => access(asset));
      if (simOn) {
        const sim = simulate(pack, agentMsg.answer, ext.studioSwitches, { persona, live });
        if (sim) { agentMsg.answer = sim.answer; agentMsg.sim = sim.sim; }
      }
    } catch (e) {
      agentMsg.error = e instanceof Error ? e.message : String(e);
      console.error('[Agent Studio] answer engine failed:', e);
    }
    push(key, userMsg, agentMsg);
    setAnimateId(agentMsg.id);
    setInput('');
  };

  // Deep link: #/<pack>/agents/<id>?q=... asks once, then clears the query.
  const deepQ = sp.get('q');
  const handledQ = useRef<string | null>(null);
  useEffect(() => {
    if (!deepQ) {
      handledQ.current = null;
      return;
    }
    if (!canChat || handledQ.current === deepQ) return;
    handledQ.current = deepQ;
    setSp({}, { replace: true });
    ask(deepQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepQ, canChat]);

  // Reveal the trace step by step for the newest answer (250–600 ms per step, faster overall than the answer).
  const lastId = lastAgent?.id;
  const lastLen = trace.length;
  useEffect(() => {
    if (!lastId) return setRevealed(0);
    if (lastId !== animateId || prefersReducedMotion()) return setRevealed(lastLen);
    setRevealed(0);
    const handles: number[] = [];
    let t = 0;
    for (let i = 0; i < lastLen; i++) {
      t += 0.55 * Math.min(600, Math.max(250, trace[i]?.ms ?? 300));
      handles.push(window.setTimeout(() => setRevealed(i + 1), t));
    }
    return () => handles.forEach((h) => window.clearTimeout(h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, lastLen, animateId]);

  // Keep the newest message in view (scrolls only the chat panel, never the page).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-4 sm:px-6"><PageHeader title="Agent Studio" layer="agent" sub={`Ask a ${pack.profile.company} agent and watch how each layer contributed to the answer.`} /></div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-4 pb-4 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] min-[1280px]:grid-cols-[240px_minmax(0,1fr)_minmax(320px,380px)]">
        <AgentList current={a} />

        <section className="panel flex min-h-[520px] min-w-0 flex-col" aria-label={`Chat with ${a.name}`}>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <Icon name="bot" size={16} />
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{a.name}</div><div className="truncate text-xs text-muted">{a.description}</div></div>
            <span className="hidden text-xs text-muted sm:inline">eval {a.evalAccuracy}%</span>
            <button className={cls('btn-ghost text-xs', simOn && 'text-warn')} onClick={() => setLayersOpen(true)} aria-label="Layer switches"><Icon name="power" size={15} /><span className="hidden sm:inline">Layers</span></button>
            <button className="btn-ghost" onClick={() => setSettings(true)} aria-label="Agent settings"><Icon name="gear" size={15} /></button>
            {msgs.length > 0 && <button className="btn-ghost text-xs" onClick={() => clear(key)}>Clear</button>}
          </div>
          {simOn && (
            <div role="status" className="flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn/15 px-4 py-1.5 text-xs">
              <Icon name="warn" size={13} className="text-warn" /><strong>Simulation: layers off</strong>
              <span className="text-muted">{SWITCHES.filter((x) => !ext.studioSwitches[x.id]).map((x) => x.label).join(', ')} · affects only this chat</span>
              <button className="link ml-auto" onClick={() => patchExt((e) => ({ ...e, studioSim: false, studioSwitches: { ...ALL_ON } }))}>Turn all layers on</button>
            </div>
          )}
          <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 scroll-thin" aria-live="polite">
            {!canChat && (
              <div className="rounded-md border border-line bg-surface2 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium"><Icon name="lock" size={15} />{persona.name} ({persona.roleId}) can&apos;t chat with {a.name} yet.</div>
                <p className="mt-1 text-muted">Agents only answer people who are granted the agent and its products.</p>
                <div className="mt-2">{code === 'P' ? <AccessChip code="P" /> : <button className="btn-primary" onClick={() => { requestAccess(pack.profile.id, persona.roleId, a.id, `Requested from Agent Studio for ${a.name}`, '90d'); toast(`Access to ${a.name} requested`); }}><Icon name="key" size={13} />Request access</button>}</div>
              </div>
            )}
            {canChat && msgs.length === 0 && (
              <p className="text-sm text-muted">Hi {persona.name.split(' ')[0]} — I answer from {a.productIds.map((p) => pack.products.find((x) => x.id === p)?.name).filter(Boolean).join(', ') || 'governance metadata'}. Try a starter question below.</p>
            )}
            {msgs.map((m) => (m.role === 'user' ? (
              <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent/10 px-3 py-2 text-sm">{m.text}<div className="mono mt-0.5 text-right text-[10px] text-muted">{m.persona}</div></div></div>
            ) : (
              <div key={m.id} className="flex gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ background: layerColor('agent') }}><Icon name="bot" size={14} /></span>
                <div className="min-w-0 flex-1">
                  {m.answer ? (
                    <Contain what="answer">
                      <AnswerView m={m} onAsk={ask} animate={m.id === animateId} onSwitch={(id) => navigate(path(`agents/${id}`))} access={access} />
                    </Contain>
                  ) : (
                    <div role="alert" className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm">I couldn&apos;t answer that because of an internal error: <span className="mono text-xs">{m.error}</span></div>
                  )}
                </div>
              </div>
            )))}
          </div>
          {canChat && (
            <div className="border-t border-line p-3">
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 scroll-thin" aria-label="Starter prompts">
                {starters.map((s) => <button key={s} className="chip shrink-0 border-line bg-surface2 py-1 hover:border-accent" onClick={() => ask(s)}>{s}</button>)}
              </div>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
                <input className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask ${a.name}…`} aria-label="Question" />
                <button className="btn-primary" type="submit" disabled={!input.trim()}><Icon name="send" size={14} />Ask</button>
              </form>
            </div>
          )}
        </section>

        <aside className="panel min-w-0 p-3 lg:col-span-2 min-[1280px]:col-span-1 min-[1280px]:overflow-y-auto" aria-label="How I answered">
          <div className="mb-2 flex items-center gap-2"><Icon name="layers" size={15} /><h2 className="font-semibold">How I answered</h2></div>
          <Contain what="trace"><TraceTimeline key={lastId ?? 'none'} steps={trace} revealed={revealed} /></Contain>
        </aside>
      </div>
      <Drawer open={settings} onClose={() => setSettings(false)} title={`${a.name} settings`} width="max-w-md"><SettingsPanel a={a} /></Drawer>
      <Drawer open={layersOpen} onClose={() => setLayersOpen(false)} title="Layer switches" subtitle="Simulate answers with layers removed" width="max-w-md">
        <div className="space-y-4 text-sm">
          <p>Turn a layer off and ask a knockout question again to see how the answer degrades. The simulation affects only this chat; the rest of the app keeps every layer on.</p>
          <SwitchRow compact value={ext.studioSwitches} onChange={(id, on) => patchExt((e) => { const sw = { ...e.studioSwitches, [id]: on }; return { ...e, studioSwitches: sw, studioSim: SWITCHES.some((x) => !sw[x.id]) }; })} />
          <div>
            <div className="label mb-1">Questions that respond to switches</div>
            {(pack.ext?.knockoutScenarios ?? []).filter((k) => k.agentId === a.id).length
              ? <ul className="space-y-1">{pack.ext!.knockoutScenarios.filter((k) => k.agentId === a.id).map((k) => <li key={k.id}><button className="link text-left" onClick={() => { setLayersOpen(false); ask(k.question); }}>{k.question}</button></li>)}</ul>
              : <p className="text-muted">This agent has no knockout questions. Try {pack.agents.find((x) => x.id === pack.ext?.knockoutScenarios[0]?.agentId)?.name ?? 'the signature agent'}.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => patchExt((e) => ({ ...e, studioSim: false, studioSwitches: { ...ALL_ON } }))}><Icon name="reset" size={13} />All layers on</button>
            <Link className="btn" to={path('why/knockout')}><Icon name="power" size={13} />Open the knockout simulator</Link>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
