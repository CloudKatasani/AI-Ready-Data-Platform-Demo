import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AccessCode, Cell, LayerId } from '../types';
import { LAYER_BY_ID, LAYERS } from '../layers';
import { tokenizeSql, tokenizeYaml } from '../mock-snowflake/ddl';
import { cls, fmtNum } from '../lib/format';
import { Icon } from './icons';

export const layerColor = (id: LayerId, alpha = 1) => `rgb(var(--layer-${id}) / ${alpha})`;

export function LayerDot({ layer, size = 8 }: { layer: LayerId; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: layerColor(layer) }} />;
}

export function LayerBadge({ layer, short }: { layer: LayerId; short?: boolean }) {
  const l = LAYER_BY_ID[layer];
  return (
    <span className="chip border-transparent" style={{ background: layerColor(layer, 0.14), color: 'rgb(var(--ink))' }}>
      <LayerDot layer={layer} />
      {short ? l.label : `${l.n}. ${l.label}`}
    </span>
  );
}

/** Thin ribbon of the nine layer colours with the current layer highlighted (spec section 3). */
export function LayerRibbon({ current }: { current: LayerId | LayerId[] }) {
  const cur = Array.isArray(current) ? current : [current];
  return (
    <div className="flex h-1.5 w-full gap-0.5" role="img" aria-label={`Layer: ${cur.map((c) => LAYER_BY_ID[c].label).join(', ')}`}>
      {LAYERS.map((l) => (
        <div key={l.id} title={l.label} className="h-full flex-1 rounded-sm transition-opacity" style={{ background: layerColor(l.id), opacity: cur.includes(l.id) ? 1 : 0.22 }} />
      ))}
    </div>
  );
}

type Status = 'Certified' | 'In certification' | 'Draft' | 'pass' | 'warn' | 'fail' | 'pending' | 'Production' | 'Pilot' | 'Approved' | 'Deprecated' | 'approved' | 'rejected';

const STATUS: Record<Status, { tone: 'good' | 'warn' | 'bad' | 'muted' | 'seal' | 'accent'; icon: string; label?: string; shape: string }> = {
  Certified: { tone: 'seal', icon: 'badge', shape: 'rounded-full' },
  'In certification': { tone: 'accent', icon: 'pending', shape: 'rounded-full border-dashed' },
  Draft: { tone: 'muted', icon: 'doc', shape: 'rounded-sm border-dashed' },
  pass: { tone: 'good', icon: 'pass', label: 'Pass', shape: 'rounded-full' },
  warn: { tone: 'warn', icon: 'warn', label: 'Warn', shape: 'rounded-sm' },
  fail: { tone: 'bad', icon: 'fail', label: 'Fail', shape: 'rounded-sm' },
  pending: { tone: 'muted', icon: 'pending', label: 'Not run', shape: 'rounded-full border-dashed' },
  Production: { tone: 'good', icon: 'check', shape: 'rounded-full' },
  Pilot: { tone: 'accent', icon: 'sparkle', shape: 'rounded-full border-dashed' },
  Approved: { tone: 'good', icon: 'check', shape: 'rounded-full' },
  Deprecated: { tone: 'bad', icon: 'x', shape: 'rounded-sm' },
  approved: { tone: 'good', icon: 'check', label: 'Approved', shape: 'rounded-full' },
  rejected: { tone: 'bad', icon: 'x', label: 'Rejected', shape: 'rounded-sm' },
};

const toneCls = (t: string) =>
  t === 'good' ? 'text-good border-good/40 bg-good/10'
  : t === 'warn' ? 'text-warn border-warn/50 bg-warn/10'
  : t === 'bad' ? 'text-bad border-bad/40 bg-bad/10'
  : t === 'seal' ? 'text-seal border-seal/50 bg-seal/10'
  : t === 'accent' ? 'text-accent border-accent/50 bg-accent/10'
  : 'text-muted border-line bg-surface2';

export function StatusChip({ status, label }: { status: Status; label?: string }) {
  const s = STATUS[status];
  return (
    <span className={cls('chip', s.shape, toneCls(s.tone))}>
      <Icon name={s.icon} size={12} />
      {label ?? s.label ?? status}
    </span>
  );
}

export function AccessChip({ code }: { code: AccessCode }) {
  if (code === 'G') return <span className={cls('chip rounded-full', toneCls('good'))}><Icon name="check" size={12} />Granted</span>;
  if (code === 'P') return <span className={cls('chip rounded-full border-dashed', toneCls('warn'))}><Icon name="pending" size={12} />Pending</span>;
  if (code === 'R') return <span className={cls('chip rounded-sm', toneCls('muted'))}><Icon name="lock" size={12} />Request</span>;
  return <span className={cls('chip rounded-sm', toneCls('muted'))}><Icon name="x" size={12} />Hidden</span>;
}

