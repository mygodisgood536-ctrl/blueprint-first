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
  it('deliberates through five independent attributable seats', async () => {
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

    // Five genuinely separate execution paths hit the router.
    assert.equal(services.router.completedSelections.filter((s) => s.taskType === 'REVIEW').length, 5);
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
    // Every seat received the same subject independently; all five object.
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
});