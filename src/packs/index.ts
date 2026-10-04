// Pack registry (spec section 4). Packs are code-split and lazy-loaded; only the active pack's data is generated.
import type { IndustryPack, PackId, PackProfile } from '../types';
import { PROFILE as UTILITIES } from './utilities/pack';
import { PROFILE as TELECOM } from './telecom/pack';
import { PROFILE as RETAIL } from './retail/pack';
import { PROFILE as BANKING } from './banking/pack';
import { PROFILE as INSURANCE } from './insurance/pack';
import { PROFILE as HEALTHCARE } from './healthcare/pack';
import { PROFILE as MANUFACTURING } from './manufacturing/pack';
import { PROFILE as PUBLIC_SECTOR } from './public-sector/pack';

const LOADERS: Partial<Record<PackId, () => Promise<{ buildPack: () => IndustryPack }>>> = {
  utilities: () => import('./utilities'),
  manufacturing: () => import('./manufacturing'),
  'public-sector': () => import('./public-sector'),
};

/** Profiles are tiny and always available (start screen, pack selector). Full packs load on demand. */
export const PROFILES: PackProfile[] = [UTILITIES, TELECOM, RETAIL, BANKING, INSURANCE, HEALTHCARE, MANUFACTURING, PUBLIC_SECTOR].map((p) => ({ ...p, ready: Boolean(LOADERS[p.id]) }));

export const PACK_IDS = PROFILES.map((x) => x.id);
export const profileOf = (id: string) => PROFILES.find((x) => x.id === id);

const cache = new Map<PackId, Promise<IndustryPack>>();

export function isPackReady(id: PackId) {
  return Boolean(LOADERS[id]);
}

export function loadPack(id: PackId): Promise<IndustryPack> {
  const loader = LOADERS[id];
  if (!loader) return Promise.reject(new Error(`Pack ${id} is not built yet`));
  let p = cache.get(id);
  if (!p) {
    p = loader().then((m) => m.buildPack());
    cache.set(id, p);
  }
  return p;
}
