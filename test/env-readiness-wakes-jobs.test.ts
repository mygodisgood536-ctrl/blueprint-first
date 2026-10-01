/**
 * Regression: a job gated on a not-yet-READY environment must unblock
 * AUTOMATICALLY when that environment becomes READY.
 *
 * ARCHITECTURE 3.3 LAWS exercised here:
 *  - §83  DEPENDENCY-GATED SCHEDULING  (the gate is real and fail-closed)
 *  - §116 GOVERNED WAIT STATES        (a gate is a wait, never a hang)
 *  - §132 NO MANUAL CONTINUE FOR ORDINARY RECOVERY
 *
 * Environment provisioning is asynchronous, so a job enqueued immediately after
 * the environment request is legitimately BLOCKED at enqueue time. The defect
 * this test pins is that nothing re-ran the scheduling pass on the readiness
 * event, so the job stayed BLOCKED forever and only a user-driven retry could
 * free it - silently starving every worker queued behind that environment.
 *
 * The assertion is deliberately behavioural (through the real HTTP API and the
 * real durable stores) rather than a unit test of the wiring, so a regression
 * cannot hide behind a refactor that keeps the classes intact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkingServer,
  until,
  createProject,
  workingSignupEnrolledCookie as signupEnrolledCookie,
  workingTempDataDir as tempDataDir,
} from './working-harness.ts';

describe('environment readiness wakes gated jobs automatically', () => {
  it('a job BLOCKED on a provisioning environment runs itself once READY (no manual Continue)', async () => {
    const dir = await tempDataDir();
    const s = await buildWorkingServer(dir);
    try {
      const alice = await signupEnrolledCookie(s.url, 'wake_alice');
      const projectId = await createProject(s.url, alice, 'Readiness Wake');

      const created = await fetch(`${s.url}/api/working/environments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({ projectId, label: 'wake workspace', gitEnabled: true }),
      });
      assert.equal(created.status, 201);
      const envId = ((await created.json()) as { id: string }).id;

      // Enqueue IMMEDIATELY: provisioning has certainly not finished, so the
      // scheduler must (correctly) refuse to start the job.
      const enqueued = await fetch(`${s.url}/api/working/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice },
        body: JSON.stringify({
          projectId,
          stageKey: 'discovery',
          instruction: 'Re-prove readiness wakes this job.',
          envId,
        }),
      });
      assert.equal(enqueued.status, 201);
      const jobId = ((await enqueued.json()) as { id: string }).id;

      const job = async (): Promise<{ status: string }> =>
        (await fetch(`${s.url}/api/working/jobs/${jobId}`, { headers: { cookie: alice } }).then(
          (r) => r.json(),
        )) as { status: string };

      // §83: the gate is real - the job cannot start before readiness.
      const atEnqueue = await job();
      assert.notEqual(atEnqueue.status, 'RUNNING', 'a job must not run before its environment is READY');

      // §132: with no user action at all, the job must leave the queue and
      // reach a terminal state once the environment becomes READY.
      await until(async () => {
        const status = (await job()).status;
        return status === 'RUNNING' || status === 'COMPLETED' || status === 'FAILED';
      }, 90_000);

      const final = await job();
      assert.notEqual(
        final.status,
        'BLOCKED',
        'the job stayed BLOCKED after its environment became READY - gated work must resume automatically',
      );
    } finally {
      await s.close();
    }
  });
});