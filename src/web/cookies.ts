/**
 * Cookie parsing/serialization helpers (dependency-free).
 *
 * Nexona uses exactly one cookie: the opaque session token. It is set
 * HttpOnly + SameSite=Lax so it is unreachable from scripts and is not sent
 * on cross-site requests. The connection is plain HTTP in local deployments,
 * so `Secure` is deliberately not set there; a TLS deployment should set it.
 */

export interface CookieOptions {
  /** Max-Age in seconds. Omit for a session (browser-lifetime) cookie. */
  maxAge?: number;
  httpOnly?: boolean;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name.length === 0) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}