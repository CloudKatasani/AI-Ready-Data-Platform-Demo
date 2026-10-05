import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Agent, DataProduct } from '../../types';
import { AccessChip, CertifiedSeal, CodeBlock, Drawer, KpiChip, PageHeader, SimpleTable, Sparkline, StatusChip, Tabs } from '../../components/ui';
import { LineageGraph } from '../../components/LineageGraph';
import { Icon } from '../../components/icons';
import { cls, fmtInt, fmtNum } from '../../lib/format';
import { useAccess, useDb, useExt, useIsSteward, useLive, usePack, usePackPath, usePackState, usePersona } from '../../app/context';
import { useAccuracy, useHealth } from '../../ext/hooks';
import { slaBreaches } from '../../ext/cost';
import { HealthPill } from '../operate/Health';
import { useStore } from '../../store';
import { toast } from '../../app/toast';
import { Rng } from '../../mock-snowflake/rng';

type Item = { kind: 'product'; p: DataProduct } | { kind: 'agent'; a: Agent };
const itemId = (i: Item) => (i.kind === 'product' ? i.p.id : i.a.id);

function series(seed: string, base: number, spread: number, n = 30) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const r = new Rng(h);
  let v = base;
  return Array.from({ length: n }, () => (v = Math.max(0, v + r.normal(0, spread) * 0.6 + (base - v) * 0.3)));
}

