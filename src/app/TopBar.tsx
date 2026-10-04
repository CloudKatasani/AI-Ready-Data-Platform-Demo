import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PROFILES } from '../packs';
import { useStore, type Theme } from '../store';
import { Icon } from '../components/icons';
import { cls } from '../lib/format';
import { usePack, usePersona } from './context';
import { toast } from './toast';
import { Logo } from './StartScreen';
import { demoSteps } from './demoScript';

export function Popover({ trigger, children, align = 'left', label }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} className="rounded-md hover:bg-surface2">
        {trigger(open)}
      </button>
      {open && (
        <div role="menu" className={cls('absolute top-full z-50 mt-1 min-w-[260px] rounded-lg border border-line bg-surface p-1 shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const MenuItem = ({ onClick, children, disabled, active }: { onClick?: () => void; children: ReactNode; disabled?: boolean; active?: boolean }) => (
  <button role="menuitem" disabled={disabled} onClick={onClick} className={cls('flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50', active && 'bg-surface2')}>
    {children}
  </button>
);

export function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const icon = theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'eye';
  return (
    <button className="btn-ghost" onClick={() => setTheme(next[theme])} aria-label={`${theme} theme — switch to ${next[theme]}`} title={`Theme: ${theme}`}>
      <Icon name={icon} />
      <span className="hidden text-xs capitalize xl:inline">{theme}</span>
    </button>
  );
}

function PackSelector() {
  const pack = usePack();
  const navigate = useNavigate();
  const loc = useLocation();
  const locked = useStore((s) => s.lockedPack);
  const p = pack.profile;
  const tab = loc.pathname.split('/')[2] ?? 'map';
  return (
    <Popover
      label={`${p.industry} · ${p.company} ${pack.database} — switch industry`}
      trigger={() => (
        <span className="flex items-center gap-2 px-1.5 py-1">
          <span className="grid h-7 w-7 place-items-center rounded-md text-white" style={{ background: p.accent }}><Icon name={p.icon} size={15} /></span>
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-sm font-semibold">{p.industry} · {p.company}</span>
            <span className="mono block text-xs text-muted">{pack.database}</span>
          </span>
          {!locked && <Icon name="chevronDown" size={14} className="text-muted" />}
        </span>
      )}
    >
      {(close) => (
        <div>
          <div className="label px-2.5 py-1.5">{locked ? 'Locked to this pack (presenter mode)' : 'Switch industry'}</div>
          {PROFILES.map((x) => (
            <MenuItem key={x.id} disabled={!x.ready || (Boolean(locked) && x.id !== locked)} active={x.id === p.id} onClick={() => { close(); navigate(`/${x.id}/${tab}`); }}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-white" style={{ background: x.accent }}><Icon name={x.icon} size={13} /></span>
              <span className="min-w-0 flex-1">
                <span className="block">{x.industry} · {x.company}</span>
                <span className="mono block text-xs text-muted">{x.dbPrefix}_AI_PLATFORM{x.ready ? '' : ' · in build'}</span>
              </span>
              {x.id === p.id && <Icon name="check" size={14} />}
            </MenuItem>
          ))}
          {!locked && <MenuItem onClick={() => { close(); navigate('/'); }}><Icon name="layers" size={14} />All packs (start screen)</MenuItem>}
        </div>
      )}
    </Popover>
  );
}

function PersonaSwitcher() {
  const pack = usePack();
  const persona = usePersona();
  const setPersona = useStore((s) => s.setPersona);
  const admin = useStore((s) => s.admin);
  return (
    <Popover
      label={`${persona.name} ${persona.roleId} — switch persona`}
      align="right"
      trigger={() => (
        <span className="flex items-center gap-2 px-2 py-1">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{persona.name.split(' ').map((s) => s[0]).join('')}</span>
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-sm font-medium">{persona.name}</span>
            <span className="mono block text-xs text-muted">{persona.roleId}{admin ? ' + ADMIN' : ''}</span>
          </span>
          <Icon name="chevronDown" size={14} className="text-muted" />
        </span>
      )}
    >
      {(close) => (
        <div className="w-[300px]">
          <div className="label px-2.5 py-1.5">View as</div>
          {pack.personas.map((p) => (
            <MenuItem key={p.roleId} active={p.roleId === persona.roleId} onClick={() => {
              close();
              if (p.roleId !== persona.roleId) {
                setPersona(pack.profile.id, p.roleId);
                toast(`Now viewing as ${p.name} · ${p.roleId}`);
              }
            }}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface2 text-xs font-semibold">{p.archetype}</span>
              <span className="min-w-0 flex-1">
                <span className="block">{p.name} <span className="text-muted">· {p.title}</span></span>
                <span className="mono block text-xs text-muted">{p.roleId}</span>
              </span>
              {p.roleId === persona.roleId && <Icon name="check" size={14} />}
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}

function PresenterMenu() {
  const pack = usePack();
  const navigate = useNavigate();
  const { admin, toggleAdmin, resetPack, resetAll, setPersona, lockedPack, setLockedPack, hideOperate, toggleHideOperate } = useStore();
  const steps = demoSteps(pack);
  return (
    <Popover label="Presenter menu" align="right" trigger={() => <span className="flex items-center px-2 py-1.5 text-muted"><Icon name="more" size={18} /></span>}>
      {(close) => (
        <div className="w-[300px]">
          <div className="label px-2.5 py-1.5">Presenter</div>
          <MenuItem onClick={() => { close(); resetPack(pack); toast(`${pack.profile.company} demo reset`); }}><Icon name="reset" size={14} />Reset demo ({pack.profile.industry})</MenuItem>
          <MenuItem onClick={() => { close(); resetAll(); navigate(`/${pack.profile.id}/map`); toast('All packs reset'); }}><Icon name="refresh" size={14} />Reset all packs</MenuItem>
          <MenuItem onClick={() => { close(); toggleAdmin(); toast(admin ? 'Admin mode off' : 'Admin mode on: PLATFORM_ADMIN can certify and approve'); }}>
            <Icon name="key" size={14} />{admin ? 'Turn off' : 'Turn on'} admin mode <span className="ml-auto text-xs text-muted">Shift+A</span>
          </MenuItem>
          <MenuItem onClick={() => { close(); setLockedPack(lockedPack ? null : pack.profile.id); toast(lockedPack ? 'Pack unlocked' : `Locked to ${pack.profile.industry}`); }}>
            <Icon name="lock" size={14} />{lockedPack ? 'Unlock pack switching' : `Lock app to ${pack.profile.industry}`}
          </MenuItem>
          <MenuItem onClick={() => { close(); toggleHideOperate(); toast(hideOperate ? 'Operate group shown' : 'Operate group hidden for an executive audience'); }}>
            <Icon name="eye" size={14} />{hideOperate ? 'Show' : 'Hide'} the Operate group
          </MenuItem>
          <MenuItem onClick={() => { close(); navigate(`/${pack.profile.id}/health?break=1`); }}>
            <Icon name="warn" size={14} />Break something (incident drill)
          </MenuItem>
          <div className="label mt-1 border-t border-line px-2.5 pb-1 pt-2.5">Jump to demo step</div>
          {steps.map((s, i) => (
            <MenuItem key={s.label} onClick={() => {
              close();
              if (s.persona) setPersona(pack.profile.id, s.persona);
              navigate(`/${pack.profile.id}/${s.route}`);
            }}>
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface2 text-xs font-semibold">{i + 1}</span>
              <span className="flex-1">{s.label}</span>
              <span className="text-xs text-muted">{s.minutes} min</span>
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function TopBar({ onSearch, onMenu }: { onSearch: () => void; onMenu?: () => void }) {
  const pack = usePack();
  const persona = usePersona();
  const navigate = useNavigate();
  void onMenu;
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
      <button className="hidden items-center gap-2 px-1 sm:flex" onClick={() => navigate('/')} aria-label="Data Fabric Studio home"><Logo /></button>
      <PackSelector />
      <div className="mx-1 hidden h-6 w-px bg-line md:block" />
      <dl className="hidden min-w-0 items-center gap-3 text-xs text-muted xl:flex">
        <div><dt className="sr-only">Account</dt><dd className="mono">{pack.profile.account}</dd></div>
        <div><dt className="sr-only">Region</dt><dd>AWS us-east-1</dd></div>
        <div><dt className="sr-only">Role</dt><dd className="mono text-ink">{persona.roleId}</dd></div>
        <div><dt className="sr-only">Warehouse</dt><dd className="mono">{pack.warehouse}</dd></div>
      </dl>
      <span className="chip ml-1 hidden border-warn/40 bg-warn/10 text-warn sm:inline-flex" title="All data is synthetic and generated in the browser"><Icon name="sparkle" size={11} />Synthetic data</span>
      <div className="flex-1" />
      <button onClick={onSearch} className="flex items-center gap-2 rounded-md border border-line bg-surface2/60 px-2.5 py-1.5 text-sm text-muted hover:text-ink" aria-label="Search Ctrl K">
        <Icon name="search" size={15} /><span className="hidden lg:inline">Search</span><kbd className="hidden rounded border border-line px-1 font-mono text-[10px] lg:inline">Ctrl K</kbd>
      </button>
      <ThemeToggle />
      <PersonaSwitcher />
      <PresenterMenu />
    </header>
  );
}
