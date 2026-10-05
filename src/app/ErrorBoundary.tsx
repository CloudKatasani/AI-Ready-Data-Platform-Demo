import { Component, lazy, type ComponentType, type ReactNode } from 'react';
import { useStore } from '../store';

/** Lazy route that retries a failed chunk fetch once with a full reload (stale dev server / redeployed build). */
export function lazyWithRetry<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err: unknown) => {
      const key = 'dfs-chunk-retry';
      let retried = false;
      try {
        retried = sessionStorage.getItem(key) === '1';
        sessionStorage.setItem(key, '1');
      } catch {
        /* storage unavailable */
      }
      if (!retried) {
        window.location.reload();
        return new Promise<{ default: T }>(() => undefined);
      }
      throw err;
    }).then((m) => {
      try {
        sessionStorage.removeItem('dfs-chunk-retry');
      } catch {
        /* ignore */
      }
      return m;
    }),
  );
}

interface Props { children: ReactNode; resetKey?: string; label?: string }
interface State { error: Error | null }

/** Shows the error instead of a blank screen, so a presenter can recover in front of a client. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[AI Ready Data Platform] ${this.props.label ?? 'view'} crashed:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-10 max-w-xl rounded-lg border border-bad/40 bg-surface p-5">
        <div className="text-md font-semibold">This view hit an error</div>
        <p className="mt-1 text-sm text-muted">The rest of the app still works. Retry, or reset the demo state if it keeps happening.</p>
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface2 p-2 font-mono text-xs">{error.message}</pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => this.setState({ error: null })}>Retry</button>
          <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
          <button className="btn" onClick={() => { useStore.getState().resetAll(); this.setState({ error: null }); }}>Reset demo state</button>
        </div>
      </div>
    );
  }
}
