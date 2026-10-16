import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Maximize2, Minimize2 } from 'lucide-react';
import { errorMessage, useNotify, useNow, useSession, useStore } from '../app/context';
import { can } from '../domain/access';
import type { EventSnapshot } from '../data/store';
import { liveView } from '../domain/attendance';
import { GAUGE_LEVELS } from '../domain/gauge';
import { fullName } from '../domain/model';
import { parisShortDate, parisTime, QUARTER_MS } from '../domain/time';
import { ColumnChart, GaugeBar, TypeBadge } from '../ui/components';
import { InPageLink } from '../ui/SectionNav';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const fr = (n: number) => n.toLocaleString('fr-FR');

export function Live({ snapshot }: { snapshot: EventSnapshot }) {
  const store = useStore();
  const notify = useNotify();
  const { stationId } = useSession();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const live = useMemo(() => liveView(snapshot.event, snapshot.participants, snapshot.passages, now),
    [snapshot, now]);
  const names = useMemo(() => new Map(snapshot.participants.map((p) => [p.id, fullName(p)])), [snapshot.participants]);
  const typeById = useMemo(() => new Map(snapshot.event.types.map((t) => [t.id, t])), [snapshot.event.types]);
  const level = GAUGE_LEVELS[live.level];
  const { thresholds, capacity } = snapshot.event;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const closeDay = async () => {
    if (!confirm(`Enregistrer la sortie des ${plural(live.present, 'personne')} encore comptées dans la salle ?`)) return;
    try {
      const n = await store.closeDay(snapshot.event.id, stationId);
      notify(`Journée clôturée : ${plural(n, 'sortie')} enregistrée${n > 1 ? 's' : ''}`);
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const peakIndex = live.curve.reduce((best, c, i, all) => (c.present > (all[best]?.present ?? -1) ? i : best), 0);
  const totalPresent = Math.max(1, live.present);
  const kpis = [
    { label: 'Entrées', value: fr(live.today.entries), sub: "aujourd'hui" },
    { label: 'Sorties', value: fr(live.today.exits), sub: "aujourd'hui" },
    { label: 'Visiteurs différents', value: fr(live.today.visitors), sub: `sur ${fr(snapshot.participants.length)} inscrits` },
    { label: 'Pic de présence', value: fr(live.today.peak), sub: live.today.peakAt ? `à ${parisTime(live.today.peakAt)}` : "aujourd'hui" },
  ];

  return (
    <section ref={ref} className={`stack live${fullscreen ? ' live-full' : ''}`} aria-labelledby="live-title">
      <div className="page-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 id="live-title" className="page-title">Fréquentation en direct</h2>
          <p className="page-sub"><span className="live-dot" aria-hidden="true" />Mise à jour en temps réel · {parisShortDate(now)}</p>
        </div>
        <button className="btn btn-secondary no-print desktop-only"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : ref.current?.requestFullscreen?.())}>
          {fullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          {fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
        </button>
      </div>

      {!live.consistent && (
        <p className="notice notice-warn" role="alert">
          Écart entre le nombre de présents et le journal des passages : contactez le support avant la fin de l'événement.
        </p>
      )}

      {live.duplicates.length > 0 && (
        <p className="notice notice-info" role="status">
          {plural(live.duplicates.length, 'doublon hors ligne')} : la même personne a été enregistrée sur deux postes coupés du réseau.
          Le comptage est corrigé ; ces passages restent dans le journal, marqués « doublon ».
          {!fullscreen && <> <InPageLink to="duplicates-title">Voir le détail</InPageLink></>}
        </p>
      )}

      <div className="dash-top">
        <section className="card live-hero" aria-label="Présence dans la salle">
          <span className="kpi-label">Personnes dans la salle</span>
          <p className="live-hero-value" aria-live="polite">
            <span className="hero-number">{fr(live.present)}</span>
            <span className="live-hero-cap">/ {fr(capacity)}</span>
          </p>
          <GaugeBar present={live.present} capacity={capacity} level={live.level} height={10} showLabel={false} />
          <p className="live-level" style={{ color: level.color }}>
            <span aria-hidden="true">{level.icon} </span>{level.label}
            <span className="muted" style={{ fontWeight: 500 }}> · alerte à {Math.round(thresholds.warn * 100)} %, critique à {Math.round(thresholds.critical * 100)} %</span>
          </p>
        </section>
        <div className="kpi-grid">
          {kpis.map((k) => (
            <div key={k.label} className="kpi">
              <span className="kpi-label">{k.label}</span>
              <span className="big-number">{k.value}</span>
              <span className="kpi-sub">{k.sub}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="type-grid">
        {live.byType.map((t) => (
          <section key={t.id} className="card type-card" aria-label={`${t.label} : ${t.present} dans la salle`}>
            <div className="row-between">
              <TypeBadge type={t} large={fullscreen} />
              <span className="small">{plural(t.registered, 'inscrit')}</span>
            </div>
            <p className="type-card-value"><span className="big-number">{fr(t.present)}</span> <span className="muted">dans la salle</span></p>
            <div className="gauge-track" style={{ height: 6 }} aria-hidden="true">
              <div className="gauge-fill" style={{ width: `${Math.round((t.present / totalPresent) * 100)}%`, background: t.color }} />
            </div>
            <p className="small">
              {t.came} venu{t.came > 1 ? 's' : ''} · aujourd'hui {plural(t.entriesToday, 'entrée')}, {plural(t.exitsToday, 'sortie')}
              {t.companies > 0 && <> · {plural(t.companies, 'structure')}</>}
            </p>
          </section>
        ))}
      </div>

      {!fullscreen && <>
        <div className="dash-bottom">
          <section className="card" aria-labelledby="curve-title">
            <div className="row-between" style={{ alignItems: 'baseline', marginBottom: 8 }}>
              <h2 id="curve-title" style={{ margin: 0 }}>Présence au fil de la journée</h2>
              {live.today.peakAt && <span className="small">Pic : {live.today.peak} à {parisTime(live.today.peakAt)}</span>}
            </div>
            {live.curve.length === 0
              ? <p className="muted">Aucun passage aujourd'hui.</p>
              : <ColumnChart
                  values={live.curve.map((c) => c.present)}
                  labels={live.curve.map((c) => parisTime(c.start))}
                  highlight={peakIndex}
                  summary={`Nombre maximal de personnes présentes par quart d'heure aujourd'hui. Pic : ${live.today.peak} personnes${live.today.peakAt ? ` à ${parisTime(live.today.peakAt)}` : ''}.`}
                />}
            {live.curve.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary className="btn btn-ghost btn-small" style={{ display: 'inline-flex' }}>Voir les données</summary>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th scope="col">Tranche</th><th scope="col" className="num">Présence maximale</th></tr></thead>
                    <tbody>{live.curve.map((c) => (
                      <tr key={c.start}><td>{parisTime(c.start)} – {parisTime(c.start + QUARTER_MS)}</td><td className="num">{c.present}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </details>
            )}
          </section>

          <section className="card" aria-labelledby="recent-title">
            <h2 id="recent-title">Derniers passages</h2>
            {live.recent.length === 0 ? <p className="muted">Aucun passage pour le moment.</p> : (
              <ul className="recent">
                {live.recent.map((p) => (
                  <li key={p.id}>
                    <span className={`recent-dir ${p.direction === 'in' ? 'in' : 'out'}`}>
                      {p.direction === 'in' ? <ArrowRight size={14} aria-hidden="true" /> : <ArrowLeft size={14} aria-hidden="true" />}
                      <span className="sr-only">{p.direction === 'in' ? 'Entrée' : 'Sortie'}</span>
                    </span>
                    <span className="recent-name">
                      {names.get(p.participantId) ?? '(supprimé)'}
                      {p.origin === 'closing' && <span className="small"> · clôture</span>}
                      {p.origin === 'offline' && <span className="small"> · hors ligne{p.offlineDuplicate && ', doublon (non compté)'}</span>}
                    </span>
                    <TypeBadge type={typeById.get(p.typeId)} />
                    <span className="small recent-time">{parisTime(p.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {live.days.length > 1 && (
          <section className="card" aria-labelledby="days-title">
            <h2 id="days-title">Par journée</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Jour</th><th scope="col" className="num">Entrées</th><th scope="col" className="num">Sorties</th><th scope="col" className="num">Visiteurs différents</th><th scope="col" className="num">Pic</th></tr></thead>
                <tbody>{live.days.map((d, i) => (
                  <tr key={d.day}>
                    <td>Jour {i + 1} <span className="small">({parisShortDate(`${d.day}T12:00:00Z`)})</span></td>
                    <td className="num">{d.entries}</td><td className="num">{d.exits}</td><td className="num">{d.visitors}</td>
                    <td className="num">{d.peak}{d.peakAt && <span className="small"> à {parisTime(d.peakAt)}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}

        {live.duplicates.length > 0 && (
          <section className="card" aria-labelledby="duplicates-title">
            <h2 id="duplicates-title">Doublons hors ligne</h2>
            <p className="muted" style={{ marginBottom: 8 }}>Passages enregistrés pendant une coupure du réseau alors que la personne était déjà entrée (ou sortie) : ils ne sont pas comptés.</p>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th scope="col">Participant</th><th scope="col">Doublon</th><th scope="col">Déjà enregistré</th>
                </tr></thead>
                <tbody>{live.duplicates.map(({ duplicate: d, original: o }) => (
                  <tr key={d.id}>
                    <td>{names.get(d.participantId) ?? '(supprimé)'} <TypeBadge type={typeById.get(d.typeId)} /></td>
                    <td>{d.direction === 'in' ? 'Entrée' : 'Sortie'} à {parisTime(d.at)} <span className="small">· {d.stationId}, {d.agentName}</span></td>
                    <td>{o
                      ? <>{o.direction === 'in' ? 'Entrée' : 'Sortie'} à {parisTime(o.at)} <span className="small">· {o.stationId}, {o.agentName}</span></>
                      : <span className="small">Jamais entré(e)</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}

        {can(snapshot.role, 'day.close') && (
          <section className="card row-between" aria-labelledby="close-title" style={{ gap: 16 }}>
            <div className="stack" style={{ gap: 4, flex: '1 1 320px' }}>
              <h2 id="close-title" style={{ margin: 0 }}>Fin de journée</h2>
              <p className="muted">Les personnes qui n'ont pas scanné leur sortie restent comptées comme présentes. Enregistrez leur sortie pour repartir de zéro le lendemain.</p>
            </div>
            <button className="btn btn-secondary" onClick={closeDay} disabled={live.present === 0}>Clôturer la journée ({plural(live.present, 'présent')})</button>
          </section>
        )}
      </>}
    </section>
  );
}
