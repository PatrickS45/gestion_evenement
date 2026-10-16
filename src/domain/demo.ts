// Données de démonstration : un salon réaliste de 1 100 inscrits sur deux jours (hier et aujourd'hui),
// pour montrer Direct et les statistiques sans serveur. Noms et sociétés entièrement fictifs.
// Les passages respectent les règles de présence (RG-01, RG-02) : le journal rejoué donne
// exactement l'état des participants.
import type { Participant, Passage, Refusal, ScanMethod } from './model';
import { newId, newToken } from './ids';
import { parisTime } from './time';

export const DEMO_COUNTS = { visiteur: 700, exposant: 180, magasin: 220 } as const;
export const DEMO_CAPACITY = 1100;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Générateur pseudo-aléatoire déterministe (mulberry32) : la démonstration est reproductible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Camille', 'Léa', 'Hugo', 'Louis', 'Emma', 'Jules', 'Chloé', 'Lucas', 'Manon', 'Nathan', 'Inès', 'Théo', 'Sarah', 'Adam',
  'Jade', 'Arthur', 'Zoé', 'Paul', 'Alice', 'Raphaël', 'Lina', 'Gabriel', 'Clara', 'Tom', 'Anna', 'Noah', 'Eva', 'Victor', 'Julie', 'Mathis',
  'Margaux', 'Antoine', 'Pauline', 'Maxime', 'Lucie', 'Romain', 'Élise', 'Bastien', 'Agathe', 'Yanis'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent',
  'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont',
  'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guérin', 'Muller', 'Henry', 'Roussel',
  'Nicolas', 'Perrin', 'Morin', 'Mathieu', 'Clément', 'Gauthier', 'Dumont', 'Lopez', 'Fontaine', 'Chevalier', 'Robin', 'Masson'];
const STAND_KIND = ['Atelier', 'Maison', 'Studio', 'Fabrique', 'Comptoir', 'Manufacture', 'Collectif', 'Domaine'];
const STAND_NAME = ['du Loir', 'des Lumières', 'Boréal', 'Saint-Martin', 'Vauban', 'du Parc', 'Horizon', 'Lavande', 'Céleste', 'des Halles',
  'Mistral', 'Aurore', 'Émeraude', 'Pivoine', 'Garance', 'Opaline'];
const SHOP_KIND = ['Épicerie', 'Boutique', 'Cave', 'Librairie', 'Droguerie', 'Bazar'];
const TOWNS = ['Orléans', 'Blois', 'Tours', 'Chartres', 'Bourges', 'Montargis', 'Vierzon', 'Gien', 'Pithiviers', 'Vendôme', 'Châteaudun',
  'Romorantin', 'Dreux', 'Amboise', 'Sully', 'Briare'];
const VISITOR_ORGS = ['Agence Ligérienne', 'Cabinet Valois', 'Studio Graphique Nord', 'Conseil & Commerce', 'Réseau des Artisans', 'Groupe Horizon'];

const AGENTS = [
  { id: 'demo-agent-a', name: 'Camille (accueil)', stationId: 'Entrée A' },
  { id: 'demo-agent-b', name: 'Hugo (accueil)', stationId: 'Entrée B' },
  { id: 'demo-agent-c', name: 'Inès (sortie)', stationId: 'Sortie' },
] as const;

function slug(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '');
}

export interface DemoData {
  participants: Participant[];
  passages: Passage[];
  refusals: Refusal[];
}

/**
 * Inscrits et passages de la démonstration. Jour 1 : hier, journée complète et clôturée.
 * Jour 2 : aujourd'hui jusqu'à `now`, salle encore occupée.
 */
