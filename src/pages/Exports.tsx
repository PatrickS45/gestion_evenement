import { useMemo } from 'react';
import type { EventSnapshot } from '../data/store';
import { quarterCurve, replayPassages } from '../domain/attendance';
import { parisShortDate, parisTime } from '../domain/time';
import { fullWorkbook, participantList } from '../export/reports';
import { toCsv, toXlsx } from '../export/spreadsheet';
import { ColumnChart, download, fileSlug, TypeBadge } from '../ui/components';

const pct = (part: number, total: number) => `${total ? Math.round((part / total) * 100) : 0} %`;
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function Exports({ snapshot }: { snapshot: EventSnapshot }) {
  const { event, participants, passages } = snapshot;
  const slug = fileSlug(event.name);
  const replay = useMemo(() => replayPassages(passages), [passages]);
  const came = participants.filter((p) => p.entryCount > 0).length;

  const byType = event.types.map((t) => {
    const ofType = participants.filter((p) => p.typeId === t.id);
    const c = ofType.filter((p) => p.entryCount > 0).length;
    return { type: t, registered: ofType.length, came: c, companies: new Set(ofType.map((p) => p.company.trim().toLowerCase()).filter(Boolean)).size };
  });

  const print = () => {
    const previous = document.title;
    document.title = `Bilan – ${event.name}`;
    window.addEventListener('afterprint', () => { document.title = previous; }, { once: true });
    window.print();
  };

  return (
    <div className="stack">
      <section className="card stack no-print" aria-labelledby="exports-title">
        <h2 id="exports-title" style={{ marginBottom: 0 }}>Exports</h2>
        <div className="row">
          <button className="btn" onClick={() => download(toXlsx(fullWorkbook(snapshot)), `statistiques-${slug}.xlsx`)}>Classeur Excel complet</button>
          <button className="btn btn-secondary" onClick={print}>Bilan PDF (sans donnée personnelle)</button>
          <button className="btn btn-secondary" onClick={() => download(toCsv(participantList(snapshot, 'inside')), `presents-${slug}.csv`)}>Présents maintenant (CSV)</button>
          <button className="btn btn-secondary" onClick={() => download(toCsv(participantList(snapshot, 'never')), `jamais-venus-${slug}.csv`)}>Jamais venus (CSV)</button>
        </div>
        <p className="small">
          Le classeur Excel contient la synthèse, la répartition par type, l'affluence par quart d'heure, la liste des participants,
          le journal des passages et les tentatives refusées. Pour le bilan PDF, choisissez « Enregistrer au format PDF » dans la fenêtre d'impression.
        </p>
      </section>

      {/* Bilan : affiché à l'écran, seul élément imprimé */}
      <article className="stack" aria-labelledby="report-title">
        <header className="card">
          <h2 id="report-title" style={{ fontSize: 24, marginBottom: 4 }}>Bilan — {event.name}</h2>
          <p className="muted">
            {event.startDate === event.endDate ? longDate(event.startDate) : `Du ${longDate(event.startDate)} au ${longDate(event.endDate)}`}
            {event.venue && ` · ${event.venue}`}
          </p>
        </header>

        <div className="grid">
          <div className="card"><p className="muted">Inscrits</p><p className="big-number">{participants.length}</p></div>
          <div className="card"><p className="muted">Venus</p><p className="big-number">{came}</p><p className="small">{pct(came, participants.length)} des inscrits</p></div>
          <div className="card"><p className="muted">Pic de présence</p><p className="big-number">{replay.peak.value}</p>
            {replay.peak.at && <p className="small">{parisShortDate(replay.peak.at)} à {parisTime(replay.peak.at)}</p>}</div>
          <div className="card"><p className="muted">Jauge</p><p className="big-number">{event.capacity}</p>
            <p className="small">{pct(replay.peak.value, event.capacity)} au plus fort</p></div>
        </div>

        <section className="card" aria-labelledby="r-types">
          <h3 id="r-types">Par type de participant</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Type</th><th scope="col" className="num">Inscrits</th><th scope="col" className="num">Venus</th><th scope="col" className="num">Taux de venue</th><th scope="col" className="num">Structures différentes</th></tr></thead>
              <tbody>{byType.map((r) => (
                <tr key={r.type.id}>
                  <td><TypeBadge type={r.type} /></td>
                  <td className="num">{r.registered}</td><td className="num">{r.came}</td>
                  <td className="num">{pct(r.came, r.registered)}</td><td className="num">{r.companies}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        {replay.days.length > 0 && (
          <section className="card" aria-labelledby="r-days">
            <h3 id="r-days">Par journée</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Jour</th><th scope="col" className="num">Entrées</th><th scope="col" className="num">Sorties</th><th scope="col" className="num">Visiteurs différents</th><th scope="col" className="num">Pic de présence</th></tr></thead>
                <tbody>{replay.days.map((d, i) => (
                  <tr key={d.day}>
                    <td>Jour {i + 1} ({parisShortDate(`${d.day}T12:00:00Z`)})</td>
                    <td className="num">{d.entries}</td><td className="num">{d.exits}</td><td className="num">{d.visitors}</td>
                    <td className="num">{d.peak}{d.peakAt && ` à ${parisTime(d.peakAt)}`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}

        {replay.days.map((d, i) => {
          const curve = quarterCurve(replay.timeline, d.day, 0);
          if (curve.length === 0) return null;
          const peak = curve.reduce((b, c, j, all) => (c.present > (all[b]?.present ?? -1) ? j : b), 0);
          return (
            <section key={d.day} className="card" aria-labelledby={`r-curve-${i}`}>
              <h3 id={`r-curve-${i}`}>Présence dans la salle — jour {i + 1} ({parisShortDate(`${d.day}T12:00:00Z`)})</h3>
              <ColumnChart values={curve.map((c) => c.present)} labels={curve.map((c) => parisTime(c.start))} highlight={peak}
                summary={`Présence maximale par quart d'heure le jour ${i + 1}. Pic : ${d.peak} personnes.`} />
            </section>
          );
        })}

        <p className="small">Document statistique sans donnée personnelle, édité le {new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}.</p>
      </article>
    </div>
  );
}
