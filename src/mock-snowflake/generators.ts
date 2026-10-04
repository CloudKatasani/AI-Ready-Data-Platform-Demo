// Generic, pack-agnostic generators (people, dates, time series), parameterised by each pack's config.
import { Rng } from './rng';

export const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara',
  'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy',
  'Anthony', 'Betty', 'Mark', 'Sandra', 'Donald', 'Ashley', 'Steven', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
  'Kevin', 'Carol', 'Brian', 'Amanda', 'Aisha', 'Mateo', 'Priya', 'Wei', 'Fatima', 'Diego', 'Hana', 'Omar', 'Lucia', 'Kwame',
];
export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez',
  'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White', 'Harris',
  'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Okoro', 'Kowalczyk', 'Haddad',
];
export const STREETS = ['Maple Ave', 'Oak St', 'Ridge Rd', 'Lakeview Dr', 'Cedar Ln', 'Mill St', 'Church St', 'Park Ave', 'River Rd', 'Hillcrest Dr', 'Elm St', 'Pine St'];

export interface Person { first: string; last: string; email: string; street: string }

export function person(rng: Rng, n: number, domain = 'examplemail.com'): Person {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  return {
    first, last,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${n % 97}@${domain}`,
    street: `${rng.int(10, 9899)} ${rng.pick(STREETS)}`,
  };
}

/** CDC noise for Bronze: mixed case and untrimmed strings. */
export function noisy(rng: Rng, s: string): string {
  const style = rng.int(0, 3);
  const cased = style === 0 ? s.toUpperCase() : style === 1 ? s.toLowerCase() : s;
  return rng.chance(0.35) ? `${cased}${' '.repeat(rng.int(1, 3))}` : cased;
}

// ---- Dates (all calendar dates are UTC-safe ISO strings; timestamps render as TIMESTAMP_NTZ in America/New_York)
const DAY = 86_400_000;
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (isoDate: string, n: number) => iso(new Date(toDate(isoDate).getTime() + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
export const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const ts = (isoDate: string, minutes: number) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  const s = Math.floor((minutes * 60) % 60);
  return `${isoDate} ${pad(h)}:${pad(m)}:${pad(s)}`;
};
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
export const monthOf = (isoDate: string) => isoDate.slice(0, 7);
export const quarterOf = (isoDate: string) => `${isoDate.slice(0, 4)}-Q${Math.floor((Number(isoDate.slice(5, 7)) - 1) / 3) + 1}`;
export const yearOf = (isoDate: string) => isoDate.slice(0, 4);

// ---- Number helpers
export const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Deterministic pseudo query id in Snowflake's format. */
export function queryId(seed: string): string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hex = (n: number, w: number) => (n >>> 0).toString(16).padStart(w, '0').slice(0, w);
  const h2 = Math.imul(h, 2654435761) >>> 0;
  return `01b7${hex(h, 4)}-0001-${hex(h2, 4)}-0000-${hex(h ^ h2, 8)}${hex(h2 >>> 3, 4)}`;
}
