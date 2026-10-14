import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage, useNotify, useSession, useStore } from '../app/context';
import { href } from '../app/router';
import type { Member } from '../data/store';
import { can, ROLE_LABELS, ROLES, type Role } from '../domain/access';
import { UserMeta } from './Home';

/** Membres de l'organisation et leur rôle (propriétaire uniquement). Invitation par email : lot 2 (F-03). */
export function Members() {
  const store = useStore();
  const notify = useNotify();
  const { session, org } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [form, setForm] = useState<{ email: string; role: Role }>({ email: '', role: 'agent' });
  const [error, setError] = useState('');
  const allowed = can(org?.role, 'members.manage');

  const load = useCallback(() => {
    if (org && allowed) store.listMembers(org.orgId).then(setMembers, (err) => notify(errorMessage(err), 'danger'));
  }, [store, org, allowed, notify]);

  useEffect(load, [load]);
  useEffect(() => { document.title = 'Membres – Event Control'; }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setError('');
    try {
      const m = await store.addMember(org.orgId, form.email, form.role);
      notify(`${m.name} ajouté(e) comme ${ROLE_LABELS[m.role].toLowerCase()}`);
      setForm({ ...form, email: '' });
      load();
    } catch (err) { setError(errorMessage(err)); }
  };

  const changeRole = async (m: Member, role: Role) => {
    if (!org) return;
    try { await store.setMemberRole(org.orgId, m.userId, role); notify(`${m.name} : ${ROLE_LABELS[role].toLowerCase()}`); }
    catch (err) { notify(errorMessage(err), 'danger'); }
    load();
  };

  const remove = async (m: Member) => {
    if (!org || !confirm(`Retirer ${m.name} de ${org.orgName} ? Son accès est supprimé immédiatement.`)) return;
    try { await store.removeMember(org.orgId, m.userId); notify(`${m.name} retiré(e)`); load(); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  return (
    <>
      <header className="topbar on-dark">
        <div className="topbar-inner">
          <div>
            <a className="brand" href={href()}>Event Control</a>
            <span aria-hidden="true"> › </span>
            <span style={{ fontWeight: 700 }}>Membres</span>
          </div>
          <UserMeta role={org?.role} />
        </div>
      </header>
      <main className="page stack">
        <h1 style={{ fontSize: 24 }}>Membres{org && <> – {org.orgName}</>}</h1>
        {!allowed ? <p className="notice notice-info">Seul le propriétaire de l'organisation gère ses membres.</p> : <>
          {members === null ? <p role="status">Chargement…</p> : (
            <div className="card table-wrap">
              <table>
                <caption className="sr-only">Membres de l'organisation et leur rôle</caption>
                <thead><tr><th scope="col">Nom</th><th scope="col">Email</th><th scope="col">Rôle</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td>{m.name}{m.userId === session?.user.id && ' (vous)'}</td>
                      <td>{m.email}</td>
                      <td>
                        <select className="input" aria-label={`Rôle de ${m.name}`} value={m.role} onChange={(e) => { void changeRole(m, e.target.value as Role); }}>
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      </td>
                      <td><button className="btn btn-danger btn-small" onClick={() => { void remove(m); }}>Retirer</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className="card stack" onSubmit={add} aria-labelledby="add-member">
            <h2 id="add-member">Ajouter un membre</h2>
            <p className="muted">La personne doit d'abord avoir créé son compte. L'invitation par email arrivera avec la version serveur.</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="m-email" className="required">Adresse email du compte</label>
                <input id="m-email" type="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="m-role">Rôle</label>
                <select id="m-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>
            <ul className="small" style={{ margin: 0 }}>
              <li><strong>Propriétaire</strong> : tout, y compris les membres et la suppression d'événements.</li>
              <li><strong>Administrateur</strong> : événements, participants, statistiques et exports.</li>
              <li><strong>Agent d'accueil</strong> : scan, recherche d'un participant et jauge ; ni export ni modification.</li>
            </ul>
            {error && <p role="alert" className="error">{error}</p>}
            <div><button className="btn" type="submit">Ajouter</button></div>
          </form>
        </>}
      </main>
    </>
  );
}
