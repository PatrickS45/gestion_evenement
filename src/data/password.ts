// Empreinte irréversible des mots de passe pour le stockage local (NF-22).
// Côté serveur, c'est PocketBase qui s'en charge.

const ITERATIONS = 100_000;
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return hex(new Uint8Array(bits));
}

/** Empreinte au format `pbkdf2$itérations$sel$condensé`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${hex(salt)}$${await derive(password, salt, ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, digest] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !digest) return false;
  const candidate = await derive(password, unhex(salt), Number(iterations));
  // Comparaison en temps constant
  let diff = candidate.length ^ digest.length;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ (digest.charCodeAt(i) || 0);
  return diff === 0;
}

export const PASSWORD_MIN_LENGTH = 10;
