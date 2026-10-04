import type { LineageNode } from '../mock-snowflake';
import { LAYER_BY_SCHEMA } from '../layers';
import type { LayerId } from '../types';

const NW = 196;
const NH = 40;
const GX = 56;
const GY = 12;

export function LineageGraph({ nodes, edges, focus, onOpen, compact }: { nodes: LineageNode[]; edges: [string, string][]; focus: string; onOpen: (id: string) => void; compact?: boolean }) {
  const levels = [...new Set(nodes.map((n) => n.level))].sort((a, b) => a - b);
  const byLevel = new Map(levels.map((l) => [l, nodes.filter((n) => n.level === l).sort((a, b) => a.id.localeCompare(b.id))]));
  const maxRows = Math.max(...[...byLevel.values()].map((x) => x.length));
  const H = Math.max(maxRows * (NH + GY) + 20, 80);
  const W = levels.length * (NW + GX) - GX + 20;
  const pos = new Map<string, { x: number; y: number }>();
  levels.forEach((l, ci) => {
    const col = byLevel.get(l)!;
    const offset = (H - col.length * (NH + GY) + GY) / 2;
    col.forEach((n, ri) => pos.set(n.id, { x: 10 + ci * (NW + GX), y: offset + ri * (NH + GY) }));
  });
  const layerOf = (id: string): LayerId | undefined => (id.startsWith('ext:') ? undefined : LAYER_BY_SCHEMA[id.split('.')[0]]?.id);
  return (
    <div tabIndex={0} role="region" aria-label="Lineage graph" className={compact ? 'overflow-x-auto scroll-thin' : 'overflow-auto rounded-md border border-line bg-surface2/40 scroll-thin'}>
      <svg width={W} height={H} role="group" aria-label={`Lineage for ${focus}`}>
        {edges.map(([a, b]) => {
          const pa = pos.get(a);
          const pb = pos.get(b);
          if (!pa || !pb) return null;
          const x1 = pa.x + NW;
          const y1 = pa.y + NH / 2;
          const x2 = pb.x;
          const y2 = pb.y + NH / 2;
          const mx = (x1 + x2) / 2;
          return <path key={`${a}-${b}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="rgb(var(--line))" strokeWidth={1.6} />;
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const layer = layerOf(n.id);
          const isFocus = n.id === focus;
          const [schema, name] = n.external ? ['SOURCE', n.id.slice(4)] : n.id.split('.');
          const color = layer ? `rgb(var(--layer-${layer}))` : 'rgb(var(--muted))';
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              role={n.external ? undefined : 'button'}
              tabIndex={n.external ? undefined : 0}
              aria-label={n.external ? `External source ${name}` : `Open ${n.id}`}
              className={n.external ? '' : 'cursor-pointer'}
              onClick={() => !n.external && onOpen(n.id)}
              onKeyDown={(e) => !n.external && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(n.id))}
            >
              <rect width={NW} height={NH} rx={6} fill="rgb(var(--surface))" stroke={isFocus ? color : 'rgb(var(--line))'} strokeWidth={isFocus ? 2.4 : 1} strokeDasharray={n.external ? '4 3' : undefined} />
              <rect width={5} height={NH} rx={2} fill={color} />
              <text x={13} y={15} fontSize={9.5} fill="rgb(var(--muted))" className="font-mono">{schema}</text>
              <text x={13} y={30} fontSize={11.5} fontWeight={isFocus ? 600 : 500} fill="rgb(var(--ink))" className="font-mono">
                {name.length > 24 ? `${name.slice(0, 23)}…` : name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
