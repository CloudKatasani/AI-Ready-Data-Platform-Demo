import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ErrorBoundary, lazyWithRetry } from './ErrorBoundary';
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

const PlatformMap = lazyWithRetry(() => import('../features/platform-map/PlatformMap'));
const Explorer = lazyWithRetry(() => import('../features/explorer/Explorer'));
const Semantic = lazyWithRetry(() => import('../features/semantic/Semantic'));
const Glossary = lazyWithRetry(() => import('../features/glossary/Glossary'));
const Context = lazyWithRetry(() => import('../features/context/ContextLayer'));
const Certification = lazyWithRetry(() => import('../features/certification/Certification'));
const Agents = lazyWithRetry(() => import('../features/agents/AgentStudio'));
const Marketplace = lazyWithRetry(() => import('../features/marketplace/Marketplace'));
const MyAccess = lazyWithRetry(() => import('../features/my-access/MyAccess'));
const Knockout = lazyWithRetry(() => import('../features/why/Knockout'));
const Compare = lazyWithRetry(() => import('../features/why/Compare'));
const Readiness = lazyWithRetry(() => import('../features/implement/Readiness'));
const Roadmap = lazyWithRetry(() => import('../features/implement/Roadmap'));
const BuildGuide = lazyWithRetry(() => import('../features/implement/BuildGuide'));
const Coverage = lazyWithRetry(() => import('../features/implement/Coverage'));
const OperatingModel = lazyWithRetry(() => import('../features/operate/OperatingModel'));
const Cost = lazyWithRetry(() => import('../features/operate/Cost'));
const Health = lazyWithRetry(() => import('../features/operate/Health'));
const AgentQuality = lazyWithRetry(() => import('../features/operate/AgentQuality'));
const Impact = lazyWithRetry(() => import('../features/operate/Impact'));

function Loading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted" role="status">
      <span className="typing"><span>●</span><span>●</span><span>●</span></span>{label}
    </div>
  );
}

export function PackShell() {
  const { pack: packId } = useParams();
  const location = useLocation();
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
            <ErrorBoundary resetKey={location.pathname} label={location.pathname}>
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
                <Route path="why/knockout" element={<Knockout />} />
                <Route path="why/compare" element={<Compare />} />
                <Route path="why" element={<Navigate to="knockout" replace />} />
                <Route path="readiness/:mode?" element={<Readiness />} />
                <Route path="roadmap" element={<Roadmap />} />
                <Route path="build/:layer?/:step?" element={<BuildGuide />} />
                <Route path="coverage" element={<Coverage />} />
                <Route path="operating-model" element={<OperatingModel />} />
                <Route path="cost" element={<Cost />} />
                <Route path="health/:tab?" element={<Health />} />
                <Route path="agent-quality/:tab?" element={<AgentQuality />} />
                <Route path="impact" element={<Impact />} />
                <Route path="*" element={<Navigate to="map" replace />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </PackContext.Provider>
  );
}
