// Banking enhancement block (Enhancement Specification, "Pack additions per industry").
import type { SfObject } from '../../../types';
import type { PackExtensions } from '../../../ext/types';
import type { BankData } from '../data';
import { buildKnockout } from './knockout';
import { incidents, legacyReports, sourceInventory } from './operate';
import { buildFeedback, impactPresets } from './quality';

export function buildExt(d: BankData, objects: SfObject[]): PackExtensions {
  return {
    knockoutScenarios: buildKnockout(d, objects),
    roadmapDefaults: { phase: 3, progress: { platform: 100, engineering: 80, semantic: 55, products: 45, ai: 30, governance: 60, change: 25 }, startDate: '2025-11-03' },
    readinessPreset: { defaultProfile: 'mid', wording: { F1: 'How much priority source data (core banking, card processing, digital banking, AML case management, general ledger) lands in the platform with CDC?' } },
    raciOverrides: { steward: 'Line-of-business data steward', sme: 'Credit, treasury or BSA/AML SME', gov_lead: 'Data governance and model risk lead' },
    domains: ['Retail banking', 'Treasury', 'Credit risk', 'Cards', 'Financial crimes', 'Finance'],
    sourceInventory,
    legacyReports,
    incidents,
    feedbackScript: buildFeedback(d),
    impactPresets,
  };
}
