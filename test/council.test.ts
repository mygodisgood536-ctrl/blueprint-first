import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReasoningCouncil, COUNCIL_SEATS } from '../src/council/council.ts';
import { DiscoveryParseError } from '../src/discovery/errors.ts';
import { makeServices } from './helpers/test-services.ts';

const INPUT = {
  subject: 'BLUEPRINT-0001',
  question: 'Is this blueprint complete and internally consistent?',
  contextSummary: 'Full chain stored: discovery department -> design -> build.',
  artifactIds: ['BLUEPRINT-0001'],
};

describe('multi-perspective reasoning council', () => {
  it('deliberates through independent attributable seats (§0.21 roster)', async () => {
    const services = makeServices();
    const deliberation = await new ReasoningCouncil(services).deliberate(INPUT);

    assert.equal(deliberation.verdict, 'endorsed');
    assert.equal(deliberation.seats.length, COUNCIL_SEATS.length);
    assert.deepEqual(
      deliberation.seats.map((s) => s.seatId),
      COUNCIL_SEATS.map((s) => s.id),
    );

    // Every seat is independently attributable and evidence-anchored.
    for (const seat of deliberation.seats) {
      assert.match(seat.modelId, /^scripted-deterministic-v1$/);
      assert.match(seat.responseSha256, /^[0-9a-f]{64}$/);
      assert.ok(seat.evidenceId !== undefined);
    }
    const evidenceIds = new Set(deliberation.seats.map((s) => s.evidenceId));
    assert.equal(evidenceIds.size, deliberation.seats.length);

    // One genuinely separate execution path per seat on the router.
    assert.equal(
      services.router.completedSelections.filter((s) => s.taskType === 'REVIEW').length,
      COUNCIL_SEATS.length,
    );
  });

  it('reconciles objections deterministically instead of averaging them away', async () => {
    const services = makeServices({
      councilResponse: () =>
        JSON.stringify({
          stance: 'object',
          findings: [
            {
              severity: 'objection',
              statement: 'No error path is specified for deleting the last task.',
              artifactIds: ['BLUEPRINT-0001'],
            },
          ],
          uncertainties: [],
        }),
    });
    const deliberation = await new ReasoningCouncil(services).deliberate(INPUT);
    assert.equal(deliberation.verdict, 'objected');
    // Every seat received the same subject independently; all roster seats object.
    assert.equal(deliberation.objections.length, COUNCIL_SEATS.length);
    assert.match(deliberation.objections[0]?.statement ?? '', /error path/);
  });

  it('records concerns as endorsed-with-concerns', async () => {
    const services = makeServices({
      councilResponse: () =>
        JSON.stringify({
          stance: 'concern',
          findings: [{ severity: 'concern', statement: 'Navigation labels need review.' }],
          uncertainties: ['Whether deep linking matters.'],
        }),
    });
    const deliberation = await new ReasoningCouncil(services).deliberate(INPUT);
    assert.equal(deliberation.verdict, 'endorsed-with-concerns');
    assert.equal(deliberation.concerns.length, COUNCIL_SEATS.length);
    assert.equal(deliberation.seats.every((s) => s.stance === 'concern'), true);
  });

  it('rejects malformed seat responses with seat attribution', async () => {
    const services = makeServices({
      councilResponse: () => JSON.stringify({ stance: 'maybe', findings: [] }),
    });
    await assert.rejects(
      () => new ReasoningCouncil(services).deliberate(INPUT),
      (error: unknown) =>
        error instanceof DiscoveryParseError &&
        /council seat product-manager/.test(error.message),
    );
  });

  it('materializes artifact-scoping findings with department discipline (§0.21)', async () => {
    const services = makeServices({
      councilResponse: () =>
        JSON.stringify({
          stance: 'object',
          findings: [
            {
              severity: 'objection',
              statement: 'No error path is specified for deleting the last task.',
              artifactIds: ['FEATURE-0001'],
            },
          ],
          uncertainties: [],
        }),
    });
    await new ReasoningCouncil(services).deliberate(INPUT);
    const findings = (await services.store.list()).filter((a) => a.type === 'FINDING');
    // One FINDING artifact per independent seat, each with the same discipline
    // as a Boss delta / Red Team finding: artifact ID, target dependency,
    // kind metadata, and an evidence anchor.
    assert.equal(findings.length, COUNCIL_SEATS.length);
    const first = findings[0]!;
    assert.equal(first.attributes['findingKind'], 'council-finding');
    assert.equal(first.attributes['severity'], 'objection');
    assert.equal(first.attributes['seatId'], COUNCIL_SEATS[0]?.id);
    assert.equal(first.attributes['subject'], INPUT.subject);
    assert.deepEqual(first.dependencies, ['FEATURE-0001']);
    assert.match(String(first.title), /Council Product Manager objection/);
    // Each finding is anchored to its seat's independent response evidence.
    for (const finding of findings) {
      const evidenceId = finding.attributes['evidenceId'];
      assert.ok(typeof evidenceId === 'string' && evidenceId.length > 0);
    }
  });
});