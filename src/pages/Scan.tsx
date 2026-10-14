import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { errorMessage, useNotify, useSession, useStationStatus, useStore } from '../app/context';
import type { EventSnapshot, ScanResult } from '../data/store';
import { fullName, type Direction, type ScanMethod } from '../domain/model';
import { decisionMessage } from '../domain/scan';
import { gaugeLevel } from '../domain/gauge';
import { parisTime } from '../domain/time';
import { CameraScanner } from '../ui/CameraScanner';
import { GaugeBar, Modal, TypeBadge, TypeBanner } from '../ui/components';

const MODE_KEY = 'event-control:station-mode';
/** Une relecture du même QR code par la caméra dans ce délai est ignorée (F-55). */
const SAME_CODE_IGNORE_MS = 10_000;

const TONES = {
  accepted: { css: 'notice-ok', icon: '✓' },
  refused: { css: 'notice-danger', icon: '✕' },
  warning: { css: 'notice-warn', icon: '!' },
} as const;

function readMode(): Direction {
  try { return localStorage.getItem(MODE_KEY) === 'out' ? 'out' : 'in'; } catch { return 'in'; }
}

export function Scan({ snapshot }: { snapshot: EventSnapshot }) {
  const store = useStore();
  const notify = useNotify();
  const { stationId } = useSession();
  const offline = useStationStatus()?.online === false;
  const { event, participants } = snapshot;
  const [mode, setModeState] = useState<Direction>(readMode);
  const [camera, setCamera] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [overCapacity, setOverCapacity] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [query, setQuery] = useState('');
  const lastCamera = useRef({ code: '', at: 0 });
  const typing = useRef({ first: 0, last: 0 });
  const busy = useRef(false);

  const present = participants.filter((p) => p.inside).length;
  const level = gaugeLevel(present, event.capacity, event.thresholds);
  const typeById = useMemo(() => new Map(event.types.map((t) => [t.id, t])), [event.types]);

  const setMode = (m: Direction) => {
    setModeState(m);
    setResult(null);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* préférence non mémorisée */ }
  };

  const handle = async (token: string, method: ScanMethod) => {
    if (!token.trim() || busy.current) return;
    if (method === 'camera') {
      const now = Date.now();
      if (token === lastCamera.current.code && now - lastCamera.current.at < SAME_CODE_IGNORE_MS) return;
      lastCamera.current = { code: token, at: now };
    }
    busy.current = true;
    try {
      const r = await store.scan(event.id, token, mode, method, stationId);
      setResult(r);
      navigator.vibrate?.(r.decision.result === 'accepted' ? 80 : [60, 60, 60]);
      if (r.decision.result === 'accepted' && r.decision.direction === 'in' && event.capacity > 0 && present + 1 > event.capacity) {
        setOverCapacity(present + 1);
      }
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      busy.current = false;
    }
  };

  // Douchette : les caractères arrivent en rafale ; une saisie humaine est bien plus lente
  const onCodeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    if (!code) typing.current.first = now;
    typing.current.last = now;
    if (e.key === 'Enter') e.preventDefault();
  };
  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const elapsed = typing.current.last - typing.current.first;
    const method: ScanMethod = code.length >= 20 && elapsed < code.length * 25 ? 'scanner' : 'manual';
    void handle(code.trim(), method);
    setCode('');
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return participants.filter((p) => p.status !== 'pending' && `${p.firstName} ${p.lastName} ${p.company}`.toLowerCase().includes(q)).slice(0, 8);
  }, [participants, query]);

  const resultType = result?.participant ? typeById.get(result.participant.typeId) : undefined;
  const tone = result ? TONES[result.decision.result] : null;
  const verb = mode === 'in' ? "l'entrée" : 'la sortie';

  return (
    <div className="stack" style={{ maxWidth: 620, margin: '0 auto' }}>
      <div role="group" aria-label="Mode de ce poste" className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {([['in', 'Entrée', '→', 'var(--ok)'], ['out', 'Sortie', '←', 'var(--warn)']] as const).map(([m, label, arrow, color]) => (
          <button key={m} type="button" className="btn btn-big" aria-pressed={mode === m} onClick={() => setMode(m)}
            style={mode === m ? { background: color, borderColor: color } : { background: '#fff', color: 'var(--ink)', borderColor: '#8b91a0' }}>
            <span aria-hidden="true">{arrow}</span> {label}
          </button>
        ))}
      </div>
      <p className="muted">
        Ce poste enregistre les <strong>{mode === 'in' ? 'entrées' : 'sorties'}</strong>.{' '}
        {offline ? 'Les passages seront transmis aux autres postes au retour du réseau.' : 'Chaque passage apparaît aussitôt sur les autres postes.'}
      </p>

      <div className="card" style={{ padding: 14 }}>
        <p style={{ marginBottom: 6 }}>
          Dans la salle : <strong>{present}</strong> / {event.capacity}
          {offline && <span className="small"> — estimation hors ligne : seuls les passages de ce poste sont à jour</span>}
        </p>
        <GaugeBar present={present} capacity={event.capacity} level={level} height={10} showLabel={level !== 'normal'} />
      </div>

      {/* Résultat du dernier scan, annoncé aux lecteurs d'écran */}
      <div role="status" aria-live="assertive" aria-atomic="true">
        {result && tone && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {resultType && <TypeBanner type={resultType} />}
            <div className={`notice ${tone.css}`} style={{ borderRadius: 0, fontSize: 20 }}>
              <span aria-hidden="true">{tone.icon} </span>
              {decisionMessage(result.decision, result.participant ? fullName(result.participant) : '', parisTime)}
            </div>
            {result.participant && (
              <p style={{ padding: '10px 16px' }}>
                {result.participant.company && <strong>{result.participant.company} · </strong>}
                <span className="muted">{result.participant.email}</span>
              </p>
            )}
          </div>
        )}
      </div>

      <section className="card stack" aria-labelledby="cam-title">
        <h2 id="cam-title" style={{ marginBottom: 0 }}>Caméra</h2>
        {camera
          ? <>
              <CameraScanner onCode={(c) => void handle(c, 'camera')} paused={overCapacity !== null} />
              <button className="btn btn-secondary" onClick={() => setCamera(false)}>Arrêter la caméra</button>
            </>
          : <button className="btn btn-big" onClick={() => setCamera(true)}>Activer la caméra</button>}
      </section>

      <form className="card stack" onSubmit={submitCode} aria-labelledby="code-title">
        <h2 id="code-title" style={{ marginBottom: 0 }}><label htmlFor="code">Douchette ou référence</label></h2>
        <p className="small" id="code-help">Avec une douchette, scannez simplement : le code est validé automatiquement.</p>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input id="code" className="input" autoComplete="off" spellCheck={false} aria-describedby="code-help"
            value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onCodeKey} style={{ fontFamily: 'ui-monospace, monospace' }} />
          <button className="btn" type="submit">Valider</button>
        </div>
      </form>

      <section className="card stack" aria-labelledby="search-title">
        <h2 id="search-title" style={{ marginBottom: 0 }}><label htmlFor="search">Rechercher par nom</label></h2>
        <input id="search" type="search" className="input" placeholder="2 lettres au moins" value={query} onChange={(e) => setQuery(e.target.value)} />
        {matches.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {matches.map((p) => {
              const blocked = (mode === 'in' && p.inside) || (mode === 'out' && !p.inside);
              return (
                <li key={p.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <span>
                    <strong>{fullName(p)}</strong> <TypeBadge type={typeById.get(p.typeId)} />
                    {p.company && <span className="small"> · {p.company}</span>}
                  </span>
                  {blocked
                    ? <span className="pill pill-muted">{p.inside ? 'Déjà dans la salle' : 'Pas dans la salle'}</span>
                    : <button className="btn btn-small" onClick={() => { void handle(p.token, 'search'); setQuery(''); }}
                        aria-label={`Enregistrer ${verb} de ${fullName(p)}`}>{mode === 'in' ? 'Entrée' : 'Sortie'}</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Modal open={overCapacity !== null} onClose={() => setOverCapacity(null)} title="Jauge dépassée">
        <p className="notice notice-danger" role="alert">
          {overCapacity} personnes sont dans la salle pour une jauge de {event.capacity}. L'entrée a été enregistrée :
          prévenez le responsable avant de laisser entrer d'autres personnes.
        </p>
        <button className="btn" onClick={() => setOverCapacity(null)}>J'ai compris</button>
      </Modal>
    </div>
  );
}
