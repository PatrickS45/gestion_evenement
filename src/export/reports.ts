// Contenu des exports (F-75) : classeur complet et listes CSV.
import type { EventSnapshot } from '../data/store';
import { replayPassages } from '../domain/attendance';
import { fullName, type Participant, type ScanMethod } from '../domain/model';
import { floorQuarter, parisDay, parisTime, QUARTER_MS, toMs } from '../domain/time';
import type { Cell, Sheet } from './spreadsheet';

const H = (header: string): Cell => ({ header });
const pct = (part: number, total: number): Cell => ({ percent: total ? part / total : 0 });
const dateTime = (iso: string | null) => (iso ? `${parisDay(iso).split('-').reverse().join('/')} ${parisTime(iso)}` : '');
const dayLabel = (day: string) => day.split('-').reverse().join('/');

const METHODS: Record<ScanMethod, string> = {
  camera: 'Caméra', scanner: 'Douchette', search: 'Recherche par nom', manual: 'Saisie manuelle',
};

function typeLabel(s: EventSnapshot, typeId: string) {
  return s.event.types.find((t) => t.id === typeId)?.label ?? 'Sans type';
}

function status(p: Participant) {
  if (p.inside) return 'Dans la salle';
  return p.entryCount > 0 ? 'Sorti' : 'Jamais venu';
}

export function summarySheet(s: EventSnapshot, exportedAt: Date): Sheet {
  const { event, participants, passages } = s;
  const replay = replayPassages(passages);
  const came = participants.filter((p) => p.entryCount > 0).length;
  return {
    name: 'Synthèse',
    widths: [38, 18, 18, 18, 18, 22],
    rows: [
      [event.name],
      [`Du ${dayLabel(event.startDate)} au ${dayLabel(event.endDate)}${event.venue ? ` — ${event.venue}` : ''}`],
      [`Export du ${dateTime(exportedAt.toISOString())}`],
      [],
      [H('Indicateur'), H('Valeur')],
      ['Inscrits', participants.length],
      ['Venus au moins une fois', came],
      ['Jamais venus', participants.length - came],
      ['Taux de venue', pct(came, participants.length)],
      ['Jauge', event.capacity],
      ['Pic de présence', replay.peak.value],
      ['Heure du pic', replay.peak.at ? dateTime(new Date(replay.peak.at).toISOString()) : ''],
      ['Tentatives refusées', s.refusals.length],
      [],
      [H('Journée'), H('Entrées'), H('Sorties'), H('Visiteurs différents'), H('Pic de présence'), H('Heure du pic')],
      ...replay.days.map((d) => [dayLabel(d.day), d.entries, d.exits, d.visitors, d.peak, d.peakAt ? parisTime(d.peakAt) : '']),
    ],
  };
}

export function byTypeSheet(s: EventSnapshot): Sheet {
  return {
    name: 'Par type',
    widths: [22, 12, 12, 16, 16, 24],
    rows: [
      [H('Type'), H('Inscrits'), H('Venus'), H('Taux de venue'), H('Dans la salle'), H('Sociétés différentes')],
      ...s.event.types.map((t) => {
        const ofType = s.participants.filter((p) => p.typeId === t.id);
        const came = ofType.filter((p) => p.entryCount > 0).length;
        const companies = new Set(ofType.map((p) => p.company.trim().toLowerCase()).filter(Boolean)).size;
        return [t.label, ofType.length, came, pct(came, ofType.length), ofType.filter((p) => p.inside).length, companies];
      }),
    ],
  };
}

