import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, Keyboard, Search, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react';
import { errorMessage, useNotify, useSession, useStationStatus, useStore } from '../app/context';
import type { EventSnapshot, ScanResult } from '../data/store';
import { fullName, type Direction, type Participant, type ScanMethod } from '../domain/model';
import { decisionMessage } from '../domain/scan';
import { gaugeLevel, GAUGE_LEVELS } from '../domain/gauge';
import { parisTime } from '../domain/time';
import { LazyCameraScanner } from '../app/lazy';
import { GaugeBar, Modal, TypeBadge } from '../ui/components';
import { signal } from '../ui/feedback';
import { flashDuration, flashText } from '../ui/scanFlash';

const MODE_KEY = 'event-control:station-mode';
const CAMERA_KEY = 'event-control:camera';
const SOUND_KEY = 'event-control:sound';
/** Une relecture du même QR code par la caméra dans ce délai est ignorée (F-55). */
const SAME_CODE_IGNORE_MS = 10_000;

function readPref(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* préférence non mémorisée */ }
}

const FLASH_ICON = { accepted: Check, refused: X, warning: TriangleAlert } as const;

export function Scan({ snapshot }: { snapshot: EventSnapshot }) {
  const store = useStore();
  const notify = useNotify();
  const { stationId } = useSession();
  const offline = useStationStatus()?.online === false;
  const { event, participants } = snapshot;
  const [mode, setModeState] = useState<Direction>(() => (readPref(MODE_KEY, 'in') === 'out' ? 'out' : 'in'));
  const [camera, setCamera] = useState(() => readPref(CAMERA_KEY, 'off') === 'on');
  const [sound, setSound] = useState(() => readPref(SOUND_KEY, 'on') === 'on');
  const [flash, setFlash] = useState<ScanResult | null>(null);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [overCapacity, setOverCapacity] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'search' | 'code' | null>(null);
  const [code, setCode] = useState('');
  const [query, setQuery] = useState('');
  const lastCamera = useRef({ code: '', at: 0 });
  const typing = useRef({ first: 0, last: 0 });
  const busy = useRef(false);

  const present = participants.filter((p) => p.inside).length;
  const level = gaugeLevel(present, event.capacity, event.thresholds);
  const typeById = useMemo(() => new Map(event.types.map((t) => [t.id, t])), [event.types]);

  // Le résultat plein écran s'efface seul ; un nouveau scan le remplace
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flashDuration(flashText(flash.decision, parisTime).tone));
    return () => clearTimeout(t);
  }, [flash]);

  const setMode = (m: Direction) => { setModeState(m); setFlash(null); writePref(MODE_KEY, m); };
  const toggleCamera = (on: boolean) => { setCamera(on); writePref(CAMERA_KEY, on ? 'on' : 'off'); };
  const toggleSound = () => { setSound(!sound); writePref(SOUND_KEY, sound ? 'off' : 'on'); };

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
      setFlash(r);
      setLast(r);
      signal(flashText(r.decision, parisTime).tone, sound);
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
    setSheet(null);
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return participants.filter((p) => p.status !== 'pending' && `${p.firstName} ${p.lastName} ${p.company}`.toLowerCase().includes(q)).slice(0, 8);
  }, [participants, query]);

  const pick = (p: Participant) => { void handle(p.token, 'search'); setQuery(''); setSheet(null); };
  const verb = mode === 'in' ? "l'entrée" : 'la sortie';
  const announce = last ? decisionMessage(last.decision, last.participant ? fullName(last.participant) : '', parisTime) : '';

  return (
    <div className="scan">
      {/* Annonce du résultat aux lecteurs d'écran (zone toujours présente) */}
      <p className="sr-only" role="status" aria-live="assertive" aria-atomic="true">{announce}</p>

      <section className="scan-count" aria-label="Présence dans la salle">
        <div className="row-between" style={{ alignItems: 'baseline' }}>
          <span className="kpi-label">Dans la salle{offline && ' (estimation hors ligne)'}</span>
          <span><strong className="scan-count-value">{present}</strong> <span className="muted">/ {event.capacity}</span></span>
        </div>
        <GaugeBar present={present} capacity={event.capacity} level={level} height={6} showLabel={false} />
        {level !== 'normal' && (
          <p style={{ color: GAUGE_LEVELS[level].color, fontWeight: 700, fontSize: 14 }}>
            <span aria-hidden="true">{GAUGE_LEVELS[level].icon} </span>{GAUGE_LEVELS[level].label}
          </p>
        )}
      </section>

      <div className="scan-mode-row">
        <div role="group" aria-label="Mode de ce poste" className="segmented scan-mode" data-mode={mode}>
          <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}><ArrowRight size={18} aria-hidden="true" />Entrée</button>
          <button type="button" aria-pressed={mode === 'out'} onClick={() => setMode('out')}><ArrowLeft size={18} aria-hidden="true" />Sortie</button>
        </div>
        <button type="button" className="btn btn-secondary icon-btn" onClick={toggleSound} aria-pressed={sound}
          aria-label={sound ? 'Couper le son des scans' : 'Activer le son des scans'}>
          {sound ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} aria-hidden="true" />}
        </button>
      </div>

      <div className="viewfinder">
        {camera ? (
          <>
            <Suspense fallback={<p className="viewfinder-hint" role="status">Démarrage de la caméra…</p>}>
              <LazyCameraScanner onCode={(c) => void handle(c, 'camera')} paused={overCapacity !== null || flash !== null} />
            </Suspense>
            <svg className="viewfinder-frame" viewBox="0 0 200 200" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" aria-hidden="true">
              <path d="M4 42V16A12 12 0 0 1 16 4h26M158 4h26a12 12 0 0 1 12 12v26M196 158v26a12 12 0 0 1-12 12h-26M42 196H16a12 12 0 0 1-12-12v-26" />
            </svg>
            <p className="viewfinder-hint" aria-hidden="true">Visez le QR code du badge</p>
            <button type="button" className="viewfinder-stop" onClick={() => toggleCamera(false)} aria-label="Arrêter la caméra"><X size={20} aria-hidden="true" /></button>
          </>
        ) : (
          <button type="button" className="viewfinder-start" onClick={() => toggleCamera(true)}>
            <Camera size={34} aria-hidden="true" />
            <span>Activer la caméra</span>
          </button>
        )}
      </div>

      {last && !flash && (
        <p className="scan-last">
          <span className="small">Dernier passage</span>
          <span className="scan-last-text">
            {(() => { const Icon = FLASH_ICON[flashText(last.decision, parisTime).tone]; return <Icon size={16} aria-hidden="true" />; })()}
            {last.participant ? `${fullName(last.participant)} · ${flashText(last.decision, parisTime).title}` : flashText(last.decision, parisTime).title}
          </span>
        </p>
      )}

      <div className="scan-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setSheet('search')}><Search size={18} aria-hidden="true" />Rechercher</button>
        <button type="button" className="btn btn-secondary mobile-only" onClick={() => setSheet('code')}><Keyboard size={18} aria-hidden="true" />Saisir un code</button>
      </div>

      {/* Sur ordinateur, champ toujours prêt pour une douchette */}
      <form className="card desktop-only stack" style={{ gap: 10 }} onSubmit={submitCode}>
        <label htmlFor="code" className="label">Douchette ou référence</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input id="code" className="input" autoComplete="off" spellCheck={false} aria-describedby="code-help"
            value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onCodeKey} style={{ fontFamily: 'var(--mono)' }} />
          <button className="btn" type="submit">Valider</button>
        </div>
        <p className="small" id="code-help">Avec une douchette, scannez simplement : le code est validé automatiquement.</p>
      </form>

      <Modal open={sheet === 'code'} onClose={() => setSheet(null)} title="Saisir un code" className="sheet">
        <form className="stack" onSubmit={submitCode}>
          <label htmlFor="code-sheet" className="label">Référence du badge</label>
          <input id="code-sheet" className="input" autoComplete="off" spellCheck={false} autoFocus
            value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onCodeKey} style={{ fontFamily: 'var(--mono)' }} />
          <button className="btn btn-big" type="submit">Valider {verb}</button>
        </form>
      </Modal>

      <Modal open={sheet === 'search'} onClose={() => { setSheet(null); setQuery(''); }} title="Rechercher un participant" className="sheet">
        <label htmlFor="search" className="sr-only">Nom, prénom ou société</label>
        <input id="search" type="search" className="input" placeholder="Nom, prénom ou société" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
        {query.trim().length >= 2 && matches.length === 0 && <p className="muted">Aucun participant trouvé.</p>}
        {matches.length > 0 && (
          <ul className="search-results">
            {matches.map((p) => {
              const blocked = (mode === 'in' && p.inside) || (mode === 'out' && !p.inside);
              return (
                <li key={p.id}>
                  <span className="search-who">
                    <strong>{fullName(p)}</strong>
                    <span className="small">{p.company || p.email}</span>
                  </span>
                  <TypeBadge type={typeById.get(p.typeId)} />
                  {blocked
                    ? <span className="pill pill-muted">{p.inside ? 'Dans la salle' : 'Pas dans la salle'}</span>
                    : <button className="btn btn-small" onClick={() => pick(p)} aria-label={`Enregistrer ${verb} de ${fullName(p)}`}>{mode === 'in' ? 'Entrée' : 'Sortie'}</button>}
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      <Modal open={overCapacity !== null} onClose={() => setOverCapacity(null)} title="Jauge dépassée">
        <p className="notice notice-danger" role="alert">
          {overCapacity} personnes sont dans la salle pour une jauge de {event.capacity}. L'entrée a été enregistrée :
          prévenez le responsable avant de laisser entrer d'autres personnes.
        </p>
        <button className="btn" onClick={() => setOverCapacity(null)}>J'ai compris</button>
      </Modal>

      {flash && <Flash result={flash} type={flash.participant ? typeById.get(flash.participant.typeId) : undefined} onClose={() => setFlash(null)} />}
    </div>
  );
}

/** Résultat plein écran : vert, rouge ou orange, lisible à un mètre (piste « Accueil »). */
function Flash({ result, type, onClose }: { result: ScanResult; type: { label: string; color: string } | undefined; onClose: () => void }) {
  const text = flashText(result.decision, parisTime);
  const Icon = FLASH_ICON[text.tone];
  // Échap ferme le résultat ; le focus reste sur le champ de la douchette
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const p = result.participant;
  return (
    <div className={`scan-flash scan-flash-${text.tone}`} onClick={onClose} aria-hidden="true">
      <div className="scan-flash-body">
        <span className="scan-flash-icon"><Icon size={44} strokeWidth={3} /></span>
        <span className="scan-flash-title">{text.title}</span>
        {p && <span className="scan-flash-name">{fullName(p)}</span>}
        <span className="scan-flash-meta">
          {type && (
            <span className="scan-flash-type">
              <span className="badge-dot" style={{ background: type.color }} />
              {type.label}
            </span>
          )}
          {p?.company && <span>{p.company}</span>}
        </span>
        <span className="scan-flash-detail">{text.detail}</span>
      </div>
      <span className="scan-flash-hint">Toucher pour continuer</span>
    </div>
  );
}
