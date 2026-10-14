// Déclarations minimales de l'environnement JavaScript des hooks PocketBase (goja),
// limitées à ce que server/src utilise. Référence complète : pb_data/types.d.ts.

interface PbCollection {
  id: string;
  name: string;
}

interface PbRecord {
  id: string;
  collection(): PbCollection;
  get(key: string): unknown;
  getString(key: string): string;
  getBool(key: string): boolean;
  getInt(key: string): number;
  getStringSlice(key: string): ArrayLike<string>;
  set(key: string, value: unknown): void;
  setPassword(password: string): void;
  email(): string;
}

interface PbApp {
  findCollectionByNameOrId(nameOrId: string): PbCollection;
  findRecordById(collection: string, id: string): PbRecord;
  findFirstRecordByData(collection: string, key: string, value: unknown): PbRecord;
  findRecordsByFilter(collection: string, filter: string, sort: string, limit: number, offset: number, params?: Record<string, unknown>): PbRecord[];
  findAuthRecordByEmail(collection: string, email: string): PbRecord;
  save(record: PbRecord): void;
  delete(record: PbRecord): void;
  runInTransaction(fn: (txApp: PbApp) => void): void;
}

interface PbRequestEvent {
  auth: PbRecord | null;
  request: { pathValue(name: string): string };
  requestInfo(): { body: Record<string, unknown> };
  json(status: number, data: unknown): void;
  noContent(status: number): void;
}

declare const $app: PbApp;
declare const $security: { randomStringWithAlphabet(length: number, alphabet: string): string };

// Valeur globale `Record` des hooks ; le type utilitaire Record<K, V> de TypeScript reste disponible
declare const Record: { new (collection: PbCollection, data?: Record<string, unknown>): PbRecord };
declare class ApiError { constructor(status: number, message: string, data?: unknown) }
