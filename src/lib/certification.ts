import type { DataProduct, Gate, GateStatus, IndustryPack } from '../types';
import type { CertState } from '../store';

const rank: Record<GateStatus, number> = { pass: 0, pending: 1, warn: 2, fail: 3 };
export const gateStatus = (g: Gate): GateStatus =>
  g.checks.reduce<GateStatus>((acc, c) => (rank[c.status] > rank[acc] ? c.status : acc), 'pass');

/** Gate results for a product given the demo state (spec section 7.6). */
export function computeGates(pack: IndustryPack, p: DataProduct, st: CertState | undefined): Gate[] {
  const script = pack.certificationScript;
  if (p.id !== script.productId || !st?.ran) return p.gates;
  return p.gates.map((g) => ({
    ...g,
    checks: g.checks.map((c) => {
      const f = script.failures.find((x) => x.checkId === c.id);
      if (!f) return { ...c, status: 'pass' as GateStatus };
      const fixed = st.fixes.includes(c.id);
      return { ...c, status: fixed ? 'pass' : f.status, detail: fixed ? f.fixedDetail : f.detail };
    }),
  }));
}

export function allPass(gates: Gate[]) {
  return gates.length === 8 && gates.every((g) => gateStatus(g) === 'pass');
}

export function releaseVersion(v: string) {
  return v.replace(/-.*$/, '');
}
