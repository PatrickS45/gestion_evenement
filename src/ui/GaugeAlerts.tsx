// Alertes actives (F-67) : chaque poste de l'équipe est prévenu quand la jauge franchit un seuil,
// quel que soit le poste qui a enregistré l'entrée (le temps réel apporte le nouveau compte).
import { useEffect, useRef, useState } from 'react';
import { gaugeAlert, gaugeLevel, GAUGE_LEVELS, type GaugeLevel } from '../domain/gauge';
import type { EventInfo } from '../domain/model';

const notificationsSupported = () => typeof Notification !== 'undefined';

/** Bip court, plus aigu pour un niveau plus grave ; sans effet si le navigateur bloque le son. */
function beep(level: GaugeLevel) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = level === 'attention' ? 660 : 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (level === 'attention' ? 0.25 : 0.6));
    osc.onended = () => void ctx.close();
  } catch { /* son indisponible */ }
}

function message(level: GaugeLevel, present: number, capacity: number) {
  return `${GAUGE_LEVELS[level].label} — ${present} personnes pour une jauge de ${capacity}`;
}

export function GaugeAlerts({ event, present }: { event: EventInfo; present: number }) {
  const level = gaugeLevel(present, event.capacity, event.thresholds);
  // Le niveau atteint à l'ouverture de l'écran n'est pas signalé : seulement les franchissements suivants
  const alerted = useRef<GaugeLevel | null>(null);
  const [shown, setShown] = useState<{ level: GaugeLevel; text: string } | null>(null);

  useEffect(() => {
    if (alerted.current === null) { alerted.current = level; return; }
    const r = gaugeAlert(alerted.current, level);
    alerted.current = r.alerted;
    if (level === 'normal') setShown(null);
    if (!r.alert) return;
    const text = message(r.alert, present, event.capacity);
    setShown({ level: r.alert, text });
    navigator.vibrate?.(r.alert === 'attention' ? [200, 100, 200] : [400, 150, 400, 150, 400]);
    beep(r.alert);
    if (notificationsSupported() && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
      try { new Notification(`Jauge — ${event.name}`, { body: text, tag: `jauge-${event.id}` }); } catch { /* notification refusée */ }
    }
  }, [level, present, event]);

  // L'autorisation des notifications se donne depuis le menu de l'utilisateur
  if (!shown) return null;
  return (
    <div className="no-print" style={{ maxWidth: 1240, margin: '12px auto 0', padding: '0 20px' }}>
      {shown && (
        <div role="alert" className={`notice ${shown.level === 'attention' ? 'notice-warn' : 'notice-danger'} row-between`} style={{ gap: 12 }}>
          <span><span aria-hidden="true">{GAUGE_LEVELS[shown.level].icon} </span>{shown.text}</span>
          <button className="btn btn-secondary btn-small" onClick={() => setShown(null)}>J'ai vu</button>
        </div>
      )}
    </div>
  );
}
