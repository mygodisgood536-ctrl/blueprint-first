/** Prompt rendering + JSON extraction for the discovery AI call. */

import type { ProductUnderstandingBrief } from './types.ts';

/**
 * The EXACT schema a discovery response must satisfy.
 *
 * The prompt has to carry this. A model cannot produce a schema it has never
 * been shown, and a system message that merely names "the agreed discovery
 * schema" leaves the model guessing - which is why a real, working provider
 * call could still end the stage as a failure.
 *
 * It is written as a VALID JSON template the model can copy verbatim, and
 * from the same field names the parser validates, so the two cannot drift
 * apart silently.
 */
const COLLECTIONS_SCHEMA = `{
  "modules": [{ "key": "", "title": "", "purpose": "" }],
  "features": [{ "key": "", "moduleKey": "", "title": "", "description": "" }],
  "workflows": [{ "key": "", "title": "", "steps": [] }],
  "pages": [{
    "key": "", "moduleKey": "", "title": "", "purpose": "",
    "sections": [{ "key": "", "title": "", "contentType": "" }],
    "actions": [{ "key": "", "title": "", "outcome": "" }],
    "states": [{ "key": "", "name": "", "whenVisible": "" }],
    "validations": [{ "targetKey": "", "message": "" }]
  }],
  "rules": [{ "key": "", "statement": "" }],
  "permissions": [{ "key": "", "resource": "", "roles": [] }],
  "entities": [{
    "key": "", "name": "",
    "fields": [{ "name": "", "type": "string|number|boolean|date", "required": false }]
  }],
  "apis": [{
    "key": "", "method": "GET|POST|PUT|DELETE", "path": "", "purpose": "",
    "requestEntityKey": "", "responseEntityKey": ""
  }],
  "integrations": [{ "key": "", "name": "", "direction": "inbound|outbound", "purpose": "" }]
}`;

/** The full discovery response template (product + every collection). */
export const DISCOVERY_RESPONSE_SCHEMA = `{
  "product": { "name": "", "summary": "" },
  "selfCheck": { "uncertainties": [] },${COLLECTIONS_SCHEMA.slice(1)}`;

/** Cluster A (understanding) template - the product only, no structure. */
export const DISCOVERY_UNDERSTANDING_SCHEMA = `{
  "product": { "name": "", "summary": "" },
  "domainProfile": "",
  "selfCheck": { "uncertainties": [] }
}`;

/** Cluster B (structural) template - every collection, no product. */
export const DISCOVERY_STRUCTURAL_SCHEMA = `{
  "selfCheck": { "uncertainties": [] },${COLLECTIONS_SCHEMA.slice(1)}`;

/** The Discovery Boss's independent reconstruction template. */
export const BOSS_EXPECTATION_SCHEMA = `{
  "productName": "",
  "features": [{ "key": "", "title": "" }],
  "workflows": [{ "key": "", "title": "" }],
  "pages": [{ "key": "", "title": "" }]
}`;

/** The system message that states the contract the model must meet. */
export const DISCOVERY_SYSTEM_PROMPT = [
  'You are a product discovery worker for a software engineering platform.',
  'You discover the complete product a user wants built, so that nothing has to be assumed later.',
  'Reply with ONLY a JSON object. No prose, no explanation, no markdown fence.',
  'Copy this template exactly and fill in every field with real, specific values:',
  DISCOVERY_RESPONSE_SCHEMA,
  'Use short kebab-case keys that are unique within their collection.',
  'Every moduleKey must name a module in "modules"; every targetKey must name an action in the same page.',
  'Include the pages, workflows, entities, apis, rules, permissions and integrations the product genuinely needs.',
].join('\n');

export function renderBrief(brief: ProductUnderstandingBrief): string {
  return [
    `Product name: ${brief.name}`,
    `Vision: ${brief.vision}`,
    `Target users: ${brief.targetUsers.join(', ')}`,
    brief.constraints?.length ? `Constraints: ${brief.constraints.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Extracts the JSON payload from a real model response.
 *
 * A real model rarely returns a bare JSON document: it wraps the payload in
 * prose ("Here is the JSON you asked for:"), in a markdown fence, or in both,
 * and sometimes appends a short remark after the closing brace. Parsing the
 * whole text with JSON.parse - as this once did - therefore failed on almost
 * every real response, which is why a genuine, working provider call could
 * still end the stage as a failure.
 *
 * The extraction is structural rather than hopeful: the first balanced JSON
 * value is located by scanning with string and escape awareness, so a brace
 * inside a string cannot truncate the payload. When the text genuinely holds no
 * JSON, a SyntaxError is still thrown and the stage still fails honestly.
 */
export function extractJson(content: string): unknown {
  const text = stripFences(content).trim();
  const direct = tryParse(text);
  if (direct.ok) return direct.value;

  // Locate a balanced JSON value inside the surrounding prose.
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = text.indexOf(open);
    if (start < 0) continue;
    const slice = balancedSlice(text, start, open, close);
    if (slice === null) continue;
    const parsed = tryParse(slice);
    if (parsed.ok) return parsed.value;
  }

  // Nothing balanced: fall back to the parser's own error so the failure names
  // the real problem instead of a generic one.
  return JSON.parse(text);
}

/** Removes a markdown code fence, if the whole response is wrapped in one. */
function stripFences(content: string): string {
  let text = content.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/```\s*$/, '').trim();
  }
  return text;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.length === 0) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Returns the balanced JSON value that starts at `start`, or null when the
 * text has no balanced value there. String literals and escapes are respected
 * so a `}` inside a string does not end the value early.
 */
function balancedSlice(text: string, start: number, open: string, close: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
