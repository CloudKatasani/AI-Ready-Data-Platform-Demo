// React hooks shared by the enhancement screens and the cross-app effects.
import { useMemo } from 'react';
import { useExt, useLive, usePack } from '../app/context';
import { coverage } from './coverage';
import { failingObjects, kpisAtRisk, productHealth } from './health';
import { agentAccuracy } from './quality';

/** Current eval accuracy per agent (E10 fixes move it); the same number everywhere it is shown. */
export function useAccuracy(): (agentId: string) => number {
  const pack = usePack();
  const [ext] = useExt();
  return useMemo(() => (id: string) => agentAccuracy(pack, ext, id), [pack, ext]);
}

export function useHealth() {
  const pack = usePack();
  const [ext] = useExt();
  return useMemo(() => ({
    product: (id: string) => productHealth(pack, ext, id),
    kpisAtRisk: kpisAtRisk(pack, ext),
    failing: failingObjects(pack, ext),
    openCount: ext.incidents.open.length,
  }), [pack, ext]);
}

export function useCoverage() {
  const pack = usePack();
  const live = useLive();
  const acc = useAccuracy();
  const health = useHealth();
  return useMemo(() => coverage({ pack, live, accuracy: acc, dqFailing: (f) => health.failing.has(f) }), [pack, live, acc, health]);
}
