import { beforeEach, describe, expect, it } from 'vitest';
import { accessCode, liveState, useStore } from '../src/store';
import { utilities } from './helpers';

const pack = utilities();

describe('demo store', () => {
  beforeEach(() => {
    useStore.getState().resetAll();
    useStore.getState().ensurePack(pack);
  });

  it('starts on archetype A with the seeded pending DP-05 request', () => {
    const st = useStore.getState().packs.utilities!;
    expect(st.persona).toBe('ANALYST_CUSTOMER');
    expect(accessCode(pack, st, 'ANALYST_CUSTOMER', 'DP-05')).toBe('P');
    expect(st.requests).toHaveLength(1);
  });

  it('request → approve grants access without reload', () => {
    const s = useStore.getState();
    s.requestAccess('utilities', 'PROCUREMENT_MGR', 'DP-01', 'Need customer counts', '30d');
    let st = useStore.getState().packs.utilities!;
    expect(accessCode(pack, st, 'PROCUREMENT_MGR', 'DP-01')).toBe('P');
    const req = st.requests.find((r) => r.role === 'PROCUREMENT_MGR')!;
    useStore.getState().decide('utilities', req.id, true);
    st = useStore.getState().packs.utilities!;
    expect(accessCode(pack, st, 'PROCUREMENT_MGR', 'DP-01')).toBe('G');
  });

  it('publishing DP-05 propagates to the live state', () => {
    const s = useStore.getState();
    s.runChecks('utilities', 'DP-05');
    s.applyFix('utilities', 'DP-05', 'G4-VQ');
    s.applyFix('utilities', 'DP-05', 'G6-MASK');
    s.publish('utilities', 'DP-05', { version: '1.0.0', certifier: 'Hannah Sullivan', date: '2026-10-04', score: 97.1 });
    const live = liveState(pack, useStore.getState().packs.utilities);
    expect(live.productStatus['DP-05']).toBe('Certified');
    expect(live.productVersion['DP-05']).toBe('1.0.0');
    expect(live.fixes['DP-05']).toEqual(['G4-VQ', 'G6-MASK']);
  });

  it('reset restores the initial state', () => {
    useStore.getState().runChecks('utilities', 'DP-05');
    useStore.getState().resetPack(pack);
    expect(useStore.getState().packs.utilities!.cert).toEqual({});
  });
});
