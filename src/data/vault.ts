// Coffre chiffré de l'appareil (F-60) : copie locale des participants, file d'envoi hors ligne, session.
// Chiffrement AES-GCM 256 bits avec une clé non exportable, créée sur l'appareil et conservée à côté
// des données : le contenu est illisible pour qui copie les fichiers du navigateur, mais pas pour un
// code qui s'exécuterait dans l'application elle-même. Vider le coffre détruit aussi la clé.

/** Stockage brut sous-jacent : valeurs clonables (clé de chiffrement comprise). */
export interface VaultBackend {
  get(name: string): Promise<unknown>;
  set(name: string, value: unknown): Promise<void>;
  delete(name: string): Promise<void>;
  clear(): Promise<void>;
}

const KEY_NAME = '__key';

interface Sealed { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }

export class Vault {
  private key: Promise<CryptoKey> | null = null;

  constructor(private backend: VaultBackend) {}

  private cryptoKey(): Promise<CryptoKey> {
    this.key ??= (async () => {
      const existing = await this.backend.get(KEY_NAME);
      if (existing) return existing as CryptoKey;
      const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await this.backend.set(KEY_NAME, created);
      return created;
    })();
    this.key.catch(() => { this.key = null; });
    return this.key;
  }

  async get<T>(name: string): Promise<T | null> {
    const sealed = await this.backend.get(name) as Sealed | undefined;
    if (!sealed) return null;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, await this.cryptoKey(), sealed.data);
      return JSON.parse(new TextDecoder().decode(plain)) as T;
    } catch {
      return null; // clé perdue ou donnée altérée : comme absente
    }
  }

  async set(name: string, value: unknown): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.cryptoKey(), new TextEncoder().encode(JSON.stringify(value)));
    await this.backend.set(name, { iv, data } satisfies Sealed);
  }

  delete(name: string): Promise<void> {
    return this.backend.delete(name);
  }

  /** Efface toutes les données et la clé. */
  async clear(): Promise<void> {
    this.key = null;
    await this.backend.clear();
  }
}

export function memoryBackend(): VaultBackend & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    raw,
    get: async (name) => raw.get(name),
    set: async (name, value) => { raw.set(name, value); },
    delete: async (name) => { raw.delete(name); },
    clear: async () => raw.clear(),
  };
}

/** Coffre du navigateur : base IndexedDB propre à l'application. */
export function indexedDbBackend(dbName = 'event-control-vault'): VaultBackend {
  const STORE = 'vault';
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.catch(() => { db = null; });
    return db;
  };
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const tx = (await open()).transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (name) => run('readonly', (s) => s.get(name)),
    set: async (name, value) => { await run('readwrite', (s) => s.put(value, name)); },
    delete: async (name) => { await run('readwrite', (s) => s.delete(name)); },
    clear: async () => { await run('readwrite', (s) => s.clear()); },
  };
}
