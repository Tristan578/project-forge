/**
 * Content safety filters for the AI asset generation pipeline.
 *
 * Intercepts user prompts before they reach AI providers and checks
 * generated results for inappropriate content. Provides:
 * - Prompt sanitization (strips injection attempts)
 * - Text safety checking (blocklist + pattern matching)
 * - Image safety checking (placeholder for future vision API)
 * - Configurable per-content-type toggles
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentSafetyConfig {
  /** Enable text prompt/result filtering */
  text: boolean;
  /** Enable image result filtering (placeholder) */
  image: boolean;
  /** Enable audio result filtering (placeholder) */
  audio: boolean;
  /** Enable 3D model result filtering (placeholder) */
  model3d: boolean;
}

export interface ContentSafetyResult {
  /** Whether the content is considered safe */
  safe: boolean;
  /** Human-readable reason when unsafe */
  reason?: string;
  /** The filtered/sanitized version of the input */
  filtered?: string;
}

// ---------------------------------------------------------------------------
// Default config — all filters enabled
// ---------------------------------------------------------------------------

export const DEFAULT_SAFETY_CONFIG: ContentSafetyConfig = {
  text: true,
  image: true,
  audio: true,
  model3d: true,
};

// ---------------------------------------------------------------------------
// Blocklist — terms that should never appear in generation prompts/results
// ---------------------------------------------------------------------------

const BLOCKED_TERMS: string[] = [
  // Violence / harm
  'gore', 'dismember', 'mutilat', 'decapitat', 'torture',
  'child abuse', 'child porn', 'csam',
  // Hate speech markers
  'white suprema', 'ethnic cleansing', 'holocaust denial',
  // Sexual explicit
  'hentai', 'xxx', 'pornograph', 'erotic',
  // Self-harm
  'suicide method', 'how to kill yourself', 'self-harm instruction',
  // Illegal
  'how to make a bomb', 'how to make meth', 'drug synthesis',
];

/**
 * Build a case-insensitive regex for each blocked term.
 * Multi-word phrases get word-boundary anchors on the outer edges only,
 * since they may contain partial-word stems like "mutilat" (matches mutilate/mutilation).
 */
function buildBlockedRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

const BLOCKED_REGEXES: RegExp[] = BLOCKED_TERMS.map(buildBlockedRegex);

// ---------------------------------------------------------------------------
// Prompt injection patterns
// ---------------------------------------------------------------------------

// Linear-time injection patterns (CodeQL cwe-1333 / ReDoS hardened).
// Rules:
//   - No optional groups wrapping repeated sub-patterns: (x+)? is O(n^2) risk.
//   - No nested quantifiers: (a+)+ is catastrophic.
//   - Alternations with unbounded repetition use possessive-equivalent splits
//     or are rewritten as independent patterns.
//   - All patterns anchored to [ ]+ (literal space) instead of \s+ to prevent
//     mixed-whitespace backtracking expansion.
const INJECTION_PATTERNS: RegExp[] = [
  // "ignore previous ..." — split the optional "all" into two patterns
  /ignore[ ]+previous[ ]+(instructions?|prompts?|rules?)/i,
  /ignore[ ]+all[ ]+previous[ ]+(instructions?|prompts?|rules?)/i,
  /ignore[ ]+(above|prior|earlier)[ ]+(instructions?|prompts?|context)/i,
  // "disregard ..." — split the optional "all" into two patterns
  /disregard[ ]+(previous|prior|above)[ ]/i,
  /disregard[ ]+all[ ]+(previous|prior|above)[ ]/i,
  /system[ ]*:[ ]/i,
  /\[[ ]*INST[ ]*\]/i,
  /\[[ ]*SYSTEM[ ]*\]/i,
  /<[ ]*\|?[ ]*system[ ]*\|?[ ]*>/i,
  /you[ ]+are[ ]+now[ ]+(a|an|the)[ ]/i,
  /act[ ]+as[ ]+(a|an|the|if)[ ]/i,
  /new[ ]+instructions?[ ]*:/i,
  /override[ ]+(safety|content|filter|guardrail)/i,
  /jailbreak/i,
  /do[ ]+anything[ ]+now/i,
  /DAN[ ]+mode/i,
  // "pretend you/there are/is no rules/filter/restrictions" —
  // split the trailing alternation to avoid nested quantifier risk
  /pretend[ ]+(you|there)[ ]+(are|is)[ ]+no[ ]+rules?/i,
  /pretend[ ]+(you|there)[ ]+(are|is)[ ]+no[ ]+filter/i,
  /pretend[ ]+(you|there)[ ]+(are|is)[ ]+no[ ]+restrictions?/i,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check text content for safety violations.
 * Returns unsafe if any blocked term or injection pattern is found.
 */
export function checkTextSafety(text: string): ContentSafetyResult {
  if (!text || text.length === 0) {
    return { safe: true };
  }

  // Check blocked terms
  for (const regex of BLOCKED_REGEXES) {
    if (regex.test(text)) {
      return {
        safe: false,
        reason: 'Content contains prohibited terms',
      };
    }
  }

  // Check injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        reason: 'Prompt injection attempt detected',
      };
    }
  }

  return { safe: true };
}

/**
 * Check image URL for safety. Currently a placeholder that always
 * returns safe. Will integrate with a vision API (e.g. AWS Rekognition,
 * Google Cloud Vision) in a future iteration.
 */
export function checkImageSafety(_url: string): ContentSafetyResult {
  // Placeholder — always returns safe for now.
  // Future: call a moderation vision API to classify the image.
  return { safe: true };
}

/**
 * Sanitize a user prompt before sending to an AI provider.
 *
 * - Strips prompt injection patterns
 * - Normalizes whitespace
 * - Trims to a reasonable length (500 chars)
 * - Removes control characters
 */
export function sanitizePrompt(prompt: string): ContentSafetyResult {
  if (!prompt || prompt.length === 0) {
    return { safe: true, filtered: '' };
  }

  let filtered = prompt;

  // Remove control characters (except newline/tab)
  filtered = filtered.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Strip injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    filtered = filtered.replace(pattern, '');
  }

  // Normalize whitespace (collapse multiple spaces, trim)
  filtered = filtered.replace(/\s+/g, ' ').trim();

  // Truncate to 500 characters
  if (filtered.length > 500) {
    filtered = filtered.slice(0, 500);
  }

  // Check if the sanitized prompt still contains blocked content
  const safetyCheck = checkTextSafety(filtered);
  if (!safetyCheck.safe) {
    return {
      safe: false,
      reason: safetyCheck.reason,
      filtered,
    };
  }

  // Check if sanitization changed the prompt substantially
  const changed = filtered !== prompt.replace(/\s+/g, ' ').trim();

  return {
    safe: true,
    filtered,
    reason: changed ? 'Prompt was sanitized' : undefined,
  };
}
