/**
 * Central error hierarchy for the Blueprint-First platform.
 *
 * Every subsystem throws typed errors carrying a stable machine-readable
 * `code` so that orchestration, verification, and CLI layers can react to
 * specific failure classes without string matching.
 */

export class BlueprintError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Artifact ID is malformed, non-canonical, or uses an unknown type/phase. */
export class InvalidArtifactIdError extends BlueprintError {
  constructor(message: string) {
    super('INVALID_ARTIFACT_ID', message);
  }
}

/** A lifecycle status transition is not permitted by the state machine. */
export class InvalidTransitionError extends BlueprintError {
  constructor(
    from: string,
    to: string,
    legal: readonly string[],
  ) {
    super(
      'INVALID_TRANSITION',
      `Illegal status transition ${from} -> ${to}. Legal transitions from ${from}: ${
        legal.length > 0 ? legal.join(', ') : '(none - terminal status)'
      }`,
    );
  }
}

/** Attempted to append an artifact whose ID already exists in the store. */
export class DuplicateArtifactError extends BlueprintError {
  constructor(id: string) {
    super('DUPLICATE_ARTIFACT', `Artifact ${id} already exists.`);
  }
}

export class ArtifactNotFoundError extends BlueprintError {
  constructor(id: string) {
    super('ARTIFACT_NOT_FOUND', `Artifact ${id} does not exist.`);
  }
}

/** Optimistic-concurrency conflict: stored version does not match expected. */
export class VersionConflictError extends BlueprintError {
  constructor(id: string, expectedVersion: number, actualVersion: number) {
    super(
      'VERSION_CONFLICT',
      `Artifact ${id} is at version ${actualVersion}; update expected version ${expectedVersion}.`,
    );
  }
}

export class GraphIntegrityError extends BlueprintError {
  constructor(message: string) {
    super('GRAPH_INTEGRITY', message);
  }
}

export class ConfigurationError extends BlueprintError {
  constructor(message: string) {
    super('CONFIGURATION', message);
  }
}

export class RoutingError extends BlueprintError {
  constructor(message: string) {
    super('AI_ROUTING', message);
  }
}

export class ProviderExhaustedError extends BlueprintError {
  constructor(providerId: string) {
    super(
      'PROVIDER_EXHAUSTED',
      `Scripted provider "${providerId}" received a request but its rules and queue are exhausted.`,
    );
  }
}

export class ProviderHttpError extends BlueprintError {
  constructor(status: number, bodyPreview: string) {
    super(
      'PROVIDER_HTTP_ERROR',
      `AI provider endpoint returned HTTP ${status}. Body preview: ${bodyPreview}`,
    );
  }
}

/**
 * Raised when verification independence would be violated, e.g. an actor
 * attempting to certify work it produced itself. The architecture forbids
 * workers certifying their own output.
 */
export class SelfCertificationError extends BlueprintError {
  constructor(message: string) {
    super('SELF_CERTIFICATION_FORBIDDEN', message);
  }
}

/**
 * Raised when a Definition-of-Complete (§0.17) gate transition is illegal:
 * skipping states, moving backwards, or advancing without the governing gate.
 */
export class DocStateError extends BlueprintError {
  constructor(message: string) {
    super('DOC_STATE', message);
  }
}

/** Raised when a scaffolded engine (planned for a later roadmap level) is invoked. */
export class EngineNotImplementedError extends BlueprintError {
  constructor(engineName: string, targetLevel: string) {
    super(
      'ENGINE_NOT_IMPLEMENTED',
      `${engineName} is scaffolded only; full implementation is planned for roadmap level ${targetLevel}.`,
    );
  }
}
