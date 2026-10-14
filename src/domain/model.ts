// Modèle métier (cahier des charges, section 7). Aucune dépendance technique.

/** Date et heure au format ISO 8601. */
export type Iso = string;

export type Direction = 'in' | 'out';

/** Moyen d'identification du participant au scan (F-51). */
export type ScanMethod = 'camera' | 'scanner' | 'search' | 'manual';

/** Origine d'un passage : en ligne, synchronisé après une coupure, ou clôture de journée (F-59). */
export type PassageOrigin = 'online' | 'offline' | 'closing';

export type ParticipantSource = 'manual' | 'import' | 'form';

export interface ParticipantType {
  id: string;
  label: string;
  color: string;
}

export interface GaugeThresholds {
  /** Part de la jauge à partir de laquelle on passe en « attention » (0–1). */
  warn: number;
  /** Part de la jauge à partir de laquelle on passe en « critique » (0–1). */
  critical: number;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: Iso;
}

export interface User {
  id: string;
  /** En minuscules ; sert d'identifiant de connexion (F-01). */
  email: string;
  name: string;
}

export interface EventInfo {
  id: string;
  /** Organisation propriétaire ; seuls ses membres accèdent à l'événement (NF-24). */
  orgId: string;
  name: string;
  /** Jour de début, AAAA-MM-JJ (heure de Paris). */
  startDate: string;
  /** Jour de fin, AAAA-MM-JJ (heure de Paris). */
  endDate: string;
  venue: string;
  capacity: number;
  thresholds: GaugeThresholds;
  types: ParticipantType[];
  registrationOpen: boolean;
  createdAt: Iso;
}

export interface Participant {
  id: string;
  eventId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  typeId: string;
  /** Secret contenu dans le QR code (F-25). */
  token: string;
  tokenRevoked: boolean;
  source: ParticipantSource;
  consentAt: Iso | null;
  createdAt: Iso;
  /** Présence actuelle : vrai si le dernier passage est une entrée (RG-01). */
  inside: boolean;
  entryCount: number;
  firstEntryAt: Iso | null;
  lastMoveAt: Iso | null;
}

export interface Passage {
  id: string;
  eventId: string;
  participantId: string;
  /** Type du participant au moment du passage (RG-07). */
  typeId: string;
  direction: Direction;
  at: Iso;
  agentId: string;
  agentName: string;
  stationId: string;
  method: ScanMethod;
  origin: PassageOrigin;
  /** Passage accepté hors ligne alors qu'un autre poste l'avait déjà enregistré (F-63). */
  offlineDuplicate: boolean;
}

export type RefusalReason = 'unknown' | 'already-inside';

export interface Refusal {
  id: string;
  eventId: string;
  reason: RefusalReason;
  at: Iso;
  agentId: string;
  agentName: string;
  stationId: string;
  method: ScanMethod;
  participantId: string | null;
  /** Début du code lu, pour les QR codes inconnus. */
  sample: string;
}

/** Ordre alphabétique des participants : nom, puis prénom. */
export function compareNames(a: Pick<Participant, 'firstName' | 'lastName'>, b: Pick<Participant, 'firstName' | 'lastName'>): number {
  return a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr');
}

export function fullName(p: Pick<Participant, 'firstName' | 'lastName'>): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}
