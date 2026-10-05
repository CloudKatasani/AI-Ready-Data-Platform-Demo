import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarChart, CodeBlock, Drawer, LineChart, PageHeader, Sparkline, Tabs } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, useIsSteward, usePack, usePackPath } from '../../app/context';
import { toast } from '../../app/toast';
import { hasExt, NotConfigured } from '../../ext/NotConfigured';
import { accuracyOf, CATEGORY_LABEL, FIX_LABEL, runEval, statusOf, trend, type EvalRow } from '../../ext/quality';
import type { FailCategory, FeedbackItem, FixType } from '../../ext/state';

type Tab = 'scorecard' | 'eval' | 'inbox';
const STATUS_TONE: Record<string, string> = { 'Meets bar': 'border-good/40 bg-good/10 text-good rounded-full', 'At risk': 'border-warn/50 bg-warn/10 text-warn rounded-sm', 'Below bar': 'border-bad/40 bg-bad/10 text-bad rounded-sm' };
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function QualityStatus({ acc }: { acc: number }) {
  const s = statusOf(acc);
  return <span className={cls('chip', STATUS_TONE[s])}><Icon name={s === 'Meets bar' ? 'pass' : 'warn'} size={11} />{s}</span>;
}

export default function AgentQuality() {
  const pack = usePack();
  const { tab } = useParams();
  const path = usePackPath();
  if (!hasExt(pack, ['feedbackScript'])) return <NotConfigured pack={pack} keys={['feedbackScript']} />;
  if (tab && !['eval', 'inbox'].includes(tab)) return <Navigate to={path('agent-quality')} replace />;
  return <Inner tab={(tab as Tab) ?? 'scorecard'} />;
}

function Inner({ tab }: { tab: Tab }) {
  const path = usePackPath();
  const navigate = useNavigate();
  const [ext, patch] = useExt();
  const [running, setRunning] = useState(false);
  const open = ext.quality.feedback.filter((f) => !f.fixed).length;
  const pending = ext.quality.fixes.filter((f) => !ext.quality.evaluated.includes(f));
  const rerun = () => {
    setRunning(true);
    window.setTimeout(() => {
      patch((e) => ({ ...e, quality: { ...e.quality, evaluated: [...e.quality.fixes], runs: e.quality.runs + 1, lastRunAt: new Date().toISOString() } }));
      setRunning(false);
      toast('Eval sets re-run against the current context and semantic layers', 'good');
    }, reduced() ? 0 : 3000);
  };
  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Agent quality"
        layer={['agent', 'context', 'semantic']}
        sub="Agents are measured like any other product, and they improve through the context and semantic layers (rules, verified queries, synonyms, relationships), not through changes to the model."
        right={<button className="btn-primary" onClick={rerun} disabled={running} aria-busy={running}><Icon name={running ? 'pending' : 'play'} size={14} className={running ? 'animate-spin' : ''} />{running ? 'Running eval sets…' : 'Re-run eval'}</button>}
      />
      {pending.length > 0 && !running && <div role="status" className="mb-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm"><Icon name="info" size={14} className="mr-1 inline" />{pending.map((f) => FIX_LABEL[f]).join(', ')} applied since the last run. Re-run the eval to measure the effect.</div>}
      {running && <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface2" aria-hidden><div className="h-full w-full origin-left animate-[grow_3s_linear] bg-accent" /></div>}
      <Tabs label="Agent quality views" value={tab} onChange={(t) => navigate(path(t === 'scorecard' ? 'agent-quality' : `agent-quality/${t}`))} tabs={[{ id: 'scorecard', label: 'Scorecard' }, { id: 'eval', label: 'Eval run detail' }, { id: 'inbox', label: 'Feedback inbox', count: open }]} />
      <div className="mt-3">{tab === 'scorecard' ? <Scorecard /> : tab === 'eval' ? <EvalDetail /> : <Inbox />}</div>
    </div>
  );
}

