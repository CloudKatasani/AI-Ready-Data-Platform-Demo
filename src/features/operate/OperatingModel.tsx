import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { layerColor, PageHeader } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, usePack, usePackPath, usePersona } from '../../app/context';
import { toast } from '../../app/toast';
import { LAYER_BY_ID } from '../../layers';
import { ARCHETYPE_ROLE, raciFor, raciMarkdown, ROLES, STYLES, type Raci } from '../../ext/raci';
import type { RoleKey } from '../../ext/buildGuide';
import type { RaciStyle } from '../../ext/state';

const CELL: Record<Exclude<Raci, ''>, string> = {
  'A/R': 'bg-accent text-white',
  A: 'bg-accent/80 text-white',
  R: 'bg-accent/25 text-ink',
  C: 'border border-line text-ink',
  I: 'text-muted',
};
const layerName = (l: string) => (l === 'setup' ? 'Platform setup' : LAYER_BY_ID[l as keyof typeof LAYER_BY_ID]?.label ?? l);

export default function OperatingModel() {
  const pack = usePack();
  const persona = usePersona();
  const path = usePackPath();
  const [ext, patch] = useExt();
  const [sp, setSp] = useSearchParams();
  const style = ext.raciStyle;
  const role = (sp.get('role') as RoleKey | null) ?? undefined;
  const [layer, setLayer] = useState<string>('all');
  const rows = useMemo(() => raciFor(style), [style]);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const labels: Record<string, string> = { ...Object.fromEntries(ROLES.map((r) => [r.id, r.label])), ...(pack.ext?.raciOverrides ?? {}) };
  const myRole = ARCHETYPE_ROLE[persona.archetype];

  const setStyle = (next: RaciStyle) => {
    if (next === style) return;
    const before = raciFor(style);
    const after = raciFor(next);
    const diff = new Set<string>();
    after.forEach(([name, , , cells], i) => ROLES.forEach((r) => { if ((cells[r.id] ?? '') !== (before[i][3][r.id] ?? '')) diff.add(`${name}|${r.id}`); }));
    patch((e) => ({ ...e, raciStyle: next }));
    setChanged(diff);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChanged(new Set()), 2000);
    toast(`${STYLES.find((s) => s.id === next)!.label}: ${diff.size} responsibilities moved`);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(raciMarkdown(style, labels)); toast('RACI copied as Markdown', 'good'); } catch { toast('Clipboard not available in this browser', 'warn'); }
  };
  const layers = [...new Set(rows.map((r) => r[1]))];
  const visible = rows.filter((r) => layer === 'all' || r[1] === layer);
  const roleActs = role ? rows.filter((r) => ['R', 'A', 'A/R'].includes(r[3][role] ?? '')) : [];

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Operating model"
        layer="gov"
        sub="AI-ready data is an ownership model as well as a stack: who builds, owns, approves and uses each layer."
        right={<button className="btn" onClick={copy}><Icon name="copy" size={13} />Copy RACI</button>}
      />
      <div role="note" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface2/60 px-3 py-2 text-sm">
        <Icon name="user" size={14} />
        <span>{persona.name} ({persona.title}) plays the <strong>{labels[myRole]}</strong> role in this model.</span>
        <button className="link ml-auto" onClick={() => setSp({ role: myRole }, { replace: true })}>Highlight my role</button>
      </div>

      <section className="panel p-4" aria-label="Operating style">
        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Operating style" className="inline-flex rounded-md border border-line p-0.5">
            {STYLES.map((s) => <button key={s.id} role="radio" aria-checked={style === s.id} className={cls('rounded px-3 py-1.5 text-sm', style === s.id ? 'bg-accent text-white' : 'hover:bg-surface2')} onClick={() => setStyle(s.id)}>{s.label}</button>)}
          </div>
          <p className="min-w-[240px] flex-1 text-sm text-muted">{STYLES.find((s) => s.id === style)!.when}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2"><span className="label">Layer</span>
            <select className="input py-1" value={layer} onChange={(e) => setLayer(e.target.value)}><option value="all">All layers</option>{layers.map((l) => <option key={l} value={l}>{layerName(l)}</option>)}</select>
          </label>
          <label className="flex items-center gap-2"><span className="label">Role</span>
            <select className="input py-1" value={role ?? ''} onChange={(e) => setSp(e.target.value ? { role: e.target.value } : {}, { replace: true })}><option value="">All roles</option>{ROLES.map((r) => <option key={r.id} value={r.id}>{labels[r.id]}</option>)}</select>
          </label>
          <span className="ml-auto flex flex-wrap gap-2 text-xs text-muted">{(['A/R', 'A', 'R', 'C', 'I'] as const).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className={cls('grid h-5 min-w-[28px] place-items-center rounded px-1 text-[11px] font-semibold', CELL[k])}>{k}</span>{{ 'A/R': 'Accountable and does it', A: 'Accountable', R: 'Responsible', C: 'Consulted', I: 'Informed' }[k]}</span>)}</span>
        </div>
      </section>

      {role && (
        <section className="panel mt-3 border-accent/50 p-4 text-sm" aria-label="Role summary">
          <div className="flex flex-wrap items-baseline gap-2"><h2 className="font-semibold">{labels[role]}</h2><span className="text-muted">{ROLES.find((r) => r.id === role)!.team} · {ROLES.find((r) => r.id === role)!.accountable}</span><button className="link ml-auto" onClick={() => setSp({}, { replace: true })}>Clear</button></div>
          <p className="mt-1">As a {labels[role].toLowerCase()} you {roleActs.length ? `are responsible or accountable for ${roleActs.length} activities in the ${STYLES.find((s) => s.id === style)!.label.toLowerCase()} model:` : 'are consulted or informed, and own no activity outright.'}</p>
          {roleActs.length > 0 && <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">{roleActs.map(([n, , route, c]) => <li key={n} className="flex items-center gap-2"><span className={cls('grid h-5 min-w-[28px] place-items-center rounded px-1 text-[11px] font-semibold', CELL[c[role] as Exclude<Raci, ''>])}>{c[role]}</span><Link className="hover:underline" to={path(route)}>{n}</Link></li>)}</ul>}
        </section>
      )}

      <section className="panel mt-3 overflow-x-auto scroll-thin" aria-label="RACI matrix">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium">Activity</th>
              {ROLES.map((r) => <th key={r.id} scope="col" className={cls('px-1 py-2 text-center font-medium', role === r.id && 'bg-accent/10 text-ink')}><button className="hover:underline" onClick={() => setSp(role === r.id ? {} : { role: r.id }, { replace: true })}>{labels[r.id]}</button></th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map(([name, l, route, cells], i) => (
              <tr key={name} className={cls('border-b border-line/50', i > 0 && visible[i - 1][1] !== l && 'border-t-2 border-t-line')}>
                <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-normal">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: l === 'setup' ? 'rgb(var(--muted))' : layerColor(l) }} title={layerName(l)} />
                  <Link className="hover:underline" to={path(route)}>{name}</Link>
                </th>
                {ROLES.map((r) => {
                  const v = cells[r.id] ?? '';
                  const hot = changed.has(`${name}|${r.id}`);
                  return (
                    <td key={r.id} className={cls('px-1 py-1 text-center', role === r.id && 'bg-accent/10')}>
                      {v ? <span className={cls('inline-grid h-6 min-w-[32px] place-items-center rounded px-1 text-xs font-semibold transition-shadow', CELL[v], hot && 'ring-2 ring-warn ring-offset-1 ring-offset-surface')} aria-label={`${labels[r.id]}: ${v}${hot ? ' (changed)' : ''}`}>{v}</span> : <span className="text-line" aria-label={`${labels[r.id]}: none`}>·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
