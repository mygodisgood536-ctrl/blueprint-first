/**
 * Scaffold marker for engines planned at later roadmap stages.
 *
 * These classes exist so the architecture's seams are visible and testable
 * TODAY: calling a scaffolded engine throws EngineNotImplementedError with its
 * name, roadmap level and status - it can never silently pretend to work
 * (no fake buttons, no fabricated outputs).
 */

import { EngineNotImplementedError } from '../core/errors.ts';

export interface EngineDescriptor {
  name: string;
  targetLevel: string;
  status: 'scaffolded' | 'partial' | 'planned';
}

export class ScaffoldedEngine {
  readonly descriptor: EngineDescriptor;

  constructor(descriptor: EngineDescriptor) {
    this.descriptor = descriptor;
  }

  protected refuse(operation: string): never {
    throw new EngineNotImplementedError(
      `${this.descriptor.name}.${operation}`,
      this.descriptor.targetLevel,
    );
  }
}
