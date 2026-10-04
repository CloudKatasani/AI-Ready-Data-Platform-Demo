import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui';
import { Icon } from '../../components/icons';
import { cls } from '../../lib/format';
import { useExt, useLive, usePack, usePersona } from '../../app/context';
import { runKnockout } from '../../ext/knockout';
import { ALL_ON, SWITCHES, type SwitchableLayer } from '../../ext/types';
import { hasExt, NotConfigured } from '../../ext/NotConfigured';
import { AnswerCard, FailureStrip, SwitchRow } from './parts';

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export default function Knockout() {
  const pack = usePack();
  if (!hasExt(pack, ['knockoutScenarios'])) return <NotConfigured pack={pack} keys={['knockoutScenarios']} />;
  return <KnockoutInner />;
}

function KnockoutInner() {
  const pack = usePack();
  const persona = usePersona();
  const live = useLive();
  const [ext, patch] = useExt();
  const [sp, setSp] = useSearchParams();
  const qs = pack.ext!.knockoutScenarios;
  const [qid, setQid] = useState(() => sp.get('q') ?? qs.find((k) => k.question === pack.signature.question)?.id ?? qs[0].id);
  const ks = qs.find((k) => k.id === qid) ?? qs[0];
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState<number | null>(null);
  const timers = useRef<number[]>([]);

  // Deep link from E2 "Why is it different?": ?q=KO-3&off=context,governance
  useEffect(() => {
    const off = sp.get('off');
    if (!off && !sp.get('q')) return;
    if (off) {
      const offs = off.split(',') as SwitchableLayer[];
      patch((e) => ({ ...e, switches: { ...ALL_ON, ...Object.fromEntries(offs.map((o) => [o, false])) } }));
    }
    setSp({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const ctx = useMemo(() => ({ persona, live }), [persona, live]);
  const governed = useMemo(() => runKnockout(pack, ks, ALL_ON, ctx), [pack, ks, ctx]);
  const current = useMemo(() => runKnockout(pack, ks, ext.switches, ctx), [pack, ks, ext.switches, ctx]);

  const flash = () => {
    if (reduced()) return;
    setBusy(true);
    timers.current.push(window.setTimeout(() => setBusy(false), 600));
  };
  const setSwitch = (id: SwitchableLayer, on: boolean) => {
    patch((e) => ({ ...e, switches: { ...e.switches, [id]: on } }));
    flash();
  };
  const reset = () => {
    timers.current.forEach(clearTimeout);
    setAuto(null);
    patch((e) => ({ ...e, switches: { ...ALL_ON } }));
  };
  const runThrough = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const step = reduced() ? 1500 : 4000;
    SWITCHES.forEach((s, i) => {
      timers.current.push(window.setTimeout(() => {
        setAuto(i);
        patch((e) => ({ ...e, switches: { ...ALL_ON, [s.id]: false } }));
        flash();
      }, i * step));
    });
    timers.current.push(window.setTimeout(() => { setAuto(null); patch((e) => ({ ...e, switches: { ...ALL_ON } })); }, SWITCHES.length * step));
  };
  const anyOff = Object.values(ext.switches).some((v) => !v);

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <PageHeader
        title="Layer knockout"
        layer={SWITCHES.filter((s) => !ext.switches[s.id]).map((s) => s.layer).concat(anyOff ? [] : ['agent'])}
        sub="Switch a layer off and watch the agent's answer break. The reference answer never changes; the right card re-runs with only the layers you leave on."
        right={(
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={runThrough} disabled={auto !== null}><Icon name="play" size={13} />{auto !== null ? `Knocking out ${SWITCHES[auto].label}…` : 'Knock out one at a time'}</button>
            <button className="btn" onClick={reset} disabled={!anyOff && auto === null}><Icon name="reset" size={13} />Reset switches</button>
          </div>
        )}
      />
      <SwitchRow value={ext.switches} onChange={setSwitch} />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="panel p-4" aria-label="Question">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Question</h2>
            <span className="chip ml-auto border-line"><Icon name="user" size={11} />{persona.name} · <span className="mono">{persona.roleId}</span></span>
          </div>
          <div role="radiogroup" aria-label="Knockout questions" className="space-y-2">
            {qs.map((k) => {
              const ag = pack.agents.find((a) => a.id === k.agentId);
              return (
                <button key={k.id} role="radio" aria-checked={k.id === ks.id} onClick={() => setQid(k.id)} className={cls('block w-full rounded-md border p-3 text-left', k.id === ks.id ? 'border-accent bg-accent/5' : 'border-line hover:border-accent/60')}>
                  <span className="block text-sm font-medium">{k.question}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                    {ag?.name} · sensitive to
                    {k.affects.map((a) => <span key={a} className="rounded bg-surface2 px-1">{SWITCHES.find((s) => s.id === a)?.label}</span>)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="order-2 md:order-1"><AnswerCard title="With all layers (reference)" run={governed} result={governed.result} reference /></div>
          <div className="order-1 md:order-2"><AnswerCard title={anyOff ? 'With current switches' : 'With current switches (all on)'} run={current} result={current.result} busy={busy} /></div>
        </div>
      </div>
      <div className="mt-4"><FailureStrip run={current} links={ks.links} /></div>
    </div>
  );
}