export default function Marketplace() {
  const pack = usePack();
  const live = useLive();
  const access = useAccess();
  const st = usePackState();
  const steward = useIsSteward();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | 'product' | 'agent'>('');
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState('');
  const [kpis, setKpis] = useState<string[]>(sp.get('kpi') ? [sp.get('kpi')!] : []);
  const [mine, setMine] = useState(false);
  const [queue, setQueue] = useState(false);
  const openId = sp.get('item');
  const pendingCount = (st?.requests ?? []).filter((r) => r.status === 'pending').length;

  const items: Item[] = useMemo(() => [
    ...pack.products.map((p) => ({ kind: 'product' as const, p })),
    ...pack.agents.map((a) => ({ kind: 'agent' as const, a })),
  ], [pack]);
  const domains = [...new Set(items.map((i) => (i.kind === 'product' ? i.p.domain : i.a.domain)))].sort();
  const statusOf = (i: Item) => (i.kind === 'product' ? live.productStatus[i.p.id] : i.a.status);
  const kpisOf = (i: Item) => (i.kind === 'product' ? i.p.kpiIds : i.a.kpiIds);
  const newly = pack.products.filter((p) => st?.cert[p.id]?.published).map((p) => p.id);

  const filtered = items.filter((i) => {
    const id = itemId(i);
    if (access(id) === '-') return false;
    const name = i.kind === 'product' ? `${i.p.name} ${i.p.description}` : `${i.a.name} ${i.a.description}`;
    return (!q || name.toLowerCase().includes(q.toLowerCase())) && (!type || i.kind === type) &&
      (!domain || (i.kind === 'product' ? i.p.domain : i.a.domain) === domain) && (!status || statusOf(i) === status) &&
      (!kpis.length || kpis.every((k) => kpisOf(i).includes(k))) && (!mine || access(id) === 'G');
  });
  const featured = items.filter((i) => i.kind === 'product' && newly.includes(i.p.id) && access(i.p.id) !== '-');
  const open = items.find((i) => itemId(i) === openId);

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Marketplace"
        layer={['product', 'agent']}
        sub={`An internal app store for ${pack.profile.company}'s data products and agents. Certification state and access are live.`}
        right={steward ? <button className="btn" onClick={() => setQueue(true)}><Icon name="key" size={14} />Requests ({pendingCount})</button> : undefined}
      />
      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={14} className="absolute left-2.5 top-2.5 text-muted" />
          <input className="input pl-8" placeholder="Search products and agents" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search marketplace" />
        </div>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Type"><option value="">All types</option><option value="product">Data products</option><option value="agent">Agents</option></select>
        <select className="input w-auto" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain"><option value="">All domains</option>{domains.map((d) => <option key={d}>{d}</option>)}</select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Certification status"><option value="">Any status</option><option>Certified</option><option>In certification</option><option>Draft</option><option>Production</option><option>Pilot</option></select>
        <select className="input w-auto" value="" onChange={(e) => e.target.value && setKpis([...new Set([...kpis, e.target.value])])} aria-label="KPI I need"><option value="">KPI I need…</option>{pack.kpis.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only what I can access</label>
        {kpis.length > 0 && (
          <div className="flex w-full flex-wrap gap-1">
            {kpis.map((k) => <button key={k} className="chip border-accent/50 bg-accent/10 text-accent" onClick={() => setKpis(kpis.filter((x) => x !== k))}>{pack.kpis.find((x) => x.id === k)?.name}<Icon name="x" size={11} /></button>)}
          </div>
        )}
      </div>

      <section className="mb-5" aria-label="Certified this month">
        <div className="label mb-2">Certified this month</div>
        {featured.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{featured.map((i) => <Card key={itemId(i)} i={i} isNew onOpen={() => setSp({ item: itemId(i) })} />)}</div>
        ) : (
          <div className="rounded-md border border-dashed border-line px-4 py-3 text-sm text-muted">
            Nothing certified yet this month. {pack.products.find((p) => p.id === pack.certificationScript.productId)!.name} is in certification —{' '}
            <Link className="link" to={`/${pack.profile.id}/certify/${pack.certificationScript.productId}`}>open Certification Studio</Link>.
          </div>
        )}
      </section>

      <div className="mb-2 text-sm text-muted">{filtered.length} results</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((i) => <Card key={itemId(i)} i={i} isNew={i.kind === 'product' && newly.includes(i.p.id)} onOpen={() => setSp({ item: itemId(i) })} />)}
      </div>

      <Drawer open={Boolean(open)} onClose={() => setSp({})} title={open ? (open.kind === 'product' ? open.p.name : open.a.name) : ''} subtitle={open ? (open.kind === 'product' ? `${open.p.id} · ${open.p.domain} · data product` : `${open.a.id} · ${open.a.domain} · agent`) : ''}>
        {open && <Detail key={itemId(open)} i={open} tab={sp.get('tab') ?? 'overview'} setTab={(t) => setSp({ item: itemId(open), tab: t })} />}
      </Drawer>
      <Drawer open={queue} onClose={() => setQueue(false)} title="Access requests" subtitle={`Steward queue for ${pack.profile.company}`} width="max-w-xl">
        <StewardQueue />
      </Drawer>
    </div>
  );
}

function AccessButton({ id, onRequest }: { id: string; onRequest: () => void }) {
  const access = useAccess();
  const pack = usePack();
  const path = usePackPath();
  const navigate = useNavigate();
  const code = access(id);
  if (code === 'G') {
    const p = pack.products.find((x) => x.id === id);
    return <button className="btn" onClick={(e) => { e.stopPropagation(); navigate(p ? path(`explorer/DATA_PRODUCTS/${p.outputPort}`) : path(`agents/${id}`)); }}><Icon name="external" size={13} />Open</button>;
  }
  if (code === 'P') return <span className="chip border-dashed border-warn/50 bg-warn/10 py-1 text-warn"><Icon name="pending" size={12} />Pending</span>;
  return <button className="btn-primary" onClick={(e) => { e.stopPropagation(); onRequest(); }}><Icon name="key" size={13} />Request access</button>;
}

