/**
 * Cline AI bridge (ARCHITECTURE 3.3 §77-§80, §185).
 *
 * Cline is the WORKER that performs engineering actions. It does NOT own an AI
 * provider system. It uses EXACTLY the provider, model and credential the
 * platform already resolved for that user through the project's single
 * authoritative AI configuration:
 *
 *   project AI configuration  ->  providerId + modelId (+ optional credential)
 *   ->  platform credential boundary  ->  real `cline auth`  ->  real `cline` run
 *
 * There is no Cline provider selector, no Cline model selector and no second
 * credential store. If the user changes the project's provider/model, the next
 * Cline run automatically uses the new selection, because the identity is
 * resolved per run from the project's authoritative configuration rather than
 * cached in Cline.
 *
 * Per-user isolation: each user's Cline profile lives in its own config/data
 * directory derived from their account, so one user's credential can never be
 * used for another user's run (LAW - LEAST PRIVILEGE EXECUTION).
 */

import { join } from 'node:path';
import { mkdir, rm, chmod } from 'node:fs/promises';
import { runShellCommand } from '../runtime/shell.ts';
import { runRealCline, type ClineRunRequest, type ClineRunResult } from './cline-runner.ts';
import type { ProviderManager } from '../ai/provider-manager.ts';

export interface ClineAiBinding {
  readonly providerId: string;
  readonly modelId: string;
  /** Cline's required `modelType/model` form. */
  readonly clineModel: string;
  /** Non-secret reference to the platform credential used (never the secret). */
  readonly credentialId: string | null;
}

export interface ClinePreparation {
  readonly ready: boolean;
  readonly binding: ClineAiBinding | null;
  readonly detail: string;
  readonly failureClass: 'none' | 'authentication' | 'provider' | 'cline' | 'unknown';
}

/** Root for the derived, regenerable per-user Cline profiles. */
export function clineRootDir(dataDir: string): string {
  return join(dataDir, 'cline-runtime');
}

/**
 * Cline's isolated profile directories for one user.
 *
 * SECURITY: the real Cline CLI persists the provider credential in PLAINTEXT in
 * its own `data/settings/providers.json` (verified against cline 3.0.65). That is
 * a property of the third-party CLI, not something the platform can change, so
 * the profile is deliberately kept OUTSIDE the platform's durable data
 * directory, in a per-user directory that is created owner-only and is never
 * written to evidence, events, logs or the Knowledge Graph. The platform's own
 * credential boundary remains the source of truth; the profile is a derived,
 * regenerable cache that can be deleted at any time.
 */
export function clineProfileDirs(root: string, ownerId: string): { config: string; data: string } {
  const safe = ownerId.replace(/[^A-Za-z0-9_-]/g, '_');
  const base = join(root, 'cline-profiles', safe);
  return { config: join(base, 'config'), data: join(base, 'data') };
}

/** Creates the per-user Cline profile with owner-only access where supported. */
export async function ensureClineProfile(dirs: { config: string; data: string }): Promise<void> {
  for (const dir of [dirs.config, dirs.data]) {
    await mkdir(dir, { recursive: true });
    if (process.platform !== 'win32') {
      await chmod(dir, 0o700).catch(() => undefined);
    }
  }
}

