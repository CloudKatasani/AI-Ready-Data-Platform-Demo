import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { CertificationFailure, DataProduct, Gate, GateStatus } from '../../types';
import { CertifiedSeal, CodeBlock, Drawer, PageHeader, StatusChip } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { allPass, computeGates, gateStatus, releaseVersion } from '../../lib/certification';
import { useIsSteward, useLive, usePack, usePackPath, usePackState, usePersona } from '../../app/context';
import { useStore } from '../../store';
import { toast } from '../../app/toast';
import { addDays } from '../../mock-snowflake/generators';

export default function Certification() {
  const { product } = useParams();
  const pack = usePack();
  const path = usePackPath();
  const p = pack.products.find((x) => x.id === product);
  if (!p) return <Navigate to={path(`certify/${pack.certificationScript.productId}`)} replace />;
  return <Studio key={p.id} p={p} />;
}

const today = () => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

function Studio({ p }: { p: DataProduct }) {
  const pack = usePack();
  const live = useLive();
  const st = usePackState();
  const persona = usePersona();
  const steward = useIsSteward();
  const admin = useStore((s) => s.admin);
  const { runChecks, applyFix, publish, resetCert } = useStore();
  const path = usePackPath();
  const navigate = useNavigate();
  const cert = st?.cert[p.id];
  const gates = useMemo(() => computeGates(pack, p, cert), [pack, p, cert]);
  const status = live.productStatus[p.id];
  const isScript = p.id === pack.certificationScript.productId;
  const published = cert?.published;
  const [sel, setSel] = useState<number>(() => (isScript ? 4 : 1));
  const [anim, setAnim] = useState<{ ids: string[]; i: number } | null>(null);
  const [fixOpen, setFixOpen] = useState<CertificationFailure | null>(null);
  const timer = useRef<number>();

  useEffect(() => () => window.clearInterval(timer.current), []);

  const animate = (ids: string[], firstGate: number) => {
    window.clearInterval(timer.current);
    setSel(firstGate);
    setAnim({ ids, i: 0 });
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      const id = ids[i];
      if (id) setSel(Number(id.slice(1, 2)));
      if (i >= ids.length) {
        window.clearInterval(timer.current);
        setAnim(null);
        const failing = computeGates(pack, p, useStore.getState().packs[pack.profile.id]?.cert[p.id]).find((g) => gateStatus(g) === 'fail' || gateStatus(g) === 'warn');
        if (failing) setSel(failing.id);
      } else setAnim({ ids, i });
    }, 300);
  };

  const shown = (g: Gate): Gate => {
    if (!anim) return g;
    return { ...g, checks: g.checks.map((c) => { const k = anim.ids.indexOf(c.id); return k >= anim.i ? { ...c, status: 'pending' as GateStatus } : c; }) };
  };
  const running = (checkId: string) => anim?.ids[anim.i] === checkId;

  const runAll = () => {
    runChecks(pack.profile.id, p.id);
    animate(gates.filter((g) => g.id >= 4).flatMap((g) => g.checks.map((c) => c.id)), 4);
  };
  const doFix = (f: CertificationFailure) => {
    applyFix(pack.profile.id, p.id, f.checkId);
    setFixOpen(null);
    toast(f.fix.kind === 'masking' ? `${pack.maskingPolicy} attached · re-running gate ${f.gate}` : `${f.fix.items.length} verified queries approved · re-running gate ${f.gate}`, 'good');
    animate(gates.find((g) => g.id === f.gate)!.checks.map((c) => c.id), f.gate);
  };
  const ready = isScript && cert?.ran && !anim && allPass(gates) && !published;
  const version = releaseVersion(p.version);
  const doPublish = () => {
    publish(pack.profile.id, p.id, { version, certifier: admin && persona.archetype !== 'D' ? 'PLATFORM_ADMIN' : `${persona.name} (${persona.roleId})`, date: today(), score: Math.round((p.qualityScore + 2.9) * 10) / 10 });
    toast(`${p.name} v${version} certified and published to the Marketplace`, 'good');
  };

  const g = shown(gates.find((x) => x.id === sel) ?? gates[0]);
  const contract = published ? p.contractYaml.replace(/^version: .*$/m, `version: ${published.version}`).replace(/^status: .*$/m, 'status: Certified') : p.contractYaml;

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
      <PageHeader
        title="Certification Studio"
        layer="product"
        sub="A data product earns the Certified badge by passing eight gates built from the layers below it."
        right={isScript && (cert?.ran || published) ? <button className="btn" onClick={() => { resetCert(pack.profile.id, p.id); setSel(4); toast(`${p.name} certification reset`); }}><Icon name="reset" size={14} />Reset demo</button> : undefined}
      />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scroll-thin" role="tablist" aria-label="Data products">
        {pack.products.map((x) => (
          <Link key={x.id} role="tab" aria-selected={x.id === p.id} to={path(`certify/${x.id}`)} className={cls('panel shrink-0 px-3 py-2 hover:border-accent', x.id === p.id && 'border-[rgb(var(--layer-product))] ring-1 ring-[rgb(var(--layer-product))]')}>
            <div className="text-sm font-semibold">{x.id} {x.name}</div>
            <div className="mt-1"><StatusChip status={live.productStatus[x.id]} /></div>
          </Link>
        ))}
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-md font-semibold">{p.name}</h2>
            <span className="mono text-xs text-muted">v{live.productVersion[p.id]}</span>
            {status === 'Certified' ? <CertifiedSeal version={live.productVersion[p.id]} /> : <StatusChip status={status} />}
          </div>
          <div className="mt-1 text-xs text-muted">{p.owner} · steward {p.steward ?? 'not assigned'} · {p.sla} · output port <span className="mono break-all">{pack.database}.DATA_PRODUCTS.{p.outputPort}</span></div>
        </div>
        {isScript && !published && (
          <>
            <button className="btn" onClick={runAll} disabled={Boolean(anim)}><Icon name="play" size={13} />{cert?.ran ? 'Re-run certification checks' : 'Run certification checks'}</button>
            <span title={steward ? '' : 'Needs DATA_STEWARD, or admin mode (Shift+A)'}>
              <button className="btn-primary" disabled={!ready || !steward} onClick={doPublish}><Icon name="badge" size={14} />Certify &amp; publish v{version}</button>
            </span>
          </>
        )}
      </div>
      {isScript && ready && !steward && <div className="mb-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">All gates pass. Switch to the Data steward persona, or turn on admin mode (Shift+A), to certify and publish.</div>}

      {published && (
        <div className="panel mb-4 flex flex-wrap items-center gap-4 border-seal/60 bg-seal/5 p-4" role="status">
          <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-seal text-seal"><Icon name="badge" size={28} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-semibold">Certificate · {p.name} v{published.version}</div>
            <div className="text-sm text-muted">Certified by {published.certifier} on {published.date} · score {published.score} · tag <span className="mono">CERTIFICATION = 'GOLD'</span> applied to {p.outputPort}</div>
          </div>
          <button className="btn" onClick={() => navigate(path(`marketplace?item=${p.id}`))}><Icon name="store" size={14} />View in Marketplace</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <ol className="panel space-y-1 p-2" aria-label="Certification gates">
          {gates.map((raw) => {
            const gg = shown(raw);
            const s = gateStatus(gg);
            const isRunning = gg.checks.some((c) => running(c.id));
            return (
              <li key={gg.id}>
                <button onClick={() => setSel(gg.id)} aria-current={sel === gg.id} className={cls('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left', sel === gg.id ? 'bg-surface2' : 'hover:bg-surface2/60')}>
                  <span className={cls('grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold', s === 'pass' ? 'border-good text-good' : s === 'warn' ? 'border-warn text-warn' : s === 'fail' ? 'border-bad text-bad' : 'border-dashed border-line text-muted', isRunning && 'animate-pulse')}>
                    {s === 'pass' ? <Icon name="check" size={14} /> : s === 'fail' ? <Icon name="x" size={14} /> : s === 'warn' ? '!' : gg.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{gg.id}. {gg.name}</span>
                    <span className="block text-xs text-muted">{isRunning ? 'Checking…' : status === 'Certified' && !isScript ? `Passed ${addDays(p.lastCertified ?? '2026-06-01', -(8 - gg.id))}` : `${gg.checks.filter((c) => c.status === 'pass').length}/${gg.checks.length} checks pass`}</span>
                  </span>
                  <StatusChip status={s} />
                </button>
              </li>
            );
          })}
          {p.status === 'Draft' && <li className="px-2.5 py-2 text-xs text-muted">Gates 3–8 not started: a Draft product needs a steward and a semantic view before it can enter certification.</li>}
        </ol>

        <section className="panel min-w-0 p-4" aria-live="polite">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-semibold">Gate {g.id}: {g.name}</h3>
            <span className="ml-auto"><StatusChip status={gateStatus(g)} /></span>
          </div>
          <ul className="space-y-2">
            {g.checks.map((c) => {
              const f = isScript && cert?.ran ? pack.certificationScript.failures.find((x) => x.checkId === c.id && !cert.fixes.includes(x.checkId)) : undefined;
              return (
                <li key={c.id} className={cls('flex flex-wrap items-start gap-3 rounded-md border p-3', c.status === 'fail' ? 'border-bad/40 bg-bad/5' : c.status === 'warn' ? 'border-warn/40 bg-warn/5' : 'border-line')}>
                  <span className="pt-0.5">{running(c.id) ? <span className="typing text-xs text-muted"><span>●</span><span>●</span><span>●</span></span> : <StatusChip status={c.status} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="text-xs text-muted">{c.detail}</div>
                  </div>
                  {f && c.status !== 'pass' && !anim && <button className="btn" onClick={() => setFixOpen(f)}><Icon name="sparkle" size={13} />{f.fix.label}</button>}
                </li>
              );
            })}
          </ul>
          {isScript && !cert?.ran && sel >= 4 && <p className="mt-3 text-sm text-muted">Gates 4–8 have not been run for this release candidate. Click <strong>Run certification checks</strong>.</p>}
        </section>
      </div>

      <section className="panel mt-4 p-4">
        <div className="mb-2 flex items-center gap-2"><Icon name="doc" size={15} /><h3 className="font-semibold">Data contract</h3><span className="mono text-xs text-muted">{p.id}.yaml</span></div>
        <CodeBlock code={contract} lang="yaml" maxH="max-h-80" />
      </section>

      <Drawer open={Boolean(fixOpen)} onClose={() => setFixOpen(null)} title={fixOpen?.fix.label ?? ''} subtitle={fixOpen ? `Gate ${fixOpen.gate}: ${fixOpen.detail}` : ''}>
        {fixOpen && <FixPanel f={fixOpen} onApply={() => doFix(fixOpen)} />}
      </Drawer>
    </div>
  );
}

function FixPanel({ f, onApply }: { f: CertificationFailure; onApply: () => void }) {
  const pack = usePack();
  const p = pack.products.find((x) => x.id === pack.certificationScript.productId)!;
  const [checked, setChecked] = useState(f.fix.items.map(() => true));
  if (f.fix.kind === 'masking') {
    return (
      <div className="space-y-4">
        <p className="text-sm">The column is tagged as sensitive, but no masking policy is attached, so every role sees it in clear text. Attaching <span className="mono">{pack.maskingPolicy}</span> masks it for everyone except the data steward, in the Explorer, the Marketplace preview and agent answers.</p>
        <CodeBlock code={f.fix.items.join('\n')} />
        <button className="btn-primary" onClick={onApply}><Icon name="lock" size={14} />Attach {pack.maskingPolicy}</button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">Cortex Analyst suggested these questions for <span className="mono">{p.semanticView}</span>. Approving them adds them to <span className="mono">CONTEXT.VERIFIED_QUERIES</span>, which brings the count to 10.</p>
      <ul className="space-y-2">
        {f.fix.items.map((q, i) => (
          <li key={q} className="rounded-md border border-line p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={checked[i]} onChange={(e) => setChecked(checked.map((c, k) => (k === i ? e.target.checked : c)))} />
              <span>
                <span className="font-medium">{q}</span>
                <code className="mono mt-1 block text-[11px] text-muted">SELECT * FROM SEMANTIC_VIEW({pack.database}.SEMANTIC.{p.semanticView} …)</code>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button className="btn-primary" disabled={!checked.every(Boolean)} onClick={onApply}><Icon name="check" size={14} />Approve {f.fix.items.length} verified queries</button>
    </div>
  );
}
