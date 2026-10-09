// Identifiants et secrets, toujours tirés d'un générateur cryptographique.

/** Jeton de QR code : 160 bits aléatoires, en hexadécimal (F-25). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId(): string {
  return crypto.randomUUID();
}

// Code d'accès agents (F-04) : lisible et facile à dicter, sans 0/O ni 1/I/L
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newAccessCode(length = 8): string {
  const max = 256 - (256 % CODE_ALPHABET.length);
  let code = '';
  while (code.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length))) {
      if (b < max && code.length < length) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}
