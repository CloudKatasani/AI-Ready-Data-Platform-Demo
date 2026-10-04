import { NavLink } from 'react-router-dom';
import { Icon } from '../components/icons';
import { cls } from '../lib/format';
import type { LayerId } from '../types';
import { usePack } from './context';

export const NAV: { group: string; items: { id: string; label: string; icon: string; layer: LayerId }[] }[] = [
  { group: 'Platform', items: [
    { id: 'map', label: 'Platform Map', icon: 'map', layer: 'gold' },
    { id: 'explorer', label: 'Database Explorer', icon: 'database', layer: 'silver' },
  ] },
  { group: 'Meaning', items: [
    { id: 'semantic', label: 'Semantic Layer', icon: 'cube', layer: 'semantic' },
    { id: 'glossary', label: 'Glossary', icon: 'book', layer: 'glossary' },
    { id: 'context', label: 'Context Layer', icon: 'compass', layer: 'context' },
  ] },
  { group: 'Build & consume', items: [
    { id: 'certify', label: 'Certification Studio', icon: 'badge', layer: 'product' },
    { id: 'agents', label: 'Agent Studio', icon: 'bot', layer: 'agent' },
    { id: 'marketplace', label: 'Marketplace', icon: 'store', layer: 'product' },
    { id: 'my-access', label: 'My Access', icon: 'key', layer: 'gov' },
  ] },
];

export function NavRail() {
  const pack = usePack();
  return (
    <nav aria-label="Main" className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface px-2 py-4 min-[900px]:flex scroll-thin">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="label px-2.5 pb-1.5">{g.group}</div>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.id}>
                <NavLink
                  to={`/${pack.profile.id}/${it.id}`}
                  className={({ isActive }) => cls('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm', isActive ? 'bg-surface2 font-semibold text-ink' : 'text-muted hover:bg-surface2/60 hover:text-ink')}
                >
                  {({ isActive }) => (
                    <>
                      <span className="h-4 w-1 rounded-full" style={{ background: isActive ? `rgb(var(--layer-${it.layer}))` : 'transparent' }} />
                      <Icon name={it.icon} size={16} />
                      {it.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto px-2.5 text-xs text-muted">Data as of <span className="mono">2026-09-30</span><br />Times in America/New_York</div>
    </nav>
  );
}

/** Below 900 px the rail collapses to a top tab strip (spec section 3). */
export function TabStrip() {
  const pack = usePack();
  return (
    <nav aria-label="Main" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 min-[900px]:hidden scroll-thin">
      {NAV.flatMap((g) => g.items).map((it) => (
        <NavLink key={it.id} to={`/${pack.profile.id}/${it.id}`} className={({ isActive }) => cls('flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm', isActive ? 'bg-surface2 font-semibold' : 'text-muted')}>
          <Icon name={it.icon} size={14} />{it.label}
        </NavLink>
      ))}
    </nav>
  );
}
