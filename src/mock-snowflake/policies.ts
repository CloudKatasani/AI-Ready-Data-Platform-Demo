import type { Cell, Column, Persona, Row, SensitiveClass, SfObject } from '../types';

export const SENSITIVE: SensitiveClass[] = ['PII', 'PHI', 'PCI', 'CPNI', 'NPI', 'GOV_ID', 'TRADE_SECRET'];

export function sensitiveTags(col: Column): SensitiveClass[] {
  return (col.tags ?? []).filter((t): t is SensitiveClass => (SENSITIVE as string[]).includes(t));
}

/** A column is masked for a persona when it carries a sensitive class the persona may not see. */
export function isMasked(col: Column, persona: Persona, fixes: string[] = []): boolean {
  if (col.maskPendingFix && !fixes.includes(col.maskPendingFix)) return false;
  return sensitiveTags(col).some((c) => !persona.unmasked.includes(c));
}

/** True when a sensitive column has a masking policy attached (in the current demo state). */
export function hasMaskingPolicy(col: Column, fixes: string[] = []): boolean {
  if (!sensitiveTags(col).length) return false;
  return !col.maskPendingFix || fixes.includes(col.maskPendingFix);
}

/** Mask a value the way the demo masking policies do: emails keep their first letter, everything else is ****. */
export function maskValue(v: Cell): Cell {
  if (v === null || v === undefined) return v ?? null;
  const s = String(v);
  if (s.includes('@')) return `${s.trim().charAt(0).toLowerCase()}****@****.com`;
  if (/^\d{4}$/.test(s)) return '****';
  return '****';
}

/** Row access: true when the persona may see this row of this object. */
export function rowAllowed(obj: SfObject, row: Row, persona: Persona): boolean {
  if (!persona.rowFilter || !obj.rowAccess) return true;
  const raw = row[obj.rowAccess.column];
  if (raw === null || raw === undefined) return false;
  const key = String(raw).trim().toUpperCase();
  const value = obj.rowAccess.map ? obj.rowAccess.map[key] ?? obj.rowAccess.map[String(raw).trim()] : String(raw);
  return value !== undefined && persona.rowFilter.allowed.includes(value);
}

export interface PolicyResult {
  rows: Row[];
  maskedColumns: string[];
  filteredOut: number;
  rowPolicyApplied: boolean;
}

/** Apply row access and masking policies, the way Snowflake does at query time. */
export function applyPolicies(obj: SfObject, rows: Row[], persona: Persona, fixes: string[] = []): PolicyResult {
  const masked = obj.columns.filter((c) => isMasked(c, persona, fixes)).map((c) => c.name);
  const rowPolicyApplied = Boolean(persona.rowFilter && obj.rowAccess);
  const kept = rowPolicyApplied ? rows.filter((r) => rowAllowed(obj, r, persona)) : rows;
  const out = masked.length
    ? kept.map((r) => {
        const copy: Row = { ...r };
        for (const m of masked) copy[m] = maskValue(copy[m]);
        return copy;
      })
    : kept;
  return { rows: out, maskedColumns: masked, filteredOut: rows.length - kept.length, rowPolicyApplied };
}

/** Mask a free-standing value given its sensitive class (used by agent answers). */
export function maskFor(persona: Persona, cls: SensitiveClass, v: Cell): Cell {
  return persona.unmasked.includes(cls) ? v : maskValue(v);
}
