// Utilities enhancement block (Enhancement Specification, "Pack additions per industry").
import type { SfObject } from '../../../types';
import type { PackExtensions } from '../../../ext/types';
import type { UtilData } from '../data';
import { buildKnockout } from './knockout';
import { incidents, legacyReports, sourceInventory } from './operate';

export function buildExt(d: UtilData, objects: SfObject[]): PackExtensions {
  return {
    knockoutScenarios: buildKnockout(d, objects),
    roadmapDefaults: { phase: 2, progress: { platform: 100, engineering: 70, semantic: 20, products: 15, ai: 5, governance: 35, change: 20 }, startDate: '2026-01-05' },
    readinessPreset: { defaultProfile: 'mid', wording: { F1: 'How much priority source data (CIS, AMI, OMS, ERP) lands in the platform with CDC?' } },
    raciOverrides: {},
    domains: ['Customer', 'Grid operations', 'Supply chain', 'Finance'],
    sourceInventory,
    legacyReports,
    incidents,
    feedbackScript: undefined as unknown as PackExtensions['feedbackScript'],
    impactPresets: [],
  };
}
