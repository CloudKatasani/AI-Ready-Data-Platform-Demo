import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { SfObject } from '../../types';
import { Icon } from '../../components/icons';
import { CodeBlock, DataGrid, Drawer, LayerBadge, LayerDot, PageHeader, StatusChip, Tabs } from '../../components/ui';
import { LineageGraph } from '../../components/LineageGraph';
import { cls, fmtBytes, fmtInt } from '../../lib/format';
import { useAccess, useDb, useLive, usePack, usePackPath, usePersona } from '../../app/context';
import { hasMaskingPolicy, sensitiveTags } from '../../mock-snowflake/policies';
import { queryId } from '../../mock-snowflake/generators';
import { Worksheet } from './Worksheet';

type TabId = 'preview' | 'columns' | 'ddl' | 'lineage' | 'quality' | 'gov' | 'worksheet';

export default function Explorer() {
  const { schema, object } = useParams();
  const db = useDb();
  const path = usePackPath();
  if (!schema || !object || !db.getObject(`${schema}.${object}`)) {
    const first = db.listSchemas()[0].objects[0];
    return <Navigate to={path(`explorer/${first.schema}/${first.name}`)} replace />;
  }
  return <ExplorerInner id={`${schema}.${object}`} />;
}

function ObjectTree({ current }: { current: string }) {
  const db = useDb();
  const path = usePackPath();
  const navigate = useNavigate();
  const curSchema = current.split('.')[0];
  const [open, setOpen] = useState<Record<string, boolean>>({ [curSchema]: true });
  useEffect(() => setOpen((o) => ({ ...o, [curSchema]: true })), [curSchema]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-tree-item]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const el = items[i];
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
    if (e.key === 'ArrowRight' && el.dataset.schema) { e.preventDefault(); setOpen((o) => ({ ...o, [el.dataset.schema!]: true })); }
    if (e.key === 'ArrowLeft' && el.dataset.schema) { e.preventDefault(); setOpen((o) => ({ ...o, [el.dataset.schema!]: false })); }
  };

  return (
    <div role="tree" aria-label={`${db.database} objects`} onKeyDown={onKey} className="text-sm">
      <div className="mono flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold"><Icon name="database" size={14} />{db.database}</div>
      {db.listSchemas().map(({ layer, schema, objects }) => {
        const isOpen = open[schema];
        const types = [...new Set(objects.map((o) => o.type))];
        return (
          <div key={schema} role="treeitem" aria-expanded={isOpen} aria-selected={false}>
            <button data-tree-item data-schema={schema} onClick={() => setOpen((o) => ({ ...o, [schema]: !isOpen }))} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-surface2">
              <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} className="text-muted" />
              <LayerDot layer={layer.id} />
              <span className="mono flex-1 truncate text-xs">{schema}</span>
              <span className="text-xs text-muted">{objects.length}</span>
            </button>
            {isOpen && (
              <div role="group" className="ml-4 border-l border-line pl-1">
                {types.map((t) => (
                  <div key={t}>
                    <div className="px-2 pb-0.5 pt-1.5 text-[11px] uppercase tracking-wide text-muted">{t.toLowerCase()}s</div>
                    {objects.filter((o) => o.type === t).map((o) => {
                      const id = `${o.schema}.${o.name}`;
                      const sel = id === current;
                      return (
                        <button
                          key={id} data-tree-item role="treeitem" aria-selected={sel}
                          onClick={() => navigate(path(`explorer/${o.schema}/${o.name}`))}
                          className={cls('mono flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left text-xs', sel ? 'bg-accent/10 font-semibold text-ink' : 'hover:bg-surface2')}
                        >
                          <LayerDot layer={o.layer} size={6} />
                          <span className="truncate">{o.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MetaPanel({ o }: { o: SfObject }) {
  const pack = usePack();
  const db = useDb();
  const path = usePackPath();
  const id = `${o.schema}.${o.name}`;
  const terms = [...new Set(o.columns.map((c) => c.termId).filter(Boolean))].map((t) => pack.glossary.find((g) => g.id === t)!).filter(Boolean);
  const lin = db.lineage(id, 6);
  const products = pack.products.filter((p) => lin.nodes.some((n) => n.level >= 0 && n.id === `DATA_PRODUCTS.${p.outputPort}`));
  const rows: [string, React.ReactNode][] = [
    ['Fully qualified name', <span className="mono break-all">{db.fqn(id)}</span>],
    ['Type', o.type],
    ['Owner role', <span className="mono">{o.owner}</span>],
    ['Last altered', <span className="mono">{o.lastAltered}</span>],
    ['Rows', <span className="mono">{o.rowCount ? fmtInt(o.rowCount) : '—'}</span>],
    ['Size', fmtBytes(o.bytes)],
    ...(o.targetLag ? [['Target lag', <span className="mono">{o.targetLag}</span>] as [string, React.ReactNode]] : []),
    ['Upstream / downstream', `${db.upstream(id).length} / ${db.downstream(id).length}`],
  ];
  return (
    <div className="space-y-4 text-sm">
      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="label">{k}</dt><dd className="mt-0.5">{v}</dd></div>
        ))}
      </dl>
      <div><div className="label">Comment</div><p className="mt-0.5 text-muted">{o.comment}</p></div>
      {terms.length > 0 && (
        <div>
          <div className="label">Glossary terms</div>
          <div className="mt-1 flex flex-wrap gap-1">{terms.map((t) => <Link key={t.id} to={path(`glossary/${t.id}`)} className="chip border-transparent bg-[rgb(var(--layer-glossary)/0.14)] hover:underline">{t.term}</Link>)}</div>
        </div>
      )}
      {products.length > 0 && (
        <div>
          <div className="label">Feeds data products</div>
          <ul className="mt-1 space-y-1">{products.map((p) => <li key={p.id}><Link to={path(`certify/${p.id}`)} className="link">{p.id} {p.name}</Link></li>)}</ul>
        </div>
      )}
    </div>
  );
}

function ExplorerInner({ id }: { id: string }) {
  const pack = usePack();
  const db = useDb();
  const live = useLive();
  const persona = usePersona();
  const access = useAccess();
  const path = usePackPath();
  const navigate = useNavigate();
  const o = db.getObject(id)!;
  const [tab, setTab] = useState<TabId>(o.rows ? 'preview' : o.type === 'SEMANTIC VIEW' || o.type === 'AGENT' ? 'ddl' : 'columns');
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(0);
  const [meta, setMeta] = useState(false);
  const fixes = live.fixes[pack.certificationScript.productId] ?? [];

  useEffect(() => {
    setTab(o.rows ? 'preview' : o.type === 'SEMANTIC VIEW' || o.type === 'AGENT' ? 'ddl' : 'columns');
    setRan((r) => r + 1);
  }, [id, o.rows, o.type]);

  const preview = useMemo(() => db.preview(id, persona, live), [db, id, persona, live]);
  const types = Object.fromEntries(o.columns.map((c) => [c.name, c.type]));
  const run = () => {
    setRunning(true);
    setTimeout(() => { setRunning(false); setRan((r) => r + 1); }, preview.ms);
  };

  const tabs: { id: TabId; label: string; count?: number }[] = [
    ...(o.rows ? [{ id: 'preview' as TabId, label: 'Data preview' }] : []),
    ...(o.columns.length ? [{ id: 'columns' as TabId, label: 'Columns', count: o.columns.length }] : []),
    { id: 'ddl', label: 'Definition' },
    { id: 'lineage', label: 'Lineage' },
    { id: 'quality', label: 'Quality' },
    { id: 'gov', label: 'Governance' },
    { id: 'worksheet', label: 'Worksheet' },
  ];
  const lin = useMemo(() => db.lineage(id, 4), [db, id]);
  const dmf = db.dmf(id);
  const sensitive = o.columns.filter((c) => sensitiveTags(c).length);
  const isBronze = o.layer === 'bronze';
  const isSilver = o.layer === 'silver';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-4 sm:px-6">
        <PageHeader title="Database Explorer" layer={o.layer} sub={<>Browse {pack.database} like Snowsight: every layer is a schema. Policies apply at query time for <span className="mono">{persona.roleId}</span>.</>} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 sm:px-6 min-[900px]:flex-row">
        <aside className="panel max-h-64 shrink-0 overflow-y-auto p-1.5 scroll-thin min-[900px]:max-h-none min-[900px]:w-64">
          <ObjectTree current={id} />
        </aside>
        <section className="panel flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <LayerBadge layer={o.layer} />
              <h2 className="mono text-md font-semibold">{o.name}</h2>
              <span className="chip border-line text-muted">{o.type}</span>
              {o.targetLag && <span className="chip border-line text-muted">lag {o.targetLag}</span>}
              <button className="btn-ghost ml-auto min-[1280px]:hidden" onClick={() => setMeta(true)}><Icon name="info" size={14} />Details</button>
            </div>
            <div className="mt-1 text-xs text-muted">
              {o.rowCount ? <><span className="mono">{fmtInt(o.rowCount)}</span> rows · </> : null}
              {o.bytes ? <>{fmtBytes(o.bytes)} · </> : null}owner <span className="mono">{o.owner}</span> · altered <span className="mono">{o.lastAltered}</span>
            </div>
          </div>
          <div className="px-4"><Tabs label="Object workspace" tabs={tabs} value={tab} onChange={setTab} /></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
            {tab === 'preview' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="mono min-w-0 flex-1 truncate rounded-md border border-line bg-surface2/60 px-2.5 py-1.5 text-xs" title={preview.sql}>{preview.sql}</code>
                  <button className="btn-primary" onClick={run} disabled={running}><Icon name="play" size={13} />{running ? 'Running…' : 'Run'}</button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-live="polite">
                  {running ? <span className="typing">Executing on {pack.warehouse} <span>●</span><span>●</span><span>●</span></span> : (
                    <>
                      <span>Query ID <span className="mono">{queryId(`${id}:${persona.roleId}:${ran}`)}</span></span>
                      <span>{preview.ms} ms</span>
                      <span>{preview.rows.length} rows</span>
                      {preview.maskedColumns.length > 0 && <span className="text-ink"><Icon name="lock" size={11} className="mr-1 inline" />{pack.maskingPolicy} masked {preview.maskedColumns.join(', ')}</span>}
                      {preview.rowPolicyApplied && <span className="text-ink"><Icon name="filter" size={11} className="mr-1 inline" />{pack.rowAccessPolicy}: {persona.rowFilter!.allowed.join(', ')} only</span>}
                    </>
                  )}
                </div>
                {isBronze && <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">Raw CDC: rows marked <span className="mono">OP_TYPE = 'U'</span> are update duplicates and <span className="mono">'D'</span> deletes; names arrive mixed-case and untrimmed (␠). Silver shows them cleaned.</div>}
                {isSilver && <div className="rounded-md border border-good/40 bg-good/10 px-3 py-2 text-xs">Curated: deduplicated on the business key, deletes applied, strings trimmed and cased, types enforced{o.columns.some((c) => c.name === 'IS_CURRENT') ? ', SCD2 history kept with IS_CURRENT' : ''}.</div>}
                {!running && (
                  <DataGrid
                    columns={preview.columns} rows={preview.rows} masked={preview.maskedColumns} types={types}
                    highlight={(r) => (r.OP_TYPE === 'U' ? 'bg-warn/10' : r.OP_TYPE === 'D' ? 'bg-bad/10' : r.IS_CURRENT === false ? 'bg-surface2/70' : undefined)}
                  />
                )}
              </div>
            )}
            {tab === 'columns' && (
              <div className="overflow-x-auto rounded-md border border-line scroll-thin">
                <table className="min-w-full text-sm">
                  <thead className="bg-surface2 text-left text-xs">
                    <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Null</th><th className="px-3 py-2">Comment</th><th className="px-3 py-2">Tags</th></tr>
                  </thead>
                  <tbody>
                    {o.columns.map((c) => {
                      const t = c.termId ? pack.glossary.find((g) => g.id === c.termId) : undefined;
                      return (
                        <tr key={c.name} className="border-t border-line/70 align-top">
                          <td className="mono px-3 py-1.5 font-medium">{c.name}</td>
                          <td className="mono px-3 py-1.5 text-xs text-muted">{c.type}</td>
                          <td className="px-3 py-1.5 text-xs">{c.nullable ? 'Y' : 'N'}</td>
                          <td className="px-3 py-1.5 text-xs text-muted">{c.comment}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {sensitiveTags(c).map((s) => <span key={s} className="chip border-bad/40 bg-bad/10 text-bad"><Icon name="lock" size={10} />{s}</span>)}
                              {(c.tags ?? []).includes('CDE') && <span className="chip border-seal/50 bg-seal/10 text-seal">CDE</span>}
                              {t && <Link to={path(`glossary/${t.id}`)} className="chip border-transparent bg-[rgb(var(--layer-glossary)/0.14)] hover:underline">{t.term}</Link>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'ddl' && <CodeBlock code={db.ddl(id, live)} maxH="max-h-[60vh]" />}
            {tab === 'lineage' && (
              <div className="space-y-2">
                <p className="text-xs text-muted">Upstream on the left, downstream (including data products and agents) on the right. Click a node to open it.</p>
                <LineageGraph nodes={lin.nodes} edges={lin.edges} focus={id} onOpen={(n) => navigate(path(`explorer/${n.replace('.', '/')}`))} />
              </div>
            )}
            {tab === 'quality' && (
              dmf.length ? (
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="min-w-full text-sm">
                    <thead className="bg-surface2 text-left text-xs"><tr><th className="px-3 py-2">Metric</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2">Threshold</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Measured</th></tr></thead>
                    <tbody>
                      {dmf.map((d) => (
                        <tr key={d.metric} className="border-t border-line/70">
                          <td className="mono px-3 py-1.5">SNOWFLAKE.CORE.{d.metric}</td>
                          <td className="mono px-3 py-1.5 text-right">{fmtInt(d.value)}</td>
                          <td className="px-3 py-1.5 text-xs text-muted">{d.threshold}</td>
                          <td className="px-3 py-1.5"><StatusChip status={d.status} /></td>
                          <td className="mono px-3 py-1.5 text-xs text-muted">{d.measuredAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-muted">No data metric functions are scheduled on this {o.type.toLowerCase()}. DMFs run on tables, dynamic tables and product views.</p>
            )}
            {tab === 'gov' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <div className="label mb-1">Sensitive columns and masking</div>
                    {sensitive.length ? (
                      <ul className="space-y-1 text-sm">
                        {sensitive.map((c) => {
                          const ok = hasMaskingPolicy(c, fixes);
                          return (
                            <li key={c.name} className="flex flex-wrap items-center gap-2">
                              <span className="mono">{c.name}</span>
                              {sensitiveTags(c).map((s) => <span key={s} className="chip border-bad/40 bg-bad/10 text-bad">{s}</span>)}
                              {ok ? <StatusChip status="pass" label={pack.maskingPolicy} /> : <StatusChip status="fail" label="No masking policy" />}
                            </li>
                          );
                        })}
                      </ul>
                    ) : <p className="text-sm text-muted">No sensitive columns.</p>}
                  </div>
                  <div>
                    <div className="label mb-1">Row access policy</div>
                    <p className="text-sm">{o.rowAccess ? <><span className="mono">{pack.rowAccessPolicy}</span> on <span className="mono">{o.rowAccess.column}</span></> : <span className="text-muted">None</span>}</p>
                  </div>
                  <div>
                    <div className="label mb-1">Tags</div>
                    <div className="flex flex-wrap gap-1 text-xs">
                      <span className="chip border-line">DOMAIN = '{o.schema === 'DATA_PRODUCTS' ? pack.products.find((p) => p.outputPort === o.name)?.domain ?? 'Shared' : 'Platform'}'</span>
                      {o.columns.some((c) => (c.tags ?? []).includes('CDE')) && <span className="chip border-seal/50 text-seal">CDE on {o.columns.filter((c) => (c.tags ?? []).includes('CDE')).length} columns</span>}
                      {(() => { const p = pack.products.find((x) => x.outputPort === o.name); return p && live.productStatus[p.id] === 'Certified' ? <span className="chip border-seal/50 text-seal">CERTIFICATION = 'GOLD'</span> : null; })()}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="label mb-1">Grants by role</div>
                    <table className="w-full text-sm"><tbody>
                      {db.grants(id, (r, a) => access(a, r)).map((g) => (
                        <tr key={g.role} className="border-t border-line/70"><td className="mono py-1 pr-2">{g.role}</td><td className="py-1 pr-2 text-xs">{g.privilege}</td><td className="py-1 text-xs text-muted">{g.via}</td></tr>
                      ))}
                    </tbody></table>
                  </div>
                  <div>
                    <div className="label mb-1">Last five access-history rows</div>
                    <table className="w-full text-xs"><tbody>
                      {db.accessHistory(id).map((h) => (
                        <tr key={h.queryId} className="border-t border-line/70 align-top"><td className="mono py-1 pr-2">{h.ts}</td><td className="mono py-1 pr-2">{h.role}</td><td className="py-1 text-muted">{h.columns}</td></tr>
                      ))}
                    </tbody></table>
                  </div>
                </div>
              </div>
            )}
            {tab === 'worksheet' && <Worksheet />}
          </div>
        </section>
        <aside className="panel hidden w-72 shrink-0 overflow-y-auto p-4 scroll-thin min-[1280px]:block"><MetaPanel o={o} /></aside>
      </div>
      <Drawer open={meta} onClose={() => setMeta(false)} title={o.name} subtitle={o.type} width="max-w-sm"><MetaPanel o={o} /></Drawer>
    </div>
  );
}
