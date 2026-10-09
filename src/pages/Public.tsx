import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, useStore } from '../app/context';
import { navigate } from '../app/router';
import type { AccessPage, RegistrationForm, RegistrationInfo } from '../data/store';
import { QrImage, TypeBadge } from '../ui/components';

const JUST_REGISTERED = 'event-control:just-registered';
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function PrivacyNotice() {
  return (
    <details>
      <summary className="small" style={{ cursor: 'pointer' }}>Utilisation de vos données</summary>
      <p className="small" style={{ marginTop: 8 }}>
        Vos données (nom, email, société, téléphone, type) sont utilisées par l'organisateur de l'événement, responsable
        du traitement, uniquement pour gérer votre inscription et votre accès. Les heures d'entrée et de sortie sont
        enregistrées pour le contrôle d'accès et des statistiques anonymes. Vos données ne sont ni vendues ni cédées, et
        sont supprimées après l'événement. Vous pouvez demander à l'organisateur d'y accéder, de les corriger ou de les effacer.
      </p>
    </details>
  );
}

export function Register({ eventId }: { eventId: string }) {
  const store = useStore();
  const [info, setInfo] = useState<RegistrationInfo | null | undefined>(undefined);
  const [form, setForm] = useState<RegistrationForm>({ firstName: '', lastName: '', email: '', phone: '', company: '', typeId: '', consent: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'Inscription – Event Control'; }, []);
  useEffect(() => { store.getRegistrationInfo(eventId).then(setInfo); }, [store, eventId]);

  const set = (k: keyof RegistrationForm) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? !!e.target.checked : e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.typeId) { setError('Indiquez votre profil.'); return; }
    if (!form.lastName.trim()) { setError('Indiquez votre nom.'); return; }
    if (!form.consent) { setError('Votre accord est nécessaire pour vous inscrire.'); return; }
    setError(''); setBusy(true);
    try {
      const { token } = await store.register(eventId, form);
      try { sessionStorage.setItem(JUST_REGISTERED, token); } catch { /* message de confirmation non affiché */ }
      navigate('acces', token);
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  };

  if (info === undefined) return <main className="public"><p className="public-card" role="status">Chargement…</p></main>;
  if (!info || !info.open) return (
    <main className="public">
      <div className="public-card stack">
        <h1 style={{ fontSize: 24 }}>Inscriptions fermées</h1>
        <p className="muted">{info ? `Les inscriptions à « ${info.eventName} » ne sont pas ouvertes.` : 'Ce lien d\'inscription n\'est pas valide.'}</p>
      </div>
    </main>
  );

  return (
    <main className="public">
      <form className="public-card stack" onSubmit={submit} noValidate>
        <div>
          <p className="muted" style={{ fontWeight: 600 }}>{info.eventName}</p>
          <h1 style={{ fontSize: 26 }}>Inscription</h1>
          <p className="muted">Votre QR code d'accès s'affiche dès votre inscription validée.</p>
        </div>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend className="label required" style={{ marginBottom: 8 }}>Vous êtes</legend>
          <div className="stack" style={{ gap: 8 }}>
            {info.types.map((t) => (
              <label key={t.id} className="row" style={{ border: `2px solid ${form.typeId === t.id ? t.color : 'var(--line)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', flexWrap: 'nowrap' }}>
                <input type="radio" name="type" value={t.id} checked={form.typeId === t.id} onChange={set('typeId')} style={{ width: 18, height: 18, accentColor: t.color }} />
                <TypeBadge type={t} />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-grid">
          <div className="field"><label htmlFor="r-first">Prénom</label><input id="r-first" className="input" autoComplete="given-name" value={form.firstName} onChange={set('firstName')} /></div>
          <div className="field"><label htmlFor="r-last" className="required">Nom</label><input id="r-last" className="input" autoComplete="family-name" value={form.lastName} onChange={set('lastName')} /></div>
        </div>
        <div className="field"><label htmlFor="r-email" className="required">Adresse email</label><input id="r-email" type="email" className="input" autoComplete="email" value={form.email} onChange={set('email')} /></div>
        <div className="field"><label htmlFor="r-company">Société ou enseigne</label><input id="r-company" className="input" autoComplete="organization" value={form.company} onChange={set('company')} /></div>
        <div className="field"><label htmlFor="r-phone">Téléphone</label><input id="r-phone" type="tel" className="input" autoComplete="tel" value={form.phone} onChange={set('phone')} /></div>

        <label className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.consent} onChange={set('consent')} style={{ width: 18, height: 18, marginTop: 3 }} />
          <span className="required">J'accepte que mes données soient utilisées pour gérer mon inscription et mon accès à l'événement.</span>
        </label>
        <PrivacyNotice />
        <p className="small">Les champs marqués * sont obligatoires.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="btn btn-big" type="submit" disabled={busy}>{busy ? 'Inscription…' : 'Je m\'inscris'}</button>
      </form>
    </main>
  );
}

export function Access({ token }: { token: string }) {
  const store = useStore();
  const [page, setPage] = useState<AccessPage | null | undefined>(undefined);
  const [justRegistered] = useState(() => { try { return sessionStorage.getItem(JUST_REGISTERED) === token; } catch { return false; } });

  useEffect(() => { document.title = 'Votre accès – Event Control'; }, []);
  useEffect(() => { store.getAccessPage(token).then(setPage); }, [store, token]);
  // Le message de confirmation ne s'affiche qu'une fois
  useEffect(() => { try { sessionStorage.removeItem(JUST_REGISTERED); } catch { /* sans effet */ } }, []);

  if (page === undefined) return <main className="public"><p className="public-card" role="status">Chargement…</p></main>;
  if (page === null) return (
    <main className="public">
      <div className="public-card stack">
        <h1 style={{ fontSize: 24 }}>Accès introuvable</h1>
        <p className="muted">Ce lien n'est pas valide ou a été remplacé. Contactez l'organisateur.</p>
      </div>
    </main>
  );

  return (
    <main className="public">
      <div className="public-card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        {justRegistered && (
          <p role="status" className="notice notice-ok" style={{ width: '100%' }}>
            Inscription confirmée. Gardez cette page : ajoutez-la à vos favoris ou faites une capture d'écran.
          </p>
        )}
        <p className="muted" style={{ fontWeight: 600 }}>{page.eventName}</p>
        <h1 style={{ fontSize: 26 }}>{[page.firstName, page.lastName].filter(Boolean).join(' ')}</h1>
        {page.company && <p className="muted">{page.company}</p>}
        {page.type && <TypeBadge type={page.type} large />}
        <QrImage text={page.token} size={260} label="Votre QR code d'accès" />
        <p>Présentez ce QR code <strong>à chaque entrée et à chaque sortie</strong>.</p>
        <p className="small">
          {page.startDate === page.endDate ? longDate(page.startDate) : `Du ${longDate(page.startDate)} au ${longDate(page.endDate)}`}
          {page.venue && <><br />{page.venue}</>}
        </p>
        <div style={{ width: '100%', textAlign: 'left' }}><PrivacyNotice /></div>
      </div>
    </main>
  );
}
