import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from '../store';
import { PACK_IDS } from '../packs';
import type { PackId } from '../types';
import { StartScreen } from './StartScreen';
import { PackShell } from './PackShell';
import { Toaster } from './toast';
import { ErrorBoundary } from './ErrorBoundary';

function useThemeEffect() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Presenter pack lock: ?pack=retail in the URL or VITE_LOCK_PACK at build time (spec section 3). */
function usePackLock() {
  const setLocked = useStore((s) => s.setLockedPack);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('pack') ?? (import.meta.env.VITE_LOCK_PACK as string | undefined);
    if (q && (PACK_IDS as string[]).includes(q)) setLocked(q as PackId);
  }, [setLocked]);
}

function Home() {
  const locked = useStore((s) => s.lockedPack);
  return locked ? <Navigate to={`/${locked}/map`} replace /> : <StartScreen />;
}

export function App() {
  useThemeEffect();
  usePackLock();
  return (
    <HashRouter future={{ v7_relativeSplatPath: true }}>
      <ErrorBoundary label="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/:pack/*" element={<PackShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
      <Toaster />
    </HashRouter>
  );
}
