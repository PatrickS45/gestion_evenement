// Barre d'application : logo, sections (en haut sur ordinateur, en bas sur téléphone),
// état du poste et menu de l'utilisateur.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Check, Compass, Info, LogOut, RefreshCw, ScanLine, ShieldCheck, Users, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import { errorMessage, useNotify, useSession, useStation, useStationStatus, useStore } from '../app/context';
import { href, navigate } from '../app/router';
import { can, ROLE_LABELS, type Role } from '../domain/access';
import { parisTime } from '../domain/time';
import { useDismiss } from './Menu';
import { useTour } from './Tour';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

const notificationsSupported = () => typeof Notification !== 'undefined';

function UserMenu({ role }: { role?: Role | undefined }) {
  const { session, org, stationId, signOut } = useSession();
  const notify = useNotify();
  const ref = useRef<HTMLDetailsElement>(null);
  const tour = useTour();
  const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : 'denied'));
  useDismiss(ref);
  if (!session) return null;

  const askNotifications = async () => {
    try { setPermission(await Notification.requestPermission()); } catch { /* sans effet */ }
  };

  return (
    <details ref={ref} className="menu">
      <summary aria-label={`Menu de ${session.user.name}`} className="avatar">{initials(session.user.name)}</summary>
      <div className="menu-panel">
        <div className="menu-head">
          <strong>{session.user.name}</strong>
          <span className="small">{role ? ROLE_LABELS[role] : 'Connecté'} · {stationId}</span>
        </div>
        {permission === 'default' && (
          <button type="button" className="menu-item" onClick={() => void askNotifications()}>
            <Bell size={18} aria-hidden="true" />Être prévenu des alertes de jauge
          </button>
        )}
        {permission === 'granted' && (
          <span className="menu-item" style={{ cursor: 'default' }}><Check size={18} aria-hidden="true" />Alertes de jauge activées</span>
        )}
        {tour.available && (
          <button type="button" className="menu-item" onClick={() => { if (ref.current) ref.current.open = false; void tour.start(); }}>
            <Compass size={18} aria-hidden="true" />Visite guidée
          </button>
        )}
        {can(org?.role, 'members.manage') && <a className="menu-item" href={href('membres')}><Users size={18} aria-hidden="true" />Membres de l'organisation</a>}
        {can(org?.role, 'stats.export') && <a className="menu-item" href={href('donnees')}><ShieldCheck size={18} aria-hidden="true" />Données personnelles</a>}
        <button type="button" className="menu-item danger"
          onClick={() => { signOut().then(() => navigate(), (err) => notify(errorMessage(err), 'danger')); }}>
          <LogOut size={18} aria-hidden="true" />Se déconnecter
        </button>
      </div>
    </details>
  );
}

/** État du poste (F-62) en pastille ; le détail et la copie de secours (F-60) dans son menu. */
function StationPill({ eventId }: { eventId?: string | undefined }) {
  const station = useStation();
  const status = useStationStatus();
  const notify = useNotify();
  const ref = useRef<HTMLDetailsElement>(null);
  const [preparing, setPreparing] = useState(false);
  useDismiss(ref);
  if (!station || !status) return null;

  const copy = eventId ? status.copies[eventId] : undefined;
  const prepare = async () => {
    if (!eventId) return;
    setPreparing(true);
    try {
      const info = await station.prepare(eventId);
      notify(`Copie de secours à jour : ${plural(info.participants, 'participant', 'participants')}`);
    } catch (err) { notify(errorMessage(err), 'danger'); }
    finally { setPreparing(false); }
  };

  return (
    <details ref={ref} className="menu">
      <summary className={`status-pill ${status.online ? 'status-ok' : 'status-warn'}`}>
        {status.online ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}
        {status.online ? 'En ligne' : 'Hors ligne'}
        {status.pending > 0 && <> · {status.pending}</>}
        <span className="sr-only">, détails de l'état du poste</span>
      </summary>
      <div className="menu-panel" style={{ padding: 14, gap: 10 }}>
        <strong>{status.online ? 'Poste en ligne' : 'Poste hors ligne'}</strong>
        <p className="small">
          {status.online
            ? (status.syncing ? 'Envoi des passages enregistrés hors ligne…' : 'Les passages sont transmis en direct aux autres postes.')
            : 'Les scans sont validés sur ce poste et envoyés dès le retour du réseau.'}
          {status.pending > 0 && <> {plural(status.pending, 'passage en attente d\'envoi', 'passages en attente d\'envoi')}.</>}
        </p>
        {eventId && (
          <>
            <p className="small">
              {copy
                ? <>Copie de secours : {plural(copy.participants, 'participant', 'participants')}, à jour à {parisTime(copy.savedAt)}.</>
                : <>Pas encore de copie de secours sur ce poste.</>}
            </p>
            {status.online && (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void prepare()} disabled={preparing}>
                <RefreshCw size={16} aria-hidden="true" />{preparing ? 'Copie en cours…' : copy ? 'Mettre à jour la copie' : 'Préparer le hors ligne'}
              </button>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/** Version sans serveur : rappel permanent de ce que la démonstration partage (ou non) entre appareils. */
function DemoBanner() {
  const store = useStore();
  if (!store.seedDemo) return null;
  return (
    <details className="demo-banner no-print">
      <summary><Info size={16} aria-hidden="true" />Version de démonstration · les données restent sur cet appareil</summary>
      <p>
        Le salon de démonstration et ses QR codes sont identiques sur tous vos appareils : un QR code affiché sur
        un ordinateur se scanne avec un téléphone. En revanche, ce que vous ajoutez ou enregistrez (inscrits,
        passages, réglages) reste sur l'appareil où vous l'avez fait : un collègue ne le voit pas, et l'écran Direct
        ne compte que les scans de cet appareil. Avec le serveur, tous les postes sont synchronisés en temps réel.
      </p>
    </details>
  );
}

export function AppHeader({ title, nav = [], current, role, eventId, actions }: {
  title?: string | undefined;
  nav?: NavItem[];
  current?: string | undefined;
  role?: Role | undefined;
  eventId?: string | undefined;
  actions?: ReactNode;
}) {
  // Le contenu ne doit pas passer sous la barre du bas sur téléphone
  useEffect(() => {
    if (nav.length === 0) return;
    document.body.classList.add('has-bottomnav');
    return () => document.body.classList.remove('has-bottomnav');
  }, [nav.length]);

  return (
    <>
      <header className="appbar no-print">
        <div className="appbar-inner">
          <a className="logo" href={href()} aria-label="Event Control, retour aux événements">
            <span className="logo-mark" aria-hidden="true"><ScanLine size={17} strokeWidth={2.4} /></span>
            <span className="logo-text">Event Control</span>
          </a>
          {nav.length > 0 && (
            <nav className="navpills" aria-label="Sections">
              {nav.map((n) => (
                <a key={n.id} className="navlink" href={n.href} aria-current={n.id === current ? 'page' : undefined}>{n.label}</a>
              ))}
            </nav>
          )}
          <div className="appbar-right">
            {title && <span className="appbar-event">{title}</span>}
            {actions}
            <StationPill eventId={eventId} />
            <UserMenu role={role} />
          </div>
        </div>
      </header>
      <DemoBanner />
      {nav.length > 0 && (
        <nav className="bottomnav no-print" aria-label="Sections">
          {nav.map((n) => {
            const Icon = n.icon;
            return (
              <a key={n.id} href={n.href} aria-current={n.id === current ? 'page' : undefined}>
                <Icon size={22} aria-hidden="true" />{n.label}
              </a>
            );
          })}
        </nav>
      )}
    </>
  );
}
