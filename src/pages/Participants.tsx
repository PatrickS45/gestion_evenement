import { useMemo, useRef, useState, type FormEvent } from 'react';
import { errorMessage, useNotify, useStore } from '../app/context';
import { publicUrl } from '../app/router';
import type { EventSnapshot, NewParticipant } from '../data/store';
import { fullName, type Participant } from '../domain/model';
import { previewImport, type ImportPreview } from '../domain/csvImport';
import { download, fileSlug, Modal, QrImage, TypeBadge } from '../ui/components';
import { ActionMenu } from '../ui/Menu';
import { Download, Pencil, QrCode, Search, Trash, Upload, UserPlus, Users } from 'lucide-react';
import { FieldInput, type AnswerDraft } from '../ui/fields';
import { fieldsFor } from '../domain/fields';

type StatusFilter = 'all' | 'pending' | 'never' | 'inside' | 'left';
const SHOWN = 200;

function statusOf(p: Participant): Exclude<StatusFilter, 'all'> {
  if (p.status === 'pending') return 'pending';
  if (p.inside) return 'inside';
  return p.entryCount > 0 ? 'left' : 'never';
}

const STATUS_LABEL = { pending: 'En attente', never: 'Jamais venu', inside: 'Dans la salle', left: 'Sorti' } as const;

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '', company: '', typeId: '' };

