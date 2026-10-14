import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StationStore, type StationStatus } from '../data/stationStore';
import type { EventSnapshot, EventStore, Membership, Session } from '../data/store';

// ─── Accès aux données ───────────────────────────────────────────────

const StoreContext = createContext<EventStore | null>(null);

export function StoreProvider({ store, children }: { store: EventStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): EventStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider manquant');
  return store;
}

/** Poste résistant aux coupures (F-60 à F-64) : présent seulement avec le serveur. */
export function useStation(): StationStore | null {
  const store = useStore();
  return store instanceof StationStore ? store : null;
}

/** État du poste (en ligne, passages en attente…), tenu à jour ; null sans serveur. */
export function useStationStatus(): StationStatus | null {
  const station = useStation();
  const [status, setStatus] = useState<StationStatus | null>(() => station?.getStatus() ?? null);
  useEffect(() => station?.onStatus(setStatus), [station]);
  return status;
}

/** Données d'un événement, tenues à jour en temps réel ; undefined pendant le chargement, null s'il n'existe pas. */
export function useEventSnapshot(eventId: string): EventSnapshot | null | undefined {
  const store = useStore();
  const [snapshot, setSnapshot] = useState<EventSnapshot | null | undefined>(undefined);
  useEffect(() => {
    setSnapshot(undefined);
    return store.subscribe(eventId, setSnapshot);
  }, [store, eventId]);
  return snapshot;
}

/** Heure courante, rafraîchie à intervalle régulier (pour « aujourd'hui » et les courbes). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ─── Utilisateur connecté et poste de scan (F-01, F-02) ──────────────

const STATION_KEY = 'event-control:station';
const ORG_KEY = 'event-control:org';

/** Identifiant du poste : propre à chaque onglet, pour distinguer deux postes sur une même machine. */
function stationName(): string {
  try {
    let s = sessionStorage.getItem(STATION_KEY);
    if (!s) { s = `Poste ${Math.floor(100 + Math.random() * 900)}`; sessionStorage.setItem(STATION_KEY, s); }
    return s;
  } catch { return 'Poste'; }
}

function readOrg(): string | null {
  try { return localStorage.getItem(ORG_KEY); } catch { return null; }
}

interface SessionState {
  /** undefined pendant le chargement, null si personne n'est connecté. */
  session: Session | null | undefined;
  /** Organisation affichée : la dernière choisie, sinon la première. */
  org: Membership | null;
  stationId: string;
  /** Mémorise la session renvoyée par le stockage après connexion, inscription ou création d'organisation. */
  setSession: (session: Session | null) => void;
  selectOrg: (orgId: string) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [orgId, setOrgId] = useState<string | null>(readOrg);
  const stationId = useMemo(stationName, []);

  useEffect(() => { store.getSession().then(setSession, () => setSession(null)); }, [store]);

  const value = useMemo<SessionState>(() => {
    const memberships = session?.memberships ?? [];
    return {
      session, stationId, setSession,
      org: memberships.find((m) => m.orgId === orgId) ?? memberships[0] ?? null,
      selectOrg: (id) => { try { localStorage.setItem(ORG_KEY, id); } catch { /* préférence non mémorisée */ } setOrgId(id); },
      signOut: async () => { await store.signOut(); setSession(null); },
    };
  }, [store, session, orgId, stationId]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(SessionContext);
  if (!v) throw new Error('SessionProvider manquant');
  return v;
}

// ─── Notifications ───────────────────────────────────────────────────

type Tone = 'ok' | 'warn' | 'danger' | 'info';
interface Toast { id: number; message: string; tone: Tone }

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string, tone: Tone = 'ok') => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), message, tone });
    timer.current = setTimeout(() => setToast(null), tone === 'danger' ? 8000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {/* Zone toujours présente : les lecteurs d'écran annoncent chaque message */}
      <div className="toast-zone no-print" role="status" aria-live="polite" aria-atomic="true">
        {toast && <p key={toast.id} className={`toast notice notice-${toast.tone}`}>{toast.message}</p>}
      </div>
    </ToastContext.Provider>
  );
}

export function useNotify() {
  return useContext(ToastContext);
}

/** Message d'une erreur du stockage, ou message générique. */
export function errorMessage(err: unknown, fallback = 'Une erreur est survenue, réessayez.'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
