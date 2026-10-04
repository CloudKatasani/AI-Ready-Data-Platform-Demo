import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/icons';
import { LayerDot } from '../components/ui';
import { cls } from '../lib/format';
import type { LayerId } from '../types';
import { usePack } from './context';
import { NAV } from './NavRail';

interface Item { kind: string; label: string; sub: string; route: string; layer: LayerId; icon: string }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pack = usePack();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo<Item[]>(() => [
    ...NAV.flatMap((g) => g.items).map((t) => ({ kind: 'Tab', label: t.label, sub: g(t.id), route: t.id, layer: t.layer, icon: t.icon })),
    ...pack.objects.map((o) => ({ kind: o.type, label: o.name, sub: `${pack.database}.${o.schema}`, route: `explorer/${o.schema}/${o.name}`, layer: o.layer, icon: 'database' })),
    ...pack.glossary.map((t) => ({ kind: t.isCde ? 'Term · CDE' : 'Term', label: t.term, sub: `${t.id} · ${t.domain}`, route: `glossary/${t.id}`, layer: 'glossary' as LayerId, icon: 'book' })),
    ...pack.kpis.map((k) => ({ kind: 'KPI', label: k.name, sub: `${k.id} · ${k.metric}`, route: `my-access?kpi=${k.id}`, layer: 'semantic' as LayerId, icon: 'sparkle' })),
    ...pack.products.map((p) => ({ kind: 'Data product', label: p.name, sub: `${p.id} · ${p.domain}`, route: `marketplace?item=${p.id}`, layer: 'product' as LayerId, icon: 'badge' })),
    ...pack.agents.map((a) => ({ kind: 'Agent', label: a.name, sub: `${a.id} · ${a.objectName}`, route: `agents/${a.id}`, layer: 'agent' as LayerId, icon: 'bot' })),
    ...pack.semanticViews.map((s) => ({ kind: 'Semantic view', label: s.name, sub: s.description, route: `semantic/${s.name}`, layer: 'semantic' as LayerId, icon: 'cube' })),
  ], [pack]);

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items.filter((x) => x.kind === 'Tab' || x.kind === 'Data product' || x.kind === 'Agent').slice(0, 14);
    return items
      .map((x) => {
        const hay = `${x.label} ${x.sub} ${x.kind}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const score = (x.label.toLowerCase().startsWith(words[0]) ? 3 : 0) + (x.label.toLowerCase().includes(q.toLowerCase()) ? 2 : 0) + (x.kind === 'Tab' ? 0.5 : 0);
        return { x, score };
      })
      .filter((r): r is { x: Item; score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .map((r) => r.x);
  }, [q, items]);

  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => setI(0), [q]);

  if (!open) return null;
  const go = (it: Item) => {
    onClose();
    navigate(`/${pack.profile.id}/${it.route}`);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Icon name="search" className="text-muted" />
          <input
            ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${pack.profile.company}: objects, terms, KPIs, products, agents`}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" aria-label="Search query"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[i] ? `pal-${i}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(results.length - 1, v + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(0, v - 1)); }
              if (e.key === 'Enter' && results[i]) go(results[i]);
              if (e.key === 'Escape') onClose();
            }}
          />
          <kbd className="rounded border border-line px-1.5 font-mono text-[10px] text-muted">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1 scroll-thin">
          {results.map((r, k) => (
            <li key={`${r.kind}-${r.route}`} id={`pal-${k}`} role="option" aria-selected={k === i}>
              <button onMouseEnter={() => setI(k)} onClick={() => go(r)} className={cls('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left', k === i && 'bg-surface2')}>
                <LayerDot layer={r.layer} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.label}</span>
                  <span className="block truncate text-xs text-muted">{r.sub}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{r.kind}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-6 text-center text-sm text-muted">Nothing in {pack.profile.company} matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}

function g(id: string) {
  return NAV.find((x) => x.items.some((i) => i.id === id))?.group ?? '';
}
