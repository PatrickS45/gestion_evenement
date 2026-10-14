// Protection des données à l'écran : information du public (NF-32), saisie de la politique,
// rappel avant la purge et état « purgé » (NF-33).
import type { PublicPrivacy } from '../data/store';
import { can, type Role } from '../domain/access';
import type { EventInfo } from '../domain/model';
import {
  LEGAL_BASES, PURGE_REMINDER_DAYS, purgeDay, retentionState, RETENTION_MAX_MONTHS, type LegalBasis, type PrivacyPolicy,
} from '../domain/privacy';
import { parisDay } from '../domain/time';

/** « 12 juin 2027 » à partir d'un jour AAAA-MM-JJ. */
export const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const months = (n: number) => `${n} mois`;

/** Information du public sur le formulaire d'inscription et la page participant (NF-32). */
export function PublicPrivacyNotice({ privacy, open = false }: { privacy: PublicPrivacy; open?: boolean }) {
  return (
    <details open={open}>
      <summary className="small" style={{ cursor: 'pointer' }}>Utilisation de vos données personnelles</summary>
      <div className="small stack" style={{ marginTop: 8, gap: 6 }}>
        <p>
          <strong>Responsable du traitement</strong> : {privacy.controller}, organisateur de l'événement. Vos données (nom, email,
          société, téléphone, profil) servent uniquement à gérer votre inscription et votre accès ; les heures d'entrée et de
          sortie sont enregistrées pour le contrôle d'accès et des statistiques anonymes.
        </p>
        <p><strong>Base légale</strong> : {LEGAL_BASES[privacy.legalBasis]}.</p>
        <p>
          <strong>Conservation</strong> : {months(privacy.retentionMonths)} après l'événement. Vos données seront effacées
          le {longDay(privacy.purgeDay)} ; seules des statistiques sans donnée personnelle sont conservées ensuite.
          Elles ne sont ni vendues ni cédées, et restent hébergées en France.
        </p>
        {privacy.details && <p style={{ whiteSpace: 'pre-line' }}>{privacy.details}</p>}
        <p>
          <strong>Vos droits</strong> : accès, rectification, effacement, limitation et opposition, auprès de {privacy.contact}.
          Vous pouvez aussi adresser une réclamation à la CNIL (cnil.fr).
        </p>
      </div>
    </details>
  );
}

/** Champs de la politique de confidentialité, pour un événement ou les valeurs par défaut de l'organisation. */
export function PrivacyFields({ value, onChange, idPrefix }: { value: PrivacyPolicy; onChange: (p: PrivacyPolicy) => void; idPrefix: string }) {
  const set = <K extends keyof PrivacyPolicy>(k: K, v: PrivacyPolicy[K]) => onChange({ ...value, [k]: v });
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="stack">
      <div className="form-grid">
        <div className="field">
          <label htmlFor={id('controller')} className="required">Responsable du traitement</label>
          <input id={id('controller')} className="input" maxLength={200} value={value.controller} onChange={(e) => set('controller', e.target.value)}
            aria-describedby={id('controller-help')} />
          <p className="small" id={id('controller-help')}>L'organisateur : raison sociale et, au besoin, adresse.</p>
        </div>
        <div className="field">
          <label htmlFor={id('contact')} className="required">Contact pour les données personnelles</label>
          <input id={id('contact')} className="input" maxLength={200} value={value.contact} onChange={(e) => set('contact', e.target.value)}
            aria-describedby={id('contact-help')} />
          <p className="small" id={id('contact-help')}>Délégué à la protection des données ou référent : email ou adresse postale.</p>
        </div>
        <div className="field">
          <label htmlFor={id('basis')}>Base légale</label>
          <select id={id('basis')} className="input" value={value.legalBasis} onChange={(e) => set('legalBasis', e.target.value as LegalBasis)}>
            {(Object.keys(LEGAL_BASES) as LegalBasis[]).map((b) => <option key={b} value={b}>{LEGAL_BASES[b]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id('months')}>Conservation après l'événement (mois)</label>
          <input id={id('months')} type="number" min={1} max={RETENTION_MAX_MONTHS} inputMode="numeric" className="input"
            value={value.retentionMonths} onChange={(e) => set('retentionMonths', Math.max(1, Math.min(RETENTION_MAX_MONTHS, parseInt(e.target.value, 10) || 1)))} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={id('details')}>Précisions pour le public (facultatif)</label>
        <textarea id={id('details')} className="input" rows={3} maxLength={2000} value={value.details} onChange={(e) => set('details', e.target.value)}
          placeholder="Finalités particulières, destinataires, transferts…" />
      </div>
    </div>
  );
}

/** Rappel 15 jours avant la purge, puis état « purgé » (NF-33). Pour les administrateurs. */
export function RetentionBanner({ event, role, today = parisDay(Date.now()) }: { event: EventInfo; role: Role; today?: string }) {
  if (!can(role, 'event.edit')) return null;
  const state = retentionState(event, today);
  if (state === 'kept') return null;
  return (
    <div className="no-print" style={{ maxWidth: 1100, margin: '12px auto 0', padding: '0 16px' }}>
      {state === 'purged'
        ? (
          <p className="notice notice-info" role="status">
            Données personnelles purgées le {longDay(parisDay(event.purgedAt!))} : seul le bilan anonyme est conservé (onglet Statistiques).
          </p>
        )
        : (
          <p className="notice notice-warn" role="status">
            Les données personnelles de cet événement seront effacées le <strong>{longDay(purgeDay(event))}</strong>, au terme
            de la durée de conservation ({months(event.privacy.retentionMonths)}). Exportez ce dont vous avez besoin d'ici là ;
            la durée se modifie dans les paramètres. Rappel affiché {PURGE_REMINDER_DAYS} jours avant.
          </p>
        )}
    </div>
  );
}
