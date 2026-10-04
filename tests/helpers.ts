import { buildPack } from '../src/packs/utilities';
import type { IndustryPack } from '../src/types';

let cached: IndustryPack | undefined;
export const utilities = () => (cached ??= buildPack());
export const persona = (pack: IndustryPack, arch: 'A' | 'B' | 'C' | 'D') => pack.personas.find((p) => p.archetype === arch)!;
