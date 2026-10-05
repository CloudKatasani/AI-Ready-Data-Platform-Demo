// Manufacturing enhancement block (Enhancement Specification, "Pack additions per industry").
import type { SfObject } from '../../../types';
import type { PackExtensions } from '../../../ext/types';
import type { MfgData } from '../data';
import { buildKnockout } from './knockout';
import { incidents, legacyReports, sourceInventory } from './operate';
import { buildFeedback, impactPresets } from './quality';

export function buildExt(d: MfgData, objects: SfObject[]): PackExtensions {
  return {
    knockoutScenarios: buildKnockout(d, objects),
    roadmapDefaults: { phase: 3, progress: { platform: 100, engineering: 80, semantic: 55, products: 40, ai: 25, governance: 45, change: 20 }, startDate: '2025-11-03' },
    readinessPreset: { defaultProfile: 'mid', wording: { F1: 'How much priority source data (MES, ERP, QMS, IoT historian, supplier portal) lands in the platform with CDC?' } },
    raciOverrides: { steward: 'Plant data steward', sme: 'Manufacturing engineer' },
    domains: ['Operations', 'Quality', 'Maintenance', 'Supply chain', 'Order fulfilment', 'Workforce', 'Finance', 'Sustainability'],
    sourceInventory,
    legacyReports,
    incidents,
    feedbackScript: buildFeedback(d),
    impactPresets,
  };
}
