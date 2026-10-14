// Bilan d'un événement, sans donnée personnelle (F-75, F-77) : le même affichage sert au bilan
// calculé en direct et au bilan conservé après la purge ou la suppression de l'événement.
import type { EventReport } from '../domain/report';
import { parisShortDate, parisTime } from '../domain/time';
import { ColumnChart, TypeBadge } from './components';

const pct = (part: number, total: number) => `${total ? Math.round((part / total) * 100) : 0} %`;
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const noon = (day: string) => `${day}T12:00:00Z`;

export function ReportView({ report, headingLevel = 2 }: { report: EventReport; headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as const;
  const Sub = `h${headingLevel + 1}` as 'h3' | 'h4';
  const id = (k: string) => `r-${report.eventId}-${k}`;
  return (
    <article className="stack" aria-labelledby={id('title')}>
      <header className="card">
        <H id={id('title')} style={{ fontSize: 24, marginBottom: 4 }}>Bilan — {report.eventName}</H>
        <p className="muted">
          {report.startDate === report.endDate ? longDate(report.startDate) : `Du ${longDate(report.startDate)} au ${longDate(report.endDate)}`}
          {report.venue && ` · ${report.venue}`}
        </p>
      </header>

      <div className="grid">
        <div className="card"><p className="muted">Inscrits</p><p className="big-number">{report.registered}</p></div>
        <div className="card"><p className="muted">Venus</p><p className="big-number">{report.came}</p><p className="small">{pct(report.came, report.registered)} des inscrits</p></div>
        <div className="card"><p className="muted">Pic de présence</p><p className="big-number">{report.peak.value}</p>
          {report.peak.at && <p className="small">{parisShortDate(report.peak.at)} à {parisTime(report.peak.at)}</p>}</div>
        <div className="card"><p className="muted">Jauge</p><p className="big-number">{report.capacity}</p>
          <p className="small">{pct(report.peak.value, report.capacity)} au plus fort</p></div>
      </div>

      <section className="card" aria-labelledby={id('types')}>
        <Sub id={id('types')}>Par type de participant</Sub>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Type</th><th scope="col" className="num">Inscrits</th><th scope="col" className="num">Venus</th><th scope="col" className="num">Taux de venue</th><th scope="col" className="num">Structures différentes</th></tr></thead>
            <tbody>{report.byType.map((t) => (
              <tr key={t.id}>
                <td><TypeBadge type={t} /></td>
                <td className="num">{t.registered}</td><td className="num">{t.came}</td>
                <td className="num">{pct(t.came, t.registered)}</td><td className="num">{t.companies}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {report.days.length > 0 && (
        <section className="card" aria-labelledby={id('days')}>
          <Sub id={id('days')}>Par journée</Sub>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Jour</th><th scope="col" className="num">Entrées</th><th scope="col" className="num">Sorties</th><th scope="col" className="num">Visiteurs différents</th><th scope="col" className="num">Pic de présence</th></tr></thead>
              <tbody>{report.days.map((d, i) => (
                <tr key={d.day}>
                  <td>Jour {i + 1} ({parisShortDate(noon(d.day))})</td>
                  <td className="num">{d.entries}</td><td className="num">{d.exits}</td><td className="num">{d.visitors}</td>
                  <td className="num">{d.peak}{d.peakAt && ` à ${parisTime(d.peakAt)}`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {report.days.map((d, i) => {
        if (d.curve.length === 0) return null;
        const peak = d.curve.reduce((b, c, j, all) => (c.present > (all[b]?.present ?? -1) ? j : b), 0);
        return (
          <section key={d.day} className="card" aria-labelledby={id(`curve-${i}`)}>
            <Sub id={id(`curve-${i}`)}>Présence dans la salle — jour {i + 1} ({parisShortDate(noon(d.day))})</Sub>
            <ColumnChart values={d.curve.map((c) => c.present)} labels={d.curve.map((c) => parisTime(c.start))} highlight={peak}
              summary={`Présence maximale par quart d'heure le jour ${i + 1}. Pic : ${d.peak} personnes.`} />
          </section>
        );
      })}

      <p className="small">
        Document statistique sans donnée personnelle
        {report.refusals > 0 && <> · {report.refusals} tentative{report.refusals > 1 ? 's' : ''} refusée{report.refusals > 1 ? 's' : ''}</>}
        {report.offlineDuplicates > 0 && <> · {report.offlineDuplicates} doublon{report.offlineDuplicates > 1 ? 's' : ''} hors ligne écarté{report.offlineDuplicates > 1 ? 's' : ''}</>}
        {' '}· établi le {new Date(report.generatedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}.
      </p>
    </article>
  );
}
