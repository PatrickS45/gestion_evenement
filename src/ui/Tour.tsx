// Visite guidée : met en lumière un élément de l'écran et l'explique, étape par étape,
// en passant d'une section à l'autre de l'événement de démonstration.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { errorMessage, useNotify, useSession, useStore } from '../app/context';
import { href, navigate } from '../app/router';
import { TOUR_STEPS, type TourStep } from './tourSteps';

const PENDING_KEY = 'event-control:tour';

interface TourState {
  /** La visite est possible ici (version de démonstration, organisation choisie). */
  available: boolean;
  start: () => Promise<void>;
}

const TourContext = createContext<TourState>({ available: false, start: async () => {} });

export function useTour() {
  return useContext(TourContext);
}

/** Demande de visite depuis un lien (#/visite) : la visite démarre après la connexion. */
export function requestTour() {
  try { sessionStorage.setItem(PENDING_KEY, '1'); } catch { /* sans effet */ }
}

export function tourRequested(): boolean {
  try { return sessionStorage.getItem(PENDING_KEY) === '1'; } catch { return false; }
}

function hashFor(step: TourStep, eventId: string): string {
  return step.section === 'home' ? href() : href('e', eventId, step.section);
}

export function TourProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const notify = useNotify();
  const { session, org } = useSession();
  const [run, setRun] = useState<{ eventId: string; index: number } | null>(null);
  const available = !!store.seedDemo && !!org && !!session;

  const start = useCallback(async () => {
    if (!store.seedDemo || !org) return;
    try { sessionStorage.removeItem(PENDING_KEY); } catch { /* sans effet */ }
    try {
      // Charge le salon de démonstration, ou rouvre celui déjà chargé sur cet appareil
      const event = await store.seedDemo(org.orgId);
      setRun({ eventId: event.id, index: 0 });
    } catch (err) { notify(errorMessage(err), 'danger'); }
  }, [store, org, notify]);

  // Lien de visite : démarrage dès que l'utilisateur est connecté
  useEffect(() => {
    if (available && !run && tourRequested()) void start();
  }, [available, run, start]);

  const value = useMemo(() => ({ available, start }), [available, start]);
  return (
    <TourContext.Provider value={value}>
      {children}
      {run && (
        <TourOverlay
          key={run.index}
          step={TOUR_STEPS[run.index]!}
          index={run.index}
          eventId={run.eventId}
          onMove={(delta) => setRun((r) => (r ? { ...r, index: Math.min(TOUR_STEPS.length - 1, Math.max(0, r.index + delta)) } : r))}
          onClose={() => setRun(null)}
        />
      )}
    </TourContext.Provider>
  );
}

const PAD = 8;

function TourOverlay({ step, index, eventId, onMove, onClose }: {
  step: TourStep; index: number; eventId: string; onMove: (delta: number) => void; onClose: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(!step.target);
  const card = useRef<HTMLDivElement>(null);
  const target = useRef<Element | null>(null);
  const last = index === TOUR_STEPS.length - 1;

  // Aller sur le bon écran, attendre l'élément, le faire défiler au centre
  useEffect(() => {
    const wanted = hashFor(step, eventId);
    if (window.location.hash !== wanted) {
      if (step.section === 'home') navigate(); else navigate('e', eventId, step.section);
    }
    if (!step.target) { target.current = null; setRect(null); setReady(true); return; }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const find = () => {
      const el = document.querySelector(step.target!);
      const box = el && step.card ? el.closest('.card, form, section') ?? el : el;
      if (box) {
        target.current = box;
        const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        box.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        setTimeout(() => { setRect(box.getBoundingClientRect()); setReady(true); }, reduce ? 0 : 350);
      } else if (tries++ < 40) {
        timer = setTimeout(find, 100);
      } else {
        // Élément absent (écran trop étroit, droits) : l'explication s'affiche quand même, centrée
        target.current = null; setRect(null); setReady(true);
      }
    };
    find();
    return () => clearTimeout(timer);
  }, [step, eventId]);

  // Suivre l'élément quand la page défile ou change de taille
  useEffect(() => {
    const update = () => { if (target.current) setRect(target.current.getBoundingClientRect()); };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, []);

  // Le focus va sur l'explication ; flèches et Échap pour naviguer
  useLayoutEffect(() => { if (ready) card.current?.focus(); }, [ready]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && !last) onMove(1);
      else if (e.key === 'ArrowLeft' && index > 0) onMove(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, last, onMove, onClose]);

  const mobile = typeof window !== 'undefined' && window.innerWidth <= 760;
  const placement = (() => {
    if (!rect || mobile) return undefined;
    const width = Math.min(380, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16);
    const below = rect.bottom + PAD + 12;
    const fitsBelow = below + 220 < window.innerHeight;
    return fitsBelow
      ? { left, top: below, width }
      : { left, top: Math.max(16, rect.top - PAD - 12 - 230), width };
  })();

  return (
    <div className="tour" role="presentation">
      <div className="tour-backdrop" onClick={(e) => e.stopPropagation()} />
      {rect
        ? <div className="tour-spot" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
        : <div className="tour-dim" />}
      {ready && (
        <div ref={card} className={`tour-card${rect && !mobile ? '' : ' tour-card-center'}`} style={placement}
          role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1}>
          <div className="row-between" style={{ flexWrap: 'nowrap' }}>
            <span className="small">Étape {index + 1} sur {TOUR_STEPS.length}</span>
            <button type="button" className="btn btn-ghost btn-small icon-btn" onClick={onClose} aria-label="Quitter la visite guidée"><X size={18} aria-hidden="true" /></button>
          </div>
          <h2 id="tour-title" className="tour-title">{step.title}</h2>
          <p id="tour-body" className="tour-body">{step.body}</p>
          <div className="tour-progress" aria-hidden="true"><span style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }} /></div>
          <div className="row-between">
            {index > 0
              ? <button type="button" className="btn btn-secondary btn-small" onClick={() => onMove(-1)}><ArrowLeft size={16} aria-hidden="true" />Précédent</button>
              : <span />}
            {last
              ? <button type="button" className="btn btn-small" onClick={onClose}>Terminer</button>
              : <button type="button" className="btn btn-small" onClick={() => onMove(1)}>Suivant<ArrowRight size={16} aria-hidden="true" /></button>}
          </div>
        </div>
      )}
    </div>
  );
}
