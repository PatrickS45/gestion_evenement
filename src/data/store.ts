// Contrat d'accès aux données. Les écrans ne dépendent que de cette interface :
// l'implémentation locale (démonstration, hors ligne) et l'implémentation serveur
// (PocketBase, lot 2) sont interchangeables.
import type { Role } from '../domain/access';
import type {
  Direction, EventInfo, Participant, ParticipantStatus, ParticipantSource, ParticipantType, Passage, Refusal, ScanMethod, User,
} from '../domain/model';
import type { CustomField } from '../domain/fields';
import type { SyncBatch, SyncResult } from '../domain/offline';
import type { AuditEntry, ExportKind, PrivacyPolicy } from '../domain/privacy';
import type { EventReport } from '../domain/report';
import type { ScanDecision } from '../domain/scan';

export type { OfflinePassage, OfflineRefusal, SyncBatch, SyncResult, SyncStatus } from '../domain/offline';

/** Appartenance de l'utilisateur connecté à une organisation (F-02). */
export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
}

/** Événement rejoint avec son code d'accès (F-04), hors de toute organisation : rôle d'agent d'accueil. */
export interface EventAccess {
  eventId: string;
  eventName: string;
  startDate: string;
  endDate: string;
}

export interface Session {
  user: User;
  memberships: Membership[];
  eventAccess: EventAccess[];
}

/** Membre d'une organisation, vu par son propriétaire. */
export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  /** Nom de la première organisation, dont le nouvel utilisateur devient propriétaire ; vide pour un agent qui rejoindra un événement avec son code. */
  organization: string;
}

export interface NewEvent {
  name: string;
  startDate: string;
  endDate: string;
  venue?: string;
  capacity?: number;
}

export type EventPatch = Partial<Omit<EventInfo, 'id' | 'orgId' | 'createdAt' | 'privacy' | 'purgedAt' | 'accessCode'>> & {
  privacy?: Partial<PrivacyPolicy>;
};

/** Politique de confidentialité montrée au public, avec la date de purge qui en découle (NF-32). */
export interface PublicPrivacy extends PrivacyPolicy {
  purgeDay: string;
}

/** Données d'une personne, remises à sa demande (NF-34) : tout ce qui la concerne, rien sur les agents. */
export interface ParticipantRecord {
  eventName: string;
  participant: Participant;
  passages: Pick<Passage, 'direction' | 'at' | 'stationId' | 'method' | 'origin' | 'offlineDuplicate'>[];
  refusals: Pick<Refusal, 'reason' | 'at' | 'stationId'>[];
  exportedAt: string;
}

export interface NewParticipant {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  typeId: string;
  source: ParticipantSource;
  consentAt?: string | null;
  /** Réponses aux champs personnalisés (F-33) ; vérifiées, sans exiger les champs obligatoires. */
  answers?: Record<string, unknown>;
}

export type ParticipantPatch = Partial<Pick<Participant, 'firstName' | 'lastName' | 'email' | 'phone' | 'company' | 'typeId'>> & {
  /** Réponses aux champs personnalisés, vérifiées par le stockage (F-33). */
  answers?: Record<string, unknown>;
};

export interface EventSnapshot {
  event: EventInfo;
  /** Rôle de l'utilisateur connecté dans l'organisation de l'événement. */
  role: Role;
  participants: Participant[];
  passages: Passage[];
  refusals: Refusal[];
}

export interface ScanResult {
  decision: ScanDecision;
  participant: Participant | null;
  passage: Passage | null;
}

/** Ce que voit le public sur le formulaire d'inscription (F-30 à F-32). */
export interface RegistrationInfo {
  eventName: string;
  types: ParticipantType[];
  open: boolean;
  privacy: PublicPrivacy;
  /** Champs personnalisés, à filtrer selon le type choisi (F-33). */
  fields: CustomField[];
}

/** Ce que voit un participant sur sa page d'accès (F-40) : ses seules données. */
export interface AccessPage {
  eventName: string;
  startDate: string;
  endDate: string;
  venue: string;
  firstName: string;
  lastName: string;
  company: string;
  type: ParticipantType | null;
  /** Vide tant que l'inscription attend sa validation : le QR code n'est délivré qu'après (F-37). */
  token: string;
  entryCount: number;
  status: ParticipantStatus;
  privacy: PublicPrivacy;
}

export interface RegistrationForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  typeId: string;
  consent: boolean;
  /** Champ piège, invisible : seul un robot le remplit (F-36). */
  website?: string;
  /** Réponses aux champs personnalisés ; les champs obligatoires du type choisi sont exigés (F-33). */
  answers?: Record<string, unknown>;
}

