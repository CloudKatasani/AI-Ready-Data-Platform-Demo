import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { create } from 'zustand';
import type { Agent, AgentAnswer, TraceStep } from '../../types';
import { AccessChip, BarChart, CertifiedSeal, CodeBlock, Drawer, layerColor, LineChart, PageHeader, SimpleTable, StatusChip } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { LAYER_BY_ID } from '../../layers';
import { useAccess, useLive, usePack, usePackPath, usePersona } from '../../app/context';
import { respond } from '../../agents/engine/respond';
import { useStore } from '../../store';
import { toast } from '../../app/toast';

interface Msg { id: number; role: 'user' | 'agent'; text: string; answer?: AgentAnswer; persona?: string }
const useChats = create<{ chats: Record<string, Msg[]>; push: (k: string, m: Msg) => void; clear: (k: string) => void }>((set, get) => ({
  chats: {},
  push: (k, m) => set({ chats: { ...get().chats, [k]: [...(get().chats[k] ?? []), m] } }),
  clear: (k) => set({ chats: { ...get().chats, [k]: [] } }),
}));

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function AgentStudio() {
  const { agent } = useParams();
  const pack = usePack();
  const access = useAccess();
  const path = usePackPath();
  const [sp] = useSearchParams();
  const a = pack.agents.find((x) => x.id === agent && access(x.id) !== '-');
  if (!a) {
    const sig = pack.agents.find((x) => x.id === pack.signature.agentId)!;
    const pick = access(sig.id) === 'G' ? sig : pack.agents.find((x) => access(x.id) === 'G') ?? sig;
    return <Navigate to={path(`agents/${pick.id}${sp.toString() ? `?${sp}` : ''}`)} replace />;
  }
  return <Studio a={a} />;
}