function Scorecard() {
  const pack = usePack();
  const path = usePackPath();
  const [ext] = useExt();
  return (
    <section className="panel overflow-x-auto scroll-thin" aria-label="Agent scorecard">
      <table className="w-full min-w-[860px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-3 py-2 font-medium">Agent</th><th className="px-3 py-2 text-right font-medium">Eval accuracy</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Questions</th><th className="px-3 py-2 font-medium">Last 8 weekly runs</th><th className="px-3 py-2 text-right font-medium">Thumbs-down rate</th><th className="px-3 py-2 font-medium">Last run</th></tr></thead>
        <tbody>{pack.agents.map((a) => {
          const rows = runEval(pack, ext, a.id);
          const acc = accuracyOf(rows);
          const initial = accuracyOf(runEval(pack, ext, a.id, []));
          const downs = ext.quality.feedback.filter((f) => f.agentId === a.id).length;
          const base = 1.5 + ((a.id.charCodeAt(3) * 7) % 25) / 10;
          return (
            <tr key={a.id} className="border-b border-line/50">
              <td className="px-3 py-2"><Link className="font-medium hover:underline" to={path(`agent-quality/eval?agent=${a.id}`)}>{a.name}</Link><div className="text-xs text-muted">{a.id} · {a.status}</div></td>
              <td className="px-3 py-2 text-right font-display text-lg font-semibold tabnum">{acc}%</td>
              <td className="px-3 py-2"><QualityStatus acc={acc} /></td>
              <td className="px-3 py-2 text-right tabnum">{rows.length}</td>
              <td className="px-3 py-2"><Sparkline values={trend(a.id, initial, acc)} w={120} h={26} tone={acc >= 90 ? 'good' : 'warn'} /></td>
              <td className="px-3 py-2 text-right tabnum">{(base + downs * 0.4).toFixed(1)}%{downs > 0 && <span className="ml-1 text-xs text-muted">(+{downs} new)</span>}</td>
              <td className="px-3 py-2 text-xs">{ext.quality.lastRunAt ? new Date(ext.quality.lastRunAt).toLocaleTimeString() : 'Mon 06:00 (weekly)'}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}

function EvalDetail() {
  const pack = usePack();
  const [ext] = useExt();
  const [sp, setSp] = useSearchParams();
  const agentId = sp.get('agent') ?? pack.ext!.feedbackScript.agentId;
  const [filter, setFilter] = useState<'all' | 'fail'>('fail');
  const rows = runEval(pack, ext, agentId);
  const acc = accuracyOf(rows);
  const initial = accuracyOf(runEval(pack, ext, agentId, []));
  const cats = Object.keys(CATEGORY_LABEL) as FailCategory[];
  const counts = cats.map((c) => rows.filter((r) => r.result === 'fail' && r.category === c).length);
  const shown = rows.filter((r) => filter === 'all' || r.result === 'fail');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><span className="label">Agent</span><select className="input py-1" value={agentId} onChange={(e) => setSp({ agent: e.target.value }, { replace: true })}>{pack.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <span className="font-display text-xl font-semibold tabnum">{acc}%</span><QualityStatus acc={acc} />
        <span className="text-sm text-muted">{rows.filter((r) => r.result === 'pass').length} of {rows.length} pass · eval set <span className="mono">{pack.agents.find((a) => a.id === agentId)?.objectName.replace('AGT_', '').toLowerCase()}_golden_v3</span></span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="panel p-4" aria-label="Failures by category"><h2 className="mb-2 text-sm font-semibold">Failures by category</h2><BarChart labels={cats.map((c) => CATEGORY_LABEL[c])} values={counts} decimals={0} color="rgb(var(--bad))" /></section>
        <section className="panel p-4" aria-label="Accuracy trend"><h2 className="mb-2 text-sm font-semibold">Accuracy, last 8 runs</h2><LineChart labels={['W-7', 'W-6', 'W-5', 'W-4', 'W-3', 'W-2', 'W-1', 'Now']} values={trend(agentId, initial, acc)} unit="%" h={150} /></section>
      </div>
      <section className="panel overflow-x-auto scroll-thin" aria-label="Eval questions">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2"><h2 className="text-sm font-semibold">Eval questions</h2>
          <div role="radiogroup" aria-label="Show" className="ml-auto inline-flex rounded border border-line p-0.5 text-xs">{(['fail', 'all'] as const).map((f) => <button key={f} role="radio" aria-checked={filter === f} className={cls('rounded px-2 py-1', filter === f && 'bg-accent text-white')} onClick={() => setFilter(f)}>{f === 'fail' ? 'Failing' : 'All'}</button>)}</div>
        </div>
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-3 py-2 font-medium">Question</th><th className="px-3 py-2 font-medium">Expected</th><th className="px-3 py-2 font-medium">Agent answer</th><th className="px-3 py-2 font-medium">Result</th><th className="px-3 py-2 font-medium">Category</th></tr></thead>
          <tbody>{shown.map((r) => <EvalLine key={r.id} r={r} />)}{!shown.length && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted">Every eval question passes.</td></tr>}</tbody>
        </table>
      </section>
    </div>
  );
}

function EvalLine({ r }: { r: EvalRow }) {
  return (
    <tr className="border-b border-line/50 align-top">
      <td className="px-3 py-2"><div>{r.question}</div><div className="mono text-[11px] text-muted">{r.id}</div></td>
      <td className="px-3 py-2 text-xs">{r.expected}</td>
      <td className={cls('px-3 py-2 text-xs', r.result === 'fail' && 'text-bad')}>{r.actual}</td>
      <td className="px-3 py-2"><span className={cls('chip', r.result === 'pass' ? 'rounded-full border-good/40 bg-good/10 text-good' : 'rounded-sm border-bad/40 bg-bad/10 text-bad')}><Icon name={r.result === 'pass' ? 'pass' : 'fail'} size={11} />{r.result}</span></td>
      <td className="px-3 py-2 text-xs">{r.category ? CATEGORY_LABEL[r.category] : '—'}{r.fix && r.result === 'fail' && <div className="text-muted">Fix: {FIX_LABEL[r.fix]}</div>}</td>
    </tr>
  );
}

function Inbox() {
  const pack = usePack();
  const path = usePackPath();
  const [ext] = useExt();
  const steward = useIsSteward();
  const [fixFor, setFixFor] = useState<FeedbackItem | null>(null);
  const items = ext.quality.feedback;
  return (
    <section className="space-y-3" aria-label="Feedback inbox">
      {!steward && <div role="note" className="rounded-md border border-line bg-surface2/60 px-3 py-2 text-sm"><Icon name="info" size={14} className="mr-1 inline" />This is the data steward&apos;s view. Switch persona to the data steward to apply fixes.</div>}
      {!items.length && <div className="panel p-6 text-center text-sm text-muted">No feedback yet. Give a thumbs down on an answer in <Link className="link" to={path(`agents/${pack.ext!.feedbackScript.agentId}?q=${encodeURIComponent(pack.ext!.feedbackScript.question)}`)}>Agent Studio</Link>.</div>}
      {items.map((f) => (
        <article key={f.id} className={cls('panel p-4', f.fixed && 'opacity-70')}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Icon name="thumbDown" size={14} className="text-bad" />
            <span className="font-semibold">{pack.agents.find((a) => a.id === f.agentId)?.name}</span>
            <span className="mono text-muted">{f.role}</span><span className="text-muted">{new Date(f.at).toLocaleTimeString()}</span>
            <span className="chip border-warn/50 bg-warn/10 text-warn">{CATEGORY_LABEL[f.category]}</span>
            {f.fixed && <span className="chip rounded-full border-good/40 bg-good/10 text-good"><Icon name="pass" size={11} />Fixed</span>}
          </div>
          <p className="mt-2 text-sm font-medium">“{f.question}”</p>
          <p className="mt-1 line-clamp-2 text-xs text-muted">Answer: {f.answer}</p>
          {f.comment && <p className="mt-1 text-sm">Comment: <em>{f.comment}</em></p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {f.fix && <span className="text-xs text-muted">Suggested fix: {FIX_LABEL[f.fix]}</span>}
            {!f.fixed && <button className="btn-primary ml-auto" disabled={!steward} onClick={() => setFixFor(f)}><Icon name="sparkle" size={13} />Fix</button>}
          </div>
        </article>
      ))}
      <Drawer open={Boolean(fixFor)} onClose={() => setFixFor(null)} title="Fix from feedback" subtitle={fixFor ? `“${fixFor.question}”` : ''} width="max-w-xl">
        {fixFor && <FixChooser item={fixFor} onDone={() => setFixFor(null)} />}
      </Drawer>
    </section>
  );
}

function FixChooser({ item, onDone }: { item: FeedbackItem; onDone: () => void }) {
  const pack = usePack();
  const [ext, patch] = useExt();
  const fs = pack.ext!.feedbackScript;
  const [type, setType] = useState<FixType>(item.fix ?? 'rule');
  const steward = pack.personas.find((p) => p.archetype === 'D')!;
  const sql = useMemo(() => fs.compute(true, { persona: { ...steward, rowFilter: undefined }, live: { productStatus: {}, productVersion: {}, fixes: {} } }).sql, [fs, steward]);
  const term = pack.glossary.find((g) => g.id === fs.termId);
  const applied = ext.quality.fixes.includes(type);
  const apply = () => {
    patch((e) => ({
      ...e,
      quality: {
        ...e.quality,
        fixes: e.quality.fixes.includes(type) ? e.quality.fixes : [...e.quality.fixes, type],
        feedback: e.quality.feedback.map((f) => (f.id === item.id || (f.fix === type && f.agentId === fs.agentId) ? { ...f, fixed: true } : f)),
      },
    }));
    toast(`${FIX_LABEL[type]} saved to the ${type === 'relationship' ? 'semantic view' : 'Context layer'}. Re-run the eval to measure it.`, 'good');
    onDone();
  };
  const OPTS: { id: FixType; where: string }[] = [
    { id: 'rule', where: 'CONTEXT.BUSINESS_RULES' }, { id: 'verified_query', where: 'CONTEXT.VERIFIED_QUERIES' },
    { id: 'synonym', where: 'CONTEXT.SYNONYMS' }, { id: 'relationship', where: `SEMANTIC.${fs.relationship.view}` },
  ];
  return (
    <div className="space-y-4 text-sm">
      <fieldset><legend className="label mb-1">Fix type</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{OPTS.map((o) => (
          <label key={o.id} className={cls('flex cursor-pointer items-start gap-2 rounded-md border p-2', type === o.id ? 'border-accent bg-accent/5' : 'border-line')}>
            <input type="radio" name="fix" checked={type === o.id} onChange={() => setType(o.id)} className="mt-1" />
            <span><span className="block font-medium">{FIX_LABEL[o.id]}{item.fix === o.id && <span className="ml-1 text-xs text-accent">(suggested)</span>}</span><span className="mono block text-[11px] text-muted">{o.where}</span></span>
          </label>
        ))}</div>
      </fieldset>
      {type === 'rule' && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <div className="flex flex-wrap gap-2 text-xs"><span className="chip border-line">{fs.rule.id}</span><span className="chip border-line">{fs.rule.domain}</span><span className="chip border-line">Term: {term?.term}</span><span className="chip border-line mono">{fs.rule.metric}</span></div>
          <p>{fs.rule.text}</p><p className="text-xs text-muted">Source: {fs.rule.sourceDoc}</p>
        </div>
      )}
      {type === 'verified_query' && <div className="space-y-2"><p><span className="label">Question</span><br />{fs.question}</p><CodeBlock code={sql} maxH="max-h-56" /></div>}
      {type === 'synonym' && <p className="rounded-md border border-line p-3">“{fs.synonym.synonym}” → <strong>{fs.synonym.term}</strong> <span className="text-muted">· scope {fs.synonym.scope}</span></p>}
      {type === 'relationship' && <p className="rounded-md border border-line p-3"><strong>{fs.relationship.label}</strong> in <span className="mono">{fs.relationship.view}</span>: {fs.relationship.detail}</p>}
      <button className="btn-primary" onClick={apply} disabled={applied}><Icon name="check" size={13} />{applied ? 'Already applied' : `Apply: ${FIX_LABEL[type]}`}</button>
    </div>
  );
}
