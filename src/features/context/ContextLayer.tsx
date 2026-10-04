import { useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { CodeBlock, layerColor, PageHeader } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls, fmtNum } from '../../lib/format';
import { useLive, usePack, usePackPath } from '../../app/context';
import { verifiedQueriesLive } from '../../mock-snowflake/shared-schemas';
import { tokens } from '../../agents/engine/matcher';

const SECTIONS = [
  { id: 'instructions', label: 'Agent instructions', icon: 'bot', blurb: 'Persona, response, guardrail and orchestration instructions per agent, versioned.' },
  { id: 'rules', label: 'Business rules', icon: 'check', blurb: 'Rules tied to metrics, each with its source document.' },
  { id: 'verified-queries', label: 'Verified queries', icon: 'pass', blurb: 'Question → SQL pairs a human verified, by semantic view.' },
  { id: 'synonyms', label: 'Synonyms', icon: 'book', blurb: 'How people say it → the term it means → scope.' },
  { id: 'search', label: 'Document search', icon: 'doc', blurb: 'Cortex Search over policies and standards, with relevance.' },
] as const;

export default function ContextLayer() {
  const { section } = useParams();
  const path = usePackPath();
  if (!SECTIONS.some((s) => s.id === section)) return <Navigate to={path('context/rules')} replace />;
  return <Inner section={section as (typeof SECTIONS)[number]['id']} />;
}

function Explainer() {
  const pack = usePack();
  const term = pack.glossary.find((t) => t.id === pack.signature.termId)!;
  const metricRef = term.metricRefs[0] ?? '';
  const metric = pack.semanticViews.flatMap((s) => s.metrics.map((m) => ({ s, m }))).find((x) => `${x.s.name}.${x.m.name}` === metricRef);
  const rule = pack.context.rules.find((r) => r.id === pack.signature.ruleId);
  const items = [
    { layer: 'glossary' as const, title: 'Glossary', q: 'what words mean', ex: `${term.term}: ${term.definition}` },
    { layer: 'semantic' as const, title: 'Semantic', q: 'how to compute them', ex: metric ? `${metric.m.name} = ${metric.m.expr}` : term.formula ?? '' },
    { layer: 'context' as const, title: 'Context', q: 'how to judge and present them', ex: rule ? `${rule.id}: ${rule.text}` : '' },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Three meaning layers compared">
      {items.map((i) => (
        <div key={i.title} className="rounded-md border border-line bg-surface p-3" style={{ borderTop: `4px solid ${layerColor(i.layer)}` }}>
          <div className="text-sm font-semibold">{i.title} <span className="font-normal text-muted">= {i.q}</span></div>
          <div className="mt-1 text-xs text-muted">{i.ex}</div>
        </div>
      ))}
    </div>
  );
}

function DocSearch() {
  const pack = usePack();
  const [q, setQ] = useState(pack.signature.docQuery);
  const results = useMemo(() => {
    const qt = new Set(tokens(q));
    if (!qt.size) return [];
    const all = pack.context.documents.flatMap((d) => d.chunks.map((c) => ({ d, c })));
    const df = new Map<string, number>();
    for (const x of all) for (const t of new Set(tokens(x.c.text))) df.set(t, (df.get(t) ?? 0) + 1);
    return all
      .map((x) => {
        const toks = tokens(x.c.text);
        let s = 0;
        for (const t of qt) {
          const tf = toks.filter((w) => w === t).length;
          if (tf) s += (1 + Math.log(tf)) * Math.log(1 + all.length / (df.get(t) ?? 1));
        }
        const phrase = x.c.text.toLowerCase().includes(q.toLowerCase().trim()) ? 1.5 : 0;
        return { ...x, score: s + phrase };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x, _i, arr) => ({ ...x, rel: x.score / (arr[0]?.score || 1) }));
  }, [q, pack]);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-sm">
          <thead className="bg-surface2 text-left text-xs"><tr><th className="px-3 py-2">Doc</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Chunks</th><th className="px-3 py-2">Updated</th></tr></thead>
          <tbody>{pack.context.documents.map((d) => <tr key={d.id} className="border-t border-line/70"><td className="mono px-3 py-1.5 text-xs">{d.id}</td><td className="px-3 py-1.5">{d.title}</td><td className="mono px-3 py-1.5 text-[11px] text-muted">{d.source}</td><td className="mono px-3 py-1.5 text-right">{d.chunkCount}</td><td className="mono px-3 py-1.5 text-xs text-muted">{d.updatedAt}</td></tr>)}</tbody>
        </table>
      </div>
      <div>
        <label className="label" htmlFor="cs-q">Search {pack.context.searchService}</label>
        <div className="relative mt-1">
          <Icon name="search" size={14} className="absolute left-2.5 top-2.5 text-muted" />
          <input id="cs-q" className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <ol className="space-y-2" aria-live="polite">
        {results.map((r) => (
          <li key={`${r.d.id}-${r.c.n}`} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold">{r.d.title}</span><span className="text-muted">chunk {r.c.n}</span>
              <span className="ml-auto inline-flex items-center gap-1.5"><span className="h-1.5 w-16 rounded bg-surface2"><span className="block h-full rounded bg-[rgb(var(--layer-context))]" style={{ width: `${r.rel * 100}%` }} /></span><span className="mono">{fmtNum(r.rel * 0.92 + 0.05, 2)}</span></span>
            </div>
            <p className="mt-1.5 text-sm">{r.c.text}</p>
          </li>
        ))}
        {!results.length && <li className="text-sm text-muted">No indexed chunk matches.</li>}
      </ol>
    </div>
  );
}

