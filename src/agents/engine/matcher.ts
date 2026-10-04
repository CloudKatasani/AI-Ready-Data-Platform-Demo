// Free-text matching (spec section 9): normalise, expand synonyms, score scenarios with a simple TF-IDF cosine.
import type { IndustryPack, Scenario } from '../../types';

const STOP = new Set('a an the of in on for by to and or is are was were what which how many much our we show me give tell with this that last our do does did be it its from at as per vs than'.split(' '));

export function normalise(s: string): string {
  return s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9%$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function expandSynonyms(text: string, pack: Pick<IndustryPack, 'context' | 'glossary'>): string {
  let t = ` ${normalise(text)} `;
  const add: string[] = [];
  for (const s of pack.context.synonyms) {
    const syn = normalise(s.synonym);
    if (syn && t.includes(` ${syn} `)) add.push(normalise(s.term));
  }
  for (const g of pack.glossary) {
    for (const syn of g.synonyms) {
      const n = normalise(syn);
      if (n && t.includes(` ${n} `)) add.push(normalise(g.term));
    }
  }
  t += add.join(' ');
  return t.trim();
}

const stem = (w: string) => w.replace(/(ing|ers|er|es|s)$/, '').replace(/ies$/, 'y');
export function tokens(s: string): string[] {
  return normalise(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);
}

export interface MatchResult {
  scenario: Scenario;
  score: number;
}

export class Matcher {
  private idf = new Map<string, number>();
  private docs: { scenario: Scenario; vec: Map<string, number>; norm: number }[] = [];
  private pack: IndustryPack;

  constructor(pack: IndustryPack) {
    this.pack = pack;
    const raw = pack.scenarios.flatMap((s) => {
      const kpiNames = s.kpiIds.map((k) => pack.kpis.find((x) => x.id === k)?.name ?? '').join(' ');
      return [s.question, ...s.paraphrases].map((q) => ({ scenario: s, toks: [...new Set(tokens(expandSynonyms(`${q} ${kpiNames}`, pack)))] }));
    });
    const df = new Map<string, number>();
    for (const d of raw) for (const t of d.toks) df.set(t, (df.get(t) ?? 0) + 1);
    for (const [t, n] of df) this.idf.set(t, Math.log(1 + raw.length / n));
    this.docs = raw.map((d) => {
      const vec = new Map(d.toks.map((t) => [t, this.idf.get(t)!]));
      return { scenario: d.scenario, vec, norm: Math.sqrt([...vec.values()].reduce((a, b) => a + b * b, 0)) };
    });
  }

  rank(query: string, agentId?: string): MatchResult[] {
    const qt = [...new Set(tokens(expandSynonyms(query, this.pack)))];
    const qv = new Map(qt.map((t) => [t, this.idf.get(t) ?? 0.4]));
    const qn = Math.sqrt([...qv.values()].reduce((a, b) => a + b * b, 0)) || 1;
    const best = new Map<string, MatchResult>();
    const nq = normalise(query);
    for (const d of this.docs) {
      if (agentId && d.scenario.agentId !== agentId) continue;
      let dot = 0;
      for (const [t, w] of qv) if (d.vec.has(t)) dot += w * d.vec.get(t)!;
      let score = dot / (qn * (d.norm || 1));
      if (normalise(d.scenario.question) === nq) score = 1;
      const cur = best.get(d.scenario.id);
      if (!cur || score > cur.score) best.set(d.scenario.id, { scenario: d.scenario, score });
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  }
}

export const MATCH = { run: 0.45, clarify: 0.25 };
