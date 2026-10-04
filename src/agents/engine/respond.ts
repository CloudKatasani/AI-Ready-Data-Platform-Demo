// Turn a free-text question into an AgentAnswer: run, clarify, redirect or decline (spec section 9).
import type { AccessCode, AgentAnswer, IndustryPack, LiveState, Persona } from '../../types';
import { Matcher, MATCH } from './matcher';
import { runScenario } from './runScenario';

const matchers = new WeakMap<IndustryPack, Matcher>();
export function matcherFor(pack: IndustryPack) {
  let m = matchers.get(pack);
  if (!m) {
    m = new Matcher(pack);
    matchers.set(pack, m);
  }
  return m;
}

export function respond(pack: IndustryPack, agentId: string, text: string, persona: Persona, live: LiveState, access: (id: string) => AccessCode): AgentAnswer {
  const agent = pack.agents.find((a) => a.id === agentId)!;
  const m = matcherFor(pack);
  const own = m.rank(text, agentId);
  const best = own[0];
  if (best && best.score >= MATCH.run) return runScenario({ pack, scenario: best.scenario, persona, live, access });

  const other = m.rank(text).find((r) => r.scenario.agentId !== agentId);
  if (other && other.score >= MATCH.run && (!best || other.score > best.score + 0.1)) {
    const a = pack.agents.find((x) => x.id === other.scenario.agentId)!;
    return {
      kind: 'clarify', summary: `That’s answered by the ${a.name}. It works from ${a.productIds.map((p) => pack.products.find((x) => x.id === p)?.name).filter(Boolean).join(', ') || 'governance metadata'}.`,
      sources: [], sql: '', trace: [], switchAgentId: a.id, suggestions: [other.scenario.question],
    };
  }
  if (best && best.score >= MATCH.clarify) {
    return { kind: 'clarify', summary: 'Did you mean one of these?', sources: [], sql: '', trace: [], suggestions: own.slice(0, 2).map((r) => r.scenario.question) };
  }
  const kpis = agent.kpiIds.map((k) => pack.kpis.find((x) => x.id === k)?.name).filter(Boolean);
  return {
    kind: 'help',
    summary: `I can only answer questions about ${agent.domain.toLowerCase()} data at ${pack.profile.company}${kpis.length ? `, such as ${kpis.slice(0, 6).join(', ')}` : ': glossary health, CDE ownership, term usage and certification status'}. Try one of these:`,
    sources: [], sql: '', trace: [], suggestions: pack.scenarios.filter((s) => s.agentId === agentId).slice(0, 3).map((s) => s.question),
  };
}
