/**
 * Keyword blocklist for auto-flagging content.
 *
 * Distinct from the severity-based contentFilter — this module provides
 * a simple keyword list and matching function suitable for use in any
 * auto-flagging pipeline (comment creation, asset descriptions, etc.).
 *
 * Matching is case-insensitive and uses word-boundary anchors to avoid
 * false positives (e.g. "grass" will NOT match "ass").
 */

export const DEFAULT_BLOCKED_KEYWORDS: string[] = [
  // Profanity
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'whore',
  'dick',
  'cock',
  'pussy',
  'bastard',
  'prick',
  'twat',
  'wanker',
  'bollocks',
  'motherfucker',
  'jackass',
  // Slurs (abbreviated — full list managed via MODERATION_BLOCK_LIST env var)
  'retard',
  'faggot',
  // Spam triggers
  'buy now',
  'click here',
  'free money',
  'make money fast',
  'work from home',
  'lose weight fast',
  'limited offer',
  'act now',
  'guaranteed',
  // Harmful content
  'suicide',
  'self-harm',
  'self harm',
  'kill yourself',
  'kys',
];

/**
 * Check whether the given text contains any keyword from the blocklist.
 *
 * Uses word-boundary matching so partial-word substrings are not flagged
 * (e.g. "grass" does NOT match the keyword "ass").
 *
 * Multi-word phrases (e.g. "buy now") are matched as literal substrings
 * (case-insensitive) without word-boundary wrapping so that natural spacing
 * is respected.
 *
 * @param text     The text to check.
 * @param keywords Optional custom list; falls back to DEFAULT_BLOCKED_KEYWORDS.
 * @returns true if the text contains at least one blocked keyword.
 */
export function containsBlockedKeyword(
  text: string,
  keywords: string[] = DEFAULT_BLOCKED_KEYWORDS
): boolean {
  const normalised = text.toLowerCase();

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;

    if (trimmed.includes(' ')) {
      // Multi-word phrase: plain substring match
      if (normalised.includes(trimmed.toLowerCase())) {
        return true;
      }
    } else {
      // Single word: word-boundary match to avoid false positives
      const pattern = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, 'i');
      if (pattern.test(text)) {
        return true;
      }
    }
  }

  return false;
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
