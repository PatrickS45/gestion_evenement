// Protection des données (NF-31 à NF-34) : politique de confidentialité par événement, durée de conservation,
// purge automatique des données personnelles et traces des actions en masse (RG-09).
// Module exécuté aussi par le serveur (hooks PocketBase, sans Intl).
import type { Iso } from './model';

export type LegalBasis = 'consent' | 'contract' | 'legitimate-interest';

export const LEGAL_BASES: Record<LegalBasis, string> = {
  consent: 'Consentement de la personne',
  contract: 'Exécution d\'un contrat (inscription à l\'événement)',
  'legitimate-interest': 'Intérêt légitime de l\'organisateur (contrôle d\'accès et sécurité de l\'événement)',
};

/** Politique de confidentialité d'un événement, renseignée par l'organisateur, responsable de traitement (NF-32). */
export interface PrivacyPolicy {
  /** Identité du responsable de traitement. */
  controller: string;
  /** Contact pour exercer ses droits : délégué à la protection des données ou référent. */
  contact: string;
  legalBasis: LegalBasis;
  /** Conservation des données personnelles après la fin de l'événement, en mois (NF-33). */
  retentionMonths: number;
  /** Précisions affichées au public : finalités, destinataires… */
  details: string;
}

export const RETENTION_DEFAULT_MONTHS = 3;
export const RETENTION_MAX_MONTHS = 36;
/** Rappel à l'organisateur avant la purge (NF-33). */
export const PURGE_REMINDER_DAYS = 15;

export function defaultPrivacy(controller = ''): PrivacyPolicy {
  return { controller, contact: '', legalBasis: 'consent', retentionMonths: RETENTION_DEFAULT_MONTHS, details: '' };
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Politique reçue vérifiée ; les champs absents ou invalides reprennent ceux de `base`. */
export function normalizePrivacy(raw: unknown, base: PrivacyPolicy): PrivacyPolicy {
  const r = (raw ?? {}) as Record<string, unknown>;
  const months = Number(r.retentionMonths);
  return {
    controller: 'controller' in r ? text(r.controller, 200) : base.controller,
    contact: 'contact' in r ? text(r.contact, 200) : base.contact,
    legalBasis: (r.legalBasis as string) in LEGAL_BASES ? r.legalBasis as LegalBasis : base.legalBasis,
    retentionMonths: Number.isInteger(months) && months >= 1 && months <= RETENTION_MAX_MONTHS ? months : base.retentionMonths,
    details: 'details' in r ? text(r.details, 2000) : base.details,
  };
}

/** Les inscriptions publiques ne s'ouvrent que si le public sait à qui s'adresser (NF-32). */
export function privacyComplete(p: PrivacyPolicy): boolean {
  return p.controller.trim() !== '' && p.contact.trim() !== '';
}

/** Jour AAAA-MM-JJ décalé de `months` mois ; ramené au dernier jour du mois s'il n'existe pas (31 → 30). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Jour de la purge automatique des données personnelles d'un événement (NF-33). */
export function purgeDay(event: { endDate: string; privacy: PrivacyPolicy }): string {
  return addMonths(event.endDate, event.privacy.retentionMonths);
}

export type RetentionState = 'kept' | 'reminder' | 'due' | 'purged';

/** Où en est la conservation des données à la date `today` (AAAA-MM-JJ, heure de Paris). */
export function retentionState(event: { endDate: string; privacy: PrivacyPolicy; purgedAt: Iso | null }, today: string): RetentionState {
  if (event.purgedAt) return 'purged';
  const purge = purgeDay(event);
  if (today >= purge) return 'due';
  return today >= addDays(purge, -PURGE_REMINDER_DAYS) ? 'reminder' : 'kept';
}

// ─── Traces des actions sur les données personnelles (RG-09) ──────────

export type AuditAction =
  | 'import' // participants importés
  | 'export' // classeur ou liste exportés
  | 'participant.export' // données d'une personne, à sa demande (NF-34)
  | 'participant.delete' // effacement d'une personne (NF-34)
  | 'event.delete' // événement supprimé avec ses participants
  | 'purge'; // purge à l'échéance de conservation (NF-33)

export const AUDIT_LABELS: Record<AuditAction, string> = {
  import: 'Import de participants',
  export: 'Export de données',
  'participant.export': 'Export des données d\'une personne',
  'participant.delete': 'Effacement d\'une personne',
  'event.delete': 'Suppression de l\'événement',
  purge: 'Purge des données personnelles',
};

export interface AuditEntry {
  id: string;
  orgId: string;
  /** L'événement a pu être supprimé depuis : son nom est conservé. */
  eventId: string;
  eventName: string;
  /** Vide pour la purge automatique. */
  actorId: string;
  actorName: string;
  action: AuditAction;
  /** Nombre de personnes concernées. */
  count: number;
  /** Précision : nom du fichier exporté, motif… jamais de donnée personnelle. */
  detail: string;
  at: Iso;
}

/** Exports tracés à la demande de l'application (les fichiers sont produits sur le poste). */
export const EXPORT_KINDS = ['workbook', 'present-list', 'never-came-list'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_LABELS: Record<ExportKind, string> = {
  workbook: 'Classeur Excel complet',
  'present-list': 'Liste des présents (CSV)',
  'never-came-list': 'Liste des jamais venus (CSV)',
};
