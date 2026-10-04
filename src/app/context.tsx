import { createContext, useCallback, useContext, useMemo } from 'react';
import type { AccessCode, IndustryPack, Persona } from '../types';
import { MockSnowflake } from '../mock-snowflake';
import { accessCode, liveState, useStore } from '../store';
import { extOf, type ExtState } from '../ext/state';

interface Ctx { pack: IndustryPack; db: MockSnowflake }
export const PackContext = createContext<Ctx | null>(null);

export function usePackCtx(): Ctx {
  const c = useContext(PackContext);
  if (!c) throw new Error('usePack outside PackContext');
  return c;
}
export const usePack = () => usePackCtx().pack;
export const useDb = () => usePackCtx().db;

export function usePackState() {
  const pack = usePack();
  return useStore((s) => s.packs[pack.profile.id]);
}

export function usePersona(): Persona {
  const pack = usePack();
  const st = usePackState();
  return pack.personas.find((p) => p.roleId === st?.persona) ?? pack.personas[0];
}

/** Access code for the current persona (or a given role) on an asset. */
export function useAccess() {
  const pack = usePack();
  const st = usePackState();
  const persona = usePersona();
  return useCallback((assetId: string, roleId: string = persona.roleId): AccessCode => accessCode(pack, st, roleId, assetId), [pack, st, persona.roleId]);
}

export function useLive() {
  const pack = usePack();
  const st = usePackState();
  return useMemo(() => liveState(pack, st), [pack, st]);
}

/** Can the current persona run steward-only actions (certify, approve)? */
export function useIsSteward() {
  const persona = usePersona();
  const admin = useStore((s) => s.admin);
  return persona.archetype === 'D' || admin;
}

export function usePackPath() {
  const pack = usePack();
  return useCallback((p: string) => `/${pack.profile.id}/${p.replace(/^\//, '')}`, [pack.profile.id]);
}

/** Enhancement-feature state for the active pack, plus a patch function. */
export function useExt() {
  const pack = usePack();
  const st = usePackState();
  const patchExt = useStore((s) => s.patchExt);
  const ext = useMemo(() => extOf(st), [st]);
  const patch = useCallback((f: (e: ExtState) => ExtState) => patchExt(pack.profile.id, f), [patchExt, pack.profile.id]);
  return [ext, patch] as const;
}
