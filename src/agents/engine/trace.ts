import type { IndustryPack, LiveState, Persona, Scenario, ScenarioResult, TraceStep } from '../../types';

const hashMs = (s: string, lo: number, hi: number) => {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return lo + (h % (hi - lo));
};

/** Ordered, layer-coloured trace steps (spec section 7.7). `result` is null when access was denied before running. */
export function buildTrace(pack: IndustryPack, s: Scenario, persona: Persona, live: LiveState, result: ScenarioResult | null): TraceStep[] {
  const steps: TraceStep[] = [];
  const terms = s.terms.map((t) => ({ t, g: pack.glossary.find((g) => g.id === t.termId) })).filter((x) => x.g);
  steps.push({
    layer: 'glossary', title: 'Understand the question', ms: hashMs(s.id + 'g', 250, 420),
    detail: terms.length
      ? terms.map(({ t, g }) => `Resolved "${t.text}" → ${g!.term} (${g!.id}${g!.isCde ? ', CDE' : ''}${g!.status !== 'Approved' ? `, ${g!.status}` : ''}).`).join(' ')
      : 'Classified as a metadata question: answered from GLOSSARY, GOVERNANCE and DP_REGISTRY, not customer data.',
    refs: terms.map(({ g }) => ({ kind: 'term' as const, id: g!.id, label: g!.term })),
  });

  const rules = s.ruleIds.map((id) => pack.context.rules.find((r) => r.id === id)).filter(Boolean);
  const instr = pack.context.instructions.find((i) => i.agentId === s.agentId && i.type === 'response');
  steps.push({
    layer: 'context', title: 'Apply business context', ms: hashMs(s.id + 'c', 250, 480),
    detail: [
      ...rules.map((r) => `Rule ${r!.id}: ${r!.text}`),
      `Instruction: ${s.instruction ?? instr?.text ?? 'Answer with a table and a recommended action.'}`,
    ].join(' '),
    refs: rules.map((r) => ({ kind: 'rule' as const, id: r!.id })),
  });

  if (s.semantic) {
    steps.push({
      layer: 'semantic', title: 'Choose the model', ms: hashMs(s.id + 's', 280, 520),
      detail: `${s.semantic.view} · metric ${s.semantic.metrics.join(', ')}${s.semantic.dimensions.length ? ` · dimension ${s.semantic.dimensions.join(', ')}` : ''}${s.semantic.filters.length ? ` · filter ${s.semantic.filters.join(' and ')}` : ''}`,
      refs: [{ kind: 'view', id: s.semantic.view }, ...s.semantic.metrics.map((m) => ({ kind: 'metric' as const, id: `${s.semantic!.view}.${m}` }))],
    });
  } else {
    steps.push({ layer: 'semantic', title: 'Choose the model', ms: 220, detail: 'No semantic view needed: SQL tool over the metadata schemas.', refs: [] });
  }

  if (!result) return steps;

  const masked = result.maskedColumns ?? [];
  const rowPol = persona.rowFilter
    ? `row policy ${pack.rowAccessPolicy}: ${persona.rowFilter.allowed.join(', ')} only`
    : `row policy ${pack.rowAccessPolicy}: all values`;
  steps.push({
    layer: 'gov', title: 'Check access', ms: hashMs(s.id + 'a', 200, 380),
    detail: `Role ${persona.roleId} · ${s.productIds.length ? s.productIds.map((p) => `${p} granted`).join(', ') + ' · ' : ''}${rowPol}${result.rowFiltered ? ' (applied to this answer)' : ''} · ${masked.length ? `${pack.maskingPolicy} applied to ${masked.join(', ')}` : 'no masked columns used'}`,
    refs: [{ kind: 'policy', id: pack.rowAccessPolicy }, ...(masked.length ? [{ kind: 'policy' as const, id: pack.maskingPolicy }] : [])],
  });

  const ports = s.productIds.map((pid) => pack.products.find((p) => p.id === pid)!).map((p) => p.outputPort);
  const target = ports.length ? ports.join(' + ') : 'GLOSSARY / GOVERNANCE / DP_REGISTRY';
  const execMs = hashMs(s.id + persona.roleId, 280, 900);
  steps.push({
    layer: 'product', title: 'Generate and run SQL', ms: hashMs(s.id + 'q', 300, 600),
    detail: `Generated SQL against ${target}, ${execMs} ms, ${result.rows} row${result.rows === 1 ? '' : 's'}.${result.note ? ` ${result.note}` : ''}`,
    refs: ports.map((p) => ({ kind: 'object' as const, id: `DATA_PRODUCTS.${p}` })),
  });

  if (s.doc) {
    const doc = pack.context.documents.find((d) => d.id === s.doc!.docId);
    steps.push({
      layer: 'context', title: 'Ground with documents', ms: hashMs(s.id + 'd', 250, 450),
      detail: `Cortex Search on ${pack.context.searchService}: cited "${doc?.title}", chunk ${s.doc.chunk}.`,
      refs: [{ kind: 'doc', id: s.doc.docId }],
    });
  }

  const uncert = s.productIds.filter((pid) => (live.productStatus[pid] ?? pack.products.find((p) => p.id === pid)!.status) !== 'Certified');
  steps.push({
    layer: 'agent', title: 'Answer', ms: hashMs(s.id + 'z', 150, 300),
    detail: uncert.length
      ? `Answered with a "Not certified" banner: ${uncert.join(', ')} ${uncert.length > 1 ? 'are' : 'is'} not certified.`
      : s.productIds.length ? 'Final answer with certified source badge.' : 'Final answer from governed metadata.',
    refs: [],
  });
  return steps;
}