export function Participants({ snapshot }: { snapshot: EventSnapshot }) {
  const store = useStore();
  const notify = useNotify();
  const { event, participants } = snapshot;
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<Participant | 'new' | null>(null);
  const [qrFor, setQrFor] = useState<Participant | null>(null);
  const [showImport, setShowImport] = useState(false);

  const typeById = useMemo(() => new Map(event.types.map((t) => [t.id, t])), [event.types]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return participants.filter((p) =>
      (!q || `${p.firstName} ${p.lastName} ${p.email} ${p.company}`.toLowerCase().includes(q))
      && (!typeFilter || p.typeId === typeFilter)
      && (status === 'all' || statusOf(p) === status));
  }, [participants, query, typeFilter, status]);

  const exportOne = async (p: Participant) => {
    try {
      const record = await store.exportParticipant(p.id);
      download(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }), `donnees-${fileSlug(fullName(p))}.json`);
      notify(`Données de ${fullName(p)} exportées (export tracé)`);
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const pending = participants.filter((p) => p.status === 'pending').length;

  const accept = async (p: Participant) => {
    try { await store.acceptParticipant(p.id); notify(`Inscription de ${fullName(p)} acceptée : son QR code est disponible sur sa page`); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const remove = async (p: Participant) => {
    if (!confirm(`Supprimer ${fullName(p)} et toutes ses données, passages compris ? Cette action est tracée et définitive.`)) return;
    try { await store.deleteParticipant(p.id); notify(`${fullName(p)} supprimé(e)`); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const STATUS_PILL = { pending: 'pill-warn', never: 'pill-muted', inside: 'pill-ok', left: 'pill-info' } as const;
  const counts = {
    inside: participants.filter((p) => p.inside).length,
    came: participants.filter((p) => p.entryCount > 0).length,
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="page-title">Participants</h2>
          <p className="page-sub">{participants.length} inscrits · {counts.came} venus · {counts.inside} dans la salle</p>
        </div>
        <div className="row">
          <button className="btn btn-secondary" onClick={() => setShowImport((v) => !v)} aria-expanded={showImport}><Upload size={18} aria-hidden="true" />Importer</button>
          <button className="btn" onClick={() => setEditing('new')}><UserPlus size={18} aria-hidden="true" />Ajouter</button>
        </div>
      </div>

      {showImport && <ImportPanel snapshot={snapshot} onDone={() => setShowImport(false)} />}

      {pending > 0 && (
        <p className="notice notice-info row-between" style={{ gap: 12 }}>
          <span>{pending} inscription{pending > 1 ? 's' : ''} en attente de validation : le QR code n'est délivré qu'après acceptation.</span>
          {status !== 'pending' && <button className="btn btn-secondary btn-small" onClick={() => setStatus('pending')}>Les afficher</button>}
        </p>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="filters" role="search">
          <div className="filter-search">
            <Search size={18} aria-hidden="true" />
            <label htmlFor="q" className="sr-only">Rechercher un participant</label>
            <input id="q" type="search" className="input" placeholder="Rechercher un nom, un email, une société" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label htmlFor="type-filter" className="sr-only">Type</label>
          <select id="type-filter" className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Tous les types</option>
            {event.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <label htmlFor="status-filter" className="sr-only">Statut</label>
          <select id="status-filter" className="input" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">Tous les statuts</option>
            {(pending > 0 || event.requireApproval) && <option value="pending">En attente de validation ({pending})</option>}
            <option value="never">Jamais venus</option>
            <option value="inside">Dans la salle</option>
            <option value="left">Sortis</option>
          </select>
        </div>
        <p className="small" role="status" style={{ padding: '0 20px 8px' }}>
          {filtered.length} participant{filtered.length > 1 ? 's' : ''}
          {filtered.length > SHOWN && ` — ${SHOWN} premiers affichés, affinez la recherche`}
        </p>
        {filtered.length === 0 ? (
          <div className="empty">
            <Users size={28} aria-hidden="true" />
            <p>{participants.length === 0 ? 'Aucun participant pour le moment. Importez une liste ou ouvrez les inscriptions.' : 'Aucun participant ne correspond à ces filtres.'}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="people">
              <caption className="sr-only">Liste des participants</caption>
              <thead>
                <tr><th scope="col">Participant</th><th scope="col" className="hide-mobile">Type</th><th scope="col" className="hide-mobile">Société</th><th scope="col">Statut</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {filtered.slice(0, SHOWN).map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <span className="person">
                        <strong>{fullName(p)}</strong>
                        <span className="small">{p.email || '—'}</span>
                        {p.company && <span className="small show-mobile">{p.company}</span>}
                        <span className="show-mobile" style={{ marginTop: 4 }}><TypeBadge type={typeById.get(p.typeId)} /></span>
                      </span>
                    </th>
                    <td className="hide-mobile"><TypeBadge type={typeById.get(p.typeId)} /></td>
                    <td className="hide-mobile">{p.company}</td>
                    <td>
                      <span className={`pill ${STATUS_PILL[statusOf(p)]}`}>{STATUS_LABEL[statusOf(p)]}</span>
                      {p.entryCount > 1 && <span className="small" style={{ display: 'block', marginTop: 2 }}>{p.entryCount} entrées</span>}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        {p.status === 'pending'
                          ? <button className="btn btn-small" onClick={() => void accept(p)} aria-label={`Accepter l'inscription de ${fullName(p)}`}>Accepter</button>
                          : <button className="btn btn-secondary btn-small icon-btn" onClick={() => setQrFor(p)} aria-label={`QR code de ${fullName(p)}`}><QrCode size={18} aria-hidden="true" /></button>}
                        <ActionMenu label={`Actions pour ${fullName(p)}`} actions={[
                          { label: 'Modifier', icon: <Pencil size={16} aria-hidden="true" />, onSelect: () => setEditing(p) },
                          { label: 'Exporter ses données', icon: <Download size={16} aria-hidden="true" />, onSelect: () => void exportOne(p) },
                          { label: 'Supprimer', icon: <Trash size={16} aria-hidden="true" />, onSelect: () => void remove(p), danger: true },
                        ]} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ParticipantForm snapshot={snapshot} participant={editing} onClose={() => setEditing(null)} />

      <Modal open={!!qrFor} onClose={() => setQrFor(null)} title={qrFor ? fullName(qrFor) : ''}>
        {qrFor && <AccessCard participant={qrFor} />}
      </Modal>
    </div>
  );
}

function AccessCard({ participant }: { participant: Participant }) {
  const notify = useNotify();
  const store = useStore();
  const url = publicUrl('acces', participant.token);
  const renew = async () => {
    if (!confirm('Générer un nouveau QR code ? L\'ancien sera immédiatement refusé à l\'entrée.')) return;
    try { await store.revokeToken(participant.id); notify('Nouveau QR code généré'); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <QrImage text={participant.token} size={220} label={`QR code d'accès de ${fullName(participant)}`} />
      <p className="small" style={{ wordBreak: 'break-all' }}>{url}</p>
      <div className="row">
        <button className="btn btn-secondary" onClick={() => { navigator.clipboard?.writeText(url); notify('Lien copié'); }}>Copier le lien d'accès</button>
        <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">Ouvrir la page<span className="sr-only"> (nouvel onglet)</span></a>
        <button className="btn btn-danger" onClick={renew}>Nouveau QR code</button>
      </div>
    </div>
  );
}

function ParticipantForm({ snapshot, participant, onClose }: { snapshot: EventSnapshot; participant: Participant | 'new' | null; onClose: () => void }) {
  const store = useStore();
  const notify = useNotify();
  const isNew = participant === 'new';
  const initial = participant && participant !== 'new'
    ? { firstName: participant.firstName, lastName: participant.lastName, email: participant.email, phone: participant.phone, company: participant.company, typeId: participant.typeId }
    : { ...EMPTY_FORM, typeId: snapshot.event.types[0]?.id ?? '' };
  const initialAnswers: AnswerDraft = participant && participant !== 'new' ? { ...participant.answers } : {};
  const [form, setForm] = useState(initial);
  const [answers, setAnswers] = useState<AnswerDraft>(initialAnswers);
  const [error, setError] = useState('');
  const [lastKey, setLastKey] = useState<unknown>(participant);
  if (lastKey !== participant) { setLastKey(participant); setForm(initial); setAnswers(initialAnswers); setError(''); }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (isNew) {
        const input: NewParticipant = { ...form, source: 'manual', answers };
        await store.addParticipants(snapshot.event.id, [input]);
        notify(`${form.firstName} ${form.lastName} ajouté(e)`);
      } else if (participant) {
        await store.updateParticipant(participant.id, { ...form, answers });
        notify('Modifications enregistrées');
      }
      onClose();
    } catch (err) { setError(errorMessage(err)); }
  };

  return (
    <Modal open={participant !== null} onClose={onClose} title={isNew ? 'Ajouter un participant' : 'Modifier le participant'}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pf-type" className="required">Type</label>
            <select id="pf-type" className="input" value={form.typeId} onChange={set('typeId')}>
              {snapshot.event.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="pf-first">Prénom</label><input id="pf-first" className="input" autoComplete="off" value={form.firstName} onChange={set('firstName')} /></div>
          <div className="field"><label htmlFor="pf-last" className="required">Nom</label><input id="pf-last" className="input" autoComplete="off" required value={form.lastName} onChange={set('lastName')} /></div>
          <div className="field"><label htmlFor="pf-email">Email</label><input id="pf-email" type="email" className="input" autoComplete="off" value={form.email} onChange={set('email')} /></div>
          <div className="field"><label htmlFor="pf-company">Société / enseigne</label><input id="pf-company" className="input" autoComplete="off" value={form.company} onChange={set('company')} /></div>
          <div className="field"><label htmlFor="pf-phone">Téléphone</label><input id="pf-phone" type="tel" className="input" autoComplete="off" value={form.phone} onChange={set('phone')} /></div>
        </div>
        {fieldsFor(snapshot.event.fields, form.typeId).map((f) => (
          <FieldInput key={f.id} field={f} idPrefix="pf-field" value={answers[f.id]} onChange={(v) => setAnswers({ ...answers, [f.id]: v })} />
        ))}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="row"><button className="btn" type="submit">{isNew ? 'Ajouter' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  );
}

function ImportPanel({ snapshot, onDone }: { snapshot: EventSnapshot; onDone: () => void }) {
  const store = useStore();
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const analyse = (content: string) => {
    setText(content);
    setPreview(previewImport(content, snapshot.event.types, snapshot.participants.map((p) => p.email).filter(Boolean), snapshot.event.fields));
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => analyse(String(reader.result ?? ''));
    reader.readAsText(file, 'utf-8');
  };

  const confirmImport = async () => {
    if (!preview?.accepted.length) return;
    setBusy(true);
    try {
      const added = await store.addParticipants(snapshot.event.id, preview.accepted.map((r) => ({ ...r, source: 'import' as const })));
      notify(`${added.length} participant${added.length > 1 ? 's' : ''} importé${added.length > 1 ? 's' : ''}`);
      onDone();
    } catch (err) { notify(errorMessage(err), 'danger'); }
    finally { setBusy(false); }
  };

  return (
    <section className="card stack" aria-labelledby="import-title">
      <h2 id="import-title">Importer une liste</h2>
      <p className="muted" id="import-help">
        Fichier CSV ou copier-coller depuis un tableur. La première ligne doit contenir les en-têtes :
        Nom, Prénom, Email, Société, Téléphone, Type (Visiteur, Exposant, Magasin…). Seule la colonne Nom est obligatoire.
      </p>
      <div className="row">
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="sr-only" tabIndex={-1} onChange={(e) => readFile(e.target.files?.[0])} />
        <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>Choisir un fichier</button>
        <span className="muted">ou collez le contenu ci-dessous</span>
      </div>
      <div className="field">
        <label htmlFor="import-text">Contenu à importer</label>
        <textarea id="import-text" className="input" rows={6} aria-describedby="import-help" value={text}
          onChange={(e) => analyse(e.target.value)} placeholder={'Nom;Prénom;Email;Société;Type\nRoy;Marc;marc@roy.fr;Roy & Fils;Exposant'} />
      </div>

      {preview && (
        <div className="stack" role="status" aria-live="polite">
          {preview.error ? <p className="notice notice-danger">{preview.error}</p> : <>
            <p className="notice notice-info">
              {preview.accepted.length} participant{preview.accepted.length > 1 ? 's' : ''} prêt{preview.accepted.length > 1 ? 's' : ''} à importer
              {preview.duplicates.length > 0 && ` · ${preview.duplicates.length} doublon${preview.duplicates.length > 1 ? 's' : ''} ignoré${preview.duplicates.length > 1 ? 's' : ''}`}
              {preview.skipped.length > 0 && ` · ${preview.skipped.length} ligne${preview.skipped.length > 1 ? 's' : ''} écartée${preview.skipped.length > 1 ? 's' : ''}`}
            </p>
            <p className="small">
              Colonnes reconnues : {Object.entries(preview.columns).filter(([, v]) => v).map(([, v]) => `« ${v} »`).join(', ')}
              {preview.fieldColumns.length > 0 && <><br />Réponses aux questions : {preview.fieldColumns.map((c) => `« ${c.header} »`).join(', ')}</>}
            </p>
            {[...preview.skipped.map((s) => `Ligne ${s.line} : ${s.reason}`),
              ...preview.duplicates.map((d) => `Ligne ${d.line} : ${d.email} déjà inscrit`),
              ...preview.warnings.map((w) => `Ligne ${w.line} : ${w.message}`)].slice(0, 12).map((m) => <p key={m} className="small">{m}</p>)}
            <div className="row">
              <button className="btn" onClick={confirmImport} disabled={busy || preview.accepted.length === 0}>
                Importer {preview.accepted.length} participant{preview.accepted.length > 1 ? 's' : ''}
              </button>
              <button className="btn btn-ghost" onClick={onDone}>Annuler</button>
            </div>
          </>}
        </div>
      )}
    </section>
  );
}
