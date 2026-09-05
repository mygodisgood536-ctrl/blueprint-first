/**
 * RFC 6238 TOTP (time-based one-time password) for the NEXORA authenticator.
 *
 * Implemented directly on node:crypto (HMAC-SHA-1) so the platform gains a real
 * authenticator without new dependencies. Secrets are base32 (RFC 4648) so they
 * can be entered manually into any authenticator app (Google Authenticator,
 * Aegis, 1Password) via the standard otpauth:// provisioning URI.
 *
 * Verification allows a ±1 step clock window. Codes are compared with a
 * timing-safe equality to avoid leaking the expected value.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encodes bytes as unpadded RFC 4648 base32. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Decodes unpadded RFC 4648 base32; returns null for invalid input. */
export function base32Decode(input: string): Buffer | null {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean.length === 0 || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generates a fresh 160-bit TOTP secret as base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP over HMAC-SHA-1 with dynamic truncation. */
function hotp(secretBytes: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secretBytes).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

/** Current TOTP code for a base32 secret (30-second step, 6 digits). */
export function totpNow(secretBase32: string, atMs: number = Date.now()): string | null {
  const secret = base32Decode(secretBase32);
  if (secret === null) return null;
  return hotp(secret, Math.floor(atMs / 30_000));
}

/** Timing-safe comparison of equal-length codes. */
function codesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verifies a 6-digit code against the current time with a ±1 step window.
 * Returns false (never throws) for malformed secrets or codes.
 */
export function verifyTotp(secretBase32: string, code: string, atMs: number = Date.now()): boolean {
  const trimmed = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(trimmed)) return false;
  const secret = base32Decode(secretBase32);
  if (secret === null) return false;
  const counter = Math.floor(atMs / 30_000);
  for (const drift of [-1, 0, 1]) {
    const candidate = counter + drift;
    if (candidate < 0) continue;
    if (codesMatch(hotp(secret, candidate), trimmed)) return true;
  }
  return false;
}

/**
 * otpauth:// provisioning URI for authenticator-app enrollment.
 *
 * Per the Key URI Format (Google Authenticator) the label is
 * `{issuer}:{account_name}` with a LITERAL colon separator; only the individual
 * parts are percent-encoded. `otpauth://totp/NEXORA%3Aada` is NOT parsed
 * correctly by authenticator apps, so the colon must never be encoded.
 */
export function otpauthUrl(secretBase32: string, accountName: string, issuer = 'NEXORA'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}