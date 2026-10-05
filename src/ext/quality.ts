// E10 agent quality: eval accuracy per agent. Wave 3 replaces the static value with eval sets recomputed from
// the current context and semantic state.
import type { IndustryPack } from '../types';
import type { ExtState } from './state';

export function agentAccuracy(pack: IndustryPack, _ext: ExtState, agentId: string): number {
  return pack.agents.find((a) => a.id === agentId)?.evalAccuracy ?? 0;
}
