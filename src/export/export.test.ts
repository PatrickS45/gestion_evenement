import { strFromU8, unzipSync } from 'fflate';
import { safeText, toCsv, toXlsx } from './spreadsheet';
import { fullWorkbook, participantList } from './reports';
import { makeEvent, makeParticipant, makePassage } from '../domain/fixtures';
import type { EventSnapshot } from '../data/store';

const at = (hhmm: string) => `2027-03-11T${hhmm}:00+01:00`;

const snapshot: EventSnapshot = {
  event: makeEvent(),
  participants: [
    makeParticipant({ id: 'a', lastName: '=HYPERLINK("x")', firstName: 'Eve', typeId: 'exposant', company: 'ACME', phone: '+33 6 12 34 56 78', inside: true, entryCount: 1, firstEntryAt: at('09:00') }),
    makeParticipant({ id: 'b', lastName: 'Roy', firstName: 'Marc', typeId: 'magasin', company: 'Roy & Fils' }),
  ],
  passages: [makePassage('a', 'in', at('09:00'), { typeId: 'exposant' })],
  refusals: [{ id: 'r1', eventId: 'evt', reason: 'unknown', at: at('09:05'), agentId: 'x', agentName: 'Agent', stationId: 'entree', method: 'camera', participantId: null, sample: 'faux' }],
};

async function blobText(b: Blob) { return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await b.arrayBuffer()); }

describe('protection contre les formules', () => {
  it('neutralise les débuts de formule mais pas les numéros de téléphone', () => {
    expect(safeText('=1+1')).toBe("'=1+1");
    expect(safeText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeText('+33 6 12 34 56 78')).toBe('+33 6 12 34 56 78');
    expect(safeText('-12,5')).toBe('-12,5');
    expect(safeText('Durand')).toBe('Durand');
  });
});

describe('CSV', () => {
  it('point-virgule, BOM UTF-8, guillemets doublés', async () => {
    const text = await blobText(toCsv([['Nom', 'Note'], ['Dupont "Jo"; fils', '=2*3'], [12.5, { percent: 0.5 }]]));
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe('"Nom";"Note"\r\n"Dupont ""Jo""; fils";"\'=2*3"\r\n"12,5";"50 %"');
  });

  it('liste des présents et des jamais venus', () => {
    expect(participantList(snapshot, 'inside').slice(1).map((r) => r[1])).toEqual(['Eve']);
    expect(participantList(snapshot, 'never').slice(1).map((r) => r[1])).toEqual(['Marc']);
  });
});

describe('classeur Excel', () => {
  it('produit une archive valide avec les six onglets', async () => {
    const blob = toXlsx(fullWorkbook(snapshot, new Date('2027-03-11T12:00:00Z')));
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const workbook = strFromU8(files['xl/workbook.xml']!);
    for (const name of ['Synthèse', 'Par type', 'Affluence', 'Participants', 'Passages', 'Refus']) {
      expect(workbook).toContain(`name="${name}"`);
    }
    expect(Object.keys(files).filter((f) => f.startsWith('xl/worksheets/'))).toHaveLength(6);
  });

  it('écrit le texte en ligne et échappé : aucune formule possible', async () => {
    const files = unzipSync(new Uint8Array(await toXlsx(fullWorkbook(snapshot)).arrayBuffer()));
    const participants = strFromU8(files['xl/worksheets/sheet4.xml']!);
    expect(participants).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>');
    expect(participants).not.toContain('<f>');
    expect(participants).toContain('Roy &amp; Fils');
  });

  it('calcule la synthèse et la répartition par type', () => {
    const [summary, byType] = fullWorkbook(snapshot);
    expect(summary!.rows).toContainEqual(['Inscrits', 2]);
    expect(summary!.rows).toContainEqual(['Venus au moins une fois', 1]);
    expect(byType!.rows.find((r) => r[0] === 'Exposant')).toEqual(['Exposant', 1, 1, { percent: 1 }, 1, 1]);
  });
});
