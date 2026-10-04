/**
 * Account settings that are NOT authentication.
 *
 * Everything that authenticated an account (password, TOTP/authenticator,
 * recovery codes, recovery questions, two-step login, password recovery) lived
 * in the retired `auth-api.ts` and is deliberately absent here. The only
 * credential on this platform is the security question + answer pair handled by
 * `identity-api.ts`.
 *
 * Identity is resolved server-side from the session cookie. There is no client
 * supplied identity to trust, and no role field a caller can assert.
 */

import type { Express, Request, Response } from 'express';
import type { IdentityView } from '../account/identity.ts';
import { validateFullName, ValidationError } from '../account/identity.ts';

export interface AccountApiOptions {
  readonly identities: {
    setFullName(id: string, fullName: string): Promise<boolean>;
    setPreferences(id: string, prefs: Record<string, string | number | boolean>): Promise<boolean>;
    get(id: string): IdentityView | null;
  };
}

/** Preferences a client is allowed to write. Anything else is ignored. */
const ALLOWED_PREFERENCES: Readonly<Record<string, 'string' | 'number' | 'boolean'>> = {
  theme: 'string',
  accent: 'string',
  density: 'string',
  reduceMotion: 'boolean',
  notificationsEnabled: 'boolean',
  telemetryEnabled: 'boolean',
};

function readString(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

export function registerAccountApi(app: Express, options: AccountApiOptions): void {
  const { identities } = options;

  // Display name only. The username, Gmail and security question are identity
  // facts established at signup and are not editable here — changing the
  // question would silently change how the account is proven.
  app.post('/api/account/profile', async (req: Request, res: Response) => {
    const identity = req.identity;
    if (identity === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    const requested = readString(req.body, 'fullName');
    try {
      const fullName = validateFullName(requested ?? '');
      if (!(await identities.setFullName(identity.id, fullName))) {
        res.status(409).json({ error: 'That name could not be applied.' });
        return;
      }
      res.json({ account: identities.get(identity.id) });
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'The profile could not be updated.' });
    }
  });

  app.get('/api/account/preferences', (_req: Request, res: Response) => {
    res.json({ preferences: {} });
  });

  app.post('/api/account/preferences', async (req: Request, res: Response) => {
    const identity = req.identity;
    if (identity === undefined) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (typeof req.body !== 'object' || req.body === null) {
      res.status(400).json({ error: 'Preferences must be an object.' });
      return;
    }
    // Allow-list: an unknown key is ignored rather than stored, so a client can
    // never write server-managed state (roles, ids) through this route.
    const sanitized: Record<string, string | number | boolean> = {};
    for (const [key, kind] of Object.entries(ALLOWED_PREFERENCES)) {
      const value = (req.body as Record<string, unknown>)[key];
      if (typeof value === kind) sanitized[key] = value as string | number | boolean;
    }
    await identities.setPreferences(identity.id, sanitized);
    res.json({ preferences: sanitized });
  });
}