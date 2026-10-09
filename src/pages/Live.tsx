import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, useAgent, useNotify, useNow, useStore } from '../app/context';
import type { EventSnapshot } from '../data/store';
import { liveView } from '../domain/attendance';
import { GAUGE_LEVELS } from '../domain/gauge';
import { fullName } from '../domain/model';
import { parisShortDate, parisTime, QUARTER_MS } from '../domain/time';
import { ColumnChart, GaugeBar, TypeBadge } from '../ui/components';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function Live({ snapshot }: { snapshot: EventSnapshot }) {
  const store = useStore();
  const notify = useNotify();
  const { agent } = useAgent();
  const now = useNow();
  const ref = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const live = useMemo(() => liveView(snapshot.event, snapshot.participants, snapshot.passages, now),
    [snapshot, now]);
  const names = useMemo(() => new Map(snapshot.participants.map((p) => [p.id, fullName(p)])), [snapshot.participants]);
  const typeById = useMemo(() => new Map(snapshot.event.types.map((t) => [t.id, t])), [snapshot.event.types]);
  const level = GAUGE_LEVELS[live.level];

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const closeDay = async () => {
    if (!agent || !confirm(`Enregistrer la sortie des ${plural(live.present, 'personne')} encore comptées dans la salle ?`)) return;
    try {
      const n = await store.closeDay(snapshot.event.id, agent);
      notify(`Journée clôturée : ${plural(n, 'sortie')} enregistrée${n > 1 ? 's' : ''}`);
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const peakIndex = live.curve.reduce((best, c, i, all) => (c.present > (all[best]?.present ?? -1) ? i : best), 0);

  return (
    <section ref={ref} className="stack" aria-labelledby="live-title"
      style={fullscreen ? { background: 'var(--page)', padding: 32, height: '100vh', overflow: 'auto' } : undefined}>
      <div className="row-between">
        <h2 id="live-title" style={{ fontSize: fullscreen ? 30 : 20 }}>Fréquentation en direct</h2>
        <button className="btn btn-secondary no-print"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : ref.current?.requestFullscreen?.())}>
          {fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
        </button>
      </div>

      {!live.consistent && (
        <p className="notice notice-warn" role="alert">
          Écart entre le nombre de présents et le journal des passages : contactez le support avant la fin de l'événement.
        </p>
      )}

      <div className="card" style={{ borderLeft: `6px solid ${level.color}`, background: level.background }}>
        <p className="label">Personnes présentes dans la salle</p>
        <p className="hero-number" style={{ fontSize: fullscreen ? 140 : 72, margin: '6px 0 14px' }} aria-live="polite">
          {live.present}<span style={{ fontSize: fullscreen ? 52 : 26, color: 'var(--ink-2)', fontWeight: 600 }}> / {live.capacity}</span>
        </p>
        <GaugeBar present={live.present} capacity={live.capacity} level={live.level} height={fullscreen ? 26 : 18} />
      </div>

      <div className="grid">
        {live.byType.map((t) => (
          <div key={t.id} className="card" style={{ borderTop: `5px solid ${t.color}` }}>
            <TypeBadge type={t} large={fullscreen} />
            <p className="big-number" style={{ fontSize: fullscreen ? 64 : 36 }}>{t.present}</p>
            <p className="muted">présent{t.present > 1 ? 's' : ''} maintenant</p>
            <p className="small" style={{ marginTop: 6 }}>
              Aujourd'hui : {plural(t.entriesToday, 'entrée')} · {plural(t.exitsToday, 'sortie')}<br />
              {t.came} venu{t.came > 1 ? 's' : ''} sur {plural(t.registered, 'inscrit')}
              {t.companies > 0 && <> · {plural(t.companies, 'structure')}</>}
            </p>
          </div>
        ))}
      </div>

      <div className="grid">
        <div className="card"><p className="muted">Entrées aujourd'hui</p><p className="big-number">{live.today.entries}</p></div>
        <div className="card"><p className="muted">Sorties aujourd'hui</p><p className="big-number">{live.today.exits}</p></div>
        <div className="card"><p className="muted">Visiteurs différents aujourd'hui</p><p className="big-number">{live.today.visitors}</p></div>
        <div className="card">
          <p className="muted">Pic de présence aujourd'hui</p>
          <p className="big-number">{live.today.peak}</p>
          {live.today.peakAt && <p className="small">à {parisTime(live.today.peakAt)}</p>}
        </div>
      </div>

      {!fullscreen && <>
        <section className="card" aria-labelledby="curve-title">
          <h2 id="curve-title">Présence au fil de la journée</h2>
          {live.curve.length === 0
            ? <p className="muted">Aucun passage aujourd'hui.</p>
            : <ColumnChart
                values={live.curve.map((c) => c.present)}
                labels={live.curve.map((c) => parisTime(c.start))}
                highlight={peakIndex}
                summary={`Nombre maximal de personnes présentes par quart d'heure aujourd'hui. Pic : ${live.today.peak} personnes${live.today.peakAt ? ` à ${parisTime(live.today.peakAt)}` : ''}.`}
              />}
          {live.curve.length > 0 && (
            <details style={{ marginTop: 12 }}>
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

        {live.days.length > 0 && (
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

        <section className="card" aria-labelledby="recent-title">
          <h2 id="recent-title">Derniers passages</h2>
          {live.recent.length === 0 ? <p className="muted">Aucun passage pour le moment.</p> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {live.recent.map((p) => (
                <li key={p.id} style={{ display: 'grid', gridTemplateColumns: '84px 1fr auto 50px', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <span style={{ fontWeight: 700, color: p.direction === 'in' ? 'var(--ok)' : 'var(--warn)' }}>
                    <span aria-hidden="true">{p.direction === 'in' ? '→ ' : '← '}</span>{p.direction === 'in' ? 'Entrée' : 'Sortie'}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {names.get(p.participantId) ?? '(supprimé)'}{p.origin === 'closing' && <span className="small"> · clôture</span>}
                  </span>
                  <TypeBadge type={typeById.get(p.typeId)} />
                  <span className="small" style={{ textAlign: 'right' }}>{parisTime(p.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card stack" aria-labelledby="close-title">
          <h2 id="close-title" style={{ marginBottom: 0 }}>Fin de journée</h2>
          <p className="muted">
            Les personnes qui n'ont pas scanné leur sortie restent comptées comme présentes. En fin de journée,
            enregistrez leur sortie pour repartir de zéro le lendemain.
          </p>
          <div><button className="btn btn-secondary" onClick={closeDay} disabled={live.present === 0}>Clôturer la journée ({plural(live.present, 'présent')})</button></div>
        </section>
      </>}
    </section>
  );
}
