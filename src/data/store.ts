// Contrat d'accès aux données. Les écrans ne dépendent que de cette interface :
// l'implémentation locale (démonstration, hors ligne) et l'implémentation serveur
// (PocketBase, lot 2) sont interchangeables.
import type {
  Direction, EventInfo, Participant, ParticipantSource, ParticipantType, Passage, Refusal, ScanMethod,
} from '../domain/model';
import type { ScanDecision } from '../domain/scan';

/** Agent d'accueil connecté sur un poste de scan. */
export interface Agent {
  id: string;
  name: string;
  stationId: string;
}

export interface NewEvent {
  name: string;
  startDate: string;
  endDate: string;
  venue?: string;
  capacity?: number;
}

export type EventPatch = Partial<Omit<EventInfo, 'id' | 'createdAt'>>;

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
  constructor(public code: 'not-found' | 'closed' | 'duplicate' | 'invalid', message: string) {
    super(message);
  }
}

export interface EventStore {
  // Événements (F-10 à F-16)
  listEvents(): Promise<EventInfo[]>;
  createEvent(input: NewEvent): Promise<EventInfo>;
  updateEvent(id: string, patch: EventPatch): Promise<EventInfo>;
  duplicateEvent(id: string, name: string): Promise<EventInfo>;
  deleteEvent(id: string): Promise<void>;

  // Participants (F-20 à F-26)
  addParticipants(eventId: string, list: NewParticipant[]): Promise<Participant[]>;
  updateParticipant(id: string, patch: ParticipantPatch): Promise<Participant>;
  deleteParticipant(id: string): Promise<void>;
  revokeToken(id: string): Promise<Participant>;

  // Scan (F-50 à F-59) — opérations atomiques
  scan(eventId: string, token: string, direction: Direction, method: ScanMethod, agent: Agent): Promise<ScanResult>;
  /** Enregistre la sortie de tous les présents ; renvoie le nombre de sorties. */
  closeDay(eventId: string, agent: Agent): Promise<number>;

  // Public (F-30 à F-42)
  getRegistrationInfo(eventId: string): Promise<RegistrationInfo | null>;
  register(eventId: string, form: RegistrationForm): Promise<{ token: string }>;
  getAccessPage(token: string): Promise<AccessPage | null>;

  /** Suivi en temps réel d'un événement ; appelle `listener` à chaque changement, y compris venant d'un autre poste. */
  subscribe(eventId: string, listener: (snapshot: EventSnapshot) => void): () => void;
}
