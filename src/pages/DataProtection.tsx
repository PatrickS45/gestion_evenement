import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, useNotify, useSession, useStore } from '../app/context';
import { href } from '../app/router';
import { can } from '../domain/access';
import { AUDIT_LABELS, type AuditEntry, type PrivacyPolicy } from '../domain/privacy';
import type { EventReport } from '../domain/report';
import { PrivacyFields } from '../ui/privacy';
import { ReportView } from '../ui/ReportView';
import { UserMeta } from './Home';

const dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const REASONS: Record<EventReport['reason'], string> = { purge: 'purge des données', deletion: 'suppression de l\'événement' };

/** Protection des données de l'organisation : politique par défaut, traces (RG-09), bilans conservés (F-77). */
export function DataProtection() {
  const store = useStore();
  const notify = useNotify();
  const { org } = useSession();
  const allowed = can(org?.role, 'stats.export');
  const [policy, setPolicy] = useState<PrivacyPolicy | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [reports, setReports] = useState<EventReport[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { document.title = 'Données personnelles – Event Control'; }, []);
  useEffect(() => {
    if (!org || !allowed) return;
    const fail = (err: unknown) => notify(errorMessage(err), 'danger');
    store.getOrgPrivacy(org.orgId).then(setPolicy, fail);
    store.listAudit(org.orgId).then(setAudit, fail);
    store.listReports(org.orgId).then(setReports, fail);
  }, [store, org, allowed, notify]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!org || !policy) return;
    setError('');
    try { setPolicy(await store.setOrgPrivacy(org.orgId, policy)); notify('Politique par défaut enregistrée'); }
    catch (err) { setError(errorMessage(err)); }
  };

  return (
    <>
      <header className="topbar on-dark">
        <div className="topbar-inner">
          <div>
            <a className="brand" href={href()}>Event Control</a>
            <span aria-hidden="true"> › </span>
            <span style={{ fontWeight: 700 }}>Données personnelles</span>
          </div>
          <UserMeta role={org?.role} />
        </div>
      </header>
      <main className="page stack">
        <h1 style={{ fontSize: 24 }}>Données personnelles{org && <> – {org.orgName}</>}</h1>
        {!allowed ? <p className="notice notice-info">Réservé aux propriétaires et administrateurs de l'organisation.</p> : <>
          <form className="card stack" onSubmit={save} aria-labelledby="default-title" noValidate>
            <h2 id="default-title" style={{ marginBottom: 0 }}>Politique par défaut</h2>
            <p className="muted">Reprise par chaque nouvel événement, qui peut ensuite la préciser dans ses paramètres.</p>
            {policy === null ? <p role="status">Chargement…</p> : <PrivacyFields value={policy} onChange={setPolicy} idPrefix="org-privacy" />}
            {error && <p role="alert" className="error">{error}</p>}
            <div><button className="btn" type="submit" disabled={!policy}>Enregistrer</button></div>
          </form>

          <section className="card stack" aria-labelledby="audit-title">
            <h2 id="audit-title" style={{ marginBottom: 0 }}>Traces des actions sur les données</h2>
            <p className="muted">Imports, exports, effacements et purges : qui, quand, combien de personnes concernées.</p>
            {audit === null ? <p role="status">Chargement…</p> : audit.length === 0 ? <p className="muted">Aucune action pour le moment.</p> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Actions sur les données personnelles, de la plus récente à la plus ancienne</caption>
                  <thead><tr><th scope="col">Date</th><th scope="col">Action</th><th scope="col">Événement</th><th scope="col">Par</th><th scope="col" className="num">Personnes</th></tr></thead>
                  <tbody>{audit.map((a) => (
                    <tr key={a.id}>
                      <td>{dateTime(a.at)}</td>
                      <td>{AUDIT_LABELS[a.action]}{a.detail && <span className="small"> · {a.detail}</span>}</td>
                      <td>{a.eventName}</td>
                      <td>{a.actorName}</td>
                      <td className="num">{a.count}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card stack" aria-labelledby="reports-title">
            <h2 id="reports-title" style={{ marginBottom: 0 }}>Bilans conservés</h2>
            <p className="muted">Bilans anonymes enregistrés avant chaque purge ou suppression d'événement, conservés sans limite de durée.</p>
            {reports === null ? <p role="status">Chargement…</p> : reports.length === 0 ? <p className="muted">Aucun bilan conservé pour le moment.</p> : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
                {reports.map((r) => (
                  <li key={`${r.eventId}-${r.generatedAt}`}>
                    <details>
                      <summary style={{ cursor: 'pointer' }}>
                        <strong>{r.eventName}</strong> <span className="small">· {r.registered} inscrits, {r.came} venus · {REASONS[r.reason]} le {dateTime(r.generatedAt)}</span>
                      </summary>
                      <div style={{ marginTop: 12 }}><ReportView report={r} headingLevel={3} /></div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>}
      </main>
    </>
  );
}
