import { Link } from 'react-router-dom';
import { PROFILES } from '../packs';
import { LAYERS } from '../layers';
import { Icon } from '../components/icons';
import { layerColor } from '../components/ui';
import { ThemeToggle } from './TopBar';

export function StartScreen() {
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-md font-semibold">AI Ready Data Platform</span>
          <span className="chip border-line text-muted">Synthetic data</span>
        </div>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-2 flex h-1.5 w-40 gap-0.5">{LAYERS.map((l) => <div key={l.id} className="flex-1 rounded-sm" style={{ background: layerColor(l.id) }} />)}</div>
        <h1 className="font-display text-[28px] font-semibold leading-tight sm:text-[34px]">One account. Nine layers. Agents you can trust.</h1>
        <p className="mt-3 max-w-3xl text-muted">
          Pick the client&apos;s industry. Every pack fills the same nine schemas — Bronze, Silver, Gold, Semantic, Glossary, Context,
          Data Products, Agents and Governance — with its own fictional company, synthetic data, glossary, products and agents.
          The operating model never changes; only the content does.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROFILES.map((p) => {
            const body = (
              <>
                <div className="flex items-center justify-between">
                  <span className="grid h-9 w-9 place-items-center rounded-md text-white" style={{ background: p.accent }}><Icon name={p.icon} size={18} /></span>
                  {p.ready ? <span className="chip border-good/40 bg-good/10 text-good"><Icon name="check" size={11} />Ready</span> : <span className="chip border-dashed border-line text-muted">Pack in build</span>}
                </div>
                <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{p.industry}</div>
                <div className="font-display text-md font-semibold">{p.company}</div>
                <div className="mono mt-0.5 text-xs text-muted">{p.dbPrefix}_AI_PLATFORM</div>
                <div className="mt-2 text-xs text-muted">{p.scale.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(' · ')}</div>
                <div className="mt-3 flex flex-wrap gap-1">{p.headlineKpis.map((k) => <span key={k} className="chip border-line bg-surface2">{k}</span>)}</div>
                <div className="mt-3 text-xs text-muted">6 data products · 4 agents</div>
              </>
            );
            return p.ready ? (
              <Link key={p.id} to={`/${p.id}/map`} className="panel block p-4 transition-colors hover:border-accent">{body}</Link>
            ) : (
              <div key={p.id} className="panel p-4 opacity-70" aria-disabled="true" title="This industry pack is specified and will ship in milestone M9">{body}</div>
            );
          })}
        </div>
        <p className="mt-8 text-xs text-muted">All companies, people and numbers are fictional and generated in your browser. No Snowflake connection, network or login is used.</p>
      </main>
    </div>
  );
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      {['bronze', 'gold', 'semantic', 'product'].map((l, i) => <rect key={l} y={2 + i * 7} width="32" height="5" rx="2" fill={`rgb(var(--layer-${l}))`} />)}
    </svg>
  );
}
