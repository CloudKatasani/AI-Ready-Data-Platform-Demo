import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { isPackReady, loadPack, profileOf } from '../packs';
import { MockSnowflake } from '../mock-snowflake';
import { useStore } from '../store';
import type { IndustryPack, PackId } from '../types';
import { PackContext } from './context';
import { TopBar } from './TopBar';
import { NavRail, TabStrip } from './NavRail';
import { CommandPalette } from './CommandPalette';
import { toast } from './toast';
import { Icon } from '../components/icons';

/** Last pack shown in this tab; switching industry resets the persona to the new pack's archetype A (spec section 2). */
let lastPackId: string | null = null;

const PlatformMap = lazy(() => import('../features/platform-map/PlatformMap'));
const Explorer = lazy(() => import('../features/explorer/Explorer'));
const Semantic = lazy(() => import('../features/semantic/Semantic'));
const Glossary = lazy(() => import('../features/glossary/Glossary'));
const Context = lazy(() => import('../features/context/ContextLayer'));
const Certification = lazy(() => import('../features/certification/Certification'));
const Agents = lazy(() => import('../features/agents/AgentStudio'));
const Marketplace = lazy(() => import('../features/marketplace/Marketplace'));
const MyAccess = lazy(() => import('../features/my-access/MyAccess'));

function Loading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted" role="status">
      <span className="typing"><span>●</span><span>●</span><span>●</span></span>{label}
    </div>
  );
}

export function PackShell() {
  const { pack: packId } = useParams();
  const locked = useStore((s) => s.lockedPack);
  const ensurePack = useStore((s) => s.ensurePack);
  const toggleAdmin = useStore((s) => s.toggleAdmin);
  const [pack, setPack] = useState<IndustryPack | null>(null);
  const [palette, setPalette] = useState(false);
  const profile = profileOf(packId ?? '');

  useEffect(() => {
    if (!profile || !isPackReady(profile.id)) return;
    let alive = true;
    setPack((p) => (p?.profile.id === profile.id ? p : null));
    void loadPack(profile.id as PackId).then((p) => {
      if (!alive) return;
      ensurePack(p);
      if (lastPackId && lastPackId !== p.profile.id) {
        useStore.getState().setPersona(p.profile.id, p.personas.find((x) => x.archetype === 'A')!.roleId);
      }
      lastPackId = p.profile.id;
      setPack(p);
    });
    return () => {
      alive = false;
    };
  }, [profile, ensurePack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setPalette(true);
      }
      if (e.key === 'A' && e.shiftKey && !typing && !e.ctrlKey && !e.metaKey) {
        toggleAdmin();
        toast(useStore.getState().admin ? 'Admin mode on: PLATFORM_ADMIN can certify and approve' : 'Admin mode off');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleAdmin]);

  const ctx = useMemo(() => (pack ? { pack, db: new MockSnowflake(pack) } : null), [pack]);

  if (!profile) return <Navigate to="/" replace />;
  if (locked && locked !== profile.id) return <Navigate to={`/${locked}/map`} replace />;
  if (!isPackReady(profile.id)) {
    return (
      <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-lg text-white" style={{ background: profile.accent }}><Icon name={profile.icon} size={22} /></span>
        <h1 className="h-title">{profile.company} is in build</h1>
        <p className="text-sm text-muted">The {profile.industry} pack ({profile.dbPrefix}_AI_PLATFORM) is specified and follows the same pack contract as Utilities. It ships in milestone M9.</p>
        <Link className="btn-primary" to="/utilities/map">Open the Utilities reference pack</Link>
      </div>
    );
  }
  if (!ctx) return <Loading label={`Generating ${profile.company} synthetic data…`} />;

  return (
    <PackContext.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }} className="sr-only z-[90] rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-2 focus:top-2">Skip to content</a>
        <TopBar onSearch={() => setPalette(true)} />
        <TabStrip />
        <div className="flex min-h-0 flex-1">
          <NavRail />
          <main id="main" tabIndex={-1} className="min-w-0 outline-none flex-1 overflow-y-auto scroll-thin">
            <Suspense fallback={<Loading label="Loading…" />}>
              <Routes>
                <Route index element={<Navigate to="map" replace />} />
                <Route path="map" element={<PlatformMap />} />
                <Route path="explorer/:schema?/:object?" element={<Explorer />} />
                <Route path="semantic/:view?" element={<Semantic />} />
                <Route path="glossary/:term?" element={<Glossary />} />
                <Route path="context/:section?" element={<Context />} />
                <Route path="certify/:product?" element={<Certification />} />
                <Route path="agents/:agent?" element={<Agents />} />
                <Route path="marketplace" element={<Marketplace />} />
                <Route path="my-access" element={<MyAccess />} />
                <Route path="*" element={<Navigate to="map" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </PackContext.Provider>
  );
}
