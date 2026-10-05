// Insurance enhancement block (Enhancement Specification, "Pack additions per industry").
import type { SfObject } from '../../../types';
import type { PackExtensions } from '../../../ext/types';
import type { InsData } from '../data';
import { buildKnockout } from './knockout';
import { incidents, legacyReports, sourceInventory } from './operate';
import { buildFeedback, impactPresets } from './quality';

export function buildExt(d: InsData, objects: SfObject[]): PackExtensions {
  return {
    knockoutScenarios: buildKnockout(d, objects),
    roadmapDefaults: { phase: 3, progress: { platform: 100, engineering: 80, semantic: 55, products: 45, ai: 25, governance: 50, change: 30 }, startDate: '2025-11-03' },
    readinessPreset: { defaultProfile: 'mid', wording: { F1: 'How much priority source data (policy administration, claims, billing, agent & broker portal) lands in the platform with CDC?' } },
    raciOverrides: { steward: 'Claims and policy data steward', sme: 'Actuarial or underwriting SME' },
    domains: ['Policyholder', 'Claims', 'Finance', 'Distribution', 'Catastrophe risk'],
    sourceInventory,
    legacyReports,
    incidents,
    feedbackScript: buildFeedback(d),
    impactPresets,
  };
}