/** Removes a user's derived Cline profile (the credential cache). */
export async function clearClineProfile(dirs: { config: string; data: string }): Promise<void> {
  await rm(dirs.data, { recursive: true, force: true }).catch(() => undefined);
  await rm(dirs.config, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Resolves the user's AUTHORITATIVE platform AI identity and configures the real
 * Cline CLI to use exactly that provider, model and credential.
 *
 * Nothing is hard-coded and nothing is substituted: if the project has no
 * verified platform credential, the preparation fails honestly rather than
 * falling back to a different provider or model.
 */
export async function prepareClineAi(
  options: {
    providerManager: ProviderManager;
    /** Root for the derived, regenerable per-user Cline profile (kept out of platform data). */
    clineRoot: string;
    ownerId: string;
    providerId: string;
    modelId: string;
  },
): Promise<ClinePreparation> {
  const { providerManager, clineRoot, ownerId, providerId, modelId } = options;

  // Reuse the platform's OWN verification: the same call the platform makes
  // before any AI execution. If the platform cannot prove this provider/model is
  // usable for this user, Cline cannot use it either.
  const route = await providerManager.getExecutionRouterFor(ownerId, providerId, modelId);
  if (route === null) {
    return {
      ready: false,
      binding: null,
      detail:
        `The platform could not verify a working AI configuration for ${providerId}/${modelId} on this account. ` +
        'Cline uses the project\'s single authoritative AI configuration, so nothing was substituted and no Cline work was attempted.',
      failureClass: 'authentication',
    };
  }

  // The credential comes from the platform's own store, for this user only.
  const ref = providerManager.credentials.findByUserAndProvider(ownerId, providerId);
  const binding: ClineAiBinding = {
    providerId: route.providerId,
    modelId: route.modelId,
    // The provider is passed separately with `-p`, so the model must be the
    // platform's model id VERBATIM. Verified against cline 3.0.65: passing
    // `openrouter/vendor/model` together with `-p openrouter` makes Cline strip
    // the first segment and record `vendor/model`, which would silently change
    // which model runs. When no provider is supplied, Cline requires its own
    // `modelType/model` shape.
    clineModel: options.providerId.length > 0
      ? route.modelId
      : (route.modelId.includes('/') ? route.modelId : `opencode/${route.modelId}`),
    credentialId: ref?.id ?? null,
  };

  const dirs = clineProfileDirs(clineRoot, ownerId);
  await ensureClineProfile(dirs);
  const cli = process.env['CLINE_BIN']?.trim() || 'cline';
  const baseUrl = process.env['CLINE_BASE_URL']?.trim();

  // Configure the real CLI with the platform's provider identity. `-k` carries
  // the platform secret; the command string is never logged or persisted.
  const key = ref === null ? null : providerManager.credentials.resolveSecret(ownerId, ref.id);
  const authArgs = [
    'auth',
    '-p', binding.providerId,
    '-m', binding.clineModel,
    '--config', dirs.config,
    '--data-dir', dirs.data,
  ];
  if (key !== null) authArgs.push('-k', key);
  if (baseUrl !== undefined && baseUrl.length > 0) authArgs.push('-b', baseUrl);

  const auth = await runShellCommand(
    `${cli} ${authArgs.map(quoteForCmd).join(' ')}`,
    { timeoutMs: 120_000 },
  );
  if (auth.exitCode !== 0) {
    return {
      ready: false,
      binding: null,
      detail:
        'The real Cline CLI rejected the platform\'s AI configuration for this account: ' +
        `${redact(auth.stderr || auth.stdout).slice(0, 200)}. No Cline work was attempted.`,
      failureClass: 'authentication',
    };
  }

  return {
    ready: true,
    binding,
    detail: `The real Cline CLI is configured with the platform's AI configuration (${binding.clineModel}) for this account.`,
    failureClass: 'none',
  };
}

/**
 * Runs a real Cline task using the prepared platform AI configuration. The task
 * executes in the REAL environment workspace, and the genuine result is
 * returned for the platform to record as evidence.
 */
export async function runClineTask(
  request: Omit<ClineRunRequest, 'providerId' | 'modelId' | 'apiKey'> & {
    providerId: string;
    modelId: string;
    apiKey?: string;
    profileDirs: { config: string; data: string };
  },
): Promise<ClineRunResult> {
  const cli = process.env['CLINE_BIN']?.trim() || 'cline';
  const withProfile = await runShellCommand(
    `${cli} --version --config ${quoteForCmd(request.profileDirs.config)} --data-dir ${quoteForCmd(request.profileDirs.data)}`,
    { timeoutMs: 60_000 },
  );
  if (withProfile.exitCode !== 0) {
    // The profile directory is not usable: report honestly rather than
    // silently running with some other profile.
    return {
      ok: false,
      exitCode: withProfile.exitCode,
      stdout: '',
      stderr: redact(withProfile.stderr),
      durationMs: 0,
      timedOut: false,
      aborted: false,
      binding: request.binding,
      sessionId: null,
      failureClass: 'cline',
      detail: 'The isolated Cline profile for this account is not usable, so no Cline work was attempted.',
    };
  }
  return runRealCline({
    ...request,
    providerId: request.providerId,
    modelId: request.modelId,
  });
}

function quoteForCmd(value: string): string {
  if (process.platform === 'win32') {
    return /\s/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function redact(text: string): string {
  return text.replace(/(sk-[A-Za-z0-9_-]{6,}|dtn_[A-Za-z0-9_-]{6,})/g, '[redacted]').replace(/\s+/g, ' ').trim();
}
