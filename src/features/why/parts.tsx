import { Link } from 'react-router-dom';
import type { KnockoutRun } from '../../ext/knockout';
import { fmtDelta, SEVERITY_LABEL } from '../../ext/knockout';
import { SWITCHES, type KnockoutResult, type LayerSwitches, type SwitchableLayer } from '../../ext/types';
import { CertifiedSeal, CodeBlock, layerColor, SimpleTable, StatusChip } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { usePack, usePackPath } from '../../app/context';
import type { MiniStep } from '../../ext/knockout';

export function SwitchRow({ value, onChange, compact }: { value: LayerSwitches; onChange: (id: SwitchableLayer, on: boolean) => void; compact?: boolean }) {
  return (
    <div role="group" aria-label="Layer switches" className={cls('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6')}>
      {SWITCHES.map((s) => {
        const on = value[s.id];
        return (
          <button
            key={s.id} role="switch" aria-checked={on} onClick={() => onChange(s.id, !on)}
            className={cls('flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors', on ? 'border-transparent' : 'border-dashed border-line bg-surface')}
            style={on ? { background: layerColor(s.layer, 0.16) } : undefined}
          >
            <span className={cls('relative h-5 w-9 shrink-0 rounded-full transition-colors', on ? '' : 'bg-line')} style={on ? { background: layerColor(s.layer) } : undefined} aria-hidden>
              <span className={cls('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">{s.label}</span>
              {!compact && <span className="block truncate text-[11px] text-muted">{on ? s.blurb : 'Layer off'}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const CONF_TONE = { Trusted: 'border-good/40 bg-good/10 text-good', Questionable: 'border-warn/50 bg-warn/10 text-warn', Unsafe: 'border-bad/40 bg-bad/10 text-bad' };
const CONF_ICON = { Trusted: 'pass', Questionable: 'warn', Unsafe: 'fail' };

export function ConfidenceBadge({ c }: { c: KnockoutRun['confidence'] }) {
  return <span className={cls('chip', c === 'Trusted' ? 'rounded-full' : 'rounded-sm', CONF_TONE[c])}><Icon name={CONF_ICON[c]} size={12} />{c}</span>;
}

export function MiniTrace({ steps }: { steps: MiniStep[] }) {
  return (
    <ol className="space-y-1" aria-label="Mini trace">
      {steps.map((s, i) => (
        <li key={i} className={cls('rounded border px-2 py-1 text-xs', s.skipped ? 'border-dashed border-line text-muted' : 'border-line')} style={s.skipped ? undefined : { borderLeft: `3px solid ${layerColor(s.layer)}` }}>
          <span className="font-medium">{s.title}</span>{s.skipped && <span className="ml-1.5 rounded bg-surface2 px-1 text-[10px] uppercase tracking-wide">Layer off</span>}
          <span className="block truncate text-[11px] text-muted" title={s.note}>{s.note}</span>
        </li>
      ))}
    </ol>
  );
}

export function AnswerCard({ title, run, result, reference, busy }: { title: string; run?: KnockoutRun; result: KnockoutResult; reference?: boolean; busy?: boolean }) {
  const pack = usePack();
  const conf = run?.confidence ?? 'Trusted';
  return (
    <section className={cls('panel flex min-w-0 flex-col p-4 transition-opacity', busy && 'opacity-40')} aria-label={title} aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="ml-auto"><ConfidenceBadge c={conf} /></span>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-2">
        <div className="font-display text-[34px] font-semibold leading-none tabnum">{result.valueText}</div>
        {!reference && run?.deltaPct !== undefined && (
          <span className="chip border-bad/40 bg-bad/10 text-bad" title="Difference against the governed answer">{fmtDelta(run.deltaPct)} vs. governed answer</span>
        )}
      </div>
      <div className="mt-1 text-xs text-muted">{result.caption}</div>
      {result.hiddenWarning && <div className="mt-2 rounded-md border border-dashed border-warn/60 px-2 py-1 text-xs text-warn"><Icon name="eye" size={12} className="mr-1 inline" />{result.hiddenWarning}</div>}
      {result.exposed?.length ? <div className="mt-2 rounded-md border border-bad/40 bg-bad/10 px-2 py-1 text-xs text-bad"><Icon name="warn" size={12} className="mr-1 inline" />Exposed in clear: {result.exposed.join(', ')}</div> : null}
      {result.table && result.table.rows.length > 0 && <div className="mt-3"><SimpleTable columns={result.table.columns} rows={result.table.rows} masked={result.table.masked} /></div>}
      <ul className="mt-3 space-y-1 text-xs">
        {result.notes.map((n) => <li key={n} className="flex gap-1.5"><Icon name="info" size={12} className="mt-0.5 shrink-0 text-muted" />{n}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {result.sources.map((s) => {
          const p = pack.products.find((x) => x.id === s.productId);
          return s.certified ? <span key={s.productId} className="inline-flex items-center gap-1"><CertifiedSeal version={s.version} /><span className="text-muted">{p?.name}</span></span>
            : <StatusChip key={s.productId} status={p?.status ?? 'Draft'} label={`${p?.name ?? s.productId} v${s.version}`} />;
        })}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-accent">Generated SQL</summary>
        <div className="mt-2"><CodeBlock code={result.sql} maxH="max-h-40" /></div>
      </details>
      {run && <div className="mt-3"><div className="label mb-1">Trace</div><MiniTrace steps={run.trace} /></div>}
    </section>
  );
}

export function FailureStrip({ run, links }: { run: KnockoutRun; links: Partial<Record<SwitchableLayer, string>> }) {
  const path = usePackPath();
  return (
    <section className="panel p-4" aria-label="What went wrong" aria-live="polite">
      <h3 className="mb-2 text-sm font-semibold">What went wrong</h3>
      {run.failures.length === 0 ? (
        <p className="text-sm text-muted">Nothing: with these switches the answer matches the governed one. Switch off a layer to see what it protects.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {run.failures.map((f) => {
            const sw = SWITCHES.find((x) => x.id === f.layer)!;
            const to = links[f.layer];
            const body = (
              <>
                <span className="flex items-center gap-2 text-xs font-semibold"><span className="h-3 w-3 rounded-sm" style={{ background: layerColor(sw.layer) }} />{sw.label} off<span className="ml-auto text-[11px] font-normal text-muted">{SEVERITY_LABEL[f.severity]}</span></span>
                <span className="mt-1 block text-sm">{f.reason}</span>
              </>
            );
            return (
              <li key={f.layer}>
                {to ? <Link to={path(to)} className="block rounded-md border border-line p-3 hover:border-accent" style={{ borderLeft: `4px solid ${layerColor(sw.layer)}` }}>{body}</Link>
                  : <div className="rounded-md border border-line p-3" style={{ borderLeft: `4px solid ${layerColor(sw.layer)}` }}>{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
