// Règles d'enregistrement d'un passage (cahier des charges F-52).
// Fonctions pures : le stockage les exécute de façon atomique (F-53).
import type { Direction, Iso, Participant, Passage, PassageOrigin, ScanMethod } from './model';

export type ScanDecision =
  | { result: 'accepted'; direction: 'in'; firstEntry: boolean; entryNumber: number }
  | { result: 'accepted'; direction: 'out' }
  | { result: 'refused'; reason: 'unknown' }
  | { result: 'refused'; reason: 'already-inside'; since: Iso | null }
  | { result: 'warning'; reason: 'not-inside' };

/**
 * Décide du sort d'un scan à partir de l'état actuel du participant.
 * `participant` vaut undefined si le jeton lu ne correspond à personne.
 */
export function decideScan(participant: Participant | undefined, direction: Direction): ScanDecision {
  // Jeton révoqué (RG-06) ou inscription en attente de validation (F-37) : comme inconnu
  if (!participant || participant.tokenRevoked || participant.status === 'pending') return { result: 'refused', reason: 'unknown' };

  if (direction === 'in') {
    if (participant.inside) return { result: 'refused', reason: 'already-inside', since: participant.lastMoveAt };
    return {
      result: 'accepted', direction: 'in',
      firstEntry: participant.entryCount === 0,
      entryNumber: participant.entryCount + 1,
    };
  }

  if (!participant.inside) return { result: 'warning', reason: 'not-inside' };
  return { result: 'accepted', direction: 'out' };
}

export interface ScanContext {
  eventId: string;
  at: Iso;
  agentId: string;
  agentName: string;
  stationId: string;
  method: ScanMethod;
  origin: PassageOrigin;
  passageId: string;
}

/**
 * Applique une décision acceptée : nouvel état du participant et passage à journaliser.
 * Renvoie null si la décision n'enregistre aucun passage (refus ou avertissement).
 */
export function applyScan(
  participant: Participant,
  decision: ScanDecision,
  ctx: ScanContext,
): { participant: Participant; passage: Passage } | null {
  if (decision.result !== 'accepted') return null;

  const passage: Passage = {
    id: ctx.passageId,
    eventId: ctx.eventId,
    participantId: participant.id,
    typeId: participant.typeId,
    direction: decision.direction,
    at: ctx.at,
    agentId: ctx.agentId,
    agentName: ctx.agentName,
    stationId: ctx.stationId,
    method: ctx.method,
    origin: ctx.origin,
    offlineDuplicate: false,
  };

  const updated: Participant = decision.direction === 'in'
    ? {
        ...participant,
        inside: true,
        entryCount: decision.entryNumber,
        firstEntryAt: participant.firstEntryAt ?? ctx.at,
        lastMoveAt: ctx.at,
      }
    : { ...participant, inside: false, lastMoveAt: ctx.at };

  return { participant: updated, passage };
}

/** Message affiché à l'agent après un scan (F-54). */
export function decisionMessage(decision: ScanDecision, name: string, formatTime: (iso: Iso) => string): string {
  switch (decision.result) {
    case 'accepted':
      if (decision.direction === 'out') return `Sortie enregistrée : au revoir ${name}`;
      return decision.firstEntry
        ? `Bienvenue ${name}`
        : `Bon retour ${name} (${decision.entryNumber}e entrée)`;
    case 'refused':
      return decision.reason === 'unknown'
        ? 'QR code non reconnu'
        : `${name} est déjà dans la salle${decision.since ? ` depuis ${formatTime(decision.since)}` : ''}`;
    case 'warning':
      return `${name} n'est pas enregistré(e) dans la salle : vérifiez le mode du poste`;
  }
}
