import { Empty } from '../components/ui';
import type { IndustryPack } from '../types';
import type { PackExtensions } from './types';

/** Empty state for enhancement tabs when the active pack has no (or an incomplete) ext block. */
export function NotConfigured({ pack, keys }: { pack: IndustryPack; keys: (keyof PackExtensions)[] }) {
  const missing = keys.filter((k) => {
    const v = pack.ext?.[k];
    return v === undefined || (Array.isArray(v) && v.length === 0);
  });
  return (
    <div className="p-6">
      <Empty title={`Not configured for ${pack.profile.industry}`}>
        This feature needs pack data that {pack.profile.company} does not provide yet. Missing keys: <span className="mono">{missing.join(', ') || keys.join(', ')}</span>.
      </Empty>
    </div>
  );
}

export function hasExt(pack: IndustryPack, keys: (keyof PackExtensions)[]): boolean {
  return keys.every((k) => {
    const v = pack.ext?.[k];
    return v !== undefined && !(Array.isArray(v) && v.length === 0);
  });
}
