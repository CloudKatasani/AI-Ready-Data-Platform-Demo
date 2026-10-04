// Demo state (spec section 11): persona, access requests, certification and theme, namespaced by pack and kept in
// sessionStorage so a refresh mid-demo does not lose progress.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AccessCode, AccessRequestT, IndustryPack, LiveState, PackId } from '../types';

export interface CertState {
  ran: boolean;
  fixes: string[];
  published?: { version: string; certifier: string; date: string; score: number };
}

export interface PackState {
  persona: string;
  requests: AccessRequestT[];
  cert: Record<string, CertState>;
  seq: number;
}

export type Theme = 'system' | 'light' | 'dark';

interface Store {
  packs: Partial<Record<PackId, PackState>>;
  theme: Theme;
  admin: boolean;
  lockedPack: PackId | null;
  ensurePack: (pack: IndustryPack) => void;
  setPersona: (packId: PackId, roleId: string) => void;
  requestAccess: (packId: PackId, roleId: string, assetId: string, justification: string, duration: AccessRequestT['duration']) => void;
  decide: (packId: PackId, requestId: string, approve: boolean) => void;
  runChecks: (packId: PackId, productId: string) => void;
  applyFix: (packId: PackId, productId: string, checkId: string) => void;
  publish: (packId: PackId, productId: string, info: CertState['published']) => void;
  resetCert: (packId: PackId, productId: string) => void;
  resetPack: (pack: IndustryPack) => void;
  resetAll: () => void;
  setTheme: (t: Theme) => void;
  toggleAdmin: () => void;
  setLockedPack: (p: PackId | null) => void;
}

export function initialPackState(pack: IndustryPack): PackState {
  const requests: AccessRequestT[] = [];
  let seq = 1;
  for (const [role, assets] of Object.entries(pack.initialAccess)) {
    for (const [assetId, code] of Object.entries(assets)) {
      if (code === 'P') {
        requests.push({ id: `REQ-${String(seq++).padStart(4, '0')}`, role, assetId, justification: pack.initialRequestJustification, duration: '90d', status: 'pending', createdAt: '2026-09-29 14:12:00' });
      }
    }
  }
  const archA = pack.personas.find((p) => p.archetype === 'A')!;
  return { persona: archA.roleId, requests, cert: {}, seq };
}

const nowTs = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const safeSession = createJSONStorage(() => {
  try {
    const s = window.sessionStorage;
    s.setItem('__dfs', '1');
    s.removeItem('__dfs');
    return s;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  }
});

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const patch = (packId: PackId, f: (s: PackState) => PackState) => {
        const cur = get().packs[packId];
        if (!cur) return;
        set({ packs: { ...get().packs, [packId]: f(cur) } });
      };
      return {
        packs: {},
        theme: 'system',
        admin: false,
        lockedPack: null,
        ensurePack: (pack) => {
          if (!get().packs[pack.profile.id]) set({ packs: { ...get().packs, [pack.profile.id]: initialPackState(pack) } });
        },
        setPersona: (packId, roleId) => patch(packId, (s) => ({ ...s, persona: roleId })),
        requestAccess: (packId, role, assetId, justification, duration) =>
          patch(packId, (s) => ({
            ...s,
            seq: s.seq + 1,
            requests: [...s.requests.filter((r) => !(r.role === role && r.assetId === assetId && r.status === 'pending')),
              { id: `REQ-${String(s.seq).padStart(4, '0')}`, role, assetId, justification, duration, status: 'pending', createdAt: nowTs() }],
          })),
        decide: (packId, id, approve) =>
          patch(packId, (s) => ({ ...s, requests: s.requests.map((r) => (r.id === id ? { ...r, status: approve ? 'approved' : 'rejected', decidedAt: nowTs() } : r)) })),
        runChecks: (packId, productId) =>
          patch(packId, (s) => ({ ...s, cert: { ...s.cert, [productId]: { ...(s.cert[productId] ?? { fixes: [] }), ran: true } } })),
        applyFix: (packId, productId, checkId) =>
          patch(packId, (s) => {
            const c = s.cert[productId] ?? { ran: true, fixes: [] };
            return { ...s, cert: { ...s.cert, [productId]: { ...c, fixes: [...new Set([...c.fixes, checkId])] } } };
          }),
        publish: (packId, productId, info) =>
          patch(packId, (s) => ({ ...s, cert: { ...s.cert, [productId]: { ...(s.cert[productId] ?? { ran: true, fixes: [] }), published: info } } })),
        resetCert: (packId, productId) =>
          patch(packId, (s) => {
            const cert = { ...s.cert };
            delete cert[productId];
            return { ...s, cert };
          }),
        resetPack: (pack) => set({ packs: { ...get().packs, [pack.profile.id]: initialPackState(pack) } }),
        resetAll: () => set({ packs: {}, admin: false }),
        setTheme: (theme) => set({ theme }),
        toggleAdmin: () => set({ admin: !get().admin }),
        setLockedPack: (lockedPack) => set({ lockedPack }),
      };
    },
    { name: 'data-fabric-studio', storage: safeSession, version: 1 },
  ),
);

/** Effective access code for a role on an asset: initial matrix overlaid with the latest request. */
export function accessCode(pack: IndustryPack, st: PackState | undefined, roleId: string, assetId: string): AccessCode {
  const base = pack.initialAccess[roleId]?.[assetId] ?? '-';
  if (!st) return base;
  const reqs = st.requests.filter((r) => r.role === roleId && r.assetId === assetId);
  const last = reqs[reqs.length - 1];
  if (!last) return base === 'P' ? 'R' : base;
  if (last.status === 'pending') return 'P';
  if (last.status === 'approved') return 'G';
  return base === 'G' ? 'G' : 'R';
}

export function liveState(pack: IndustryPack, st: PackState | undefined): LiveState {
  const productStatus: LiveState['productStatus'] = {};
  const productVersion: LiveState['productVersion'] = {};
  const fixes: LiveState['fixes'] = {};
  for (const p of pack.products) {
    const c = st?.cert[p.id];
    productStatus[p.id] = c?.published ? 'Certified' : p.status;
    productVersion[p.id] = c?.published?.version ?? p.version;
    fixes[p.id] = c?.fixes ?? [];
  }
  return { productStatus, productVersion, fixes };
}
