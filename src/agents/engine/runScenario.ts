// Scenario runner: guardrails + layer-by-layer trace around a computed scenario result (spec section 9).
import type { AccessCode, AgentAnswer, IndustryPack, LiveState, Persona, Scenario, TraceStep } from '../../types';
import { buildTrace } from './trace';

export interface RunInput {
  pack: IndustryPack;
  scenario: Scenario;
  persona: Persona;
  live: LiveState;
  access: (assetId: string) => AccessCode;
}

export function productState(pack: IndustryPack, live: LiveState, id: string) {
  const p = pack.products.find((x) => x.id === id)!;
  const status = live.productStatus[id] ?? p.status;
  return { product: p, status, version: live.productVersion[id] ?? p.version, certified: status === 'Certified' };
}

export function runScenario({ pack, scenario, persona, live, access }: RunInput): AgentAnswer {
  const missing = scenario.productIds.filter((pid) => access(pid) !== 'G');
  if (missing.length) {
    const p = productState(pack, live, missing[0]);
    const pending = access(missing[0]) === 'P';
    const trace: TraceStep[] = buildTrace(pack, scenario, persona, live, null).filter((s) => s.layer === 'glossary' || s.layer === 'context');
    trace.push({
      layer: 'gov', title: 'Check access', ms: 180,
      detail: `Role ${persona.roleId} has no grant on ${p.product.id} ${p.product.name}${pending ? ' (request pending)' : ''}. The agent only answers from products your role can access, so no data was queried.`,
      refs: [{ kind: 'object', id: `DATA_PRODUCTS.${p.product.outputPort}` }],
    });
    trace.push({ layer: 'agent', title: 'Answer', detail: 'Declined politely; offered an access request.', refs: [], ms: 90 });
    return {
      kind: 'decline', banner: 'no-access',
      summary: `I can't answer that for you yet. It needs ${p.product.name} (${p.product.id}, ${p.status}), and your role ${persona.roleId} doesn't have access${pending ? ' — your request is still pending with the data steward' : ''}. ${pending ? 'You can check it in the Marketplace.' : 'You can request access and I’ll answer as soon as it’s approved.'}`,
      sources: [], sql: '', trace, requestAssetId: p.product.id,
    };
  }

  const result = scenario.run({ persona, live });
  const states = scenario.productIds.map((pid) => productState(pack, live, pid));
  const uncert = states.filter((s) => !s.certified);
  const trace = buildTrace(pack, scenario, persona, live, result);
  return {
    kind: 'answer',
    summary: result.summary,
    table: result.table,
    chart: result.chart,
    sql: result.sql,
    trace,
    sources: states.map((s) => ({ productId: s.product.id, version: s.version, certified: s.certified })),
    banner: uncert.length ? 'not-certified' : result.maskedColumns?.length ? 'masked' : undefined,
    bannerText: uncert.length ? `Not certified: use with caution. ${uncert.map((s) => `${s.product.name} (${s.product.id}) is ${s.status}`).join('; ')}.` : undefined,
    explorerTarget: result.explorerTarget ?? (states[0] ? `DATA_PRODUCTS.${states[0].product.outputPort}` : undefined),
  };
}