export function buildDemo(eventId: string, now: number, seed = 2027): DemoData {
  const rand = seededRandom(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  const between = (a: number, b: number) => a + rand() * (b - a);

  // Minuit à Paris pour aujourd'hui (offset 0) et hier (offset 1), à partir de l'heure affichée à Paris
  const [h, m] = parisTime(now).split(':').map(Number) as [number, number];
  const nowMin = h * 60 + m;
  const midnight = (offset: number) => now - nowMin * MIN - offset * DAY - (now % MIN);
  const createdAt = new Date(midnight(14)).toISOString();

  const stands = STAND_KIND.flatMap((k) => STAND_NAME.map((n) => `${k} ${n}`)).sort(() => rand() - 0.5).slice(0, 64);
  const shops = SHOP_KIND.flatMap((k) => TOWNS.map((t) => `${k} de ${t}`)).sort(() => rand() - 0.5).slice(0, 58);

  const participants: Participant[] = [];
  const used = new Set<string>();
  const person = (typeId: string, company: string): Participant => {
    let first = pick(FIRST), last = pick(LAST), email = '';
    for (let i = 2; ; i++) {
      email = `${slug(first)}.${slug(last)}${i > 2 ? i - 1 : ''}@demo.example`;
      if (!used.has(email)) break;
      if (i > 4) { first = pick(FIRST); last = pick(LAST); i = 1; }
    }
    used.add(email);
    return {
      id: newId(), eventId, firstName: first, lastName: last, email, phone: '', company, typeId,
      token: newToken(), tokenRevoked: false, source: 'import', status: 'accepted', answers: {}, consentAt: null, createdAt,
      inside: false, entryCount: 0, firstEntryAt: null, lastMoveAt: null,
    };
  };
  for (let i = 0; i < DEMO_COUNTS.exposant; i++) participants.push(person('exposant', stands[i % stands.length]!));
  for (let i = 0; i < DEMO_COUNTS.magasin; i++) participants.push(person('magasin', shops[i % shops.length]!));
  for (let i = 0; i < DEMO_COUNTS.visiteur; i++) participants.push(person('visiteur', rand() < 0.35 ? pick(VISITOR_ORGS) : ''));

  const passages: Passage[] = [];
  const refusals: Refusal[] = [];
  const method = (): ScanMethod => { const r = rand(); return r < 0.86 ? 'camera' : r < 0.95 ? 'search' : r < 0.98 ? 'scanner' : 'manual'; };
  const push = (p: Participant, direction: 'in' | 'out', at: number, origin: Passage['origin'] = 'online') => {
    const agent = direction === 'out' ? AGENTS[2] : AGENTS[rand() < 0.5 ? 0 : 1];
    passages.push({
      id: newId(), eventId, participantId: p.id, typeId: p.typeId, direction, at: new Date(Math.floor(at)).toISOString(),
      agentId: agent.id, agentName: agent.name, stationId: agent.stationId,
      method: origin === 'closing' ? 'manual' : method(), origin, offlineDuplicate: false,
    });
  };

  // Une journée : ouverture, fermeture et limite (l'instant présent pour aujourd'hui)
  const day = (offset: number, attend: Record<string, number>) => {
    const base = midnight(offset);
    const isToday = offset === 0;
    // Aujourd'hui, la journée « démarre » au plus tard 4 h avant maintenant, pour que la salle soit animée à toute heure
    const openMin = isToday ? Math.min(8 * 60, Math.max(0, nowMin - 4 * 60)) : 8 * 60;
    const closeMin = 18 * 60;
    const limit = isToday ? now - MIN : Infinity;
    const open = base + openMin * MIN, close = base + closeMin * MIN;
    const span = Math.max(60 * MIN, (isToday ? Math.min(close, limit) : close) - open);

    for (const p of participants) {
      if (rand() > (attend[p.typeId] ?? 0.5)) continue;
      const exhibitor = p.typeId === 'exposant';
      // Exposants à l'ouverture ; les autres en vague, avec un pic en fin de matinée
      const arrive = exhibitor ? open + between(0, 50) * MIN : open + (60 * MIN) + ((rand() + rand()) / 2) * (span * 0.8);
      const leave = exhibitor ? close - between(0, 40) * MIN : arrive + between(60, 300) * MIN;
      const moves: [('in' | 'out'), number][] = [['in', arrive]];
      if (!exhibitor && rand() < 0.15 && leave - arrive > 150 * MIN) {
        const out = arrive + between(60, 120) * MIN;
        moves.push(['out', out], ['in', out + between(20, 60) * MIN]);
      }
      // Une partie des sorties n'est pas scannée : elles seront enregistrées par la clôture de journée
      if (isToday || rand() > 0.08) moves.push(['out', Math.min(leave, close - MIN)]);
      for (const [dir, at] of moves) if (at < limit && at > open - 60 * MIN) push(p, dir, at);
    }
  };

  day(1, { exposant: 0.97, magasin: 0.72, visiteur: 0.62 });
  // Clôture de la veille (F-59) : sortie des personnes encore comptées présentes
  const inside = new Set<string>();
  for (const ps of [...passages].sort((a, b) => a.at.localeCompare(b.at))) {
    if (ps.direction === 'in') inside.add(ps.participantId); else inside.delete(ps.participantId);
  }
  const closing = midnight(1) + (18 * 60 + 30) * MIN;
  for (const p of participants) if (inside.has(p.id)) push(p, 'out', closing, 'closing');

  day(0, { exposant: 0.95, magasin: 0.66, visiteur: 0.8 });

  // Ordre chronologique, puis état de chaque participant d'après son journal (RG-01)
  passages.sort((a, b) => a.at.localeCompare(b.at));
  const byId = new Map(participants.map((p) => [p.id, p]));
  for (const ps of passages) {
    const p = byId.get(ps.participantId)!;
    if (ps.direction === 'in') {
      if (p.inside) continue;
      p.inside = true; p.entryCount++; p.firstEntryAt ??= ps.at;
    } else {
      p.inside = false;
    }
    p.lastMoveAt = ps.at;
  }

  // Quelques tentatives refusées, comme sur un vrai salon
  for (const offset of [1, 0]) {
    const base = midnight(offset);
    const until = offset === 0 ? now - MIN : base + 18 * 60 * MIN;
    for (let i = 0; i < 6; i++) {
      const at = between(base + 9 * 60 * MIN, until);
      if (at >= until || at < base) continue;
      const agent = AGENTS[rand() < 0.5 ? 0 : 1];
      refusals.push({
        id: newId(), eventId, reason: 'unknown', at: new Date(Math.floor(at)).toISOString(), agentId: agent.id, agentName: agent.name,
        stationId: agent.stationId, method: 'camera', participantId: null, sample: newToken().slice(0, 12),
      });
    }
  }
  refusals.sort((a, b) => a.at.localeCompare(b.at));

  return { participants, passages, refusals };
}
