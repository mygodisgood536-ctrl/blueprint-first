/** Prompt rendering + JSON extraction for the discovery AI call. */

import type { ProductUnderstandingBrief } from './types.ts';

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
 * Extracts the JSON payload from an AI response, tolerating markdown code
 * fences. Anything that is not valid JSON after stripping throws SyntaxError
 * (caught by the engine as a failed run - never silently retried).
 */
export function extractJson(content: string): unknown {
  let text = content.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*\n/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(text);
}
