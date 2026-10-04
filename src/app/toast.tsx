import { create } from 'zustand';
import { useEffect } from 'react';

interface T { id: number; text: string; tone: 'info' | 'good' | 'warn' }
const useToasts = create<{ items: T[]; push: (text: string, tone?: T['tone']) => void; drop: (id: number) => void }>((set, get) => ({
  items: [],
  push: (text, tone = 'info') => {
    const id = Date.now() + Math.random();
    set({ items: [...get().items.slice(-2), { id, text, tone }] });
  },
  drop: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
}));

export const toast = (text: string, tone?: T['tone']) => useToasts.getState().push(text, tone);

function Item({ t }: { t: T }) {
  const drop = useToasts((s) => s.drop);
  useEffect(() => {
    const h = setTimeout(() => drop(t.id), 2000);
    return () => clearTimeout(h);
  }, [t.id, drop]);
  const bar = t.tone === 'good' ? 'bg-good' : t.tone === 'warn' ? 'bg-warn' : 'bg-accent';
  return (
    <div role="status" className="panel flex overflow-hidden shadow-lg">
      <div className={`w-1 ${bar}`} />
      <div className="px-3 py-2 text-sm">{t.text}</div>
    </div>
  );
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div aria-live="polite" className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 flex-col gap-2">
      {items.map((t) => <Item key={t.id} t={t} />)}
    </div>
  );
}