function TraceTimeline({ steps, revealed }: { steps: TraceStep[]; revealed: number }) {
  const path = usePackPath();
  const [open, setOpen] = useState<number | null>(null);
  if (!steps.length) return <p className="text-sm text-muted">Ask a question to see which layer contributed what.</p>;
  const href = (r: TraceStep['refs'][number]) =>
    r.kind === 'term' ? path(`glossary/${r.id}`) : r.kind === 'rule' ? path(`context/rules?rule=${r.id}`) : r.kind === 'view' ? path(`semantic/${r.id}`)
    : r.kind === 'metric' ? path(`semantic/${r.id.split('.')[0]}`) : r.kind === 'doc' ? path('context/search') : r.kind === 'object' ? path(`explorer/${r.id.replace('.', '/')}`) : path(`explorer/GOVERNANCE/${r.id}`);
  return (
    <ol className="relative space-y-2" aria-label="How I answered">
      {steps.map((s, i) => {
        const visible = i < revealed;
        const l = LAYER_BY_ID[s.layer];
        const isOpen = open === i || (open === null && visible);
        return (
          <li key={i} className={cls('transition-opacity', visible ? 'opacity-100' : 'opacity-0')} aria-hidden={!visible}>
            <div className="rounded-md border border-line" style={{ borderLeft: `4px solid ${layerColor(s.layer)}` }}>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen}>
                <span className="text-sm font-semibold">{s.title}</span>
                <span className="chip border-transparent text-[11px]" style={{ background: layerColor(s.layer, 0.14) }}>{l.label}</span>
                <span className="mono ml-auto text-[11px] text-muted">{s.ms} ms</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-2.5">
                  <p className="text-xs leading-5">{s.detail}</p>
                  {s.refs.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.refs.map((r) => <Link key={r.kind + r.id} to={href(r)} className="chip border-line text-[11px] hover:border-accent">{r.label ?? r.id}</Link>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function AnswerView({ m, onAsk, streaming, onSwitch }: { m: Msg; onAsk: (q: string) => void; streaming: boolean; onSwitch: (id: string) => void }) {
  const pack = usePack();
  const path = usePackPath();
  const navigate = useNavigate();
  const persona = usePersona();
  const access = useAccess();
  const requestAccess = useStore((s) => s.requestAccess);
  const [sql, setSql] = useState(false);
  const a = m.answer!;
  const [shown, setShown] = useState(streaming && !reduced() ? 0 : a.summary.length);
  useEffect(() => {
    if (shown >= a.summary.length) return;
    // Typewriter: ~40 characters per 100 ms frame.
    const h = window.setTimeout(() => setShown((n) => Math.min(a.summary.length, n + 40)), 100);
    return () => window.clearTimeout(h);
  }, [shown, a.summary.length]);
  const done = shown >= a.summary.length;
  const req = a.requestAssetId;
  const reqState = req ? access(req) : undefined;
  return (
    <div className="space-y-3">
      {a.banner === 'not-certified' && <div className="flex items-start gap-2 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-ink"><Icon name="warn" size={16} className="mt-0.5 shrink-0 text-warn" /><span><strong>Not certified: use with caution.</strong> {a.bannerText?.replace('Not certified: use with caution. ', '')}</span></div>}
      {a.banner === 'no-access' && <div className="flex items-start gap-2 rounded-md border border-line bg-surface2 px-3 py-2 text-sm"><Icon name="lock" size={16} className="mt-0.5 shrink-0 text-muted" /><span>No data was returned: access is checked before any query runs.</span></div>}
      <p className="whitespace-pre-line text-sm leading-6">{a.summary.slice(0, Math.floor(shown))}{!done && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />}</p>
      {done && (
        <>
          {a.chart && (a.chart.kind === 'line' ? <LineChart labels={a.chart.labels} values={a.chart.values} unit={a.chart.unit} /> : <BarChart labels={a.chart.labels} values={a.chart.values} unit={a.chart.unit} decimals={a.chart.unit === 'interruptions' ? 3 : a.chart.values.every((v) => Number.isInteger(v)) ? 0 : 1} />)}
          {a.table && <SimpleTable columns={a.table.columns} rows={a.table.rows} masked={a.table.masked} />}
          {a.suggestions && (
            <div className="flex flex-wrap gap-1.5">
              {a.suggestions.map((s) => <button key={s} className="chip border-accent/40 bg-accent/5 py-1 text-accent hover:bg-accent/10" onClick={() => onAsk(s)}>{s}</button>)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {a.kind === 'answer' && (a.sources.length ? a.sources.map((s) => {
              const p = pack.products.find((x) => x.id === s.productId)!;
              return s.certified ? <span key={s.productId} className="inline-flex items-center gap-1.5 text-xs"><CertifiedSeal version={s.version} /><span className="text-muted">Certified source: {p.name}</span></span>
                : <span key={s.productId} className="inline-flex items-center gap-1.5 text-xs"><StatusChip status={pack.products.find((x) => x.id === s.productId)!.status} label={`${p.name} v${s.version}`} /></span>;
            }) : <span className="chip border-line text-muted"><Icon name="layers" size={11} />Governed metadata</span>)}
            {a.sql && <button className="btn-ghost text-xs" onClick={() => setSql(!sql)}><Icon name="table" size={13} />{sql ? 'Hide SQL' : 'Show SQL'}</button>}
            {a.explorerTarget && <button className="btn-ghost text-xs" onClick={() => navigate(path(`explorer/${a.explorerTarget!.replace('.', '/')}`))}><Icon name="external" size={13} />Open in Explorer</button>}
            {a.switchAgentId && <button className="btn text-xs" onClick={() => onSwitch(a.switchAgentId!)}><Icon name="bot" size={13} />Switch to {pack.agents.find((x) => x.id === a.switchAgentId)?.name}</button>}
            {req && (reqState === 'P' ? <span className="chip border-warn/50 bg-warn/10 text-warn"><Icon name="pending" size={11} />Request pending</span>
              : reqState === 'G' ? <span className="chip border-good/40 bg-good/10 text-good"><Icon name="check" size={11} />Access granted — ask again</span>
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
      <div><div className="label">Object</div><div className="mono">{pack.database}.AGENTS.{a.objectName}</div></div>
      <div><div className="label mb-1">Tools bound</div><ul className="space-y-1">{a.tools.map((t) => <li key={t.kind + t.target} className="flex gap-2"><span className="chip border-line">{t.kind.replace('_', ' ')}</span><span className="mono">{t.target}</span></li>)}</ul></div>
      <div><div className="label mb-1">Products used</div><div className="flex flex-wrap gap-1">{a.productIds.map((id) => <Link key={id} className="chip border-line hover:border-accent" to={path(`certify/${id}`)}>{id} {pack.products.find((p) => p.id === id)?.name}</Link>)}{!a.productIds.length && <span className="text-muted">Glossary, Governance, DP registry</span>}</div></div>
      <div><div className="label mb-1">Instructions</div><ul className="space-y-1.5">{pack.context.instructions.filter((i) => i.agentId === a.id).map((i) => <li key={i.id}><span className="chip mr-1 border-line">{i.type}</span>{i.text}</li>)}</ul><Link className="link mt-1 inline-block text-xs" to={path('context/instructions')}>Open in Context Layer</Link></div>
      <div><div className="label">Evaluation</div><div>{a.evalAccuracy}% on {a.evalQuestions} questions · eval set <span className="mono">{a.objectName.replace('AGT_', '').toLowerCase()}_golden_v3</span></div></div>
    </div>
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
  const key = `${pack.profile.id}:${a.id}`;
  const msgs = useChats((s) => s.chats[key]) ?? [];
  const push = useChats((s) => s.push);
  const clear = useChats((s) => s.clear);
  const starters = pack.scenarios.filter((s) => s.agentId === a.id).map((s) => s.question);
  const [input, setInput] = useState(a.id === pack.signature.agentId ? pack.signature.question : starters[0]);
  const [streamId, setStreamId] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [settings, setSettings] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const canChat = access(a.id) === 'G';
  const lastAgent = [...msgs].reverse().find((m) => m.role === 'agent');
  const trace = lastAgent?.answer?.trace ?? [];
  const requestAccess = useStore((s) => s.requestAccess);

  const ask = (q: string) => {
    if (!q.trim() || !canChat) return;
    const id = Date.now();
    const ans = respond(pack, a.id, q, persona, live, (asset) => access(asset));
    push(key, { id: id - 1, role: 'user', text: q, persona: persona.roleId });
    push(key, { id, role: 'agent', text: q, answer: ans, persona: persona.roleId });
    setStreamId(id);
    setInput('');
  };

  useEffect(() => {
    const q = sp.get('q');
    if (q && canChat) {
      ask(q);
      setSp({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, canChat]);

  useEffect(() => {
    if (!lastAgent) return;
    const steps = lastAgent.answer?.trace ?? [];
    if (lastAgent.id !== streamId || reduced()) return setRevealed(steps.length);
    setRevealed(0);
    let t = 0;
    const hs = steps.map((s, i) => { t += Math.min(600, Math.max(250, s.ms)); return window.setTimeout(() => setRevealed(i + 1), t * 0.55); });
    return () => hs.forEach(clearTimeout);
  }, [lastAgent, streamId]);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' }), [msgs.length]);

  const visibleAgents = pack.agents.filter((x) => access(x.id) !== '-');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-4 sm:px-6"><PageHeader title="Agent Studio" layer="agent" sub="Ask an agent and watch how each layer contributed to the answer." /></div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-4 pb-4 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] min-[1280px]:grid-cols-[240px_minmax(0,1fr)_minmax(320px,380px)]">
        <nav aria-label="Agents" className="space-y-2 lg:overflow-y-auto">
          {visibleAgents.map((x) => {
            const code = access(x.id);
            return (
              <Link key={x.id} to={path(`agents/${x.id}`)} className={cls('panel block p-3 hover:border-accent', x.id === a.id && 'border-[rgb(var(--layer-agent))] ring-1 ring-[rgb(var(--layer-agent))]')}>
                <div className="flex items-center gap-2"><Icon name="bot" size={15} /><span className="text-sm font-semibold">{x.name}</span></div>
                <div className="mt-1 flex flex-wrap items-center gap-1"><StatusChip status={x.status} /><span className="text-xs text-muted">{x.domain}</span></div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted"><span className="truncate">{x.productIds.join(', ') || 'Metadata'}</span>{code !== 'G' && <AccessChip code={code} />}</div>
              </Link>
            );
          })}
        </nav>

        <section className="panel flex min-h-[520px] min-w-0 flex-col" aria-label={`Chat with ${a.name}`}>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <Icon name="bot" size={16} />
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{a.name}</div><div className="truncate text-xs text-muted">{a.description}</div></div>
            <span className="hidden text-xs text-muted sm:inline">eval {a.evalAccuracy}%</span>
            <button className="btn-ghost" onClick={() => setSettings(true)} aria-label="Agent settings"><Icon name="gear" size={15} /></button>
            {msgs.length > 0 && <button className="btn-ghost text-xs" onClick={() => clear(key)}>Clear</button>}
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 scroll-thin" aria-live="polite">
            {!canChat && (
              <div className="rounded-md border border-line bg-surface2 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium"><Icon name="lock" size={15} />{persona.name} ({persona.roleId}) can&apos;t chat with {a.name} yet.</div>
                <p className="mt-1 text-muted">Agents only answer people who are granted the agent and its products.</p>
                <div className="mt-2">{access(a.id) === 'P' ? <AccessChip code="P" /> : <button className="btn-primary" onClick={() => { requestAccess(pack.profile.id, persona.roleId, a.id, `Requested from Agent Studio for ${a.name}`, '90d'); toast(`Access to ${a.name} requested`); }}><Icon name="key" size={13} />Request access</button>}</div>
              </div>
            )}
            {canChat && msgs.length === 0 && (
              <div className="text-sm text-muted">
                <p>Hi {persona.name.split(' ')[0]} — I answer from {a.productIds.map((p) => pack.products.find((x) => x.id === p)?.name).join(', ') || 'governance metadata'}. Try a starter question:</p>
              </div>
            )}
            {msgs.map((m) => (m.role === 'user' ? (
              <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent/10 px-3 py-2 text-sm">{m.text}<div className="mono mt-0.5 text-right text-[10px] text-muted">{m.persona}</div></div></div>
            ) : (
              <div key={m.id} className="flex gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ background: layerColor('agent') }}><Icon name="bot" size={14} /></span>
                <div className="min-w-0 flex-1"><AnswerView m={m} onAsk={ask} streaming={m.id === streamId} onSwitch={(id) => navigate(path(`agents/${id}`))} /></div>
              </div>
            )))}
            <div ref={endRef} />
          </div>
          {canChat && (
            <div className="border-t border-line p-3">
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 scroll-thin">
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
          <TraceTimeline steps={trace} revealed={revealed} />
        </aside>
      </div>
      <Drawer open={settings} onClose={() => setSettings(false)} title={`${a.name} settings`} width="max-w-md"><SettingsPanel a={a} /></Drawer>
    </div>
  );
}