function Inner({ section }: { section: (typeof SECTIONS)[number]['id'] }) {
  const pack = usePack();
  const live = useLive();
  const path = usePackPath();
  const [sp, setSp] = useSearchParams();
  const ctx = pack.context;
  const vqs = verifiedQueriesLive(pack, live);
  const counts: Record<string, number> = { instructions: ctx.instructions.length, rules: ctx.rules.length, 'verified-queries': vqs.length, synonyms: ctx.synonyms.length, search: ctx.documents.length };
  const hl = sp.get('rule') ?? pack.signature.ruleId;
  const svFilter = sp.get('sv') ?? '';
  const [openVq, setOpenVq] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
      <PageHeader title="Context Layer" layer="context" sub={`The judgment, rules and knowledge that make an agent answer like a ${pack.profile.company} expert.`} />
      <Explainer />
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5" role="tablist" aria-label="Context sections">
        {SECTIONS.map((s) => (
          <Link key={s.id} role="tab" aria-selected={s.id === section} to={path(`context/${s.id}`)} className={cls('panel p-3 hover:border-accent', s.id === section && 'border-[rgb(var(--layer-context))] ring-1 ring-[rgb(var(--layer-context))]')}>
            <div className="flex items-center gap-2"><Icon name={s.icon} size={15} className="text-[rgb(var(--layer-context))]" /><span className="text-sm font-semibold">{s.label}</span><span className="mono ml-auto text-xs text-muted">{counts[s.id]}</span></div>
            <div className="mt-1 hidden text-xs text-muted lg:block">{s.blurb}</div>
          </Link>
        ))}
      </div>
      <section className="panel mt-4 p-4">
        {section === 'instructions' && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pack.agents.map((a) => (
              <div key={a.id} className="rounded-md border border-line p-3">
                <div className="flex items-center gap-2"><Icon name="bot" size={15} /><Link to={path(`agents/${a.id}`)} className="font-semibold hover:underline">{a.name}</Link><span className="mono text-xs text-muted">{a.objectName}</span></div>
                <ul className="mt-2 space-y-1.5">
                  {ctx.instructions.filter((i) => i.agentId === a.id).map((i) => (
                    <li key={i.id} className="text-sm"><span className="chip mr-1.5 border-line text-muted">{i.type}</span>{i.text}<span className="mono ml-1 text-[11px] text-muted">v{i.version}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {section === 'rules' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface2 text-left text-xs"><tr><th className="px-3 py-2">Rule</th><th className="px-3 py-2">Domain</th><th className="px-3 py-2">Rule text</th><th className="px-3 py-2">Applies to metric</th><th className="px-3 py-2">Source document</th></tr></thead>
              <tbody>
                {ctx.rules.map((r) => (
                  <tr key={r.id} className={cls('border-t border-line/70 align-top', r.id === hl && 'bg-[rgb(var(--layer-context)/0.12)]')}>
                    <td className="mono px-3 py-2 text-xs font-semibold">{r.id}</td>
                    <td className="px-3 py-2 text-xs">{r.domain}</td>
                    <td className="px-3 py-2">{r.text}</td>
                    <td className="mono px-3 py-2 text-xs">{r.metric.startsWith('SV_') ? <Link className="link" to={path(`semantic/${r.metric.split('.')[0]}`)}>{r.metric}</Link> : r.metric}</td>
                    <td className="px-3 py-2 text-xs text-muted">{r.sourceDoc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {section === 'verified-queries' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="label" htmlFor="vq-sv">Semantic view</label>
              <select id="vq-sv" className="input w-auto" value={svFilter} onChange={(e) => setSp(e.target.value ? { sv: e.target.value } : {})}>
                <option value="">All ({vqs.length})</option>
                {pack.semanticViews.map((s) => <option key={s.name} value={s.name}>{s.name} ({vqs.filter((v) => v.semanticView === s.name).length})</option>)}
              </select>
            </div>
            <ul className="divide-y divide-line/70 rounded-md border border-line">
              {vqs.filter((v) => !svFilter || v.semanticView === svFilter).map((v) => (
                <li key={v.id}>
                  <button className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface2/60" aria-expanded={openVq === v.id} onClick={() => setOpenVq(openVq === v.id ? null : v.id)}>
                    <span className="mono w-16 shrink-0 text-xs text-muted">{v.id}</span>
                    <span className="min-w-0 flex-1">{v.question}</span>
                    <span className="mono text-xs text-muted">{v.semanticView}</span>
                    <span className="text-xs text-muted">{v.verifiedBy} · {v.verifiedOn}</span>
                  </button>
                  {openVq === v.id && <div className="px-3 pb-3"><CodeBlock code={v.sql} maxH="max-h-60" /></div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {section === 'synonyms' && (
          <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {ctx.synonyms.map((s) => (
              <div key={s.term + s.synonym} className="flex items-center gap-2 border-b border-line/70 py-1.5 text-sm">
                <span className="mono">“{s.synonym}”</span><Icon name="arrowRight" size={12} className="text-muted" /><span className="font-medium">{s.term}</span><span className="ml-auto text-xs text-muted">{s.scope}</span>
              </div>
            ))}
          </div>
        )}
        {section === 'search' && <DocSearch />}
      </section>
    </div>
  );
}
