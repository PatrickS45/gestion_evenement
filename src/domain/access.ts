// Rôles et droits (cahier des charges, section 3). Une seule matrice, appliquée par le
// stockage (NF-20) et reflétée par l'interface.

export type Role = 'owner' | 'admin' | 'agent';

export const ROLES: readonly Role[] = ['owner', 'admin', 'agent'];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  agent: 'Agent d\'accueil',
};

export type Action =
  | 'scan'               // scanner, rechercher un participant, consulter la jauge
  | 'event.create'
  | 'event.edit'         // paramètres, jauge, types, ouverture des inscriptions
  | 'event.delete'       // F-16 : propriétaire uniquement
  | 'participants.manage'// liste, ajout, import, modification, suppression, nouveau QR code
  | 'day.close'          // F-59
  | 'stats.export'       // F-76 : statistiques et exports
  | 'members.manage';

const RANK: Record<Role, number> = { agent: 0, admin: 1, owner: 2 };

/** Rôle minimal requis pour chaque action. */
const REQUIRED: Record<Action, Role> = {
  'scan': 'agent',
  'event.create': 'admin',
  'event.edit': 'admin',
  'event.delete': 'owner',
  'participants.manage': 'admin',
  'day.close': 'admin',
  'stats.export': 'admin',
  'members.manage': 'owner',
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && RANK[role] >= RANK[REQUIRED[action]];
}