function Card({ i, isNew, onOpen }: { i: Item; isNew?: boolean; onOpen: () => void }) {
  const pack = usePack();
  const live = useLive();
  const [, setSp] = useSearchParams();
  const id = itemId(i);
  const kpis = (i.kind === 'product' ? i.p.kpiIds : i.a.kpiIds).slice(0, 3).map((k) => pack.kpis.find((x) => x.id === k)!).filter(Boolean);
  const status = i.kind === 'product' ? live.productStatus[i.p.id] : i.a.status;
  const health = useHealth();
  const acc = useAccuracy();
  const [ext] = useExt();
  const h = i.kind === 'product' ? health.product(i.p.id) : undefined;
  const breach = i.kind === 'product' && slaBreaches(pack, ext.cost).has(i.p.id);
  return (
    <article className="panel relative flex flex-col overflow-hidden p-4 hover:border-accent">
      {isNew && <span className="absolute right-[-34px] top-3 rotate-45 bg-seal px-10 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">New</span>}
      <button className="text-left" onClick={onOpen} aria-label={`Open details for ${i.kind === 'product' ? i.p.name : i.a.name}`}>
        <div className="flex items-start gap-2.5 pr-8">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md" style={{ background: `rgb(var(--layer-${i.kind === 'product' ? 'product' : 'agent'}) / 0.14)` }}><Icon name={i.kind === 'product' ? 'badge' : 'bot'} size={18} /></span>
          <div className="min-w-0">
            <div className="font-semibold">{i.kind === 'product' ? i.p.name : i.a.name}</div>
            <div className="text-xs text-muted">{id} · {i.kind === 'product' ? i.p.domain : i.a.domain} · {i.kind === 'product' ? i.p.owner : 'AI_PLATFORM_ADMIN'}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {status === 'Certified' ? <CertifiedSeal version={i.kind === 'product' ? live.productVersion[i.p.id] : undefined} /> : <StatusChip status={status} />}
          {h && h.status !== 'Healthy' && <HealthPill status={h.status} />}
          {breach && <span className="chip border-bad/40 bg-bad/10 text-bad"><Icon name="warn" size={11} />SLA breach</span>}
        </div>
        {h && h.incidents.length > 0 && <p className="mt-1 text-xs text-bad">Open incident: {h.incidents.map((x) => x.title).join(', ')}</p>}
        <p className="mt-2 line-clamp-2 text-sm text-muted">{i.kind === 'product' ? i.p.description : i.a.description}</p>
      </button>
      <div className="mt-2 flex flex-wrap gap-1">{kpis.map((k) => <KpiChip key={k.id} name={k.name} />)}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2 text-xs">
        {i.kind === 'product' ? (
          <>
            <div><div className="text-muted">Quality</div><div className="mono font-semibold">{fmtNum(i.p.qualityScore, 1)}</div></div>
            <div><div className="text-muted">Freshness</div><div>{i.p.freshness}</div></div>
            <div><div className="text-muted">Consumers</div><div className="mono">{i.p.consumers}</div></div>
          </>
        ) : (
          <>
            <div><div className="text-muted">Eval</div><div className="mono font-semibold">{acc(i.a.id)}%</div></div>
            <div><div className="text-muted">Products</div><div className="mono">{i.a.productIds.length || '—'}</div></div>
            <div><div className="text-muted">Questions</div><div className="mono">{i.a.evalQuestions}</div></div>
          </>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button className="btn-ghost text-xs" onClick={onOpen}>Details</button>
        <AccessButton id={id} onRequest={() => setSp({ item: id, tab: 'access' })} />
      </div>
    </article>
  );
}

function Detail({ i, tab, setTab }: { i: Item; tab: string; setTab: (t: string) => void }) {
  const pack = usePack();
  const db = useDb();
  const live = useLive();
  const path = usePackPath();
  const navigate = useNavigate();
  const id = itemId(i);
  const st = usePackState();
  const p = i.kind === 'product' ? i.p : undefined;
  const a = i.kind === 'agent' ? i.a : undefined;
  const tabs = p
    ? [{ id: 'overview', label: 'Overview' }, { id: 'kpis', label: 'KPIs & questions' }, { id: 'schema', label: 'Schema & contract' }, { id: 'lineage', label: 'Lineage' }, { id: 'quality', label: 'Quality' }, { id: 'usage', label: 'Consumers & usage' }, { id: 'access', label: 'Access' }]
    : [{ id: 'overview', label: 'Overview' }, { id: 'kpis', label: 'KPIs & questions' }, { id: 'access', label: 'Access' }];
  const kpis = (p ? p.kpiIds : a!.kpiIds).map((k) => pack.kpis.find((x) => x.id === k)!).filter(Boolean);
  const port = p ? db.getObject(`DATA_PRODUCTS.${p.outputPort}`) : undefined;
  const acc = useAccuracy();
  const health = useHealth();
  const h = p ? health.product(p.id) : undefined;
  return (
    <div className="space-y-4">
      <Tabs label="Details" tabs={tabs} value={tabs.some((t) => t.id === tab) ? tab : 'overview'} onChange={setTab} />
      {tab === 'overview' && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">{p ? (live.productStatus[p.id] === 'Certified' ? <CertifiedSeal version={live.productVersion[p.id]} size="lg" /> : <StatusChip status={live.productStatus[p.id]} />) : <StatusChip status={a!.status} />}{h && <HealthPill status={h.status} />}</div>
          {h && h.incidents.length > 0 && <div role="alert" className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm"><Icon name="warn" size={14} className="mr-1 inline text-bad" />{h.incidents.map((x) => `${x.title}: ${x.fault}`).join(' ')} <Link className="link" to={path('health/incidents')}>Open Data Health</Link></div>}
          <p>{p ? p.purpose : a!.description}</p>
          {p ? (
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="label">Owner</dt><dd>{p.owner}</dd></div>
              <div><dt className="label">Steward</dt><dd>{p.steward ?? <span className="text-bad">Not assigned</span>}</dd></div>
              <div><dt className="label">SLA</dt><dd>{p.sla}</dd></div>
              <div><dt className="label">Version</dt><dd className="mono">{live.productVersion[p.id]}</dd></div>
              <div><dt className="label">Last certified</dt><dd className="mono">{st?.cert[p.id]?.published?.date ?? p.lastCertified ?? '—'}</dd></div>
              <div><dt className="label">Output port</dt><dd className="mono break-all text-xs">{pack.database}.DATA_PRODUCTS.{p.outputPort}</dd></div>
              <div><dt className="label">Semantic view</dt><dd className="mono text-xs">{p.semanticView ?? '—'}</dd></div>
              <div><dt className="label">CDEs</dt><dd className="mono">{port?.columns.filter((c) => (c.tags ?? []).includes('CDE')).length ?? 0}</dd></div>
            </dl>
          ) : (
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="label">Object</dt><dd className="mono text-xs">{a!.objectName}</dd></div>
              <div><dt className="label">Eval accuracy</dt><dd>{acc(a!.id)}% ({a!.evalQuestions} questions)</dd></div>
              <div className="col-span-2"><dt className="label">Products used</dt><dd className="flex flex-wrap gap-1">{a!.productIds.map((x) => <span key={x} className="chip border-line">{x} {pack.products.find((pp) => pp.id === x)?.name} · {live.productStatus[x]}</span>)}{!a!.productIds.length && 'Glossary, Governance, DP registry'}</dd></div>
              <div className="col-span-2"><dt className="label">Tools</dt><dd className="flex flex-wrap gap-1">{a!.tools.map((t) => <span key={t.target + t.kind} className="chip border-line">{t.kind.replace('_', ' ')} · {t.target}</span>)}</dd></div>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            {p && <button className="btn" onClick={() => navigate(path(`certify/${p.id}`))}><Icon name="badge" size={13} />Certification record</button>}
            {a && <button className="btn" onClick={() => navigate(path(`agents/${a.id}`))}><Icon name="bot" size={13} />Open in Agent Studio</button>}
          </div>
        </div>
      )}
      {tab === 'kpis' && (
        <div className="space-y-3">
          <SimpleTable columns={['KPI', 'Definition', 'Unit']} rows={kpis.map((k) => [k.name, k.definition, k.unit])} />
          <div className="label">Sample questions</div>
          <ul className="list-disc space-y-1 pl-5 text-sm">{(p ? p.sampleQuestions : pack.scenarios.filter((s) => s.agentId === a!.id).map((s) => s.question)).map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {tab === 'schema' && p && (
        <div className="space-y-3">
          <SimpleTable columns={['Column', 'Type', 'CDE', 'Classification']} rows={(port?.columns ?? []).map((c) => [c.name, c.type, (c.tags ?? []).includes('CDE') ? 'yes' : '', (c.tags ?? []).filter((t) => t !== 'CDE').join(', ')])} />
          <CodeBlock code={p.contractYaml} lang="yaml" maxH="max-h-72" />
        </div>
      )}
      {tab === 'lineage' && p && (() => { const lin = db.lineage(`DATA_PRODUCTS.${p.outputPort}`, 3); return <LineageGraph nodes={lin.nodes} edges={lin.edges} focus={`DATA_PRODUCTS.${p.outputPort}`} onOpen={(n) => navigate(path(`explorer/${n.replace('.', '/')}`))} />; })()}
      {tab === 'quality' && p && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-3"><div className="font-display text-xl font-semibold">{fmtNum(p.qualityScore, 1)}</div><div className="text-muted">quality score (DMF composite)</div></div>
          <div><div className="label mb-1">DMF trend, 30 days</div><Sparkline values={series(p.id + 'q', p.qualityScore, 0.6)} w={320} h={48} tone="good" /></div>
          <SimpleTable columns={['Metric', 'Value', 'Status']} rows={db.dmf(`DATA_PRODUCTS.${p.outputPort}`).map((d) => [d.metric, fmtInt(d.value), d.status])} />
        </div>
      )}
      {tab === 'usage' && p && (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="panel p-3"><div className="label">Consumers</div><div className="font-display text-xl font-semibold">{p.consumers}</div></div>
            <div className="panel p-3"><div className="label">Queries / week</div><div className="font-display text-xl font-semibold">{fmtInt(p.queriesPerWeek)}</div></div>
          </div>
          <div><div className="label mb-1">Queries per week, 12 weeks</div><Sparkline values={series(p.id + 'u', p.queriesPerWeek || 1, (p.queriesPerWeek || 10) * 0.08, 12)} w={320} h={48} /></div>
          <div className="label">Top roles</div>
          <SimpleTable columns={['Role', 'Share of queries']} rows={pack.personas.filter((x) => pack.initialAccess[x.roleId]?.[p.id] === 'G').map((x, k, arr) => [x.roleId, `${Math.round(100 / arr.length + (k === 0 ? 12 : -12 / Math.max(1, arr.length - 1)))}%`])} />
        </div>
      )}
      {tab === 'access' && <AccessForm id={id} />}
    </div>
  );
}

function AccessForm({ id }: { id: string }) {
  const pack = usePack();
  const persona = usePersona();
  const access = useAccess();
  const st = usePackState();
  const requestAccess = useStore((s) => s.requestAccess);
  const [just, setJust] = useState('');
  const [dur, setDur] = useState<'30d' | '90d' | 'permanent'>('90d');
  const code = access(id);
  const mine = (st?.requests ?? []).filter((r) => r.role === persona.roleId && r.assetId === id);
  const last = mine[mine.length - 1];
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">Your access as <span className="mono">{persona.roleId}</span>: <AccessChip code={code} /></div>
      {persona.rowFilter && code === 'G' && <p className="text-muted">Rows are limited to {persona.rowFilter.allowed.join(' and ')} by {pack.rowAccessPolicy}; sensitive columns are masked by {pack.maskingPolicy}.</p>}
      {last && <div className="rounded-md border border-line p-3"><div className="label mb-1">Latest request</div><div className="mono text-xs">{last.id} · {last.createdAt} · {last.duration}</div><div className="mt-1">“{last.justification}”</div><div className="mt-1"><StatusChip status={last.status === 'pending' ? 'pending' : last.status} label={last.status === 'pending' ? 'Pending steward review' : undefined} /></div></div>}
      {code === 'R' && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); requestAccess(pack.profile.id, persona.roleId, id, just.trim(), dur); toast(`Request sent to the data steward for ${id}`); setJust(''); }}>
          <label className="block"><span className="label">Business justification</span>
            <textarea className="input mt-1 h-24" required value={just} onChange={(e) => setJust(e.target.value)} placeholder="What will you use it for?" />
          </label>
          <fieldset><legend className="label">Duration</legend>
            <div className="mt-1 flex gap-3">{(['30d', '90d', 'permanent'] as const).map((d) => <label key={d} className="flex items-center gap-1.5"><input type="radio" name="dur" checked={dur === d} onChange={() => setDur(d)} />{d === 'permanent' ? 'Permanent' : d.replace('d', ' days')}</label>)}</div>
          </fieldset>
          <button className="btn-primary" type="submit" disabled={!just.trim()}><Icon name="send" size={13} />Submit request</button>
        </form>
      )}
      {code === 'P' && <p className="text-muted">Your request is in the steward&apos;s queue. Switch to the Data steward persona to approve it.</p>}
      {code === 'G' && <p className="text-muted">You have access. Agents that use this product can now answer from it for you.</p>}
    </div>
  );
}

function StewardQueue() {
  const pack = usePack();
  const st = usePackState();
  const decide = useStore((s) => s.decide);
  const reqs = st?.requests ?? [];
  const pending = reqs.filter((r) => r.status === 'pending');
  const done = reqs.filter((r) => r.status !== 'pending').slice(-5).reverse();
  const nameOf = (id: string) => pack.products.find((p) => p.id === id)?.name ?? pack.agents.find((a) => a.id === id)?.name ?? id;
  const live = useLive();
  return (
    <div className="space-y-4">
      {pending.length === 0 && <p className="text-sm text-muted">No pending requests.</p>}
      {pending.map((r) => {
        const who = pack.personas.find((p) => p.roleId === r.role);
        const prod = pack.products.find((p) => p.id === r.assetId);
        return (
          <div key={r.id} className="rounded-md border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span className="mono text-xs text-muted">{r.id}</span><span className="font-medium">{who?.name}</span><span className="mono text-xs">{r.role}</span><span className="ml-auto text-xs text-muted">{r.createdAt}</span></div>
            <div className="mt-1">requests <strong>{r.assetId} {nameOf(r.assetId)}</strong> for {r.duration === 'permanent' ? 'permanent access' : r.duration.replace('d', ' days')}{prod && <> · <StatusChip status={live.productStatus[prod.id]} /></>}</div>
            <div className="mt-1 text-muted">“{r.justification}”</div>
            <div className="mt-2 flex gap-2">
              <button className="btn-primary" onClick={() => { decide(pack.profile.id, r.id, true); toast(`Approved: ${who?.name} can now use ${nameOf(r.assetId)}`, 'good'); }}><Icon name="check" size={13} />Approve</button>
              <button className="btn" onClick={() => { decide(pack.profile.id, r.id, false); toast(`Rejected ${r.id}`, 'warn'); }}><Icon name="x" size={13} />Reject</button>
            </div>
          </div>
        );
      })}
      {done.length > 0 && (
        <div>
          <div className="label mb-1">Recently decided</div>
          <ul className="space-y-1 text-sm">{done.map((r) => <li key={r.id} className={cls('flex items-center gap-2')}><StatusChip status={r.status as 'approved' | 'rejected'} /><span className="mono text-xs">{r.role}</span>{nameOf(r.assetId)}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
