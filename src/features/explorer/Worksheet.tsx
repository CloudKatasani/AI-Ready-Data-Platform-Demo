import { useMemo, useState } from 'react';
import { CodeBlock, SimpleTable } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useLive, usePack, usePersona } from '../../app/context';
import { queryId } from '../../mock-snowflake/generators';

/** Free-form worksheet with preset cross-layer queries (spec section 7.2, Should). Results use the same query
 * functions as the agents, so the numbers match. */
export function Worksheet() {
  const pack = usePack();
  const persona = usePersona();
  const live = useLive();
  const [id, setId] = useState(pack.worksheet[0]?.id);
  const [runs, setRuns] = useState(0);
  const preset = pack.worksheet.find((w) => w.id === id) ?? pack.worksheet[0];
  const res = useMemo(() => preset.run({ persona, live }), [preset, persona, live]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="label" htmlFor="ws-preset">Preset query</label>
        <select id="ws-preset" className="input w-auto max-w-full" value={id} onChange={(e) => setId(e.target.value)}>
          {pack.worksheet.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
        <button className="btn-primary" onClick={() => setRuns((r) => r + 1)}><Icon name="play" size={13} />Run</button>
        <span className="text-xs text-muted">as <span className="mono">{persona.roleId}</span> · query ID <span className="mono">{queryId(`${preset.id}:${persona.roleId}:${runs}`)}</span></span>
      </div>
      <CodeBlock code={preset.sql} maxH="max-h-48" />
      <SimpleTable columns={res.columns} rows={res.rows} />
      <p className="text-xs text-muted">Results computed from the in-memory sample with your role&apos;s row access policy applied; agent answers use the same functions.</p>
    </div>
  );
}
