import crypto from 'node:crypto';
import { TOKEN_ALPHABET } from '../constants';

export function randomToken(length = 4): string {
  const bytes = crypto.randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i += 1) {
    // Rejection-free modulo is unnecessary for a 32 char alphabet over 256; bias is negligible.
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  while (out.length < length) out += TOKEN_ALPHABET[crypto.randomInt(TOKEN_ALPHABET.length)];
  return out;
}

export function humanId(prefix: string, length = 8): string {
  return `${prefix}-${randomToken(length)}`;
}

export function requestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function newOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

/** Constant-time string comparison that tolerates length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}