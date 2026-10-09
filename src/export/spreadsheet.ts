// Écriture de fichiers tableur : CSV et classeur Excel (.xlsx).
// Aucune cellule n'est jamais interprétée comme une formule (F-75).
import { strToU8, zipSync } from 'fflate';

/** Valeur de cellule : texte, nombre, pourcentage (0–1) ou vide. */
export type Cell = string | number | null | { percent: number } | { header: string };

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Largeur des colonnes, en nombre de caractères. */
  widths?: number[];
}

// ─── CSV ─────────────────────────────────────────────────────────────

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^[+-]?[\d\s.,()]*$/;

/** Neutralise une cellule qui serait lue comme une formule ; les numéros de téléphone restent intacts. */
export function safeText(value: string): string {
  return FORMULA_START.test(value) && !NUMERIC.test(value) ? `'${value}` : value;
}

function csvValue(cell: Cell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') return String(cell).replace('.', ',');
  if (typeof cell === 'object') return 'percent' in cell ? `${Math.round(cell.percent * 100)} %` : cell.header;
  return safeText(cell);
}

/** CSV au format attendu par Excel en français : point-virgule, UTF-8 avec BOM. */
export function toCsv(rows: Cell[][]): Blob {
  const text = rows
    .map((r) => r.map((c) => `"${csvValue(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  return new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
}

// ─── XLSX ────────────────────────────────────────────────────────────

const xml = (s: string) => s
  // Caractères de contrôle interdits en XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnLetter(index: number): string {
  let n = index + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Styles : 0 normal, 1 en-tête (gras sur fond gris), 2 pourcentage
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="0%"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE4E7EC"/></patternFill></fill></fills>'
  + '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
  + '<cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs>'
  + '</styleSheet>';

function cellXml(cell: Cell, ref: string): string {
  if (cell === null || cell === '') return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? `<c r="${ref}"><v>${cell}</v></c>` : '';
  if (typeof cell === 'object' && 'percent' in cell) return `<c r="${ref}" s="2"><v>${cell.percent}</v></c>`;
  const [text, style] = typeof cell === 'object' ? [cell.header, ' s="1"'] : [cell, ''];
  // Texte en ligne : Excel ne l'évalue jamais comme formule
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const firstIsHeader = sheet.rows[0]?.some((c) => c !== null && typeof c === 'object' && 'header' in c);
  const freeze = firstIsHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';
  const data = sheet.rows
    .map((row, r) => `<row r="${r + 1}">${row.map((c, i) => cellXml(c, `${columnLetter(i)}${r + 1}`)).join('')}</row>`)
    .join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${data}</sheetData></worksheet>`;
}

/** Nom d'onglet valide pour Excel : 31 caractères, sans \ / ? * [ ] : */
function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille';
}

export function toXlsx(sheets: Sheet[]): Blob {
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>`
      + sheets.map((s, i) => `<sheet name="${xml(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s)); });
  return new Blob([zipSync(files, { level: 6 })], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
