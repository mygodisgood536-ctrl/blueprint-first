/**
 * Vercel serverless entry point for the Blueprint-First control plane.
 *
 * V.8 — Product Delivery / Hosting Direction: the managed control plane (API,
 * authentication, persistence, orchestration, durable workflows, events and the
 * user-facing application) runs on Vercel, while Daytona remains the real project
 * execution environment. The user's computer never has to be powered on for the
 * production platform to work.
 *
 * The Express application built by `buildServer()` is exported as the function
 * handler. One instance is memoized per warm container; a cold start simply
 * rebuilds it from durable state (Neon), so no project state is lost between
 * invocations.
 *
 * Secrets are read from the server-side environment only. Nothing in this file
 * reads, logs or forwards a secret to the browser.
 */

import { buildServer } from '../src/web/server.ts';
import type { Server } from 'node:http';
import type { Express } from 'express';

type BuiltServer = Awaited<ReturnType<typeof buildServer>>;

interface Memoized {
  app?: Express;
  built?: BuiltServer;
  building?: Promise<BuiltServer>;
}

const memo: Memoized = globalThis as unknown as Memoized;

/** Builds (once per warm container) and returns the control-plane app. */
export async function getApp(): Promise<{ app: Express; built: BuiltServer }> {
  if (memo.app !== undefined && memo.built !== undefined) {
    return { app: memo.app, built: memo.built };
  }
  memo.building ??= buildServer().then((built) => {
    memo.built = built;
    memo.app = built.app;
    memo.building = undefined;
    return built;
  });
  const built = await memo.building;
  return { app: built.app, built };
}

/** Vercel Node runtime handler. */
export default async function handler(req: unknown, res: unknown): Promise<void> {
  const { app } = await getApp();
  (app as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}

// A long-lived local process (`npm run dev`) starts the supervisor's interval
// loops; a serverless invocation must not, or every request would spawn a
// competing supervisor. The scheduled watchdog drives supervision instead.
export const config = { api: { bodyParser: false }, maxDuration: 300 };

export type { Server };