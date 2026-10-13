// Contrat d'accès aux données. Les écrans ne dépendent que de cette interface :
// l'implémentation locale (démonstration, hors ligne) et l'implémentation serveur
// (PocketBase, lot 2) sont interchangeables.
import type { Role } from '../domain/access';
import type {
  Direction, EventInfo, Participant, ParticipantSource, ParticipantType, Passage, Refusal, ScanMethod, User,
} from '../domain/model';
import type { ScanDecision } from '../domain/scan';

/** Appartenance de l'utilisateur connecté à une organisation (F-02). */
export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
}

export interface Session {
  user: User;
  memberships: Membership[];
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
  /** Nom de la première organisation, dont le nouvel utilisateur devient propriétaire. */
  organization: string;
}

export interface NewEvent {
  name: string;
  startDate: string;
  endDate: string;
  venue?: string;
  capacity?: number;
}

export type EventPatch = Partial<Omit<EventInfo, 'id' | 'orgId' | 'createdAt'>>;

export interface NewParticipant {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  typeId: string;
  source: ParticipantSource;
  consentAt?: string | null;
}

export type ParticipantPatch = Partial<Pick<Participant, 'firstName' | 'lastName' | 'email' | 'phone' | 'company' | 'typeId'>>;

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
  token: string;
  entryCount: number;
}

export interface RegistrationForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  typeId: string;
  consent: boolean;
}

export class StoreError extends Error {
  constructor(
    public code: 'not-found' | 'closed' | 'duplicate' | 'invalid' | 'unauthenticated' | 'forbidden',
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

  // Scan (F-50 à F-59) — opérations atomiques ; l'agent est l'utilisateur connecté, `stationId` son poste
  scan(eventId: string, token: string, direction: Direction, method: ScanMethod, stationId: string): Promise<ScanResult>;
  /** Enregistre la sortie de tous les présents ; renvoie le nombre de sorties. */
  closeDay(eventId: string, stationId: string): Promise<number>;

  // Public (F-30 à F-42)
  getRegistrationInfo(eventId: string): Promise<RegistrationInfo | null>;
  register(eventId: string, form: RegistrationForm): Promise<{ token: string }>;
  getAccessPage(token: string): Promise<AccessPage | null>;

  /**
   * Suivi en temps réel d'un événement ; appelle `listener` à chaque changement, y compris venant d'un autre poste.
   * Rien n'est transmis si l'utilisateur connecté n'est pas membre de son organisation (NF-24).
   */
  subscribe(eventId: string, listener: (snapshot: EventSnapshot) => void): () => void;
}
