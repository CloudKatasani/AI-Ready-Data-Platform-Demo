import type { IndustryPack } from '../types';

/** The 15-minute demo script (spec section 12), filled with the active pack's own objects. */
export function demoSteps(pack: IndustryPack) {
  const a = pack.personas.find((p) => p.archetype === 'A')!.roleId;
  const d = pack.personas.find((p) => p.archetype === 'D')!.roleId;
  const bronze = pack.objects.find((o) => o.schema === 'RAW_BRONZE' && o.type === 'ICEBERG TABLE')!;
  const dp05 = pack.products.find((p) => p.id === pack.certificationScript.productId)!;
  const q4 = pack.scenarios.find((s) => s.pattern === 4)!;
  return [
    { label: 'Platform Map — replay the flow', route: 'map', minutes: 2, persona: undefined as string | undefined },
    { label: 'Explorer — Bronze CDC to Silver', route: `explorer/RAW_BRONZE/${bronze.name}`, minutes: 3, persona: a },
    { label: `Meaning layers — ${pack.glossary.find((t) => t.id === pack.signature.termId)!.term}`, route: `glossary/${pack.signature.termId}`, minutes: 3, persona: undefined },
    { label: `Certify ${dp05.name}`, route: `certify/${dp05.id}`, minutes: 3, persona: d },
    { label: 'Marketplace — request access', route: `marketplace?item=${dp05.id}&tab=access`, minutes: 2, persona: a },
    { label: 'Agent Studio + My Access', route: `agents/${q4.agentId}?q=${encodeURIComponent(q4.question)}`, minutes: 2, persona: a },
  ];
}

/** Guided demo path on the Platform Map (five steps, spec section 7.1). */
export function guidedPath(pack: IndustryPack) {
  const bronze = pack.objects.find((o) => o.schema === 'RAW_BRONZE' && o.type === 'ICEBERG TABLE')!;
  const dp05 = pack.products.find((p) => p.id === pack.certificationScript.productId)!;
  const term = pack.glossary.find((t) => t.id === pack.signature.termId)!;
  return [
    { label: 'Explore a layer', route: `explorer/RAW_BRONZE/${bronze.name}` },
    { label: `See a term: ${term.term}`, route: `glossary/${term.id}` },
    { label: `Certify ${dp05.name}`, route: `certify/${dp05.id}` },
    { label: 'Find it in the Marketplace', route: `marketplace?item=${dp05.id}` },
    { label: 'Ask the agent', route: `agents/${pack.signature.agentId}?q=${encodeURIComponent(pack.signature.question)}` },
  ];
}
