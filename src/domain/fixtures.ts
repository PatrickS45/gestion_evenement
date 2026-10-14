// Fabriques de données pour les tests.
import type { EventInfo, Participant, Passage, Direction } from './model';
import { DEFAULT_TYPES } from './colors';
import { DEFAULT_THRESHOLDS } from './gauge';

export function makeEvent(over: Partial<EventInfo> = {}): EventInfo {
  return {
    id: 'evt', orgId: 'org', name: 'Salon test', startDate: '2027-03-11', endDate: '2027-03-12', venue: 'Orléans',
    capacity: 1100, thresholds: DEFAULT_THRESHOLDS, types: DEFAULT_TYPES, registrationOpen: true,
    createdAt: '2026-10-01T08:00:00.000Z', ...over,
  };
}

export function makeParticipant(over: Partial<Participant> = {}): Participant {
  return {
    id: 'p1', eventId: 'evt', firstName: 'Léa', lastName: 'Petit', email: 'lea@example.fr', phone: '',
    company: '', typeId: 'visiteur', token: 'a'.repeat(40), tokenRevoked: false, source: 'manual',
    consentAt: null, createdAt: '2026-10-01T08:00:00.000Z', inside: false, entryCount: 0,
    firstEntryAt: null, lastMoveAt: null, ...over,
  };
}

let seq = 0;
export function makePassage(participantId: string, direction: Direction, at: string, over: Partial<Passage> = {}): Passage {
  return {
    id: `ps${++seq}`, eventId: 'evt', participantId, typeId: 'visiteur', direction, at,
    agentId: 'agent', agentName: 'Agent', stationId: 'poste-1', method: 'camera', origin: 'online',
    offlineDuplicate: false, ...over,
  };
}
