// Public Sector enhancement block (Enhancement Specification, "Pack additions per industry").
import type { SfObject } from '../../../types';
import type { PackExtensions } from '../../../ext/types';
import type { PsData } from '../data';
import { buildKnockout } from './knockout';
import { buildIncidents, legacyReports, sourceInventory } from './operate';
import { buildFeedback, impactPresets } from './quality';

export function buildExt(d: PsData, objects: SfObject[]): PackExtensions {
  return {
    knockoutScenarios: buildKnockout(d, objects),
    roadmapDefaults: { phase: 2, progress: { platform: 100, engineering: 65, semantic: 30, products: 20, ai: 10, governance: 40, change: 15 }, startDate: '2026-01-12' },
    readinessPreset: { defaultProfile: 'early', wording: { F1: 'How much priority source data (case management, eligibility, benefits payments, 311) lands in the platform with CDC?' } },
    raciOverrides: { steward: 'Program data steward', sme: 'Program policy specialist', product_owner: 'Program data product owner' },
    domains: ['Constituent', 'Eligibility & case management', 'Payments & integrity', 'Finance & workforce'],
    sourceInventory,
    legacyReports,
    incidents: buildIncidents(d),
    feedbackScript: buildFeedback(d),
    impactPresets,
  };
}
