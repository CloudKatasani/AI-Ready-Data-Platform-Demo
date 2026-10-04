import { describe, expect, it } from 'vitest';
import { respond } from '../src/agents/engine/respond';
import { initialLive } from '../src/packs/validate';
import type { AccessCode } from '../src/types';
import { persona, utilities } from './helpers';

const pack = utilities();
const live = initialLive(pack);
const accessFor = (roleId: string, overrides: Record<string, AccessCode> = {}) => (id: string) => overrides[id] ?? pack.initialAccess[roleId][id] ?? '-';

describe('agent answer engine', () => {
  it('declines DP-05 questions for the analyst and offers a request', () => {
    const a = persona(pack, 'A');
    const ans = respond(pack, 'AG-01', 'What is our days sales outstanding this month?', a, live, accessFor(a.roleId));
    expect(ans.kind).toBe('decline');
    expect(ans.banner).toBe('no-access');
    expect(ans.requestAssetId).toBe('DP-05');
    expect(ans.summary).not.toMatch(/\d+\.\d days/);
  });

  it('answers DSO with a certified source after certification and approval', () => {
    const a = persona(pack, 'A');
    const certified = { ...live, productStatus: { ...live.productStatus, 'DP-05': 'Certified' as const }, productVersion: { ...live.productVersion, 'DP-05': '1.0.0' } };
    const ans = respond(pack, 'AG-01', 'what is DSO this month', a, certified, accessFor(a.roleId, { 'DP-05': 'G' }));
    expect(ans.kind).toBe('answer');
    expect(ans.sources).toEqual([{ productId: 'DP-05', version: '1.0.0', certified: true }]);
    expect(ans.banner).toBeUndefined();
  });

  it('flags the Draft Vegetation Risk product as not certified', () => {
    const b = persona(pack, 'B');
    const ans = respond(pack, 'AG-02', 'How many outages were caused by trees this quarter, and how many spans are overdue for trimming?', b, live, accessFor(b.roleId));
    expect(ans.banner).toBe('not-certified');
    expect(ans.trace.at(-1)!.detail).toMatch(/not certified/i);
  });

  it('masks names and filters opcos for the analyst', () => {
    const a = persona(pack, 'A');
    const ans = respond(pack, 'AG-01', 'Which customers are at high churn risk with arrears over $500?', a, live, accessFor(a.roleId));
    expect(ans.table!.rows.every((r) => r[1] === '****')).toBe(true);
    expect(ans.table!.rows.every((r) => ['Northvale Ohio', 'Northvale Indiana'].includes(String(r[2])))).toBe(true);
    expect(ans.trace.find((s) => s.layer === 'gov')!.detail).toContain('MP_MASK_PII applied');
  });

  it('builds the full layer trace for the signature question', () => {
    const b = persona(pack, 'B');
    const ans = respond(pack, 'AG-02', pack.signature.question, b, live, accessFor(b.roleId));
    expect(ans.trace.map((s) => s.layer)).toEqual(['glossary', 'context', 'semantic', 'gov', 'product', 'context', 'agent']);
    expect(ans.trace[1].detail).toContain('BR-012');
    expect(ans.trace[5].detail).toContain('chunk 14');
    expect(ans.trace.reduce((t, s) => t + s.ms, 0)).toBeLessThan(3000);
  });

  it('agent numbers equal the worksheet numbers', () => {
    const b = persona(pack, 'B');
    const ans = respond(pack, 'AG-02', 'SAIDI by OPCO year to date', b, live, accessFor(b.roleId));
    const ws = pack.worksheet.find((w) => w.id === 'W-01')!.run({ persona: b, live });
    for (const row of ws.rows) {
      const agentRow = ans.table!.rows.find((r) => r[0] === row[0])!;
      expect(agentRow[1]).toBe(row[1]);
    }
    const a = persona(pack, 'A');
    const dso = pack.scenarios.find((s) => s.id === 'S-04')!.run({ persona: a, live });
    const wsDso = pack.worksheet.find((w) => w.id === 'W-04')!.run({ persona: a, live });
    expect(dso.table!.rows.at(-1)![1]).toBe(wsDso.rows.find((r) => r[0] === '2026-09')![1]);
  });

  it('declines out-of-scope questions and redirects cross-agent ones', () => {
    const d = persona(pack, 'D');
    const weather = respond(pack, 'AG-01', "What's the weather?", d, live, accessFor(d.roleId));
    expect(weather.kind).toBe('help');
    expect(weather.suggestions).toHaveLength(3);
    const other = respond(pack, 'AG-01', 'Which suppliers have OTIF below 90%?', d, live, accessFor(d.roleId));
    expect(other.switchAgentId).toBe('AG-03');
  });

  it('the steward agent reads certification state live', () => {
    const d = persona(pack, 'D');
    const q = 'Which data products are not yet certified, and what is blocking them?';
    const before = respond(pack, 'AG-04', q, d, live, accessFor(d.roleId));
    expect(before.table!.rows.map((r) => String(r[0]))).toEqual(['DP-05 Billing & Receivables', 'DP-06 Vegetation Risk']);
    const after = respond(pack, 'AG-04', q, d, { ...live, productStatus: { ...live.productStatus, 'DP-05': 'Certified' } }, accessFor(d.roleId));
    expect(after.table!.rows.map((r) => String(r[0]))).toEqual(['DP-06 Vegetation Risk']);
  });
});
