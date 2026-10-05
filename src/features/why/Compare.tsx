import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CertifiedSeal, PageHeader, StatusChip } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useLive, usePack, usePackPath, usePersona } from '../../app/context';
import { runKnockout } from '../../ext/knockout';
import { ALL_ON } from '../../ext/types';
import { hasExt, NotConfigured } from '../../ext/NotConfigured';
import { buildTrace } from '../../agents/engine/trace';
import { layerColor } from '../../components/ui';
import { tokenizeSql } from '../../mock-snowflake/ddl';

export default function Compare() {
  const pack = usePack();
  if (!hasExt(pack, ['knockoutScenarios']) || !pack.ext!.knockoutScenarios.some((k) => k.raw)) return <NotConfigured pack={pack} keys={['knockoutScenarios']} />;
  return <CompareInner />;
}

function Mark({ ok }: { ok: boolean }) {
  return ok
    ? <span className="inline-flex items-center gap-1 font-semibold text-good"><Icon name="pass" size={15} />Yes</span>
    : <span className="inline-flex items-center gap-1 font-semibold text-bad"><Icon name="fail" size={15} />No</span>;
}

/** SQL with lines that differ from the other statement highlighted. */
function DiffSql({ sql, other, tone }: { sql: string; other: string; tone: 'bad' | 'good' }) {
  const others = new Set(other.split('\n').map((l) => l.trim()));
  return (
    <pre tabIndex={0} aria-label="SQL" className="max-h-60 overflow-auto rounded-md border border-line bg-surface2/60 p-2 font-mono text-xs leading-5 scroll-thin">
      {sql.split('\n').map((line, i) => (
        <div key={i} className={cls(!others.has(line.trim()) && (tone === 'bad' ? 'bg-bad/10' : 'bg-good/10'))}>
          {tokenizeSql(line).map((t, k) => <span key={k} className={t.t === 'id' || t.t === 'punc' ? undefined : `tok-${t.t}`}>{t.v}</span>)}{'\n'}
        </div>
      ))}
    </pre>
  );
}