export class StoreError extends Error {
  constructor(
    /** `unreachable` : serveur injoignable ou indisponible ; le poste bascule hors ligne (F-61). */
    public code: 'not-found' | 'closed' | 'duplicate' | 'invalid' | 'unauthenticated' | 'forbidden' | 'unreachable',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Toutes les opérations, sauf celles du public, agissent au nom de l'utilisateur connecté
 * et vérifient son rôle (NF-20) : `unauthenticated` sans session, `forbidden` sans le droit requis.
 */
export interface EventStore {
  // Comptes et organisations (F-01, F-02)
  getSession(): Promise<Session | null>;
  signUp(input: SignUpInput): Promise<Session>;
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  createOrganization(name: string): Promise<Session>;
  listMembers(orgId: string): Promise<Member[]>;
  /** Ajoute un utilisateur déjà inscrit ; l'invitation par email arrive au lot 2 (F-03). */
  addMember(orgId: string, email: string, role: Role): Promise<Member>;
  setMemberRole(orgId: string, userId: string, role: Role): Promise<Member>;
  removeMember(orgId: string, userId: string): Promise<void>;

  // Événements (F-10 à F-16)
  listEvents(orgId: string): Promise<EventInfo[]>;
  createEvent(orgId: string, input: NewEvent): Promise<EventInfo>;
  updateEvent(id: string, patch: EventPatch): Promise<EventInfo>;
  duplicateEvent(id: string, name: string): Promise<EventInfo>;
  deleteEvent(id: string): Promise<void>;

  // Participants (F-20 à F-26)
  addParticipants(eventId: string, list: NewParticipant[]): Promise<Participant[]>;
  updateParticipant(id: string, patch: ParticipantPatch): Promise<Participant>;
  deleteParticipant(id: string): Promise<void>;
  revokeToken(id: string): Promise<Participant>;
  /** Accepte une inscription en attente (F-37) ; la refuser, c'est la supprimer. */
  acceptParticipant(id: string): Promise<Participant>;

  // Scan (F-50 à F-59) — opérations atomiques ; l'agent est l'utilisateur connecté, `stationId` son poste
  scan(eventId: string, token: string, direction: Direction, method: ScanMethod, stationId: string): Promise<ScanResult>;
  /** Enregistre la sortie de tous les présents ; renvoie le nombre de sorties. */
  closeDay(eventId: string, stationId: string): Promise<number>;
  /**
   * Envoie les passages et refus enregistrés hors ligne (F-61), au nom de l'utilisateur connecté.
   * Le journal de chaque participant concerné est rejoué à l'heure réelle : les doublons sont marqués
   * et la présence recalculée (F-63). Rejouable : un lot déjà reçu n'est pas compté deux fois.
   */
  syncOffline(eventId: string, batch: SyncBatch): Promise<SyncResult>;

  // Public (F-30 à F-42)
  getRegistrationInfo(eventId: string): Promise<RegistrationInfo | null>;
  register(eventId: string, form: RegistrationForm): Promise<{ token: string }>;
  getAccessPage(token: string): Promise<AccessPage | null>;

  // Agents rejoignant un événement par code (F-04)
  /** L'utilisateur connecté rejoint l'événement du code comme agent d'accueil. */
  joinEvent(code: string): Promise<Session>;
  /** Active (nouveau code) ou désactive le code ; le désactiver retire l'accès de ceux qui l'ont utilisé. */
  setAccessCode(eventId: string, enabled: boolean): Promise<EventInfo>;
  /** Agents ayant rejoint l'événement avec son code. */
  listEventAgents(eventId: string): Promise<Member[]>;

  // Protection des données (NF-32 à NF-34, F-77, RG-09)
  /** Politique appliquée aux nouveaux événements de l'organisation. */
  getOrgPrivacy(orgId: string): Promise<PrivacyPolicy>;
  setOrgPrivacy(orgId: string, privacy: Partial<PrivacyPolicy>): Promise<PrivacyPolicy>;
  /** Purge immédiate des données personnelles (propriétaire) ; le bilan anonyme est enregistré avant. */
  purgeEvent(eventId: string): Promise<EventReport>;
  /** Bilans anonymes conservés, y compris ceux des événements purgés ou supprimés. */
  listReports(orgId: string): Promise<EventReport[]>;
  /** Traces des actions sur les données personnelles, de la plus récente à la plus ancienne. */
  listAudit(orgId: string): Promise<AuditEntry[]>;
  /** Trace un export produit sur le poste (le fichier ne passe pas par le serveur). */
  logExport(eventId: string, kind: ExportKind, count: number): Promise<void>;
  /** Données d'une personne, à sa demande ; l'export est tracé. */
  exportParticipant(id: string): Promise<ParticipantRecord>;

  /**
   * Suivi en temps réel d'un événement ; appelle `listener` une fois chargé, puis à chaque changement,
   * y compris venant d'un autre poste. `null` : événement introuvable, supprimé, ou dont l'utilisateur
   * connecté n'est pas membre de l'organisation (NF-24).
   */
  subscribe(eventId: string, listener: (snapshot: EventSnapshot | null) => void): () => void;
}
