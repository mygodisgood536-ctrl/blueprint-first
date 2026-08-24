/**
 * Discovery domain types for the single-pass Product Discovery Engine
 * (roadmap Level 1a).
 *
 * The engine accepts a Product Understanding Brief, obtains ONE structured
 * discovery response through the AI router, then PARSES, NORMALIZES and
 * VALIDATES it before anything becomes an artifact. AI output is never
 * trusted structurally: malformed, incomplete, duplicated or contradictory
 * responses are rejected with explicit errors.
 */

/** The raw user intent that starts everything. */
export interface ProductUnderstandingBrief {
  name: string;
  vision: string;
  targetUsers: readonly string[];
  constraints?: readonly string[];
}

/** Slug-style key used inside discovery responses; maps to artifact identity. */
export type DiscoveryKey = string;

export interface RawModule {
  key: DiscoveryKey;
  title: string;
  purpose: string;
}

export interface RawFeature {
  key: DiscoveryKey;
  moduleKey: DiscoveryKey;
  title: string;
  description: string;
}

export interface RawWorkflow {
  key: DiscoveryKey;
  title: string;
  steps: readonly string[];
}

export interface RawSection {
  key: DiscoveryKey;
  title: string;
  contentType: string;
}

export interface RawAction {
  key: DiscoveryKey;
  title: string;
  outcome: string;
}

export interface RawPageState {
  key: DiscoveryKey;
  name: string;
  whenVisible: string;
}

export interface RawValidation {
  /** Validation applies to an action within the same page. */
  targetKey: DiscoveryKey;
  message: string;
}

export interface RawPage {
  key: DiscoveryKey;
  moduleKey: DiscoveryKey;
  title: string;
  purpose: string;
  sections: readonly RawSection[];
  actions: readonly RawAction[];
  states: readonly RawPageState[];
  validations: readonly RawValidation[];
}

export interface RawRule {
  key: DiscoveryKey;
  statement: string;
}

export interface RawPermission {
  key: DiscoveryKey;
  resource: string;
  roles: readonly string[];
}

export interface RawEntityField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
}

export interface RawEntity {
  key: DiscoveryKey;
  name: string;
  fields: readonly RawEntityField[];
}

export interface RawApi {
  key: DiscoveryKey;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  purpose: string;
  requestEntityKey?: DiscoveryKey;
  responseEntityKey?: DiscoveryKey;
}

export interface RawIntegration {
  key: DiscoveryKey;
  name: string;
  direction: 'inbound' | 'outbound';
  purpose: string;
}

/** Exact schema a discovery response must satisfy (after JSON parsing). */
export interface RawDiscoveryResult {
  product: { name: string; summary: string };
  modules: readonly RawModule[];
  features: readonly RawFeature[];
  workflows: readonly RawWorkflow[];
  pages: readonly RawPage[];
  rules: readonly RawRule[];
  permissions: readonly RawPermission[];
  entities: readonly RawEntity[];
  apis: readonly RawApi[];
  integrations: readonly RawIntegration[];
}
