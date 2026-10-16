import { useEffect, useMemo, useState } from 'react';
import { errorMessage, useNotify, useStore } from '../app/context';
import type { EventSnapshot } from '../data/store';
import type { ExportKind } from '../domain/privacy';
import { anonymousReport, type EventReport } from '../domain/report';
import { controlStats, type ControlStats } from '../domain/stats';
import { fullWorkbook, participantList } from '../export/reports';
import { toCsv, toXlsx } from '../export/spreadsheet';
import { download, fileSlug } from '../ui/components';
import { ReportView } from '../ui/ReportView';

export function Exports({ snapshot }: { snapshot: EventSnapshot }) {
  const store = useStore();
  const notify = useNotify();
  const { event } = snapshot;
  const slug = fileSlug(event.name);
  const live = useMemo(
    () => anonymousReport(event, snapshot.participants, snapshot.passages, snapshot.refusals, new Date().toISOString(), 'purge'),
    [event, snapshot.participants, snapshot.passages, snapshot.refusals],
  );
  // Après la purge, seul le bilan enregistré à ce moment-là reste (F-77)
  const [kept, setKept] = useState<EventReport | null | undefined>(event.purgedAt ? undefined : null);
  useEffect(() => {
    if (!event.purgedAt) return;
    store.listReports(event.orgId).then(
      (reports) => setKept(reports.find((r) => r.eventId === event.id && r.reason === 'purge') ?? null),
      () => setKept(null),
    );
  }, [store, event.id, event.orgId, event.purgedAt]);

  /** Chaque export de données personnelles est tracé avant que le fichier soit produit (RG-09). */
  const exportFile = async (kind: ExportKind, count: number, make: () => Blob, filename: string) => {
    try {
      await store.logExport(event.id, kind, count);
      download(make(), filename);
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const print = () => {
    const previous = document.title;
    document.title = `Bilan – ${event.name}`;
    window.addEventListener('afterprint', () => { document.title = previous; }, { once: true });
    window.print();
  };

  const inside = snapshot.participants.filter((p) => p.inside).length;
  const never = snapshot.participants.filter((p) => p.entryCount === 0).length;
  const report = event.purgedAt ? kept : live;

  return (
    <div className="stack">
      <div className="page-head no-print">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="page-title">Statistiques et exports</h2>
          <p className="page-sub">Bilan à jour en continu, exports Excel, CSV et PDF</p>
        </div>
      </div>
      <section className="card stack no-print" aria-labelledby="exports-title">
        <h2 id="exports-title" style={{ marginBottom: 0 }}>Exports</h2>
        {event.purgedAt
          ? <p className="muted">Les données personnelles ont été purgées : seul le bilan anonyme ci-dessous est disponible.</p>
          : <>
            <div className="row">
              <button className="btn" onClick={() => void exportFile('workbook', snapshot.participants.length, () => toXlsx(fullWorkbook(snapshot)), `statistiques-${slug}.xlsx`)}>Classeur Excel complet</button>
              <button className="btn btn-secondary" onClick={print}>Bilan PDF (sans donnée personnelle)</button>
              <button className="btn btn-secondary" onClick={() => void exportFile('present-list', inside, () => toCsv(participantList(snapshot, 'inside')), `presents-${slug}.csv`)}>Présents maintenant (CSV)</button>
              <button className="btn btn-secondary" onClick={() => void exportFile('never-came-list', never, () => toCsv(participantList(snapshot, 'never')), `jamais-venus-${slug}.csv`)}>Jamais venus (CSV)</button>
            </div>
            <p className="small">
              Le classeur Excel contient la synthèse, la répartition par type, l'affluence par quart d'heure, la liste des participants,
              le journal des passages et les tentatives refusées. Les exports contenant des données personnelles sont tracés.
              Pour le bilan PDF, choisissez « Enregistrer au format PDF » dans la fenêtre d'impression.
            </p>
          </>}
        {event.purgedAt && report && <div><button className="btn btn-secondary" onClick={print}>Bilan PDF</button></div>}
      </section>

      {/* Bilan : affiché à l'écran, seul élément imprimé */}
      {report === undefined ? <p role="status">Chargement du bilan…</p>
        : report === null ? <p className="notice notice-warn">Aucun bilan enregistré pour cet événement.</p>
          : <ReportView report={report} />}

      {!event.purgedAt && <Control stats={controlStats(snapshot.passages, snapshot.refusals)} />}
    </div>
  );
}

const METHOD_LABELS: Record<keyof ControlStats['byMethod'], string> = {
  camera: 'Caméra', scanner: 'Douchette', search: 'Recherche par nom', manual: 'Saisie manuelle',
};

/** Contrôle (F-74) : nomme les agents, n'est donc ni imprimé avec le bilan ni conservé après la purge. */
function Control({ stats }: { stats: ControlStats }) {
  const scans = Object.values(stats.byMethod).reduce((a, b) => a + b, 0);
  return (
    <section className="card stack no-print" aria-labelledby="control-title">
      <h2 id="control-title" style={{ marginBottom: 0 }}>Contrôle</h2>
      <p className="muted">Scans par agent et par poste, hors clôture de journée. Ces chiffres nomment les agents : ils ne figurent pas dans le bilan.</p>
      <div className="grid">
        <div className="card"><p className="muted">QR codes inconnus</p><p className="big-number">{stats.refusals.unknown}</p></div>
        <div className="card"><p className="muted">Refus « déjà dans la salle »</p><p className="big-number">{stats.refusals.alreadyInside}</p></div>
        <div className="card"><p className="muted">Passages enregistrés hors ligne</p><p className="big-number">{stats.offline}</p></div>
        <div className="card"><p className="muted">Doublons hors ligne écartés</p><p className="big-number">{stats.offlineDuplicates}</p></div>
      </div>
      {scans === 0 ? <p className="muted">Aucun scan pour le moment.</p> : <>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Scans par agent</caption>
            <thead><tr><th scope="col">Agent</th><th scope="col" className="num">Entrées</th><th scope="col" className="num">Sorties</th><th scope="col" className="num">Refus</th></tr></thead>
            <tbody>{stats.byAgent.map((a) => (
              <tr key={a.agentId}><td>{a.agentName || '(sans nom)'}</td><td className="num">{a.entries}</td><td className="num">{a.exits}</td><td className="num">{a.refusals}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Scans par poste</caption>
            <thead><tr><th scope="col">Poste</th><th scope="col" className="num">Entrées</th><th scope="col" className="num">Sorties</th><th scope="col" className="num">Refus</th></tr></thead>
            <tbody>{stats.byStation.map((s) => (
              <tr key={s.stationId}><td>{s.stationId || '(sans nom)'}</td><td className="num">{s.entries}</td><td className="num">{s.exits}</td><td className="num">{s.refusals}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Moyens d'identification utilisés</caption>
            <thead><tr><th scope="col">Moyen d'identification</th><th scope="col" className="num">Scans</th><th scope="col" className="num">Part</th></tr></thead>
            <tbody>{(Object.keys(METHOD_LABELS) as (keyof ControlStats['byMethod'])[]).map((m) => (
              <tr key={m}><td>{METHOD_LABELS[m]}</td><td className="num">{stats.byMethod[m]}</td><td className="num">{Math.round((stats.byMethod[m] / scans) * 100)} %</td></tr>
            ))}</tbody>
          </table>
        </div>
      </>}
    </section>
  );
}
