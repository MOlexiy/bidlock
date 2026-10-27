import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  href?: string;
}

let seq = 0;

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => remove(id), 6000);
    },
    [remove],
  );
  return { items, push, remove };
}

export function Toasts({ items, onClose }: { items: Toast[]; onClose: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <a key={t.id} className="toast" href={t.href} onClick={() => onClose(t.id)}>
          <span aria-hidden>⚡</span> {t.text}
        </a>
      ))}
    </div>
  );
}