function CompareInner() {
  const pack = usePack();
  const persona = usePersona();
  const live = useLive();
  const path = usePackPath();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const presets = pack.ext!.knockoutScenarios.filter((k) => k.raw);
  const [qid, setQid] = useState(() => {
    const fromQ = sp.get('q');
    const byScenario = presets.find((k) => k.scenarioId === fromQ || k.id === fromQ);
    return byScenario?.id ?? presets.find((k) => k.question === pack.signature.question)?.id ?? presets[0].id;
  });
  const [showSql, setShowSql] = useState(false);
  const ks = presets.find((k) => k.id === qid) ?? presets[0];
  const ctx = useMemo(() => ({ persona, live }), [persona, live]);
  const ready = useMemo(() => runKnockout(pack, ks, ALL_ON, ctx), [pack, ks, ctx]);
  const raw = useMemo(() => ks.raw!(ctx), [ks, ctx]);
  const scenario = pack.scenarios.find((s) => s.id === ks.scenarioId);
  const trace = useMemo(() => (scenario ? buildTrace(pack, scenario, persona, live, scenario.run(ctx)) : []), [pack, scenario, persona, live, ctx]);
  const products = ready.result.sources.map((s) => pack.products.find((p) => p.id === s.productId)).filter(Boolean);
  const exposedForMe = raw.rowsRead.exposed.length > 0 && !persona.unmasked.length;

  const score = [
    { k: 'Correct', q: 'Does the number match the governed reference?', raw: raw.valueText === ready.result.valueText, ready: true, why: [raw.valueText === ready.result.valueText ? 'Matches by coincidence' : `${raw.valueText} vs. ${ready.result.valueText}`, 'Computed from the certified product'] },
    { k: 'Consistent', q: 'Would Power BI show the same number?', raw: false, ready: true, why: ['No shared definition: BI computes its own', `Same semantic view (${scenario?.semantic?.view ?? 'governed metadata'}) as BI`] },
    { k: 'Safe', q: 'Were masking and row access enforced?', raw: raw.rowsRead.exposed.length === 0 && !persona.rowFilter, ready: true, why: [raw.rowsRead.exposed.length ? `Sensitive values read in clear (${raw.rowsRead.exposed.map((i) => raw.rowsRead.columns[i]).join(', ')})` : persona.rowFilter ? 'Row access not applied to raw tables' : 'Nothing sensitive in this query', `${pack.maskingPolicy} and ${pack.rowAccessPolicy} applied`] },
    { k: 'Explainable', q: 'Can every number be traced to a source and definition?', raw: false, ready: true, why: ['Two steps: guess tables, run SQL', `${trace.length}-step layer trace with term, rule and citation`] },
    { k: 'Owned', q: 'Is there an accountable owner and steward?', raw: false, ready: products.every((p) => p!.owner && p!.steward), why: ['Raw tables have no business owner', products.map((p) => `${p!.name}: ${p!.owner} · ${p!.steward ?? 'no steward'}`).join('; ')] },
  ];

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader title="Raw vs. AI-ready" layer={['bronze', 'agent']} sub="The same question, asked of an agent pointed at raw tables and of an agent on the certified, layered stack." />
      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3" role="radiogroup" aria-label="Question">
        {presets.map((k) => (
          <button key={k.id} role="radio" aria-checked={k.id === ks.id} onClick={() => setQid(k.id)} className={cls('rounded-full border px-3 py-1.5 text-sm', k.id === ks.id ? 'border-accent bg-accent/10 font-medium' : 'border-line hover:border-accent/60')}>
            {k.question}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="panel flex flex-col border-bad/40 p-4" aria-label="Agent on raw data">
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: layerColor('bronze') }} /><h2 className="text-md font-semibold">Agent on raw data</h2></div>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="label">Data it can see</dt><dd className="mono text-xs">{raw.tablesUsed.join(', ')} · columns as landed</dd></div>
            <div><dt className="label">What it knows</dt><dd>Nothing beyond column names and types</dd></div>
          </dl>
          <div className="relative mt-4 rounded-md border border-line p-4">
            <span className="absolute right-3 top-3 rotate-[-6deg] rounded border-2 border-bad px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-bad">Unverified</span>
            <div className="font-display text-[34px] font-semibold leading-none tabnum">{raw.valueText}</div>
            <div className="mt-1 text-xs text-muted">{raw.caption}</div>
          </div>
          <div className="mt-3">
            <div className="label mb-1 flex items-center gap-2">Rows it read {exposedForMe && <span className="chip border-bad/60 bg-bad/10 text-ink"><Icon name="warn" size={11} className="text-bad" />Exposed</span>}</div>
            <div tabIndex={0} role="region" aria-label="Rows read" className="overflow-x-auto rounded-md border border-line scroll-thin">
              <table className="min-w-full text-xs">
                <thead className="bg-surface2"><tr>{raw.rowsRead.columns.map((c, i) => <th key={c} scope="col" className={cls('whitespace-nowrap px-2 py-1 text-left font-mono font-medium', raw.rowsRead.exposed.includes(i) && 'underline decoration-bad decoration-2 underline-offset-2')}>{c}</th>)}</tr></thead>
                <tbody>{raw.rowsRead.rows.map((r, i) => <tr key={i} className="border-t border-line/70">{r.map((v, j) => <td key={j} className={cls('whitespace-pre px-2 py-1 font-mono', raw.rowsRead.exposed.includes(j) && 'bg-bad/10 font-semibold text-ink')}>{String(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="mt-3"><div className="label mb-1">Trace</div>
            <ol className="space-y-1 text-xs"><li className="rounded border border-line px-2 py-1">1. Guess tables from column names</li><li className="rounded border border-line px-2 py-1">2. Run SQL on {raw.tablesUsed.length} raw table{raw.tablesUsed.length > 1 ? 's' : ''}</li></ol>
          </div>
          <div className="mt-3 rounded-md border border-bad/40 bg-bad/5 p-3">
            <div className="label mb-1 text-bad">Problems found</div>
            <ul className="space-y-1 text-sm">{raw.risks.map((r) => <li key={r} className="flex gap-1.5"><Icon name="fail" size={14} className="mt-0.5 shrink-0 text-bad" />{r}</li>)}</ul>
          </div>
        </section>

        <section className="panel flex flex-col border-good/40 p-4" aria-label="Agent on AI-ready data">
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: layerColor('product') }} /><h2 className="text-md font-semibold">Agent on AI-ready data</h2></div>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="label">Data it can see</dt><dd className="text-xs">Certified output ports through semantic views: <span className="mono">{products.map((p) => p!.outputPort).join(', ')}</span></dd></div>
            <div><dt className="label">What it knows</dt><dd>Glossary, business rules, verified queries, documents</dd></div>
          </dl>
          <div className="relative mt-4 rounded-md border border-line p-4">
            <span className="absolute right-3 top-3">{ready.result.sources.every((s) => s.certified) ? <CertifiedSeal /> : <StatusChip status="Draft" label="Not certified" />}</span>
            <div className="font-display text-[34px] font-semibold leading-none tabnum">{ready.result.valueText}</div>
            <div className="mt-1 text-xs text-muted">{ready.result.caption}</div>
          </div>
          {ready.result.table && ready.result.table.rows.length > 0 && (
            <div className="mt-3"><div className="label mb-1">Answer detail {ready.result.table.masked?.length ? <span className="chip ml-1 border-line text-muted"><Icon name="lock" size={11} />Masked</span> : null}</div>
              <div tabIndex={0} role="region" aria-label="Answer detail" className="overflow-x-auto rounded-md border border-line scroll-thin">
                <table className="min-w-full text-xs"><thead className="bg-surface2"><tr>{ready.result.table.columns.map((c) => <th key={c} scope="col" className="px-2 py-1 text-left font-medium">{c}</th>)}</tr></thead>
                  <tbody>{ready.result.table.rows.map((r, i) => <tr key={i} className="border-t border-line/70">{r.map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{ready.result.table!.masked?.includes(j) ? <span className="inline-flex items-center gap-1 text-muted"><Icon name="lock" size={11} />{v}</span> : v}</td>)}</tr>)}</tbody></table>
              </div>
            </div>
          )}
          <div className="mt-3"><div className="label mb-1">Trace</div>
            <ol className="space-y-1 text-xs">{trace.map((t, i) => <li key={i} className="rounded border border-line px-2 py-1" style={{ borderLeft: `3px solid ${layerColor(t.layer)}` }}>{i + 1}. {t.title}</li>)}</ol>
          </div>
          <div className="mt-3 rounded-md border border-good/40 bg-good/5 p-3">
            <div className="label mb-1 text-good">Controls applied</div>
            <ul className="space-y-1 text-sm">
              {[`Certification: ${products.map((p) => `${p!.name} (${live.productStatus[p!.id]})`).join(', ')}`, `Masking: ${pack.maskingPolicy}`, `Row access: ${pack.rowAccessPolicy}${persona.rowFilter ? ` (${persona.rowFilter.allowed.join(', ')})` : ''}`, ...ready.result.notes].map((r) => <li key={r} className="flex gap-1.5"><Icon name="pass" size={14} className="mt-0.5 shrink-0 text-good" />{r}</li>)}
            </ul>
          </div>
        </section>
      </div>

      <section className="panel mt-4 p-4" aria-label="Scorecard">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Scorecard</h2>
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn" onClick={() => setShowSql(!showSql)}><Icon name="table" size={13} />{showSql ? 'Hide the SQL' : 'Show the SQL'}</button>
            <button className="btn-primary" onClick={() => navigate(path(`why/knockout?q=${ks.id}&off=${ks.affects.filter((a) => a !== 'governance' || persona.rowFilter).slice(0, 2).join(',')}`))}><Icon name="power" size={13} />Why is it different?</button>
          </div>
        </div>
        <div tabIndex={0} role="region" aria-label="Scorecard table" className="overflow-x-auto scroll-thin">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th scope="col" className="py-1.5 pr-3">Check</th><th scope="col" className="py-1.5 pr-3">Agent on raw data</th><th scope="col" className="py-1.5">Agent on AI-ready data</th></tr></thead>
            <tbody>
              {score.map((r) => (
                <tr key={r.k} className="border-t border-line/70 align-top">
                  <th scope="row" className="py-2 pr-3 text-left"><div className="font-semibold">{r.k}</div><div className="text-xs font-normal text-muted">{r.q}</div></th>
                  <td className="py-2 pr-3"><Mark ok={r.raw} /><div className="text-xs text-muted">{r.why[0]}</div></td>
                  <td className="py-2"><Mark ok={r.ready} /><div className="text-xs text-muted">{r.why[1]}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showSql && (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div><div className="label mb-1">Raw agent SQL</div><DiffSql sql={raw.sql} other={ready.result.sql} tone="bad" /></div>
            <div><div className="label mb-1">AI-ready agent SQL</div><DiffSql sql={ready.result.sql} other={raw.sql} tone="good" /></div>
          </div>
        )}
      </section>
    </div>
  );
}
