import type { SVGProps } from 'react';

const P: Record<string, string> = {
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  signal: 'M2 20h2v-3H2zm5 0h2v-7H7zm5 0h2V9h-2zm5 0h2V4h-2z',
  bag: 'M6 7h12l1 13H5zM9 7a3 3 0 0 1 6 0',
  bank: 'M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  civic: 'M3 21h18M5 21V10m14 11V10M9 21v-6h6v6M2 10 12 3l10 7z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zm16 0h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5z',
  badge: 'M12 2l2.4 2.2 3.2-.4.9 3.1 2.8 1.6-1.1 3 1.1 3-2.8 1.6-.9 3.1-3.2-.4L12 22l-2.4-2.2-3.2.4-.9-3.1-2.8-1.6 1.1-3-1.1-3 2.8-1.6.9-3.1 3.2.4zm-3 10 2 2 4-4',
  bot: 'M12 3v3M5 9h14v10H5zm4 4h.01M15 13h.01M9 17h6M2 13v2M22 13v2',
  store: 'M4 9l1.5-5h13L20 9M4 9h16v11H4zm0 0a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-5h4v5',
  key: 'M14 3a7 7 0 0 0-6.7 9L2 17.3V22h4.7l.8-.8V19h2.2l.8-.8V16h2.2l1.3-1.3A7 7 0 1 0 14 3zm2.5 4.5h.01',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  x: 'M6 6l12 12M18 6 6 18',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  lock: 'M6 11h12v10H6zm2 0V7a4 4 0 0 1 8 0v4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warn: 'M12 3 2 20h20zM12 10v4m0 3h.01',
  fail: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6m0-6-6 6',
  pass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16 10',
  pending: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  play: 'M7 4l13 8-13 8z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  plus: 'M12 5v14M5 12h14',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  table: 'M3 5h18v14H3zM3 10h18M9 5v14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  send: 'M4 12l16-8-6 16-3-6z',
  sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z',
  doc: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h6',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8h.01',
  reset: 'M4 4v6h6M4.6 15a8 8 0 1 0 1.9-8.3L4 10',
  power: 'M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0',
  scale: 'M12 3v18M5 21h14M4 8l3-4 3 4M4 8a3 3 0 0 0 6 0M14 8l3-4 3 4M14 8a3 3 0 0 0 6 0M7 4h10',
  gauge: 'M12 13l4-4M3.5 17a9 9 0 1 1 17 0',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8',
  hammer: 'M14 6l4 4M4 20l9-9M11 4l2-2 7 7-2 2-3-3-3 3-3-3 3-3z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v1.5M12 16v1.5',
  heart: 'M12 20s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.5-8 11-8 11zM5 12h3l2-3 3 6 2-3h4',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  blast: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3',
  thumbUp: 'M7 10v10H4V10zM7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.3 6A2 2 0 0 1 17.7 20H7',
  thumbDown: 'M7 14V4H4v10zM7 14l4 7a2 2 0 0 0 3-2l-1-5h6a2 2 0 0 0 2-2.3l-1.3-6A2 2 0 0 0 17.7 4H7',
};

export type IconName = keyof typeof P | string;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name] ?? P.cube} />
    </svg>
  );
}
