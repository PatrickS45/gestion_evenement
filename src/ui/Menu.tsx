// Menus déroulants sur <details> / <summary> : clavier et lecteurs d'écran gérés par le navigateur.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';

/** Ferme un menu <details> au clic à l'extérieur ou à la touche Échap. */
export function useDismiss(ref: React.RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) {
        el.open = false;
        if (e instanceof KeyboardEvent) el.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [ref]);
}

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

/** Bouton « ⋯ » ouvrant une liste d'actions (une ligne de tableau, une carte). */
export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Positionné par rapport à la fenêtre : un tableau qui défile ne le coupe pas
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useDismiss(ref);
  useEffect(() => {
    if (!pos) return;
    const close = () => { if (ref.current) ref.current.open = false; };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [pos]);
  const onToggle = () => {
    const el = ref.current;
    if (!el?.open) { setPos(null); return; }
    const r = el.querySelector('summary')!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };
  return (
    <details ref={ref} className="menu" onToggle={onToggle}>
      <summary className="btn btn-secondary btn-small icon-btn" aria-label={label}><Ellipsis size={18} aria-hidden="true" /></summary>
      <div className="menu-panel" style={{ width: 240, position: 'fixed', top: pos?.top ?? 0, right: pos?.right ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
        {actions.map((a) => (
          <button key={a.label} type="button" className={`menu-item${a.danger ? ' danger' : ''}`}
            onClick={() => { if (ref.current) ref.current.open = false; a.onSelect(); }}>
            {a.icon}{a.label}
          </button>
        ))}
      </div>
    </details>
  );
}
