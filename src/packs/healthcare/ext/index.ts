// Healthcare enhancement block (Enhancement Specification, "Pack additions per industry").
import type { SfObject } from '../../../types';
import type { PackExtensions } from '../../../ext/types';
import type { HcData } from '../data';
import { buildKnockout } from './knockout';
import { incidents, legacyReports, sourceInventory } from './operate';
import { buildFeedback, impactPresets } from './quality';

export function buildExt(d: HcData, objects: SfObject[]): PackExtensions {
  return {
    knockoutScenarios: buildKnockout(d, objects),
    roadmapDefaults: { phase: 3, progress: { platform: 100, engineering: 80, semantic: 55, products: 40, ai: 25, governance: 50, change: 30 }, startDate: '2026-01-12' },
    readinessPreset: { defaultProfile: 'mid', wording: { F1: 'How much priority source data (EHR ADT and encounters, 837/835 claims, scheduling, pharmacy, supply chain) lands in the platform with CDC?' } },
    raciOverrides: { steward: 'Clinical data steward' },
    domains: ['Patient access', 'Hospital operations', 'Revenue cycle', 'Quality & safety', 'Supply chain', 'Population health', 'Finance'],
    sourceInventory,
    legacyReports,
    incidents,
    feedbackScript: buildFeedback(d),
    impactPresets,
  };
}