/** Entrées, sorties et présence maximale par quart d'heure, pour chaque journée. */
export function attendanceSheet(s: EventSnapshot): Sheet {
  const replay = replayPassages(s.passages);
  const rows: Cell[][] = [[H('Journée'), H('Tranche'), H('Entrées'), H('Sorties'), H('Présence maximale')]];
  const counted = s.passages.filter((p) => !p.offlineDuplicate);
  for (const day of replay.days) {
    const points = replay.timeline.filter((p) => parisDay(p.at) === day.day);
    if (points.length === 0) continue;
    let present = 0;
    for (const p of replay.timeline) { if (p.at >= points[0]!.at) break; present = p.present; }
    let i = 0;
    for (let start = floorQuarter(points[0]!.at); start <= floorQuarter(points[points.length - 1]!.at); start += QUARTER_MS) {
      let max = present;
      while (i < points.length && points[i]!.at < start + QUARTER_MS) { present = points[i]!.present; max = Math.max(max, present); i++; }
      const inSlot = counted.filter((p) => { const t = toMs(p.at); return t >= start && t < start + QUARTER_MS; });
      rows.push([
        dayLabel(day.day), `${parisTime(start)} – ${parisTime(start + QUARTER_MS)}`,
        inSlot.filter((p) => p.direction === 'in').length, inSlot.filter((p) => p.direction === 'out').length, max,
      ]);
    }
  }
  return { name: 'Affluence', widths: [12, 16, 10, 10, 18], rows };
}

export function participantsSheet(s: EventSnapshot): Sheet {
  return {
    name: 'Participants',
    widths: [20, 18, 14, 26, 30, 16, 14, 18, 10, 18],
    rows: [
      [H('Nom'), H('Prénom'), H('Type'), H('Société'), H('Email'), H('Téléphone'), H('Statut'), H('Première entrée'), H('Entrées'), H('Origine')],
      ...s.participants.map((p) => [
        p.lastName, p.firstName, typeLabel(s, p.typeId), p.company, p.email, p.phone, status(p),
        dateTime(p.firstEntryAt), p.entryCount,
        p.source === 'form' ? 'Formulaire' : p.source === 'import' ? 'Import' : 'Saisie',
      ]),
    ],
  };
}

export function passagesSheet(s: EventSnapshot): Sheet {
  const byId = new Map(s.participants.map((p) => [p.id, p]));
  return {
    name: 'Passages',
    widths: [18, 9, 26, 14, 22, 14, 18, 12],
    rows: [
      [H('Date et heure'), H('Sens'), H('Participant'), H('Type'), H('Agent'), H('Poste'), H('Moyen'), H('Origine')],
      ...[...s.passages].sort((a, b) => toMs(a.at) - toMs(b.at)).map((p) => [
        dateTime(p.at), p.direction === 'in' ? 'Entrée' : 'Sortie',
        byId.has(p.participantId) ? fullName(byId.get(p.participantId)!) : '(supprimé)',
        typeLabel(s, p.typeId), p.agentName, p.stationId, METHODS[p.method],
        p.origin === 'closing' ? 'Clôture' : p.origin === 'offline' ? (p.offlineDuplicate ? 'Hors ligne (doublon)' : 'Hors ligne') : 'En ligne',
      ]),
    ],
  };
}

export function refusalsSheet(s: EventSnapshot): Sheet {
  const byId = new Map(s.participants.map((p) => [p.id, p]));
  return {
    name: 'Refus',
    widths: [18, 18, 26, 22, 14, 18],
    rows: [
      [H('Date et heure'), H('Motif'), H('Participant ou code lu'), H('Agent'), H('Poste'), H('Moyen')],
      ...[...s.refusals].sort((a, b) => toMs(a.at) - toMs(b.at)).map((r) => [
        dateTime(r.at), r.reason === 'unknown' ? 'QR code inconnu' : 'Déjà dans la salle',
        r.participantId && byId.has(r.participantId) ? fullName(byId.get(r.participantId)!) : r.sample,
        r.agentName, r.stationId, METHODS[r.method],
      ]),
    ],
  };
}

export function fullWorkbook(s: EventSnapshot, exportedAt = new Date()): Sheet[] {
  return [summarySheet(s, exportedAt), byTypeSheet(s), attendanceSheet(s), participantsSheet(s), passagesSheet(s), refusalsSheet(s)];
}

/** Listes CSV : présents en ce moment, jamais venus. */
export function participantList(s: EventSnapshot, filter: 'inside' | 'never'): Cell[][] {
  const list = s.participants.filter((p) => (filter === 'inside' ? p.inside : p.entryCount === 0));
  return [
    ['Nom', 'Prénom', 'Type', 'Société', 'Email', 'Téléphone'],
    ...list.map((p) => [p.lastName, p.firstName, typeLabel(s, p.typeId), p.company, p.email, p.phone]),
  ];
}
