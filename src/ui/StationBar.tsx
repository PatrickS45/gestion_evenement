import { useStationStatus } from '../app/context';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Alertes du poste (F-62, F-63) : seulement quand il y a quelque chose à savoir.
 * L'état normal (en ligne, copie de secours) est dans la pastille de la barre d'application.
 */
export function StationBar({ eventId }: { eventId: string }) {
  const status = useStationStatus();
  if (!status) return null;
  const quiet = status.online && status.duplicates === 0 && status.rejected === 0;

  const pending = status.pending > 0 && plural(status.pending, 'passage en attente d\'envoi', 'passages en attente d\'envoi');
  return (
    <div className="no-print" style={quiet ? undefined : { maxWidth: 1240, margin: '12px auto 0', padding: '0 20px' }}>
      {/* Zone toujours présente : annoncée aux lecteurs d'écran à chaque changement d'état */}
      <div role="status" aria-live="polite" className="stack" style={{ gap: 8 }}>
        {!status.online && (
          <p className="notice notice-warn">
            Hors ligne : les scans sont validés et enregistrés sur ce poste, puis envoyés dès le retour du réseau.
            {pending ? <> <strong>{pending}.</strong></> : null}
            {!status.copies[eventId] && <> Aucune copie de secours sur ce poste : le scan est impossible.</>}
          </p>
        )}
        {status.duplicates > 0 && (
          <p className="notice notice-info">
            {plural(status.duplicates, 'doublon hors ligne détecté', 'doublons hors ligne détectés')} à l'envoi : la même personne a été
            entrée sur deux postes coupés du réseau. Le comptage a été corrigé ; le détail figure sur l'écran Direct.
          </p>
        )}
        {status.rejected > 0 && (
          <p className="notice notice-danger">
            {plural(status.rejected, 'passage refusé', 'passages refusés')} par le serveur à l'envoi (participant supprimé entre-temps, ou accès retiré).
          </p>
        )}
      </div>
    </div>
  );
}
