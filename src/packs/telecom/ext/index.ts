// Telecom enhancement block (Enhancement Specification, "Pack additions per industry").
import type { SfObject } from '../../../types';
import type { PackExtensions } from '../../../ext/types';
import type { TelData } from '../data';
import { buildKnockout } from './knockout';
import { incidents, legacyReports, sourceInventory } from './operate';
import { buildFeedback, impactPresets } from './quality';

export function buildExt(d: TelData, objects: SfObject[]): PackExtensions {
  return {
    knockoutScenarios: buildKnockout(d, objects),
    roadmapDefaults: { phase: 3, progress: { platform: 100, engineering: 85, semantic: 60, products: 45, ai: 30, governance: 50, change: 25 }, startDate: '2025-11-03' },
    readinessPreset: { defaultProfile: 'mid', wording: { F1: 'How much priority source data (CRM, BSS billing, CDR mediation, OSS network events, field service) lands in the platform with CDC?' } },
    raciOverrides: { steward: 'Subscriber data steward', sme: 'Network or billing SME', product_owner: 'Domain data product owner' },
    domains: ['Subscriber', 'Revenue', 'Network', 'Field service'],
    sourceInventory,
    legacyReports,
    incidents,
    feedbackScript: buildFeedback(d),
    impactPresets,
  };
}
