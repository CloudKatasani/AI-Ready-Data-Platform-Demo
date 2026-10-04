export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
export const fmtNum = (v: number, d = 1) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtUsd = (v: number, d = 2) => `$${fmtNum(v, d)}`;
export const fmtPct = (v: number, d = 1) => `${fmtNum(v, d)}%`;
export function fmtCompact(v: number, unit = ''): string {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${fmtNum(v / 1e9, 2)} B` : a >= 1e6 ? `${fmtNum(v / 1e6, 1)} M` : a >= 1e4 ? `${fmtNum(v / 1e3, 1)} K` : fmtInt(v);
  return unit === 'USD' ? `$${s}` : s;
}
export function fmtBytes(b?: number): string {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${fmtNum(v, 1)} ${u[i]}`;
}
export function fmtKpi(v: number, unit: string): string {
  if (unit === 'USD') return Math.abs(v) >= 1e5 ? fmtCompact(v, 'USD') : fmtUsd(v);
  if (unit === '%') return fmtPct(v);
  if (unit === 'interruptions') return fmtNum(v, 3);
  if (Number.isInteger(v)) return fmtCompact(v);
  return fmtNum(v, 1);
}
export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
