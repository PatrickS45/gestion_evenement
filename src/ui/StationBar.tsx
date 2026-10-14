import { useState } from 'react';
import { errorMessage, useNotify, useStation, useStationStatus } from '../app/context';
import { parisTime } from '../domain/time';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** État permanent du poste (F-62) : en ligne ou non, passages en attente, copie locale (F-60), doublons (F-63). */
export function StationBar({ eventId }: { eventId: string }) {
  const station = useStation();
  const status = useStationStatus();
  const notify = useNotify();
  const [preparing, setPreparing] = useState(false);
  if (!station || !status) return null;

  const copy = status.copies[eventId];
  const prepare = async () => {
    setPreparing(true);
    try {
      const info = await station.prepare(eventId);
      notify(`Copie locale à jour : ${plural(info.participants, 'participant', 'participants')}`);
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setPreparing(false);
    }
  };

  const pending = status.pending > 0 && plural(status.pending, 'passage en attente d\'envoi', 'passages en attente d\'envoi');
  return (
    <div className="no-print" style={{ maxWidth: 1100, margin: '12px auto 0', padding: '0 16px' }}>
      {/* Annoncé aux lecteurs d'écran à chaque changement d'état */}
      <div role="status" aria-live="polite" className="stack" style={{ gap: 8 }}>
        {status.online
          ? (
            <p className="row-between small" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span>
                <span className="pill pill-ok"><span aria-hidden="true">● </span>En ligne</span>{' '}
                {status.syncing && <>Envoi des passages enregistrés hors ligne… </>}
                {copy
                  ? <>Copie de secours sur ce poste : {plural(copy.participants, 'participant', 'participants')}, mise à jour à {parisTime(copy.savedAt)}.</>
                  : <>Pas encore de copie de secours sur ce poste.</>}
              </span>
              <button className="btn btn-secondary btn-small" onClick={() => void prepare()} disabled={preparing}>
                {preparing ? 'Copie en cours…' : copy ? 'Mettre à jour la copie' : 'Préparer le hors ligne'}
              </button>
            </p>
          )
          : (
            <p className="notice notice-warn">
              <span aria-hidden="true">⚠ </span>
              Hors ligne : les scans sont validés et enregistrés sur ce poste, puis envoyés dès le retour du réseau.
              {pending ? <> <strong>{pending}.</strong></> : null}
              {!copy && <> Aucune copie de secours sur ce poste : le scan est impossible.</>}
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