export function CertifiedSeal({ version, size = 'sm' }: { version?: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={cls('inline-flex items-center gap-1 rounded-full border border-seal/60 bg-seal/10 font-semibold text-seal', size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs')}>
      <Icon name="badge" size={size === 'lg' ? 16 : 12} />
      Certified{version ? ` · v${version}` : ''}
    </span>
  );
}

export function KpiChip({ name, onClick, state }: { name: string; onClick?: () => void; state?: 'ok' | 'locked' }) {
  const C = onClick ? 'button' : 'span';
  return (
    <C onClick={onClick} className={cls('chip border-line bg-surface2 text-ink', onClick && 'hover:border-accent')}>
      {state === 'locked' ? <Icon name="lock" size={11} /> : state === 'ok' ? <Icon name="check" size={11} className="text-good" /> : null}
      {name}
    </C>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line scroll-thin">
      {tabs.map((t) => (
        <button
          key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cls('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', value === t.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded bg-surface2 px-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function CodeBlock({ code, lang = 'sql', maxH = 'max-h-[420px]', copy = true }: { code: string; lang?: 'sql' | 'yaml'; maxH?: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const toks = lang === 'sql' ? tokenizeSql(code) : tokenizeYaml(code);
  return (
    <div className="relative rounded-md border border-line bg-surface2/60">
      {copy && (
        <button
          className="btn-ghost absolute right-1.5 top-1.5 z-10 bg-surface/80"
          onClick={() => {
            void navigator.clipboard?.writeText(code).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          aria-label="Copy code"
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
        </button>
      )}
      <pre className={cls('overflow-auto p-3 pr-20 font-mono text-xs leading-5 scroll-thin', maxH)}>
        <code>
          {toks.map((t, i) => (
            <span key={i} className={t.t === 'id' || t.t === 'punc' ? undefined : `tok-${t.t}`}>{t.v}</span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 'max-w-2xl', subtitle }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'} className={cls('relative flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl outline-none', width)}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-md font-semibold">{title}</div>
            {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 scroll-thin">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, sub, layer, right }: { title: string; sub?: ReactNode; layer?: LayerId | LayerId[]; right?: ReactNode }) {
  return (
    <div className="mb-4 space-y-3">
      {layer && <LayerRibbon current={layer} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="h-title">{title}</h1>
          {sub && <p className="mt-1 max-w-3xl text-sm text-muted">{sub}</p>}
        </div>
        {right}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, onClick }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C onClick={onClick} className={cls('panel px-4 py-3 text-left', onClick && 'hover:border-accent')}>
      <div className="label">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold tabnum">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </C>
  );
}

export function Sparkline({ values, w = 120, h = 28, tone = 'accent' }: { values: number[]; w?: number; h?: number; tone?: string }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1 || 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label={`Trend from ${fmtNum(values[0], 1)} to ${fmtNum(values[values.length - 1], 1)}`}>
      <polyline points={pts} fill="none" stroke={`rgb(var(--${tone}))`} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

export function BarChart({ labels, values, unit, decimals = 1, color = 'rgb(var(--accent))' }: { labels: string[]; values: number[]; unit?: string; decimals?: number; color?: string }) {
  const max = Math.max(...values.map(Math.abs), 1);
  return (
    <div className="space-y-1.5" role="img" aria-label={`Bar chart${unit ? ` (${unit})` : ''}: ${labels.map((l, i) => `${l} ${fmtNum(values[i], decimals)}`).join(', ')}`}>
      {labels.map((l, i) => (
        <div key={l + i} className="grid grid-cols-[minmax(80px,30%)_1fr_auto] items-center gap-2 text-xs">
          <div className="truncate text-muted" title={l}>{l}</div>
          <div className="h-3.5 rounded-sm bg-surface2">
            <div className="h-full rounded-sm" style={{ width: `${(Math.abs(values[i]) / max) * 100}%`, background: color }} />
          </div>
          <div className="mono w-20 text-right">{fmtNum(values[i], decimals)}{unit && unit !== 'USD' ? ` ${unit}` : ''}</div>
        </div>
      ))}
    </div>
  );
}

export function LineChart({ labels, values, unit, h = 140 }: { labels: string[]; values: number[]; unit?: string; h?: number }) {
  const w = 420;
  const pad = { l: 44, r: 10, t: 10, b: 22 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const lo = min - (max - min) * 0.15;
  const hi = max + (max - min) * 0.15 || max + 1;
  const x = (i: number) => pad.l + (i / Math.max(1, values.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`Line chart${unit ? ` (${unit})` : ''}: ${labels.map((l, i) => `${l} ${fmtNum(values[i], 1)}`).join(', ')}`}>
      {[lo, (lo + hi) / 2, hi].map((g, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={y(g)} y2={y(g)} stroke="rgb(var(--line))" strokeWidth={1} />
          <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="rgb(var(--muted))" className="font-mono">{fmtNum(g, g > 100 ? 0 : 1)}</text>
        </g>
      ))}
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} strokeLinejoin="round" />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="rgb(var(--surface))" stroke="rgb(var(--accent))" strokeWidth={2} />)}
      {labels.map((l, i) => (i % Math.ceil(labels.length / 7) === 0 || i === labels.length - 1) && (
        <text key={l} x={x(i)} y={h - 6} textAnchor="middle" fontSize={10} fill="rgb(var(--muted))">{l}</text>
      ))}
    </svg>
  );
}

export function CellView({ v, masked, type }: { v: Cell; masked?: boolean; type?: string }) {
  if (v === null || v === undefined) return <span className="italic text-muted/70">NULL</span>;
  if (masked) return <span className="inline-flex items-center gap-1 text-muted"><Icon name="lock" size={11} />{String(v)}</span>;
  if (typeof v === 'boolean') return <span className={v ? 'text-good' : 'text-muted'}>{v ? 'TRUE' : 'FALSE'}</span>;
  if (typeof v === 'number') return <span>{Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 3 })}</span>;
  const s = String(v);
  if (type?.startsWith('VARCHAR') && s !== s.trim()) return <span className="whitespace-pre">{`'${s}'`}<span className="ml-1 text-warn" title="Untrimmed string (CDC noise)">␠</span></span>;
  return <span className="whitespace-pre">{s}</span>;
}

const isNumType = (t?: string) => !!t && /^(NUMBER|FLOAT|INTEGER)/.test(t);

export function DataGrid({ columns, rows, masked = [], types = {}, highlight, maxH = 'max-h-[440px]' }: { columns: string[]; rows: Record<string, Cell>[] | Cell[][]; masked?: string[]; types?: Record<string, string>; highlight?: (r: Record<string, Cell>) => string | undefined; maxH?: string }) {
  const asObj = (r: Record<string, Cell> | Cell[]): Record<string, Cell> => (Array.isArray(r) ? Object.fromEntries(columns.map((c, i) => [c, r[i]])) : r);
  return (
    <div className={cls('overflow-auto rounded-md border border-line scroll-thin', maxH)}>
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 z-[1] bg-surface2">
          <tr>
            <th className="w-8 border-b border-line px-2 py-1.5 text-right font-mono font-normal text-muted">#</th>
            {columns.map((c) => (
              <th key={c} scope="col" className={cls('whitespace-nowrap border-b border-line px-2.5 py-1.5 font-mono font-medium', isNumType(types[c]) ? 'text-right' : 'text-left')}>
                <span className="inline-flex items-center gap-1">{masked.includes(c) && <Icon name="lock" size={11} className="text-muted" />}{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabnum">
          {rows.map((r0, i) => {
            const r = asObj(r0);
            const hl = highlight?.(r);
            return (
              <tr key={i} className={cls('border-b border-line/60 hover:bg-surface2/50', hl)}>
                <td className="px-2 py-1 text-right text-muted">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c} className={cls('whitespace-nowrap px-2.5 py-1', (isNumType(types[c]) || typeof r[c] === 'number') && 'text-right')}>
                    <CellView v={r[c]} masked={masked.includes(c)} type={types[c]} />
                  </td>
                ))}
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted">No rows visible for your role.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SimpleTable({ columns, rows, masked = [] }: { columns: string[]; rows: (string | number)[][]; masked?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line scroll-thin">
      <table className="min-w-full text-xs">
        <thead className="bg-surface2">
          <tr>{columns.map((c) => <th key={c} scope="col" className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line/70">
              {r.map((v, j) => (
                <td key={j} className={cls('whitespace-nowrap px-2.5 py-1.5', typeof v === 'number' || /^[$\d.,%\s-]+$|^\$/.test(String(v)) ? 'mono text-right' : '')}>
                  {masked.includes(j) ? <span className="inline-flex items-center gap-1 text-muted"><Icon name="lock" size={11} />{v}</span> : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Icon name="info" size={20} className="text-muted" />
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}
