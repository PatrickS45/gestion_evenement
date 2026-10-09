import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Agent, EventSnapshot, EventStore } from '../data/store';
import { newId } from '../domain/ids';

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

/** Données d'un événement, tenues à jour en temps réel ; undefined pendant le chargement, null s'il n'existe pas. */
export function useEventSnapshot(eventId: string): EventSnapshot | null | undefined {
  const store = useStore();
  const [snapshot, setSnapshot] = useState<EventSnapshot | null | undefined>(undefined);
  useEffect(() => {
    let received = false;
    const unsubscribe = store.subscribe(eventId, (s) => { received = true; setSnapshot(s); });
    if (!received) setSnapshot(null);
    return unsubscribe;
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

// ─── Agent d'accueil sur ce poste ────────────────────────────────────
// En mode local, l'identité est déclarative : la vraie connexion (F-01) arrive avec le serveur.

const PROFILE_KEY = 'event-control:profile';
const STATION_KEY = 'event-control:station';

interface Profile { id: string; name: string }

function readProfile(): Profile | null {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Profile | null; } catch { return null; }
}

/** Identifiant du poste : propre à chaque onglet, pour distinguer deux postes sur une même machine. */
function stationName(): string {
  try {
    let s = sessionStorage.getItem(STATION_KEY);
    if (!s) { s = `Poste ${Math.floor(100 + Math.random() * 900)}`; sessionStorage.setItem(STATION_KEY, s); }
    return s;
  } catch { return 'Poste'; }
}

interface AgentState {
  agent: Agent | null;
  signIn: (name: string) => void;
  signOut: () => void;
}

const AgentContext = createContext<AgentState | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(readProfile);
  const station = useMemo(stationName, []);
  const value = useMemo<AgentState>(() => ({
    agent: profile ? { id: profile.id, name: profile.name, stationId: station } : null,
    signIn: (name) => {
      const p = { id: readProfile()?.id ?? newId(), name: name.trim() };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
      setProfile(p);
    },
    signOut: () => { localStorage.removeItem(PROFILE_KEY); setProfile(null); },
  }), [profile, station]);
  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentState {
  const v = useContext(AgentContext);
  if (!v) throw new Error('AgentProvider manquant');
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
