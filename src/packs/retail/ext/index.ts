// Retail enhancement block (Enhancement Specification, "Pack additions per industry").
import type { SfObject } from '../../../types';
import type { PackExtensions } from '../../../ext/types';
import type { RetailData } from '../data';
import { buildKnockout } from './knockout';
import { incidents, legacyReports, sourceInventory } from './operate';
import { buildFeedback, impactPresets } from './quality';

export function buildExt(d: RetailData, objects: SfObject[]): PackExtensions {
  return {
    knockoutScenarios: buildKnockout(d, objects),
    roadmapDefaults: { phase: 3, progress: { platform: 100, engineering: 80, semantic: 55, products: 45, ai: 30, governance: 50, change: 25 }, startDate: '2025-11-03' },
    readinessPreset: { defaultProfile: 'mid', wording: { F1: 'How much priority source data (POS transactions, e-commerce orders, loyalty, WMS inventory, supplier EDI) lands in the platform with CDC?' } },
    raciOverrides: { steward: 'Merchandising data steward' },
    domains: ['Customer', 'Sales', 'Merchandising', 'Supply chain', 'Store operations', 'Finance'],
    sourceInventory,
    legacyReports,
    incidents,
    feedbackScript: buildFeedback(d),
    impactPresets,
  };
}
